-- Profile "All time" progress line — MATERIALIZE the per-session pace/fillers/pauses as
-- real columns + an all-time bucket-aggregate RPC that reads them.
--
-- Why: `score` is already a real column (cheap to AVG), but pace/fillers/pauses live in
-- the `data` jsonb. Aggregating those across ALL of a user's history would detoast every
-- session's transcript/word blob (the cost driver). Per the app's schema rule ("anything
-- you filter/sort/AGGREGATE on becomes a real column"), promote them to columns so the
-- all-time aggregate is a pure indexed/inline-column scan — flat cost at any scale. The
-- `data` jsonb stays the replay source of truth; these columns are the query projection.
--
-- Populated by a BEFORE INSERT trigger (ONE place, identical to the backfill below, so old
-- and new rows can't drift) — no client save-path changes. The extraction MIRRORS the
-- metric_trends RPC (20260704120000): single value from data->'metrics', or the avg across
-- data->'rounds' for TTO (round-avg baked in at write time, like `score`). data-metrics are
-- immutable after insert (the only post-insert `data` change is the audioPath patch, which
-- doesn't touch metrics), so BEFORE INSERT is sufficient.

-- (a) The materialized columns.
alter table public.sessions
  add column pace numeric,     -- words/min (session-level; TTO = round avg). Mirrors data->'metrics'->>'wpm'.
  add column fillers numeric,  -- filler density /min. Mirrors data->'metrics'->>'fillerDensityPerMin'.
  add column pauses numeric;   -- hesitation pause count. Mirrors data->'metrics'->>'hesitationPauseCount'.

-- (b) BEFORE INSERT trigger — derive the three columns from the row's own `data`.
-- security invoker + empty search_path (jsonb_*/avg are pg_catalog, always visible); it only
-- assigns NEW.* on the row being inserted, so it needs no elevated privileges.
create function public.set_session_metrics()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.pace := case when new.mode = 'tto' then
      (case when jsonb_typeof(new.data->'rounds') = 'array' then
        (select avg((r->'metrics'->>'wpm')::numeric)
           from jsonb_array_elements(new.data->'rounds') r) end)
    else (new.data->'metrics'->>'wpm')::numeric end;
  new.fillers := case when new.mode = 'tto' then
      (case when jsonb_typeof(new.data->'rounds') = 'array' then
        (select avg((r->'metrics'->>'fillerDensityPerMin')::numeric)
           from jsonb_array_elements(new.data->'rounds') r) end)
    else (new.data->'metrics'->>'fillerDensityPerMin')::numeric end;
  new.pauses := case when new.mode = 'tto' then
      (case when jsonb_typeof(new.data->'rounds') = 'array' then
        (select avg((r->'metrics'->>'hesitationPauseCount')::numeric)
           from jsonb_array_elements(new.data->'rounds') r) end)
    else (new.data->'metrics'->>'hesitationPauseCount')::numeric end;
  return new;
end;
$$;

create trigger set_session_metrics_trg
  before insert on public.sessions
  for each row execute function public.set_session_metrics();

-- (c) Backfill existing rows — one-time, IDENTICAL logic to the trigger.
update public.sessions s set
  pace = case when s.mode = 'tto' then
      (case when jsonb_typeof(s.data->'rounds') = 'array' then
        (select avg((r->'metrics'->>'wpm')::numeric)
           from jsonb_array_elements(s.data->'rounds') r) end)
    else (s.data->'metrics'->>'wpm')::numeric end,
  fillers = case when s.mode = 'tto' then
      (case when jsonb_typeof(s.data->'rounds') = 'array' then
        (select avg((r->'metrics'->>'fillerDensityPerMin')::numeric)
           from jsonb_array_elements(s.data->'rounds') r) end)
    else (s.data->'metrics'->>'fillerDensityPerMin')::numeric end,
  pauses = case when s.mode = 'tto' then
      (case when jsonb_typeof(s.data->'rounds') = 'array' then
        (select avg((r->'metrics'->>'hesitationPauseCount')::numeric)
           from jsonb_array_elements(s.data->'rounds') r) end)
    else (s.data->'metrics'->>'hesitationPauseCount')::numeric end;

-- (d) All-time RPC — the user's four metrics bucket-AVERAGED over time (day/week/month),
-- a PURE column aggregate (no jsonb, no TTO CASE — the round-avg is already in the columns).
-- Output is BOUNDED (<= ~60 buckets) regardless of session count — the whole point vs.
-- paging raw rows. Adaptive unit chosen server-side from the history span; it rides back on
-- every row so the client labels the footer without a second query. Same hardening as the
-- other read RPCs (SECURITY INVOKER + RLS + empty search_path + user_id predicate).
create function public.metric_trends_all_time()
returns table (
  bucket_start timestamp,
  avg_score numeric,
  avg_pace numeric,
  avg_fillers numeric,
  avg_pauses numeric,
  session_count bigint,
  bucket_unit text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_min  date;
  v_max  date;
  v_span int;
  v_unit text;
begin
  -- Span of the user's history, by the SAME device-local bucket date the rows group on
  -- (local_date, falling back to created_at's date for any null local_date).
  select
    min(coalesce(s.local_date, s.created_at::date)),
    max(coalesce(s.local_date, s.created_at::date))
    into v_min, v_max
    from public.sessions s
   where s.user_id = auth.uid();

  -- No sessions -> no buckets. The caller renders the empty state.
  if v_min is null then
    return;
  end if;

  v_span := v_max - v_min;  -- date - date = whole days

  -- Adaptive unit, bounded to <= ~60 buckets:
  --   <= 42 days  (6 weeks)   -> 'day'   (<= 43 daily buckets)
  --   <= 420 days (~60 weeks) -> 'week'  (<= 61 weekly buckets)
  --   else                    -> 'month' (12/yr; ~a decade before it passes ~60)
  if v_span <= 42 then
    v_unit := 'day';
  elsif v_span <= 420 then
    v_unit := 'week';
  else
    v_unit := 'month';
  end if;

  -- Cast the bucket date to ::timestamp BEFORE date_trunc: a bare `date` is ambiguously
  -- castable to timestamp/timestamptz (overload error), and timestamp (not timestamptz) is
  -- correct here — the value is already a device-local calendar date, so there's no tz to
  -- reinterpret, and a `timestamp` serializes without a `Z` so JS parses it as LOCAL (no
  -- off-by-one in the footer date labels). avg() skips nulls -> an all-null bucket yields
  -- null for that metric (the client draws a gap).
  return query
    select
      date_trunc(v_unit, (coalesce(s.local_date, s.created_at::date))::timestamp) as bucket_start,
      avg(s.score)   as avg_score,
      avg(s.pace)    as avg_pace,
      avg(s.fillers) as avg_fillers,
      avg(s.pauses)  as avg_pauses,
      count(*)::bigint as session_count,
      v_unit           as bucket_unit
    from public.sessions s
    where s.user_id = auth.uid()  -- belt-and-suspenders; RLS scopes anyway
    group by date_trunc(v_unit, (coalesce(s.local_date, s.created_at::date))::timestamp)
    order by bucket_start asc;
end;
$$;

-- Least privilege: signed-in users only (RLS still scopes each to their own rows).
revoke all on function public.metric_trends_all_time() from public;
grant execute on function public.metric_trends_all_time() to authenticated;
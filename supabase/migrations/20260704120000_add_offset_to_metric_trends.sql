-- Profile-tab progress graph — add OFFSET paging to metric_trends so the chart can
-- page through history one window at a time (page k = offset k*limit back from
-- newest). The client asks for limit+1 rows and drops the ascending-FIRST "peek" row
-- when present — its existence means an older page exists (drives the Back arrow's
-- grey-out) with no count query; has-newer is knowable client-side (page > 0).
--
-- Also restructured for deep offsets: the innermost subquery picks the winning ids
-- ONLY (a walk of sessions_user_created_idx — the offset-skipped rows never detoast
-- the big `data` jsonb or run the TTO avg() subplans), then joins back to
-- public.sessions so the jsonb extraction runs on just the <= p_limit winners. With
-- the old single-pass shape, `limit 11 offset 990` would have evaluated the
-- extraction for all ~1001 rows walked.
--
-- Adding a parameter to the existing function would create an OVERLOAD next to
-- metric_trends(int), and PostgREST then rejects every call that omits p_offset as
-- ambiguous (PGRST203) — so DROP + recreate, same precedent as 20260703180000.
-- Everything else is unchanged: same RETURNS TABLE, same metric extraction
-- (data->'metrics', TTO-averaged over data->'rounds'), same SECURITY INVOKER + RLS +
-- search_path hardening, same chronological ordering, same
-- SerializableSessionMetrics coupling on the jsonb keys.
drop function if exists public.metric_trends(int);

create function public.metric_trends(p_limit int default 20, p_offset int default 0)
returns table (
  id uuid,
  created_at timestamptz,
  mode text,
  score numeric,
  duration_sec numeric,
  prompt text,
  custom_title text,
  favorite boolean,
  pace numeric,
  fillers numeric,
  pauses numeric,
  pace_low numeric,
  pace_high numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  return query
    select
      s.id,
      s.created_at,
      s.mode,
      s.score,
      s.duration_sec,
      s.prompt,
      s.custom_title,
      s.favorite,
      -- Pace / fillers / pauses: single value from data->'metrics', or the average
      -- across TTO rounds (jsonb_typeof guard; avg() skips too-short rounds → null).
      case when s.mode = 'tto' then
        (case when jsonb_typeof(s.data->'rounds') = 'array' then
          (select avg((r->'metrics'->>'wpm')::numeric)
             from jsonb_array_elements(s.data->'rounds') r) end)
      else (s.data->'metrics'->>'wpm')::numeric end as pace,
      case when s.mode = 'tto' then
        (case when jsonb_typeof(s.data->'rounds') = 'array' then
          (select avg((r->'metrics'->>'fillerDensityPerMin')::numeric)
             from jsonb_array_elements(s.data->'rounds') r) end)
      else (s.data->'metrics'->>'fillerDensityPerMin')::numeric end as fillers,
      case when s.mode = 'tto' then
        (case when jsonb_typeof(s.data->'rounds') = 'array' then
          (select avg((r->'metrics'->>'hesitationPauseCount')::numeric)
             from jsonb_array_elements(s.data->'rounds') r) end)
      else (s.data->'metrics'->>'hesitationPauseCount')::numeric end as pauses,
      -- Pace band: rounds share the profile band at finalize, so read round 0 for TTO
      -- (do NOT average bands). null → client defaults to DEFAULT_PACE_TARGET.
      case when s.mode = 'tto'
        then (s.data->'rounds'->0->'metrics'->>'paceTargetLow')::numeric
        else (s.data->'metrics'->>'paceTargetLow')::numeric end as pace_low,
      case when s.mode = 'tto'
        then (s.data->'rounds'->0->'metrics'->>'paceTargetHigh')::numeric
        else (s.data->'metrics'->>'paceTargetHigh')::numeric end as pace_high
    from public.sessions s
    join (
      select w.id
      from public.sessions w
      where w.user_id = auth.uid()
      order by w.created_at desc, w.id desc
      limit p_limit offset p_offset
    ) picked on picked.id = s.id
    where s.user_id = auth.uid()  -- belt-and-suspenders; RLS scopes anyway
    order by s.created_at asc, s.id asc;
end;
$$;

-- Least privilege: signed-in users only (RLS still scopes each to their own rows).
-- NOTE the (int, int) signature — privileges are per-signature, and the old (int)
-- function no longer exists.
revoke all on function public.metric_trends(int, int) from public;
grant execute on function public.metric_trends(int, int) to authenticated;
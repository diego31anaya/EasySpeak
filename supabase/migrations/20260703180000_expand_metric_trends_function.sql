-- Profile-tab progress graph — EXPAND metric_trends to ALSO return each session's
-- display fields (id / duration_sec / prompt / custom_title / favorite), so tapping a
-- dot can show the same SessionCard as Home/History AND route to that session's review
-- WITHOUT a second query. The returned row is now a superset of SessionListItem + the
-- metric values.
--
-- The RETURNS TABLE signature changes, so we DROP + recreate (create-or-replace can't
-- change a function's return type). Everything else is unchanged from
-- 20260703120000: same metric extraction (data->'metrics', TTO-averaged over
-- data->'rounds'), same SECURITY INVOKER + RLS + search_path hardening, same
-- chronological ordering, same SerializableSessionMetrics coupling on the jsonb keys.
drop function if exists public.metric_trends(int);

create function public.metric_trends(p_limit int default 20)
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
    select t.id, t.created_at, t.mode, t.score, t.duration_sec, t.prompt, t.custom_title,
           t.favorite, t.pace, t.fillers, t.pauses, t.pace_low, t.pace_high
    from (
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
      where s.user_id = auth.uid()
      order by s.created_at desc, s.id desc
      limit p_limit
    ) t
    order by t.created_at asc, t.id asc;
end;
$$;

-- Least privilege: signed-in users only (RLS still scopes each to their own rows).
revoke all on function public.metric_trends(int) from public;
grant execute on function public.metric_trends(int) to authenticated;
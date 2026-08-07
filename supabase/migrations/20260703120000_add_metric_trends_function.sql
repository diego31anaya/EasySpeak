-- Profile-tab progress graph: per-session metric values for the last N sessions.
--
-- Why an RPC: the graph plots score/pace/fillers/pauses across recent sessions, but
-- only `score` is a real column — pace/fillers/pauses live inside the `data` jsonb
-- (`data->'metrics'` for single-recording modes; averaged across `data->'rounds'`
-- for TTO, mirroring how saveTtoSession already round-averages the score). Doing that
-- extraction + TTO aggregation IN THE DATABASE keeps the payload to N tiny rows and
-- one query, instead of pulling every session's full `data` blob (transcript+words).
--
-- ⚠️ COUPLING: the jsonb field names below (`wpm`, `fillerDensityPerMin`,
-- `hesitationPauseCount`, `paceTargetLow`, `paceTargetHigh`) are the SerializableSessionMetrics
-- field names in lib/metrics.ts. If those are renamed, this function silently returns
-- null for that metric — update both together.
--
-- Returns RAW values only; the good/warning/danger band is computed client-side
-- (lib/metric-status.ts) so the thresholds stay single-source. Rows come back
-- CHRONOLOGICAL (oldest→newest) so the chart plots left→right directly. null-score
-- rows are KEPT (unlike lesson_scores) — a session with a failed AI score still has
-- valid pace/fillers/pauses. SECURITY INVOKER + RLS + search_path hardening copied
-- from lesson_scores.
create or replace function public.metric_trends(p_limit int default 20)
returns table (
  created_at timestamptz,
  mode text,
  score numeric,
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
    select t.created_at, t.mode, t.score, t.pace, t.fillers, t.pauses, t.pace_low, t.pace_high
    from (
      select
        s.created_at,
        s.mode,
        s.score,
        -- Pace / fillers / pauses: single value from data->'metrics', or the average
        -- across TTO rounds (jsonb_typeof guard — jsonb_array_elements throws on a
        -- non-array; avg() skips too-short rounds whose metric is absent → null).
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
        -- Pace band: rounds share the profile band at finalize, so read round 0 for
        -- TTO (do NOT average bands). null → client defaults to DEFAULT_PACE_TARGET.
        case when s.mode = 'tto'
          then (s.data->'rounds'->0->'metrics'->>'paceTargetLow')::numeric
          else (s.data->'metrics'->>'paceTargetLow')::numeric end as pace_low,
        case when s.mode = 'tto'
          then (s.data->'rounds'->0->'metrics'->>'paceTargetHigh')::numeric
          else (s.data->'metrics'->>'paceTargetHigh')::numeric end as pace_high,
        s.id
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
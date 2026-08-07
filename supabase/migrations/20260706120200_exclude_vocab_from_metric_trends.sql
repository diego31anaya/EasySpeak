-- Exclude 'vocab' sessions from the Profile paged progress chart. Vocab describe-sessions
-- have no delivery metrics (pace/fillers/pauses) and their score is meaning-accuracy, not
-- delivery — so they don't belong on the per-session trend chart (they still count toward
-- the streak + show in History). DROP+recreate (PGRST203 overload rule); identical to
-- 20260704120000 except the inner id-picker adds `and w.mode <> 'vocab'`.
drop function if exists public.metric_trends(int, int);

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
        and w.mode <> 'vocab'  -- vocab has no delivery metrics; keep it off the trend chart
      order by w.created_at desc, w.id desc
      limit p_limit offset p_offset
    ) picked on picked.id = s.id
    where s.user_id = auth.uid()  -- belt-and-suspenders; RLS scopes anyway
    order by s.created_at asc, s.id asc;
end;
$$;

revoke all on function public.metric_trends(int, int) from public;
grant execute on function public.metric_trends(int, int) to authenticated;
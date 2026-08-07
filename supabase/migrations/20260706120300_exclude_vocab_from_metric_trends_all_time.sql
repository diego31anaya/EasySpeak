-- Exclude 'vocab' sessions from the Profile "All time" progress chart too — same rationale
-- as 20260706120200 (vocab has no delivery metrics; still counts for streak + History).
-- Identical to the function in 20260705120000 except `and s.mode <> 'vocab'` is added in
-- BOTH the span select (so a vocab-only day can't widen the bucket span/unit) AND the
-- aggregate select (so vocab can't dilute a bucket average). DROP+recreate (PGRST203).
drop function if exists public.metric_trends_all_time();

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
  select
    min(coalesce(s.local_date, s.created_at::date)),
    max(coalesce(s.local_date, s.created_at::date))
    into v_min, v_max
    from public.sessions s
   where s.user_id = auth.uid()
     and s.mode <> 'vocab';  -- vocab out of the delivery progress chart

  if v_min is null then
    return;
  end if;

  v_span := v_max - v_min;

  if v_span <= 42 then
    v_unit := 'day';
  elsif v_span <= 420 then
    v_unit := 'week';
  else
    v_unit := 'month';
  end if;

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
      and s.mode <> 'vocab'
    group by date_trunc(v_unit, (coalesce(s.local_date, s.created_at::date))::timestamp)
    order by bucket_start asc;
end;
$$;

revoke all on function public.metric_trends_all_time() from public;
grant execute on function public.metric_trends_all_time() to authenticated;
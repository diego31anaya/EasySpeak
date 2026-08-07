-- Profile-tab "View All Sessions" summary card — aggregate stats over ALL of the
-- user's sessions in ONE row, computed IN the database (never a load-all-and-count on
-- the client, the reason the old countSessions was removed). Same least-privilege
-- shape as lesson_scores / metric_trends: SECURITY INVOKER so RLS scopes the rows to
-- the caller, empty search_path, execute granted to authenticated only.
--
-- Aggregates over zero rows still return exactly one row (count 0, sum null→0 via
-- coalesce), so the client always gets a stats row.
create function public.session_stats()
returns table (
  total_sessions bigint,
  total_duration_sec numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*)::bigint as total_sessions,
    coalesce(sum(s.duration_sec), 0) as total_duration_sec
  from public.sessions s
  where s.user_id = auth.uid();
$$;

revoke all on function public.session_stats() from public;
grant execute on function public.session_stats() to authenticated;
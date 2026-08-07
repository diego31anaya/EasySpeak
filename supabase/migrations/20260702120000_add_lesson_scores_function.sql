-- Practice-tab ring scores: one AI score per session mode, computed IN THE DATABASE.
--
-- Why an RPC: getLessonScores() used to fetch EVERY scored row in the requested
-- modes newest-first and keep only the first-per-mode on the client — O(the user's
-- whole history in those modes) over the wire for an answer that is always <= one
-- row per mode, re-run on every Practice-tab focus. This function does the
-- "reduce to one row per mode" work in Postgres, so the client gets back at most
-- one row per requested mode regardless of how much history exists.
--
-- SECURITY INVOKER (the default — stated here for contrast with
-- bump_streak_on_session's SECURITY DEFINER): this function only READS sessions, so
-- it runs as the calling user and the table's RLS policy ("Users manage own
-- sessions", using auth.uid() = user_id) scopes the rows. The explicit
-- `user_id = auth.uid()` predicate is belt-and-suspenders on top of RLS. search_path
-- is pinned empty and every reference is schema-qualified (Supabase function hardening).
--
-- strategy:
--   'last' (default) — the NEWEST scored session per mode ("current form").
--   'best'           — the HIGHEST score ever earned per mode.
-- Null scores (AI feedback failed) are excluded either way, so a failed attempt can
-- never blank a mode that has a real prior score.
create or replace function public.lesson_scores(p_modes text[], p_strategy text default 'last')
returns table (mode text, score numeric)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_strategy = 'best' then
    return query
      select s.mode, max(s.score)
        from public.sessions s
       where s.user_id = auth.uid()
         and s.mode = any (p_modes)
         and s.score is not null
       group by s.mode;
  else
    -- DISTINCT ON keeps the first row of each mode group; the ORDER BY makes that the
    -- newest scored one (created_at desc), with id desc as a deterministic tiebreaker.
    return query
      select distinct on (s.mode) s.mode, s.score
        from public.sessions s
       where s.user_id = auth.uid()
         and s.mode = any (p_modes)
         and s.score is not null
       order by s.mode, s.created_at desc, s.id desc;
  end if;
end;
$$;

-- Least privilege: callable only by signed-in users (RLS still scopes what each one
-- sees); never exposed to the anon role.
revoke all on function public.lesson_scores(text[], text) from public;
grant execute on function public.lesson_scores(text[], text) to authenticated;

-- Future scale note (deferred — trivial at current volumes, and the function already
-- returns <= (#modes) rows): if these modes accumulate deep history, an index on
-- (user_id, mode, created_at desc) turns the 'last' DISTINCT ON into an index scan
-- instead of a sort.
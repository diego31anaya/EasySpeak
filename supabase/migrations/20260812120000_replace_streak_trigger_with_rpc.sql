-- Replace the per-session streak trigger with an explicit RPC used only when the
-- client has not yet confirmed a practice for its current local calendar day.
--
-- The RPC inserts the qualifying session and updates the profile streak in one
-- transaction. Later same-day sessions use the normal sessions insert and do no
-- streak work. The row lock and same-day branch keep this RPC idempotent when two
-- saves race before the client receives the first result.

drop trigger if exists trg_bump_streak_on_session on public.sessions;
drop function if exists public.bump_streak_on_session();

create function public.save_session_with_streak(
  p_mode text,
  p_score numeric,
  p_duration_sec numeric,
  p_prompt text,
  p_custom_title text,
  p_local_date date,
  p_data jsonb
)
returns table (
  session_id uuid,
  streak_event text,
  current_streak integer,
  longest_streak integer,
  last_active_date date
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_event text := 'none';
  v_current integer;
  v_longest integer;
  v_last date;
begin
  if v_user_id is null then
    raise exception 'save_session_with_streak requires an authenticated user'
      using errcode = '42501';
  end if;

  if p_local_date is null then
    raise exception 'save_session_with_streak requires p_local_date'
      using errcode = '22004';
  end if;

  -- Serialize competing first-session calls for this user. A second call waits,
  -- sees that the first call already recorded p_local_date, and returns `none`.
  select
    p.current_streak,
    p.longest_streak,
    p.last_active_date
    into v_current, v_longest, v_last
    from public.profiles as p
   where p.id = v_user_id
   for update;

  -- Keep session creation and streak advancement atomic. A missing profile is an
  -- account-integrity error, so fail the call instead of saving an uncounted first
  -- session for the day.
  if not found then
    raise exception 'profile not found for authenticated user'
      using errcode = 'P0002';
  end if;

  insert into public.sessions (
    user_id,
    mode,
    score,
    duration_sec,
    prompt,
    custom_title,
    local_date,
    data
  )
  values (
    v_user_id,
    p_mode,
    p_score,
    p_duration_sec,
    p_prompt,
    p_custom_title,
    p_local_date,
    p_data
  )
  returning id into v_session_id;

  if v_last is null then
    -- First recorded practice.
    v_current := 1;
    v_event := 'started';
  elsif p_local_date = v_last then
    -- Another RPC won a race for this local day. The session is still saved, but
    -- the streak was already counted.
    v_event := 'none';
  elsif p_local_date = v_last + 1 then
    -- Consecutive local calendar day.
    v_current := v_current + 1;
    v_event := 'continued';
  elsif p_local_date < v_last then
    -- Do not rewrite streak history for a backdated/out-of-order session.
    v_event := 'none';
  else
    -- Gap of two or more local days: start a new run at day one.
    v_current := 1;
    v_event := 'started';
  end if;

  if v_event <> 'none' then
    v_longest := greatest(v_longest, v_current);
    v_last := p_local_date;

    update public.profiles as p
       set current_streak = v_current,
           longest_streak = v_longest,
           last_active_date = v_last,
           updated_at = now()
     where p.id = v_user_id;
  end if;

  return query
  select
    v_session_id,
    v_event,
    v_current,
    v_longest,
    v_last;
end;
$$;

-- SECURITY DEFINER bypasses table RLS, so the function fixes ownership to
-- auth.uid() above and is callable only by signed-in clients.
revoke all on function public.save_session_with_streak(
  text,
  numeric,
  numeric,
  text,
  text,
  date,
  jsonb
) from public;

grant execute on function public.save_session_with_streak(
  text,
  numeric,
  numeric,
  text,
  text,
  date,
  jsonb
) to authenticated;

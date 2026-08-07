-- The immutable local-day bucket on each session. Captured CLIENT-SIDE at save
-- (only the device knows its timezone), so the streak is "consecutive local days"
-- with no server timezone math. Nullable so the column can be added to a table
-- with existing rows; new inserts always provide it.
alter table public.sessions
  add column local_date date;

-- Best-effort backfill of existing (dev) rows from created_at. created_at is a UTC
-- instant and no device tz was recorded, so this is approximate (off-by-one near a
-- day boundary) — fine because it's dev data and the value never feeds the trigger
-- (the trigger only fires on NEW inserts going forward).
update public.sessions
  set local_date = (created_at)::date
  where local_date is null;

-- Maintains the cached streak counter on profiles whenever a session is inserted.
-- SECURITY DEFINER because it UPDATEs public.profiles (the inserting client should
-- not need direct write access to these columns); search_path pinned for safety.
create or replace function public.bump_streak_on_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last date;
  v_current integer;
  v_longest integer;
begin
  -- A row with no local_date can't advance the streak (shouldn't happen for real
  -- inserts; guards a malformed/legacy row).
  if new.local_date is null then
    return new;
  end if;

  select last_active_date, current_streak, longest_streak
    into v_last, v_current, v_longest
    from public.profiles
   where id = new.user_id
   for update;

  -- No profile row (signup race): don't error / roll back the session insert.
  if not found then
    return new;
  end if;

  if v_last is null then
    -- First ever activity.
    v_current := 1;
  elsif new.local_date = v_last then
    -- Same local day, already counted today. No change.
    return new;
  elsif new.local_date = v_last + 1 then
    -- Consecutive local day.
    v_current := v_current + 1;
  elsif new.local_date < v_last then
    -- Out-of-order / backdated insert (wrong device clock, or a seeder writing an
    -- older date after a newer one): don't rewrite history.
    return new;
  else
    -- Gap of 2+ local days: streak broke, restart at 1 (strict, no grace in v1).
    v_current := 1;
  end if;

  v_longest := greatest(coalesce(v_longest, 0), v_current);

  update public.profiles
     set current_streak   = v_current,
         longest_streak    = v_longest,
         last_active_date  = new.local_date,
         updated_at        = now()
   where id = new.user_id;

  return new;
end;
$$;

create trigger trg_bump_streak_on_session
  after insert on public.sessions
  for each row
  execute function public.bump_streak_on_session();
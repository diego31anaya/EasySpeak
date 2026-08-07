-- Daily streak: a denormalized counter cached on the profile. Activity's source
-- of truth is sessions.local_date (next migration); this counter is maintained by
-- an AFTER INSERT trigger on sessions and is recomputable from sessions at any
-- time. The READ path derives "is the streak still alive" from last_active_date
-- vs the device's local today (alive iff today or yesterday) — no cron, no
-- stored is_alive boolean.
alter table public.profiles
  add column current_streak integer not null default 0,
  add column longest_streak integer not null default 0,
  add column last_active_date date;
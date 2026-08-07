-- Practice-reminder preference (added 20260630).
-- The reminder is a LOCAL notification scheduled on-device and fired by the OS;
-- AsyncStorage is the device source of truth. These columns are a BACKUP MIRROR
-- so the setting restores on reinstall / a new device (written best-effort by
-- lib/notifications.ts; the local schedule works with or without them).
alter table public.profiles
  add column reminder_enabled boolean not null default false,
  add column reminder_hour integer not null default 19,
  add column reminder_minute integer not null default 0;

alter table public.profiles
  add constraint profiles_reminder_hour_check check (reminder_hour between 0 and 23),
  add constraint profiles_reminder_minute_check check (reminder_minute between 0 and 59);
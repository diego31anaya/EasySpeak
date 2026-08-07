-- Widen the sessions.mode CHECK to allow the new 'explain' practice mode.
-- The original constraint (create_sessions.sql) is an anonymous inline check,
-- which Postgres auto-names `sessions_mode_check`. Without this, an `explain`
-- insert is silently rejected and the fire-and-forget save swallows the error,
-- so the session never appears in History.

alter table public.sessions drop constraint sessions_mode_check;

alter table public.sessions
  add constraint sessions_mode_check check (mode in ('impromptu', 'tto', 'explain'));
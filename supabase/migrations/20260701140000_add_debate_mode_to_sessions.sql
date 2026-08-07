-- Widen the sessions.mode CHECK to allow the new 'debate' practice mode.
-- Same rationale as the explain/storytelling migrations: the constraint is an
-- allow-list (auto-named `sessions_mode_check`), so an unlisted mode is silently
-- rejected and the fire-and-forget save swallows the error → the session never
-- appears in History. Re-adds the constraint with 'debate' included.

alter table public.sessions drop constraint sessions_mode_check;

alter table public.sessions
  add constraint sessions_mode_check check (mode in ('impromptu', 'tto', 'explain', 'storytelling', 'debate'));
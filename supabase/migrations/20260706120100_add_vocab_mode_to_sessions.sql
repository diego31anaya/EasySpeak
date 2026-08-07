-- Widen the sessions.mode CHECK to allow the new 'vocab' practice mode (describe-a-word
-- sessions count as practice → they insert a sessions row so the streak trigger fires and
-- they show in History). Same pattern as the explain/storytelling/debate/prep widenings;
-- without it a 'vocab' insert is silently rejected and nothing appears in History.

alter table public.sessions drop constraint sessions_mode_check;

alter table public.sessions
  add constraint sessions_mode_check
  check (mode in ('impromptu', 'tto', 'explain', 'storytelling', 'debate', 'prep', 'vocab'));
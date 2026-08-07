-- Per-user practice focus (the "What you're working on" setting). A single
-- stable preset KEY (e.g. 'interview') from lib/focus.ts; nullable, null = not set
-- (the AI behaves as it does today). Unconstrained on purpose: the valid set is the
-- app's preset list, which evolves without a migration — the read path (focusPreset)
-- treats any unknown/legacy key as "not set". No index: nothing filters/sorts on it.
-- RLS unchanged — the existing own-row profiles policies cover this column.
alter table public.profiles
  add column focus text;
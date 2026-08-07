-- User-editable session title. Nullable with no default: null means "no custom
-- title set", so display falls back to the derived default (mode label / prompt).
-- Keeping the original prompt intact (the `prompt` column) means clearing a
-- custom title is a clean fallback, not data loss.
-- No index yet: nothing filters/sorts on it. The future search pass adds a
-- trigram index when it starts matching `custom_title`/`prompt`.
alter table public.sessions
  add column custom_title text;
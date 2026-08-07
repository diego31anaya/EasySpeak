-- Per-user custom filler words/phrases. Each element is a normalized entry of
-- 1–2 tokens (e.g. 'actually', 'sort of'); merged into filler detection (and
-- pause classification) at finalize via lib/filler-word's buildFillerLexicon.
-- NOT NULL + default '{}' backfills every existing row to an empty list, so the
-- read path never has to handle null. No index: nothing filters/sorts on it.
-- RLS is unchanged — the existing own-row profiles policies cover this column.
alter table public.profiles
  add column custom_fillers text[] not null default '{}';
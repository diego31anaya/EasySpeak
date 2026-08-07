-- Vocabulary feature — the user's personal word list. One row per word the user is
-- learning; holds the cached dictionary definition (fetched once at add-time so the list
-- is instant + offline-resilient) and `best_score` = the best "describe this word in your
-- own words" session score, which drives the per-word mastery ring (read straight off the
-- column — no grouping RPC, unlike the per-mode lesson_scores). RLS/index style mirrors
-- public.sessions (20260531173328_create_sessions.sql).

create table if not exists public.vocab_words (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users on delete cascade,
  word              text not null,
  part_of_speech    text,
  definition        text,          -- nullable: a 404 (rare word) is still addable, definition null
  example           text,
  phonetic          text,
  audio_url         text,          -- dictionary human audio; cached for a future "native speaker" toggle (Pronounce uses expo-speech)
  best_score        numeric check (best_score is null or (best_score >= 1 and best_score <= 10)),
  created_at        timestamptz not null default now(),
  last_practiced_at timestamptz
);

-- List query: "my words, newest first."
create index if not exists vocab_words_user_created_idx
  on public.vocab_words (user_id, created_at desc);

-- One row per user + word, CASE-INSENSITIVE ("Ephemeral" == "ephemeral") — powers the
-- duplicate-add guard (a 23505 unique violation → "already in your list").
create unique index if not exists vocab_words_user_word_unique
  on public.vocab_words (user_id, lower(word));

alter table public.vocab_words enable row level security;

create policy "Users manage own vocab"
  on public.vocab_words
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
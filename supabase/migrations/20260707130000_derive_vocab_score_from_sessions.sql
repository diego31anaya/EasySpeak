-- The per-word vocab ring is now DERIVED from the sessions table (the source of truth for
-- scores) instead of a denormalized column. Deleting a describe-session now correctly
-- updates the ring — the old `last_score` copy went stale on delete (showed a score for a
-- session that no longer existed). This mirrors how the rest of the app reads scores
-- straight off `sessions` (recompute-on-read); the denormalized column was the one
-- exception, and the one that broke.
--
-- Drop both denormalized columns (last_score was renamed from best_score in 20260707120000;
-- last_practiced_at was stamped on save but never read). Add an RPC returning each word +
-- its latest SCORED vocab-session score (score is null when AI feedback failed — skip those
-- so a feedback error doesn't blank the ring, matching the old write behavior).

alter table public.vocab_words drop column last_score;
alter table public.vocab_words drop column last_practiced_at;

create or replace function public.vocab_words_with_scores()
returns table (
  id uuid,
  word text,
  part_of_speech text,
  definition text,
  example text,
  phonetic text,
  audio_url text,
  last_score numeric,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    w.id, w.word, w.part_of_speech, w.definition, w.example, w.phonetic, w.audio_url,
    (
      select s.score
      from public.sessions s
      where s.user_id = auth.uid()
        and s.mode = 'vocab'
        and s.score is not null
        and (s.data->>'wordId') = w.id::text
      order by s.created_at desc, s.id desc
      limit 1
    ) as last_score,
    w.created_at
  from public.vocab_words w
  where w.user_id = auth.uid()
  order by w.created_at desc;
$$;

revoke all on function public.vocab_words_with_scores() from public;
grant execute on function public.vocab_words_with_scores() to authenticated;
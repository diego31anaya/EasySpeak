-- Track WHERE a vocab word's definition came from, so the AI rubric can branch on it.
--
-- The vocab feedback prompt does two things that both silently assume the definition is a
-- DICTIONARY definition:
--   1. it treats the definition as the ground truth to check the spoken description against;
--   2. it PENALIZES reciting the definition near-verbatim ("recall, not understanding").
--
-- Once the user can edit the definition (EditDefinitionSheet, 20260708), neither assumption
-- holds for an edited word:
--   * a user-authored definition can simply be WRONG, and grading against it rewards the
--     misconception while penalizing the actually-correct meaning;
--   * a user who wrote the definition in their own casual words will naturally echo it when
--     describing the word out loud, and get marked down for "recitation" precisely when they
--     do understand it.
--
-- Only 'dictionary' | 'user' are stored. The third state, 'none', is DERIVED client-side
-- when `definition is null` (a word Datamuse had no entry for and the user never wrote one),
-- so there's no way for the column and the definition to disagree.
--
-- Existing rows default to 'dictionary', which is correct: before this migration the only
-- writer of `definition` at add-time was the dictionary lookup.

alter table public.vocab_words
  add column definition_source text not null default 'dictionary'
  check (definition_source in ('dictionary', 'user'));

-- The list RPC has to return the new column. Widening the RETURNS TABLE type is a signature
-- change, which `create or replace` cannot do, so DROP first (same dance as the metric_trends
-- recreations). Body is otherwise identical to 20260707130000.
drop function if exists public.vocab_words_with_scores();

create function public.vocab_words_with_scores()
returns table (
  id uuid,
  word text,
  part_of_speech text,
  definition text,
  definition_source text,
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
    w.id, w.word, w.part_of_speech, w.definition, w.definition_source,
    w.example, w.phonetic, w.audio_url,
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
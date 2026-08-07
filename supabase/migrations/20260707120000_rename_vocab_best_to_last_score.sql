-- The per-word vocab ring now reflects the LATEST describe-attempt score, not the best,
-- to match every other mode's ring (which shows the session's own score). Rename the
-- denormalized column from best_score to last_score; it's still written on each attempt,
-- but now always OVERWRITTEN with the new score instead of raised to the running max.
-- The check constraint (1-10) travels with the column on rename; rename it too so its
-- name isn't misleading (guarded, since the auto-generated name could differ).

alter table public.vocab_words rename column best_score to last_score;

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'vocab_words_best_score_check'
  ) then
    alter table public.vocab_words
      rename constraint vocab_words_best_score_check to vocab_words_last_score_check;
  end if;
end $$;
-- Paginate inside the RPC so PostgreSQL selects one vocabulary page before
-- running the latest-session score lookup for each word. The extra row is a
-- lookahead sentinel used by the client to determine whether another page exists.

drop function if exists public.vocab_words_with_scores();
drop function if exists public.vocab_words_with_scores(integer, timestamptz, uuid);

create function public.vocab_words_with_scores(
  p_page_size integer,
  p_cursor_created_at timestamptz,
  p_cursor_id uuid
)
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
  with page as materialized (
    select
      w.id,
      w.word,
      w.part_of_speech,
      w.definition,
      w.definition_source,
      w.example,
      w.phonetic,
      w.audio_url,
      w.created_at
    from public.vocab_words w
    where w.user_id = auth.uid()
      and (
        p_cursor_created_at is null
        or (
          p_cursor_id is not null
          and (w.created_at, w.id) < (p_cursor_created_at, p_cursor_id)
        )
      )
    order by w.created_at desc, w.id desc
    limit p_page_size + 1
  )
  select
    p.id,
    p.word,
    p.part_of_speech,
    p.definition,
    p.definition_source,
    p.example,
    p.phonetic,
    p.audio_url,
    (
      select s.score
      from public.sessions s
      where s.user_id = auth.uid()
        and s.mode = 'vocab'
        and s.score is not null
        and (s.data->>'wordId') = p.id::text
      order by s.created_at desc, s.id desc
      limit 1
    ) as last_score,
    p.created_at
  from page p
  order by p.created_at desc, p.id desc;
$$;

revoke all on function public.vocab_words_with_scores(integer, timestamptz, uuid)
  from public;

grant execute on function public.vocab_words_with_scores(integer, timestamptz, uuid)
  to authenticated;

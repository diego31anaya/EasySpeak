// lib/vocab.ts
//
// The Vocabulary word list — CRUD against public.vocab_words (migration 20260706120000).
// Each row is a word the user is learning + its cached dictionary definition. The per-word
// ring (`lastScore`) is NOT stored here — it's DERIVED from the sessions table (the latest
// SCORED 'vocab' session for the word) via the vocab_words_with_scores() RPC, so deleting a
// session updates the ring with no stale denormalized copy (recompute-on-read, like the
// rest of the app). RLS remains the authorization boundary; direct table mutations
// also include an explicit user_id filter so Postgres can construct a narrower plan.

import { supabase } from './supabase';
import type { DictionaryEntry } from './dictionary';

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) throw new Error('Not signed in — cannot touch vocabulary.');
  return userId;
}

/**
 * Where a word's current definition came from. The AI rubric branches on this: a dictionary
 * definition is authoritative ground truth (and reciting it verbatim is penalized), while a
 * user-authored one is only what the user BELIEVES the word means (so it can be wrong, and
 * echoing it isn't "recitation"). `none` is DERIVED, never stored — it just means
 * `definition == null`, so the column and the definition can't disagree.
 */
export type DefinitionSource = 'dictionary' | 'user' | 'none';

export type VocabWord = {
  id: string;
  word: string;
  partOfSpeech: string | null;
  definition: string | null;
  definitionSource: DefinitionSource;
  example: string | null;
  phonetic: string | null;
  audioUrl: string | null;
  lastScore: number | null; // latest scored describe-session → the ring (derived; null until practiced)
  createdAt: string;
};

// Real columns only — used for the insert's returning clause. The ring's `lastScore` is
// derived server-side by the list RPC, so it's absent here (a freshly added word has no
// sessions yet → rings as null/unpracticed).
const INSERT_SELECT =
  'id, word, part_of_speech, definition, definition_source, example, phonetic, audio_url, created_at';

function mapRow(r: any): VocabWord {
  return {
    id: r.id,
    word: r.word,
    partOfSpeech: r.part_of_speech,
    definition: r.definition,
    // 'none' is derived, not stored: no definition means there is nothing to check a
    // description against, whatever the column happens to say.
    definitionSource:
      r.definition == null ? 'none' : r.definition_source === 'user' ? 'user' : 'dictionary',
    example: r.example,
    phonetic: r.phonetic,
    audioUrl: r.audio_url,
    lastScore: r.last_score ?? null,
    createdAt: r.created_at,
  };
}

export type VocabCursor = { createdAt: string; id: string } | null;

export async function fetchVocabWords({
  cursor = null,
  pageSize = 15,
}: {
  cursor?: VocabCursor;
  pageSize?: number;
} = {}): Promise<{ items: VocabWord[]; nextCursor: VocabCursor }> {
  const { data, error } = await supabase.rpc('vocab_words_with_scores', {
    p_page_size: pageSize,
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_id: cursor?.id ?? null,
  });

  if (error) throw error;

  const rows = data ?? [];
  const hasNextPage = rows.length > pageSize;
  const items = rows.slice(0, pageSize).map(mapRow);

  const last = items[items.length - 1];

  return {
    items,
    nextCursor:
      hasNextPage && last
        ? {
            createdAt: last.createdAt,
            id: last.id,
          }
        : null,
  };
}

export type AddVocabResult =
  | { status: 'added'; word: VocabWord }
  | { status: 'duplicate'; word: null };

/**
 * Capitalize the first letter for a clean, consistent word bank. Words that already
 * carry an uppercase letter (iPhone, pH, eBay) are left untouched so we don't mangle
 * intentional casing. The `lower(word)` unique index still catches case-variant dupes.
 */
function capitalizeWord(raw: string): string {
  const w = raw.trim();
  if (!w || w !== w.toLowerCase()) return w;
  return w[0].toUpperCase() + w.slice(1);
}

/**
 * Add a word (+ its cached dictionary entry, or null for a 404 word). The
 * `(user_id, lower(word))` unique index enforces one-per-word case-insensitively; a 23505
 * violation ⇒ the word is already in the list (friendly, not an error).
 */
export async function addVocabWord(
  word: string,
  entry: DictionaryEntry | null,
): Promise<AddVocabResult> {
  const userId = await currentUserId();

  const { data, error } = await supabase
    .from('vocab_words')
    .insert({
      user_id: userId,
      word: capitalizeWord(word),
      part_of_speech: entry?.partOfSpeech ?? null,
      definition: entry?.definition ?? null,
      example: entry?.example ?? null,
      phonetic: entry?.phonetic ?? null,
      audio_url: entry?.audioUrl ?? null,
    })
    .select(INSERT_SELECT)
    .single();

  if (error) {
    if ((error as any).code === '23505') return { status: 'duplicate', word: null };
    throw error;
  }
  return { status: 'added', word: mapRow(data) };
}

export async function deleteVocabWord(id: string): Promise<void> {
  const userId = await currentUserId();
  const { error } = await supabase
    .from('vocab_words')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

/**
 * Bulk delete (the vocab tab's hold-to-select flow). Words only — the `mode:'vocab'`
 * practice sessions are NOT touched (there's no FK; they stay in History as the practice
 * log). RLS-scoped like the single delete.
 */
export async function deleteVocabWords(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const userId = await currentUserId();
  const { error } = await supabase
    .from('vocab_words')
    .delete()
    .in('id', ids)
    .eq('user_id', userId);
  if (error) throw error;
}

/**
 * Edit a word's cached definition + part of speech in place (the word-detail edit sheet). Keeps
 * the row's id, so the word's ring + session history are untouched (unlike delete + re-add).
 * RLS-scoped. `partOfSpeech` is stored lowercase ("adjective") to match the dictionary + the
 * card's capitalize.
 *
 * `source` records who wrote the text the user just accepted: 'user' when they typed it, or
 * 'dictionary' when they hit "Revert to dictionary" and saved the fetched text unchanged. The
 * AI rubric branches on it (see DefinitionSource), so it must not be guessed here — the sheet
 * is the only place that knows.
 */
export async function updateVocabWord(
  id: string,
  fields: { definition: string | null; partOfSpeech: string | null },
  source: Exclude<DefinitionSource, 'none'>,
): Promise<void> {
  const userId = await currentUserId();
  const { error } = await supabase
    .from('vocab_words')
    .update({
      definition: fields.definition,
      part_of_speech: fields.partOfSpeech,
      definition_source: source,
    })
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

// lib/sessions.ts
//
// Practice-session history. Persists a finished Impromptu or 3-2-1 (TTO)
// attempt to Supabase — a `sessions` row plus the recording(s) in the
// `recordings` Storage bucket — and reads them back for the History list /
// detail screens.
//
// The stored `data` payload mirrors what each results screen already consumes
// via nav params, so the detail screen can re-render with the same components.
// Metrics are stored in their JSON-safe (serialized) form — see metrics.ts
// serializeMetrics / deserializeMetrics. Audio is referenced by Storage path
// inside `data`; the device file URI is NOT stored (it's transient).
//
// Saving is best-effort and fire-and-forget from the finalize step: a failure
// here must never block the results screen. The row is inserted first (so the
// session shows in History immediately), then the recording uploads in the
// background and the row's data is patched with the Storage path.

import { File } from 'expo-file-system';
import { supabase } from './supabase';
import { deviceLocalDate, type StreakEvent } from './streak';
import { notifyStreakChanged } from './streak-events';
import type { DeepgramWord } from './deepgram';
import type { SerializableSessionMetrics } from './metrics';
import type { TTOFeedback } from './tto-feedback';
import type { Shape } from './tto-framework-prompt';

const BUCKET = 'recordings';
// Detail screens are short-lived; an hour is plenty for a playback session.
const SIGNED_URL_TTL_SEC = 60 * 60;

export type SessionMode = 'impromptu' | 'tto' | 'explain' | 'storytelling' | 'debate' | 'prep' | 'vocab';

// ============================================================
// History filters (drive listSessions + the /history FilterSheet)
// ============================================================

export type ScoreBucket = 'strong' | 'okay' | 'needsWork' | 'notScored';

// Canonical lists live HERE (the table's `check (mode in (...))` is the real
// source). The mode list is NOT derived from MODE_LABEL in components/SessionCard
// on purpose — importing that here would create a sessions↔SessionCard cycle.
export const ALL_MODES: SessionMode[] = ['impromptu', 'tto', 'explain', 'storytelling', 'debate', 'prep', 'vocab'];
export const ALL_SCORE_BUCKETS: ScoreBucket[] = ['strong', 'okay', 'needsWork', 'notScored'];




// Dirty check (draft vs applied): set-equality on the multi-selects (order of
// selection doesn't matter), and order IS compared (flipping sort is a real edit
// the Save button should enable). Distinct from isFiltered below — different jobs.
export function filtersEqual(a: Filters, b: Filters): boolean {
  return (
    a.order === b.order &&
    a.favoritesOnly === b.favoritesOnly &&
    sameSet(a.modes, b.modes) &&
    sameSet(a.scoreBuckets, b.scoreBuckets)
  );
}

function sameSet<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

// "Is the list filtered" — drives the header indicator + the empty-state copy.
// EXCLUDES order: sorting never hides rows, so it must not paint the list as filtered.
// favoritesOnly IS included: it hides rows, so it counts as filtered.
export function isFiltered(f: Filters): boolean {
  return f.modes.length > 0 || f.scoreBuckets.length > 0 || f.favoritesOnly;
}

// Bucket → PostgREST .or() fragment. Thresholds mirror scoreStatus()
// (components/metric-scoring.tsx): >=8 strong, >=5&<8 okay, <5 needsWork, null
// notScored. The 'okay' AND-group must have NO spaces inside the .or() string.
const SCORE_BUCKET_OR: Record<ScoreBucket, string> = {
  strong: 'score.gte.8',
  okay: 'and(score.gte.5,score.lt.8)',
  needsWork: 'score.lt.5',
  notScored: 'score.is.null',
};

// ============================================================
// Stored payloads (the `data` jsonb column)
// ============================================================

export type ImpromptuSessionData = {
  transcript: string;
  words: DeepgramWord[];
  durationSec: number;
  impromptuPrompt: string;
  impromptuTopic: string;
  impromptuType: string;
  aiFeedback: string;
  aiFeedbackError: boolean;
  aiScore: number | null;
  metrics: SerializableSessionMetrics;
  // Set once the recording uploads. Absent ⇒ no playback on the detail screen.
  audioPath?: string;
};

// Explain is Impromptu's shape with the generated prompt/topic/type collapsed to
// a single user-typed `topic` (which may be '' — the AI infers the concept from
// the transcript when empty). One continuous single-speaker recording, so the
// metrics payload is byte-for-byte the impromptu one.
export type ExplainSessionData = {
  transcript: string;
  words: DeepgramWord[];
  durationSec: number;
  topic: string;
  aiFeedback: string;
  aiFeedbackError: boolean;
  aiScore: number | null;
  metrics: SerializableSessionMetrics;
  // Set once the recording uploads. Absent ⇒ no playback on the detail screen.
  audioPath?: string;
};

// Storytelling is byte-for-byte the same shape as Explain (a single continuous
// single-speaker recording + an optional user-typed `topic` = what the story is
// about). Kept as its own named type so the discriminated union + call sites read
// clearly per mode.
export type StorytellingSessionData = {
  transcript: string;
  words: DeepgramWord[];
  durationSec: number;
  topic: string;
  aiFeedback: string;
  aiFeedbackError: boolean;
  aiScore: number | null;
  metrics: SerializableSessionMetrics;
  // Set once the recording uploads. Absent ⇒ no playback on the detail screen.
  audioPath?: string;
};

// Debate is the Explain/Storytelling shape PLUS the argued claim + the chosen side.
// The `statement` is also stored in the `prompt` column (searchable + shown as the
// card subtitle, like impromptu — NOT as the title).
export type DebateSessionData = {
  statement: string;
  stance: 'agree' | 'disagree';
  transcript: string;
  words: DeepgramWord[];
  durationSec: number;
  aiFeedback: string;
  aiFeedbackError: boolean;
  aiScore: number | null;
  metrics: SerializableSessionMetrics;
  // Set once the recording uploads. Absent ⇒ no playback on the detail screen.
  audioPath?: string;
};

// PREP (the Point-Reason-Example-Point framework) is a single continuous response to a
// scenario prompt. Same shape as Debate minus the stance: `prompt` is the scenario the
// user made their case about (stored in the `prompt` column → card subtitle, like
// impromptu/debate).
export type PrepSessionData = {
  prompt: string;
  transcript: string;
  words: DeepgramWord[];
  durationSec: number;
  aiFeedback: string;
  aiFeedbackError: boolean;
  aiScore: number | null;
  metrics: SerializableSessionMetrics;
  // Set once the recording uploads. Absent ⇒ no playback on the detail screen.
  audioPath?: string;
};

// Vocab (describe-a-word) is MEANING-ONLY — no delivery metrics (unlike every other mode
// above, which carry `metrics`). The `word` is stored in the `custom_title` column so
// History shows it; the cached `definition` (may be null for a 404 word) is the ground
// truth the AI scored against, kept for the review screen's context card.
export type VocabSessionData = {
  wordId: string; // the vocab_words row this attempt belongs to (drives the derived ring)
  word: string;
  definition: string | null;
  transcript: string;
  words: DeepgramWord[]; // for the review TranscriptCard (no filler/pause sets)
  durationSec: number;
  aiFeedback: string;
  aiFeedbackError: boolean;
  aiScore: number | null;
  // Set once the recording uploads. Absent ⇒ no playback on the detail screen.
  audioPath?: string;
};

export type TtoRoundData = {
  shape: Shape;
  prompt: string;
  transcript: string;
  words: DeepgramWord[];
  durationSec: number;
  metrics: SerializableSessionMetrics;
  audioPath?: string;
};

export type TtoSessionData = {
  rounds: TtoRoundData[];
  feedback: TTOFeedback | null;
  feedbackError: string;
};

// ============================================================
// List + detail return shapes
// ============================================================

export type SessionListItem = {
  id: string;
  createdAt: string;
  mode: SessionMode;
  score: number | null;
  durationSec: number;
  prompt: string | null;
  customTitle: string | null;
  favorite: boolean;
};

export type LoadedSession =
  | {
      id: string;
      createdAt: string;
      mode: 'impromptu';
      data: ImpromptuSessionData;
      audioUrl: string | null;
      customTitle: string | null;
      favorite: boolean;
    }
  | {
      id: string;
      createdAt: string;
      mode: 'tto';
      data: TtoSessionData;
      roundAudioUrls: (string | null)[];
      customTitle: string | null;
      favorite: boolean;
    }
  | {
      id: string;
      createdAt: string;
      mode: 'explain';
      data: ExplainSessionData;
      audioUrl: string | null;
      customTitle: string | null;
      favorite: boolean;
    }
  | {
      id: string;
      createdAt: string;
      mode: 'storytelling';
      data: StorytellingSessionData;
      audioUrl: string | null;
      customTitle: string | null;
      favorite: boolean;
    }
  | {
      id: string;
      createdAt: string;
      mode: 'debate';
      data: DebateSessionData;
      audioUrl: string | null;
      customTitle: string | null;
      favorite: boolean;
    }
  | {
      id: string;
      createdAt: string;
      mode: 'prep';
      data: PrepSessionData;
      audioUrl: string | null;
      customTitle: string | null;
      favorite: boolean;
    }
  | {
      id: string;
      createdAt: string;
      mode: 'vocab';
      data: VocabSessionData;
      audioUrl: string | null;
      customTitle: string | null;
      favorite: boolean;
    };

// ============================================================
// Internal helpers
// ============================================================

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) throw new Error('Not signed in — cannot touch sessions.');
  return uid;
}

// Read the recorded WAV off disk and upload it to Storage. Uploading the raw
// bytes (Uint8Array) keeps it consistent with how the rest of the app reads
// audio files (expo-file-system's File.bytes()).
async function uploadWav(path: string, deviceUri: string): Promise<void> {
  const bytes = await new File(deviceUri).bytes();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: 'audio/wav', upsert: true });
  if (error) throw error;
}

async function signedUrl(path: string | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SEC);
  if (error || !data) return null;
  return data.signedUrl;
}

// ============================================================
// Save
// ============================================================

/**
 * Persist a finished Impromptu attempt. Returns the new session id. Inserts
 * the row first, then uploads the recording in the background and patches
 * data.audioPath. Call fire-and-forget; never await this on the UI path.
 */
export async function saveImpromptuSession(args: {
  data: ImpromptuSessionData;
  audioUri: string;
}): Promise<string> {
  const userId = await currentUserId();
  const { data, audioUri } = args;

  const { data: row, error } = await supabase
    .from('sessions')
    .insert({
      user_id: userId,
      mode: 'impromptu',
      score: data.aiScore,
      duration_sec: data.durationSec,
      prompt: data.impromptuPrompt,
      local_date: deviceLocalDate(),
      data,
    })
    .select('id')
    .single();

  if (error) throw error;
  const id = row.id as string;
  notifyStreakChanged();

  // Audio is best-effort: if it fails the session still exists, just without
  // playback on the detail screen.
  try {
    const path = `${userId}/${id}/recording.wav`;
    await uploadWav(path, audioUri);
    await supabase
      .from('sessions')
      .update({ data: { ...data, audioPath: path } })
      .eq('id', id);
  } catch (e) {
    console.warn('[sessions] impromptu audio upload failed:', e);
  }

  return id;
}

/**
 * Persist a finished Explain attempt. Same insert/upload shape as impromptu. The topic
 * (AI-generated or the user's own) is written to the `prompt` column — like debate/prep,
 * an app-handed topic is a prompt, not a user-authored title — so it shows as the History
 * card subtitle + is searchable, and the title stays the generic DEFAULT_TITLE.explain.
 * Returns the new session id; call fire-and-forget.
 */
export async function saveExplainSession(args: {
  data: ExplainSessionData;
  audioUri: string;
}): Promise<string> {
  const userId = await currentUserId();
  const { data, audioUri } = args;

  const topic = data.topic.trim();

  const { data: row, error } = await supabase
    .from('sessions')
    .insert({
      user_id: userId,
      mode: 'explain',
      score: data.aiScore,
      duration_sec: data.durationSec,
      prompt: topic.length > 0 ? topic : null, // the topic to explain (generated or typed)
      local_date: deviceLocalDate(),
      data,
    })
    .select('id')
    .single();

  if (error) throw error;
  const id = row.id as string;
  notifyStreakChanged();

  try {
    const path = `${userId}/${id}/recording.wav`;
    await uploadWav(path, audioUri);
    await supabase
      .from('sessions')
      .update({ data: { ...data, audioPath: path } })
      .eq('id', id);
  } catch (e) {
    console.warn('[sessions] explain audio upload failed:', e);
  }

  return id;
}

/**
 * Persist a finished Vocab (describe-a-word) attempt. Like saveExplainSession but: the
 * WORD is the title (custom_title) so History shows it, and there are no metrics
 * (meaning-only). The per-word ring is DERIVED from these sessions rows (the latest scored
 * 'vocab' session for the word), so nothing extra is written to vocab_words here.
 * `mode:'vocab'` inserts a real sessions row, so the streak trigger fires and it shows in
 * History (it's excluded only from the Profile chart RPCs). Returns the new session id;
 * call fire-and-forget.
 */
export async function saveVocabSession(args: {
  data: VocabSessionData;
  audioUri: string;
}): Promise<string> {
  const userId = await currentUserId();
  const { data, audioUri } = args;

  const { data: row, error } = await supabase
    .from('sessions')
    .insert({
      user_id: userId,
      mode: 'vocab',
      score: data.aiScore,
      duration_sec: data.durationSec,
      prompt: null,
      custom_title: data.word, // the word IS the session title
      local_date: deviceLocalDate(),
      data,
    })
    .select('id')
    .single();

  if (error) throw error;
  const id = row.id as string;
  notifyStreakChanged();

  try {
    const path = `${userId}/${id}/recording.wav`;
    await uploadWav(path, audioUri);
    await supabase
      .from('sessions')
      .update({ data: { ...data, audioPath: path } })
      .eq('id', id);
  } catch (e) {
    console.warn('[sessions] vocab audio upload failed:', e);
  }

  return id;
}

export type LatestVocabSession = {
  id: string;
  createdAt: string;
  score: number | null;
  durationSec: number;
};

/**
 * The most recent SCORED vocab describe-session for a word (the one the ring reflects), for the
 * word-detail "Latest score" review link. Read LIVE from `sessions` so it's never stale — a
 * deleted session drops out on the next read. The (user_id, created_at desc) index makes this a
 * cheap newest-first walk stopped at limit 1; the wordId lives in `data` jsonb (no FK).
 */
export async function getLatestVocabSession(wordId: string): Promise<LatestVocabSession | null> {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, created_at, score, duration_sec')
    .eq('mode', 'vocab')
    .eq('data->>wordId', wordId)
    .not('score', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id as string,
    createdAt: data.created_at as string,
    score: data.score == null ? null : Number(data.score),
    durationSec: Number(data.duration_sec ?? 0),
  };
}

/**
 * Persist a finished Storytelling attempt. Identical to saveExplainSession (topic
 * → custom_title as the session title; prompt null); only the mode differs. Returns
 * the new session id; call fire-and-forget.
 */
export async function saveStorytellingSession(args: {
  data: StorytellingSessionData;
  audioUri: string;
}): Promise<string> {
  const userId = await currentUserId();
  const { data, audioUri } = args;

  const title = data.topic.trim();

  const { data: row, error } = await supabase
    .from('sessions')
    .insert({
      user_id: userId,
      mode: 'storytelling',
      score: data.aiScore,
      duration_sec: data.durationSec,
      prompt: null, // no generated prompt; the typed topic is the title (custom_title)
      custom_title: title.length > 0 ? title : null,
      local_date: deviceLocalDate(),
      data,
    })
    .select('id')
    .single();

  if (error) throw error;
  const id = row.id as string;
  notifyStreakChanged();

  try {
    const path = `${userId}/${id}/recording.wav`;
    await uploadWav(path, audioUri);
    await supabase
      .from('sessions')
      .update({ data: { ...data, audioPath: path } })
      .eq('id', id);
  } catch (e) {
    console.warn('[sessions] storytelling audio upload failed:', e);
  }

  return id;
}

/**
 * Persist a finished Debate attempt. Diverges from explain/storytelling: the argued
 * `statement` goes in the `prompt` column (searchable + shown as the card subtitle,
 * like impromptu) and `custom_title` stays null (the generic "Debate Result" title
 * shows; rename still works). Returns the new session id; call fire-and-forget.
 */
export async function saveDebateSession(args: {
  data: DebateSessionData;
  audioUri: string;
}): Promise<string> {
  const userId = await currentUserId();
  const { data, audioUri } = args;

  const { data: row, error } = await supabase
    .from('sessions')
    .insert({
      user_id: userId,
      mode: 'debate',
      score: data.aiScore,
      duration_sec: data.durationSec,
      prompt: data.statement, // the argued claim — the card subtitle, searchable
      local_date: deviceLocalDate(),
      data,
    })
    .select('id')
    .single();

  if (error) throw error;
  const id = row.id as string;
  notifyStreakChanged();

  try {
    const path = `${userId}/${id}/recording.wav`;
    await uploadWav(path, audioUri);
    await supabase
      .from('sessions')
      .update({ data: { ...data, audioPath: path } })
      .eq('id', id);
  } catch (e) {
    console.warn('[sessions] debate audio upload failed:', e);
  }

  return id;
}

/**
 * Persist a finished PREP attempt. Like saveDebateSession: the scenario `prompt` goes
 * in the `prompt` column (searchable + card subtitle) and `custom_title` stays null
 * (generic "PREP Result" title; rename still works). Returns the new session id; call
 * fire-and-forget.
 */
export async function savePrepSession(args: {
  data: PrepSessionData;
  audioUri: string;
}): Promise<string> {
  const userId = await currentUserId();
  const { data, audioUri } = args;

  const { data: row, error } = await supabase
    .from('sessions')
    .insert({
      user_id: userId,
      mode: 'prep',
      score: data.aiScore,
      duration_sec: data.durationSec,
      prompt: data.prompt, // the scenario the user made their case about
      local_date: deviceLocalDate(),
      data,
    })
    .select('id')
    .single();

  if (error) throw error;
  const id = row.id as string;
  notifyStreakChanged();

  try {
    const path = `${userId}/${id}/recording.wav`;
    await uploadWav(path, audioUri);
    await supabase
      .from('sessions')
      .update({ data: { ...data, audioPath: path } })
      .eq('id', id);
  } catch (e) {
    console.warn('[sessions] prep audio upload failed:', e);
  }

  return id;
}

/**
 * Persist a finished 3-2-1 attempt (three rounds). score is the round average
 * (null if feedback failed); duration is the sum of the three rounds. Each
 * round's recording uploads in the background and its data.rounds[i].audioPath
 * is patched in. Call fire-and-forget.
 */
export async function saveTtoSession(args: {
  data: TtoSessionData;
  roundAudioUris: string[];
}): Promise<string> {
  const userId = await currentUserId();
  const { data, roundAudioUris } = args;

  const score =
    data.feedback && data.feedback.rounds.length > 0
      ? data.feedback.rounds.reduce((acc, r) => acc + r.score, 0) /
        data.feedback.rounds.length
      : null;
  const durationSec = data.rounds.reduce((acc, r) => acc + (r.durationSec || 0), 0);

  const { data: row, error } = await supabase
    .from('sessions')
    .insert({
      user_id: userId,
      mode: 'tto',
      score,
      duration_sec: durationSec,
      prompt: null, // UI shows "3-2-1 Framework"; per-round prompts live in data
      local_date: deviceLocalDate(),
      data,
    })
    .select('id')
    .single();

  if (error) throw error;
  const id = row.id as string;
  notifyStreakChanged();

  try {
    const rounds = data.rounds.map((r) => ({ ...r }));
    await Promise.all(
      roundAudioUris.map(async (uri, i) => {
        if (!uri) return;
        const path = `${userId}/${id}/round-${i}.wav`;
        await uploadWav(path, uri);
        rounds[i] = { ...rounds[i], audioPath: path };
      }),
    );
    await supabase
      .from('sessions')
      .update({ data: { ...data, rounds } })
      .eq('id', id);
  } catch (e) {
    console.warn('[sessions] tto audio upload failed:', e);
  }

  return id;
}

// ============================================================
// Read
// ============================================================

// Pagination for History.tsx file

export type Filters = {
  order: 'newest' | 'oldest';
  modes: SessionMode[];
  scoreBuckets: ScoreBucket[];
  favoritesOnly: boolean;
};


export const NEUTRAL_FILTERS: Filters = { 
  order: 'newest', 
  modes: [], 
  scoreBuckets: [], 
  favoritesOnly: false
};

export type HistoryCursor = { createdAt: string; id: string } | null;

export async function fetchHistoryPage({
  cursor, 
  pageSize = 15,
  filters = NEUTRAL_FILTERS,
  search = '',
}: {
  cursor?: HistoryCursor;
  pageSize?: number;
  filters?: Filters;
  search?: string;
}): Promise<{items: SessionListItem[]; nextCursor: HistoryCursor}> {

  const ascending = filters.order === 'oldest';

  let query = supabase
  .from('sessions')
  .select('id, created_at, mode, score, duration_sec, prompt, custom_title, favorite')
  .order('created_at', { ascending })
  .order('id', { ascending }) // tiebreaker for equal timestamps

  // If this is true then we filter for only the selected modes. If its false then
  // The user either has no selected modes or all of them selected
  // Which means we return all modes so we skip this if statement and return all
  if (filters.modes.length > 0 && filters.modes.length < ALL_MODES.length) {
    query = query.in('mode', filters.modes);
  }

  // Same thing as the modes
  if (filters.scoreBuckets.length > 0 && filters.scoreBuckets.length < ALL_SCORE_BUCKETS.length) {
    query = query.or(filters.scoreBuckets.map((bucket) => SCORE_BUCKET_OR[bucket]).join(',')
  )
  }

  if (filters.favoritesOnly) {
    query = query.eq('favorite', true);
  }

  const normalizedSearch = search.trim();

  if (normalizedSearch) {
    const value = normalizedSearch.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    query = query.or(
    `prompt.ilike."%${value}%",custom_title.ilike."%${value}%"`
  );
  }

  if (cursor) {
    const comparison = ascending ? 'gt': 'lt';

    query = query.or(
      [
        `created_at.${comparison}.${cursor.createdAt}`,
        `and(created_at.eq.${cursor.createdAt},id.${comparison}.${cursor.id})`,
      ].join(','),
    );
  }

  // Fetch one lookahead row so an exact page-size result does not falsely
  // advertise another page and trigger an empty request at the end.
  query = query.limit(pageSize + 1)

  const { data, error } = await query;
  
  if (error) throw error;

  const rows = data ?? [];

  // Checks if theres at least 1 more row of data to check if it has a next page
  const hasNextPage = rows.length > pageSize;

  // The lookahead row proves another page exists but belongs to that next page.
  const items: SessionListItem[] = rows.slice(0, pageSize).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    mode: r.mode as SessionMode,
    score: r.score,
    durationSec: r.duration_sec,
    prompt: r.prompt,
    customTitle: r.custom_title,
    favorite: r.favorite,
  }));

  const last = items[items.length - 1];
  const nextCursor: HistoryCursor =
    hasNextPage && last ? { createdAt: last.createdAt, id: last.id } : null;

  return { items, nextCursor }
}


/**
 * The signed-in user's sessions. RLS scopes to them.
 *   - `order`  — 'newest' (default) or 'oldest', by `created_at`.
 *   - `limit`  — fetch only N rows (e.g. the Home card's 5).
 *   - `offset` — with `limit`, fetch the page starting at `offset` (e.g.
 *                `/history`'s infinite scroll). Long-time users can have
 *                hundreds of rows, so only the no-arg call (the dev seeder)
 *                fetches the whole history.
 *
 * Paging is offset-based (`.range`), which is fine at hundreds of rows. For
 * thousands, migrate to keyset/cursor (`created_at` + `id`) to avoid deep-offset
 * cost and mid-scroll insert drift.
 */
export async function listSessions(opts?: {
  limit?: number;
  offset?: number;
  order?: 'newest' | 'oldest';
  modes?: SessionMode[];
  scoreBuckets?: ScoreBucket[];
  favoritesOnly?: boolean;
  search?: string;
}): Promise<SessionListItem[]> {
  // One mutable query: supabase-js's builder mutates-and-returns-self, so every
  // clause (filters AND paging) must chain off the SAME object. Page LAST so the
  // .range()/.limit() applies to the filtered set, not an unfiltered base.
  let query = supabase
    .from('sessions')
    .select('id, created_at, mode, score, duration_sec, prompt, custom_title, favorite')
    .order('created_at', { ascending: opts?.order === 'oldest' });

  // Mode: only when a non-empty STRICT subset of all modes. Empty OR all-selected
  // => no clause, so "Any" can't blank the list and a future mode shows by default.
  const modes = opts?.modes;
  if (modes && modes.length > 0 && modes.length < ALL_MODES.length) {
    query = query.in('mode', modes);
  }

  // Score buckets: same strict-subset gate; OR the selected fragments together.
  const buckets = opts?.scoreBuckets;
  if (buckets && buckets.length > 0 && buckets.length < ALL_SCORE_BUCKETS.length) {
    query = query.or(buckets.map((b) => SCORE_BUCKET_OR[b]).join(','));
  }

  // Favorites: backed by the partial index sessions_user_favorite_created_idx.
  if (opts?.favoritesOnly) {
    query = query.eq('favorite', true);
  }

  // Text search over the prompt + custom title (case-insensitive substring),
  // ANDed with the filter groups above. Double-quote the value so commas/parens in
  // the term don't break the PostgREST `.or()` filter parsing; escape backslashes
  // + quotes inside. No index — a leading-wildcard ilike can't use a btree; add a
  // pg_trgm GIN index if this gets slow at thousands of rows.
  const search = opts?.search?.trim();
  if (search) {
    const v = search.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    query = query.or(`prompt.ilike."%${v}%",custom_title.ilike."%${v}%"`);
  }

  if (opts?.limit != null) {
    query =
      opts.offset != null
        ? query.range(opts.offset, opts.offset + opts.limit - 1)
        : query.limit(opts.limit);
  }

  const { data, error } = await query;

  if (error) throw error;

  return (data ?? []).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    mode: r.mode as SessionMode,
    score: r.score,
    durationSec: r.duration_sec,
    prompt: r.prompt,
    customTitle: r.custom_title,
    favorite: r.favorite,
  }));
}

/**
 * One real AI score per session mode, for the Practice-tab rings + hero card. Calls
 * the `lesson_scores` Postgres function (migration 20260702120000) which reduces to
 * at most one row per mode IN THE DATABASE, so the payload is <= (#modes) rows no
 * matter how much history the user has (vs. fetching + reducing the whole history
 * client-side). RLS + the function's SECURITY INVOKER scope rows to the signed-in user.
 *   - 'last' (default) — the newest SCORED session's score ("current form").
 *   - 'best'          — the highest score ever earned in that mode.
 * Null scores (AI failed / too short) are excluded by the function, so a failed
 * session can't blank a mode that has a real prior score. A mode with no scored
 * session simply has no key (the caller falls back to the empty-ring state).
 * NOTE: the migration must be pushed (`supabase db push`) for this to resolve — until
 * then the RPC errors and the Practice rings show empty (the caller catches + logs).
 */
export async function getLessonScores(
  modes: SessionMode[],
  strategy: 'best' | 'last' = 'last',
): Promise<Partial<Record<SessionMode, number>>> {
  if (modes.length === 0) return {};

  const { data, error } = await supabase.rpc('lesson_scores', {
    p_modes: modes,
    p_strategy: strategy,
  });
  if (error) throw error;

  const out: Partial<Record<SessionMode, number>> = {};
  for (const r of (data ?? []) as { mode: SessionMode; score: number }[]) {
    out[r.mode] = r.score;
  }
  return out;
}

// ============================================================
// Progress graph (Profile tab)
// ============================================================

/**
 * One row per session for the Profile-tab progress chart, oldest→newest. Raw
 * metric values only — the good/warning/danger band is computed client-side
 * (lib/metric-trends.ts → lib/metric-status.ts) so the thresholds stay single-source.
 * pace/fillers/pauses are extracted from the `data` jsonb (averaged over rounds for
 * TTO) by the `metric_trends` RPC. Any value can be null (AI-failed score, or a
 * metric absent) → the chart draws a gap.
 */
// A superset of SessionListItem (the display fields — so the Profile chart can render
// the same SessionCard + route to the review on tap) PLUS the per-metric values.
export type MetricTrendRow = {
  id: string;
  createdAt: string;
  mode: SessionMode;
  score: number | null;
  durationSec: number;
  prompt: string | null;
  customTitle: string | null;
  favorite: boolean;
  pace: number | null;
  fillers: number | null;
  pauses: number | null;
  paceLow: number | null;
  paceHigh: number | null;
};

/**
 * One PAGE of the signed-in user's sessions with their per-metric values for the
 * progress graph, anchored at newest: page k passes `offset = k * limit`. Calls the
 * `metric_trends` Postgres RPC (migration 20260704120000), which picks the winning
 * ids by an index walk, then does the jsonb extraction + TTO round-averaging IN the
 * DB on just those rows — so a page is one tiny query no matter how deep the offset.
 * Asks the RPC for limit+1 rows: it returns ascending, so an extra (older) "peek"
 * row comes back FIRST — its presence means an older page exists (`hasOlder`, the
 * Back arrow's grey-out) and it's dropped from `rows`. RLS + the function's
 * SECURITY INVOKER scope rows to the user.
 * NOTE: needs the migration pushed (`supabase db push`) or the RPC 404s and the chart
 * shows empty (the caller catches + logs).
 */
export async function getMetricTrends(
  limit = 20,
  offset = 0,
): Promise<{ rows: MetricTrendRow[]; hasOlder: boolean }> {
  const { data, error } = await supabase.rpc('metric_trends', {
    p_limit: limit + 1,
    p_offset: offset,
  });
  if (error) throw error;

  const mapped = ((data ?? []) as {
    id: string;
    created_at: string;
    mode: SessionMode;
    score: number | null;
    duration_sec: number;
    prompt: string | null;
    custom_title: string | null;
    favorite: boolean;
    pace: number | null;
    fillers: number | null;
    pauses: number | null;
    pace_low: number | null;
    pace_high: number | null;
  }[]).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    mode: r.mode,
    score: r.score,
    durationSec: r.duration_sec,
    prompt: r.prompt,
    customTitle: r.custom_title,
    favorite: r.favorite,
    pace: r.pace,
    fillers: r.fillers,
    pauses: r.pauses,
    paceLow: r.pace_low,
    paceHigh: r.pace_high,
  }));

  // limit+1 rows back ⇒ an older page exists; drop the peek row (ascending-first).
  const hasOlder = mapped.length > limit;
  return { rows: hasOlder ? mapped.slice(1) : mapped, hasOlder };
}

/** All-time totals for the Profile "View All Sessions" card. */
export type SessionStats = {
  totalSessions: number;
  totalDurationSec: number;
};

/**
 * Aggregate totals over ALL the user's sessions (count + summed duration), for the
 * Profile-tab "View All Sessions" card. Calls the `session_stats` Postgres RPC
 * (migration 20260704130000), which does the count/sum IN the DB and returns a single
 * row — so this stays O(1) payload no matter how much history exists (never a
 * load-all-and-count). RLS + SECURITY INVOKER scope it to the user. Needs the
 * migration pushed (`supabase db push`) or the RPC 404s (the caller catches + logs).
 */
export async function getSessionStats(): Promise<SessionStats> {
  const { data, error } = await supabase.rpc('session_stats');
  if (error) throw error;

  // Aggregate RPC → exactly one row; count(*) is int8 (may arrive as a string).
  const row = ((data ?? [])[0] ?? {}) as {
    total_sessions?: number | string;
    total_duration_sec?: number | string;
  };
  return {
    totalSessions: Number(row.total_sessions ?? 0),
    totalDurationSec: Number(row.total_duration_sec ?? 0),
  };
}

export type MetricBucketUnit = 'day' | 'week' | 'month';

// One time-bucket (day/week/month) of the Profile "All time" progress line. Shaped to
// satisfy ChartRow directly: `id` is the bucket start (unique per bucket; the chart keys
// points by id) and paceLow/High are null so the pace band falls back to the default
// 130/160 decoration. `bucketStart` duplicates `id` under a clearer name for the footer.
export type MetricBucketRow = {
  id: string;
  bucketStart: string; // "2026-05-04T00:00:00" — local-parseable by formatTrendDate
  score: number | null;
  pace: number | null;
  fillers: number | null;
  pauses: number | null;
  paceLow: null;
  paceHigh: null;
  sessionCount: number;
};

export type MetricHistory = {
  buckets: MetricBucketRow[]; // oldest → newest; empty when the user has no sessions
  unit: MetricBucketUnit | null; // null iff buckets is empty
};

/**
 * All-time progress: the user's four metrics bucket-averaged over time (day/week/month,
 * chosen server-side from the span of their history). Calls the `metric_trends_all_time`
 * RPC (migration 20260705120000), which does the whole aggregate IN the DB reading the
 * materialized pace/fillers/pauses columns (+ score) — so it returns `<= ~60` tiny bucket
 * rows no matter how many sessions exist (NEVER ships raw sessions). The chosen unit is
 * repeated on every row; read it off row 0. RLS + SECURITY INVOKER scope to the user.
 * Needs the migration pushed or the RPC 404s (the caller catches + logs).
 */
export async function getMetricHistory(): Promise<MetricHistory> {
  const { data, error } = await supabase.rpc('metric_trends_all_time');
  if (error) throw error;

  const raw = (data ?? []) as {
    bucket_start: string;
    avg_score: number | null;
    avg_pace: number | null;
    avg_fillers: number | null;
    avg_pauses: number | null;
    session_count: number | string;
    bucket_unit: MetricBucketUnit;
  }[];

  const buckets: MetricBucketRow[] = raw.map((r) => ({
    id: r.bucket_start,
    bucketStart: r.bucket_start,
    score: r.avg_score,
    pace: r.avg_pace,
    fillers: r.avg_fillers,
    pauses: r.avg_pauses,
    paceLow: null,
    paceHigh: null,
    sessionCount: Number(r.session_count),
  }));

  return { buckets, unit: raw.length > 0 ? raw[0].bucket_unit : null };
}

/**
 * One session with its `data` payload and fresh signed audio URL(s) for
 * playback. Returns null if the row doesn't exist (or RLS hides it).
 */
export async function getSession(id: string): Promise<LoadedSession | null> {
  const { data: row, error } = await supabase
    .from('sessions')
    .select('id, created_at, mode, data, custom_title, favorite')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!row) return null;

  if (row.mode === 'impromptu') {
    const data = row.data as ImpromptuSessionData;
    return {
      id: row.id,
      createdAt: row.created_at,
      mode: 'impromptu',
      data,
      audioUrl: await signedUrl(data.audioPath),
      customTitle: row.custom_title,
      favorite: row.favorite,
    };
  }

  if (row.mode === 'explain') {
    const data = row.data as ExplainSessionData;
    return {
      id: row.id,
      createdAt: row.created_at,
      mode: 'explain',
      data,
      audioUrl: await signedUrl(data.audioPath),
      customTitle: row.custom_title,
      favorite: row.favorite,
    };
  }

  if (row.mode === 'storytelling') {
    const data = row.data as StorytellingSessionData;
    return {
      id: row.id,
      createdAt: row.created_at,
      mode: 'storytelling',
      data,
      audioUrl: await signedUrl(data.audioPath),
      customTitle: row.custom_title,
      favorite: row.favorite,
    };
  }

  if (row.mode === 'debate') {
    const data = row.data as DebateSessionData;
    return {
      id: row.id,
      createdAt: row.created_at,
      mode: 'debate',
      data,
      audioUrl: await signedUrl(data.audioPath),
      customTitle: row.custom_title,
      favorite: row.favorite,
    };
  }

  if (row.mode === 'prep') {
    const data = row.data as PrepSessionData;
    return {
      id: row.id,
      createdAt: row.created_at,
      mode: 'prep',
      data,
      audioUrl: await signedUrl(data.audioPath),
      customTitle: row.custom_title,
      favorite: row.favorite,
    };
  }

  if (row.mode === 'vocab') {
    const data = row.data as VocabSessionData;
    return {
      id: row.id,
      createdAt: row.created_at,
      mode: 'vocab',
      data,
      audioUrl: await signedUrl(data.audioPath),
      customTitle: row.custom_title,
      favorite: row.favorite,
    };
  }

  const data = row.data as TtoSessionData;
  const roundAudioUrls = await Promise.all(
    data.rounds.map((r) => signedUrl(r.audioPath)),
  );
  return {
    id: row.id,
    createdAt: row.created_at,
    mode: 'tto',
    data,
    roundAudioUrls,
    customTitle: row.custom_title,
    favorite: row.favorite,
  };
}

/**
 * Toggle/set the favorite flag on one session. RLS scopes the update to the
 * signed-in user, so no explicit user filter is needed.
 */
export async function setFavorite(id: string, favorite: boolean): Promise<void> {
  const { error } = await supabase.from('sessions').update({ favorite }).eq('id', id);
  if (error) throw error;
}

/**
 * Set (or clear) the user-editable custom title on one session. RLS scopes the
 * update to the signed-in user. Empty/whitespace is normalized to null so the
 * display fallback (`customTitle ?? <derived default>`) treats "cleared" and
 * "never set" identically — the DB never holds a blank custom title.
 */
export async function setCustomTitle(id: string, customTitle: string | null): Promise<void> {
  const value = customTitle?.trim() ? customTitle.trim() : null;
  const { error } = await supabase.from('sessions').update({ custom_title: value }).eq('id', id);
  if (error) throw error;
}

// --- Fresh-practice → results: session-id hand-off ---------------------------
// A finished practice saves fire-and-forget (returning the new row id) and the
// practice screen navigates to results BEFORE the save lands. The results screen
// needs that id to enable favoriting, but a Promise can't ride through navigation
// params — so the practice screen stashes it here and the results screen consumes
// it once. The promise resolves to the id, or null if the save failed (favoriting
// then stays disabled — there's no saved row to write to). Consumed once (cleared)
// so a too-short follow-up can't pick up a stale, wrong-session id.
let pendingSaveId: Promise<string | null> | null = null;

export function setPendingSaveId(p: Promise<string | null>): void {
  pendingSaveId = p;
}

export function takePendingSaveId(): Promise<string | null> | null {
  const p = pendingSaveId;
  pendingSaveId = null;
  return p;
}

// The same fresh-practice → results hand-off, for the streak banner. The practice
// screen snapshots the streak BEFORE the insert (the trigger bumps the counter),
// then resolves the classified event once the save lands so the results screen can
// drop a "New streak" / "Continued streak" banner. Resolves to `{ kind: 'none' }`
// when the save failed or the day was already counted (no banner). Consumed once.
let pendingStreakEvent: Promise<StreakEvent> | null = null;

export function setPendingStreakEvent(p: Promise<StreakEvent>): void {
  pendingStreakEvent = p;
}

export function takePendingStreakEvent(): Promise<StreakEvent> | null {
  const p = pendingStreakEvent;
  pendingStreakEvent = null;
  return p;
}

/**
 * Delete a session and its recordings. Removes the Storage folder first
 * (best-effort), then the row. RLS scopes both to the signed-in user.
 */
export async function deleteSession(id: string): Promise<void> {
  const userId = await currentUserId();

  // Best-effort Storage cleanup — the row delete is what actually matters for
  // History, so a Storage failure shouldn't block it.
  try {
    const prefix = `${userId}/${id}`;
    const { data: files } = await supabase.storage.from(BUCKET).list(prefix);
    if (files && files.length > 0) {
      await supabase.storage
        .from(BUCKET)
        .remove(files.map((f) => `${prefix}/${f.name}`));
    }
  } catch (e) {
    console.warn('[sessions] delete storage cleanup failed:', e);
  }

  const { error } = await supabase.from('sessions').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Delete several sessions at once (the History multi-select "Delete (N)").
 * Storage folders are cleaned up in parallel (best-effort); the rows go in a
 * single `.in('id', …)` delete. RLS scopes both to the signed-in user.
 */
export async function deleteSessions(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const userId = await currentUserId();

  await Promise.all(
    ids.map(async (id) => {
      try {
        const prefix = `${userId}/${id}`;
        const { data: files } = await supabase.storage.from(BUCKET).list(prefix);
        if (files && files.length > 0) {
          await supabase.storage
            .from(BUCKET)
            .remove(files.map((f) => `${prefix}/${f.name}`));
        }
      } catch (e) {
        console.warn('[sessions] bulk delete storage cleanup failed:', e);
      }
    }),
  );

  const { error } = await supabase.from('sessions').delete().in('id', ids);
  if (error) throw error;
}

// DEV ONLY — caches one TTO (3-2-1) practice session so we can iterate on
// the results screen without re-running all three rounds. All callers gate
// on __DEV__. Mirrors lib/dev-cache-impromptu.ts for impromptu practice.
//
// Note we do NOT cache the TTS audio (prompts being read aloud). The
// results screen plays back the user's recordings, not the TTS. If a
// future results-screen feature needs TTS replay, add a per-round
// ttsAudioUri field then.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import type { TTOFeedback } from './tto-feedback';   // ← ADD

const STORAGE_KEY = '@dev/last-tto-session';
const ROUND_FILENAMES = [
  'dev-cache-tto-round-0.m4a',
  'dev-cache-tto-round-1.m4a',
  'dev-cache-tto-round-2.m4a',
] as const;

export type Shape = 'one-thing' | 'two-types' | 'three-steps';

export type CachedTTORound = {
  shape: Shape;
  prompt: string;
  transcript: string;
  words: string;        // pre-stringified for nav params (matches RoundResult shape)
  durationSec: string;  // string for nav-param consistency
  recordingUri: string; // persisted in document dir
};

export type CachedTTOSession = {
  rounds: CachedTTORound[];
  savedAt: number;
  feedback?: TTOFeedback;
};

type SaveRoundInput = Omit<CachedTTORound, 'recordingUri'> & {
  recordingSourceUri: string;
};

type SaveInput = {
  rounds: SaveRoundInput[];
};

/**
 * Copy each round's recording to the document directory (persistent) and
 * save the session metadata to AsyncStorage. Overwrites any prior cached
 * session.
 *
 * Document dir rather than cache dir because the OS can evict cache
 * between launches, which would leave valid metadata pointing at missing
 * audio.
 */
export async function saveTTOSession(input: SaveInput): Promise<void> {
  if (input.rounds.length !== 3) {
    throw new Error(`saveTTOSession expects exactly 3 rounds, got ${input.rounds.length}`);
  }

  const persistedRounds: CachedTTORound[] = [];

  for (let i = 0; i < input.rounds.length; i++) {
    const round = input.rounds[i];
    const dest = new File(Paths.document, ROUND_FILENAMES[i]);
    if (dest.exists) dest.delete();
    const bytes = await new File(round.recordingSourceUri).bytes();
    dest.create();
    dest.write(bytes);

    persistedRounds.push({
      shape: round.shape,
      prompt: round.prompt,
      transcript: round.transcript,
      words: round.words,
      durationSec: round.durationSec,
      recordingUri: dest.uri,
    });
  }

  const cached: CachedTTOSession = {
    rounds: persistedRounds,
    savedAt: Date.now(),
  };

  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
}

/**
 * Returns the cached session, or null if missing/corrupt/audio-gone.
 * Verifies every round's audio file still exists — stale metadata
 * pointing at a deleted recording would crash playback.
 */
export async function loadTTOSession(): Promise<CachedTTOSession | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedTTOSession;

    if (!parsed.rounds || parsed.rounds.length !== 3) return null;
    for (const round of parsed.rounds) {
      if (!new File(round.recordingUri).exists) return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function clearTTOSession(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
  for (const filename of ROUND_FILENAMES) {
    const file = new File(Paths.document, filename);
    if (file.exists) file.delete();
  }
}

/**
 * Update the cached session with the AI feedback once it arrives. No-op if
 * there's no cached session to update (e.g., user is replaying from a fresh
 * practice flow that didn't save to dev cache).
 *
 * Keep saveTTOSession / updateTTOSessionFeedback as separate operations: the
 * session metadata is available as soon as the recordings finish, but the
 * feedback isn't available until the OpenAI call returns. Coupling them would
 * either block the cache write on the API call (bad) or block the API call on
 * the cache write (also bad).
 */
export async function updateTTOSessionFeedback(feedback: TTOFeedback): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as CachedTTOSession;
    parsed.feedback = feedback;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Cache update failure is non-fatal — the feedback already rendered on the
    // results screen. Worst case, next reload re-runs the API call.
  }
}
// DEV ONLY — caches one impromptu practice session (transcript, metadata, and
// both audio files) so we can iterate on the impromptu-results screen without
// re-running the full practice flow. All callers gate on __DEV__.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';

const STORAGE_KEY = '@dev/last-impromptu-session';
const TTS_FILENAME = 'dev-cache-tts.mp3';
const RECORDING_FILENAME = 'dev-cache-recording.wav';

export type CachedImpromptuSession = {
  transcript: string;
  words: string;          // pre-stringified for nav params
  durationSec: string;
  impromptuPrompt: string;
  impromptuTopic: string;
  impromptuType: string;
  aiFeedback: string;
  aiFeedbackError: boolean;
  aiScore: number | null; // null when AI failed / tooShort / pre-score cache
  ttsAudioUri: string;    // persisted in document dir, survives cache eviction
  recordingUri: string;
  savedAt: number;
};

type SaveInput = Omit<CachedImpromptuSession, 'ttsAudioUri' | 'recordingUri' | 'savedAt'> & {
  ttsSourceUri: string;
  recordingSourceUri: string;
};

/**
 * Copy both audio files to the document directory (persistent) and save
 * the session metadata to AsyncStorage. Overwrites any prior cached session.
 *
 * We copy to document/ rather than referencing cache/ directly because the
 * OS can evict the cache directory between app launches, which would leave
 * us with valid metadata pointing at missing audio.
 */
export async function saveImpromptuSession(input: SaveInput): Promise<void> {
  const ttsDest = new File(Paths.document, TTS_FILENAME);
  if (ttsDest.exists) ttsDest.delete();
  const ttsBytes = await new File(input.ttsSourceUri).bytes();
  ttsDest.create();
  ttsDest.write(ttsBytes);

  const recDest = new File(Paths.document, RECORDING_FILENAME);
  if (recDest.exists) recDest.delete();
  const recBytes = await new File(input.recordingSourceUri).bytes();
  recDest.create();
  recDest.write(recBytes);

  const cached: CachedImpromptuSession = {
    transcript: input.transcript,
    words: input.words,
    durationSec: input.durationSec,
    impromptuPrompt: input.impromptuPrompt,
    impromptuTopic: input.impromptuTopic,
    impromptuType: input.impromptuType,
    aiFeedback: input.aiFeedback,
    aiFeedbackError: input.aiFeedbackError,
    aiScore: input.aiScore,
    ttsAudioUri: ttsDest.uri,
    recordingUri: recDest.uri,
    savedAt: Date.now(),
  };

  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
}

/**
 * Returns the cached session, or null if missing/corrupt/audio-gone.
 * Verifies both audio files still exist before returning a session —
 * stale metadata pointing at deleted audio would crash playback later.
 */
export async function loadImpromptuSession(): Promise<CachedImpromptuSession | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedImpromptuSession;

    if (!new File(parsed.ttsAudioUri).exists) return null;
    if (!new File(parsed.recordingUri).exists) return null;

    // Backfill for sessions cached before these fields were added to the schema.
    return { ...parsed,
      aiFeedback: parsed.aiFeedback ?? '',
      aiFeedbackError: parsed.aiFeedbackError ?? false,
      aiScore: parsed.aiScore ?? null };
  } catch {
    return null;
  }
}

export async function clearImpromptuSession(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
  const tts = new File(Paths.document, TTS_FILENAME);
  if (tts.exists) tts.delete();
  const rec = new File(Paths.document, RECORDING_FILENAME);
  if (rec.exists) rec.delete();
}
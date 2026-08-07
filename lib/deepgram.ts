// Transcription goes through the `transcribe` Supabase Edge Function (which holds
// the Deepgram key). The client only POSTs the audio bytes; the Deepgram model +
// params are fixed server-side. See supabase/functions/transcribe/index.ts.

import { transcribeAudioBlob } from './ai-proxy';

export type DeepgramWord = {
    word: string;   //raw word as deepgram heard it
    punctuated_word?: string; //word with punctuation if smart_format=true
    start: number;  //seconds from start of audio
    end: number;
    confidence: number; // 0.1
}

export type TranscriptionResult = {
    transcript: string;
    words: DeepgramWord[];
    durationSec: number;
}

/**
 * Sends a recorded audio file at `audioUri` to Deepgram Nova-3.
 * Returns the transcript and word-level timing including filler words.
 */
export async function transcribeAudio(audioUri: string): Promise<TranscriptionResult> {
  // Read the recording file into a blob, then POST the raw bytes to the transcribe
  // Edge Function (which forwards to Deepgram Nova-3 with the server-side key).
  const fileRes = await fetch(audioUri);
  const audioBlob = await fileRes.blob();

  const res = await transcribeAudioBlob(audioBlob);

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Transcription ${res.status}: ${errText || res.statusText}`);
  }
  const json = await res.json();
  const alt = json?.results?.channels?.[0]?.alternatives?.[0];
  const duration = json?.metadata?.duration ?? 0;

  if (!alt) throw new Error('No transcript returned from Deepgram');
  return {
    transcript: alt.transcript ?? '',
    words: alt.words ?? [],
    durationSec: duration,
  };
}
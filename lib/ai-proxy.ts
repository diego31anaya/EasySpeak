// lib/ai-proxy.ts
//
// Client → Supabase Edge Function proxies for OpenAI + Deepgram. The API keys live
// ONLY in the functions (Supabase secrets), never in the app bundle. These helpers
// POST to the function URLs with the signed-in user's JWT (the functions verify it),
// and RETURN THE RAW fetch Response so each caller keeps its existing
// res.ok / res.json() / res.arrayBuffer() handling unchanged.
//
// See supabase/functions/{openai-chat,openai-tts,transcribe}/index.ts.

import { supabase } from './supabase';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// The gateway needs the project apikey + a valid JWT. Use the user's access token
// when signed in (the functions require a real user); fall back to the anon key
// (the function will then 401, surfaced as a normal error to the caller).
async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? ANON_KEY;
  return { Authorization: `Bearer ${token}`, apikey: ANON_KEY };
}

async function callFunction(
  name: string,
  body: BodyInit,
  contentType: string,
  signal?: AbortSignal,
): Promise<Response> {
  const headers = { ...(await authHeaders()), 'Content-Type': contentType };
  return fetch(`${SUPABASE_URL}/functions/v1/${name}`, { method: 'POST', headers, body, signal });
}

// OpenAI chat/completions (gpt-4o / gpt-4o-mini). `body` is the full request body
// the caller already builds (model, messages, temperature, ...). Returns the raw
// Response — caller does res.ok + res.json().choices[0].message.content as before.
export function openaiChat(body: object, signal?: AbortSignal): Promise<Response> {
  return callFunction('openai-chat', JSON.stringify(body), 'application/json', signal);
}

// OpenAI TTS — { input, voice?, instructions? }. The model + mp3 format are forced
// server-side. Returns the raw Response — caller does res.arrayBuffer() as before.
export function openaiTts(body: { input: string; voice?: string; instructions?: string }): Promise<Response> {
  return callFunction('openai-tts', JSON.stringify(body), 'application/json');
}

// Deepgram transcription — POST the raw WAV bytes. The query params are fixed
// server-side. Returns the raw Response — caller does res.json() as before.
export function transcribeAudioBlob(audio: Blob): Promise<Response> {
  return callFunction('transcribe', audio, 'audio/wav');
}
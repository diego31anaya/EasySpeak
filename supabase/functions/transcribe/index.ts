// supabase/functions/transcribe/index.ts
//
// AUTHENTICATED proxy for Deepgram transcription. The Deepgram key lives ONLY here
// (DEEPGRAM_API_KEY secret). The client POSTs the raw WAV bytes as the request body;
// we forward them to Deepgram Nova-3 with the server key and return Deepgram's JSON
// verbatim (the client parses results.channels[0].alternatives[0]). The Deepgram
// query params (model, formatting) are FIXED here, not client-controlled.
//
// Deploy:  supabase functions deploy transcribe   (secret: DEEPGRAM_API_KEY)
// NOTE: Deno, not React Native.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen';
const MAX_AUDIO_BYTES = 30 * 1024 * 1024; // ~30 MB — a 16k mono WAV of a long take is well under this

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const caller = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await caller.auth.getUser();
    if (userErr || !user) return json({ error: 'Unauthorized' }, 401);

    const deepgramKey = Deno.env.get('DEEPGRAM_API_KEY');
    if (!deepgramKey) return json({ error: 'Server missing DEEPGRAM_API_KEY' }, 500);

    const audio = await req.arrayBuffer();
    if (audio.byteLength === 0) return json({ error: 'No audio' }, 400);
    if (audio.byteLength > MAX_AUDIO_BYTES) return json({ error: 'Audio too large' }, 413);

    const params = new URLSearchParams({
      model: 'nova-3',
      smart_format: 'true',
      punctuate: 'true',
      filler_words: 'true',
      language: 'en',
    });

    const res = await fetch(`${DEEPGRAM_URL}?${params.toString()}`, {
      method: 'POST',
      headers: { Authorization: `Token ${deepgramKey}`, 'Content-Type': 'audio/wav' },
      body: audio,
    });

    const data = await res.json().catch(() => ({ error: 'Bad Deepgram response' }));
    return json(data, res.ok ? 200 : res.status);
  } catch (e) {
    console.error('[transcribe] error:', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
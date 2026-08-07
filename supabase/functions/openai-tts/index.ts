// supabase/functions/openai-tts/index.ts
//
// AUTHENTICATED proxy for OpenAI text-to-speech (gpt-4o-mini-tts). The key lives
// ONLY here (OPENAI_API_KEY secret). The client sends { input, voice?, instructions? }
// and gets back the MP3 bytes (audio/mpeg). The model + response_format are FORCED
// server-side, and input length is capped, so the key can't be abused for arbitrary
// or oversized synthesis.
//
// Deploy:  supabase functions deploy openai-tts   (secret: OPENAI_API_KEY)
// NOTE: Deno, not React Native.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';
const TTS_MODEL = 'gpt-4o-mini-tts';
const MAX_INPUT_CHARS = 2000; // prompts are short; bounds cost/abuse

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

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) return json({ error: 'Server missing OPENAI_API_KEY' }, 500);

    const { input, voice, instructions } = await req.json();
    if (typeof input !== 'string' || input.length === 0) {
      return json({ error: 'input required' }, 400);
    }
    if (input.length > MAX_INPUT_CHARS) {
      return json({ error: 'input too long' }, 400);
    }

    const res = await fetch(OPENAI_TTS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: typeof voice === 'string' ? voice : 'coral',
        input,
        instructions: typeof instructions === 'string' ? instructions : undefined,
        response_format: 'mp3',
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return json({ error: `OpenAI TTS ${res.status}: ${errText}` }, res.status);
    }

    // Stream the MP3 bytes straight back to the client.
    const audio = await res.arrayBuffer();
    return new Response(audio, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'audio/mpeg' },
    });
  } catch (e) {
    console.error('[openai-tts] error:', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
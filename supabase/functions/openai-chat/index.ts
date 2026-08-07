// supabase/functions/openai-chat/index.ts
//
// Thin, AUTHENTICATED proxy for OpenAI chat/completions. The OpenAI key lives ONLY
// here (Supabase secret OPENAI_API_KEY), never in the app bundle. The client builds
// its own request body (model + messages + params — prompts aren't secret) and calls
// `supabase.functions.invoke('openai-chat', { body })`; supabase-js attaches the
// user's JWT, which we verify so only signed-in users can spend the key.
//
// Abuse guards: model must be on the allowlist, max_tokens is capped. The response
// is OpenAI's JSON, forwarded verbatim (the client parses choices[0].message.content).
//
// Deploy:  supabase functions deploy openai-chat
//   Secret: supabase secrets set OPENAI_API_KEY=sk-...
//
// NOTE: Deno, not React Native — excluded from the app tsconfig.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ALLOWED_MODELS = new Set(['gpt-4o', 'gpt-4o-mini']);
const MAX_TOKENS_CAP = 4096;

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

    // Identify the caller from their JWT (anon client scoped to their token).
    const caller = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await caller.auth.getUser();
    if (userErr || !user) return json({ error: 'Unauthorized' }, 401);

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) return json({ error: 'Server missing OPENAI_API_KEY' }, 500);

    const reqBody = await req.json();
    if (!reqBody || typeof reqBody.model !== 'string' || !ALLOWED_MODELS.has(reqBody.model)) {
      return json({ error: 'Model not allowed' }, 400);
    }
    if (!Array.isArray(reqBody.messages) || reqBody.messages.length === 0) {
      return json({ error: 'messages[] required' }, 400);
    }

    // Cap max_tokens to bound cost; pass everything else through verbatim.
    const safeBody = {
      ...reqBody,
      max_tokens: Math.min(Number(reqBody.max_tokens) || MAX_TOKENS_CAP, MAX_TOKENS_CAP),
    };

    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(safeBody),
    });

    const data = await res.json().catch(() => ({ error: 'Bad OpenAI response' }));
    // Forward OpenAI's status so a non-2xx surfaces as an invoke error on the client.
    return json(data, res.ok ? 200 : res.status);
  } catch (e) {
    console.error('[openai-chat] error:', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
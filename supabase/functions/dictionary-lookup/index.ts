// supabase/functions/dictionary-lookup/index.ts
//
// Authenticated server-side proxy for Datamuse.
// Request:  POST { "word": "pragmatic" }
// Success:  200 { "entry": DictionaryEntry | null }

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DATAMUSE_URL = 'https://api.datamuse.com/words';
const MAX_WORD_LENGTH = 40;
const TIMEOUT_MS = 8_000;

const POS_LABELS: Record<string, string> = {
  n: 'noun',
  v: 'verb',
  adj: 'adjective',
  adv: 'adverb',
};

type DictionaryEntry = {
  word: string;
  partOfSpeech: string | null;
  definition: string | null;
  example: string | null;
  phonetic: string | null;
  audioUrl: string | null;
};

function json(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function parseEntry(
  data: unknown,
  requestedWord: string,
): DictionaryEntry | null {
  if (!Array.isArray(data)) {
    throw new Error('Datamuse response was not an array');
  }

  if (data.length === 0) return null;

  const candidate = data[0];

  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof candidate.word !== 'string'
  ) {
    throw new Error('Datamuse returned a malformed entry');
  }

  // Datamuse's `sp=` search is fuzzy. Do not use a result for a
  // different word as the requested word's definition.
  if (
    candidate.word.toLowerCase() !== requestedWord.toLowerCase()
  ) {
    return null;
  }

  const topDefinition =
    Array.isArray(candidate.defs) &&
    typeof candidate.defs[0] === 'string'
      ? candidate.defs[0]
      : null;

  if (!topDefinition) return null;

  // Definitions look like: "adj\tconcerned with practical matters"
  const tabIndex = topDefinition.indexOf('\t');
  const posCode =
    tabIndex > 0
      ? topDefinition.slice(0, tabIndex).trim()
      : '';

  const definition = (
    tabIndex >= 0
      ? topDefinition.slice(tabIndex + 1)
      : topDefinition
  ).trim();

  if (!definition) return null;

  const firstTag =
    Array.isArray(candidate.tags) &&
    typeof candidate.tags[0] === 'string'
      ? candidate.tags[0]
      : '';

  return {
    word: candidate.word,
    partOfSpeech:
      POS_LABELS[posCode] ??
      POS_LABELS[firstTag] ??
      null,
    definition,
    example: null,
    phonetic: null,
    audioUrl: null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json(
      { error: 'Method not allowed' },
      405,
      { Allow: 'POST' },
    );
  }

  try {
    // Match the authentication pattern used by the other EasySpeak
    // Edge Functions.
    const authHeader = req.headers.get('Authorization');

    if (!authHeader) {
      return json(
        { error: 'Missing Authorization header' },
        401,
      );
    }

    const caller = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      },
    );

    const {
      data: { user },
      error: userError,
    } = await caller.auth.getUser();

    if (userError || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const rawWord =
      body &&
      typeof body === 'object' &&
      'word' in body
        ? (body as { word?: unknown }).word
        : undefined;

    if (typeof rawWord !== 'string') {
      return json(
        { error: 'word must be a string' },
        400,
      );
    }

    const word = rawWord.trim();

    if (!word) {
      return json({ error: 'word is required' }, 400);
    }

    if (word.length > MAX_WORD_LENGTH) {
      return json(
        {
          error:
            `word must be ${MAX_WORD_LENGTH} characters or fewer`,
        },
        400,
      );
    }

    const url = new URL(DATAMUSE_URL);

    url.search = new URLSearchParams({
      sp: word.toLowerCase(),
      md: 'dp',
      max: '1',
    }).toString();

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      TIMEOUT_MS,
    );

    let upstream: Response;

    try {
      upstream = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent':
            'EasySpeak/1.0 (dictionary lookup)',
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'AbortError'
      ) {
        console.error(
          '[dictionary-lookup] Datamuse timed out',
        );

        return json(
          { error: 'Dictionary provider timed out' },
          504,
        );
      }

      console.error(
        '[dictionary-lookup] Datamuse request failed:',
        error,
      );

      return json(
        { error: 'Dictionary provider unavailable' },
        502,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const responseText = await upstream.text();

    if (!upstream.ok) {
      console.error(
        '[dictionary-lookup] Datamuse rejected request:',
        {
          status: upstream.status,
          server: upstream.headers.get('server'),
          cache: upstream.headers.get('x-cache'),
          requestId:
            upstream.headers.get('x-amz-cf-id'),
        },
      );

      return json(
        {
          error: 'Dictionary provider unavailable',
          upstreamStatus: upstream.status,
        },
        502,
      );
    }

    let upstreamData: unknown;

    try {
      upstreamData = JSON.parse(responseText);
    } catch {
      console.error(
        '[dictionary-lookup] Datamuse returned invalid JSON',
      );

      return json(
        {
          error:
            'Dictionary provider returned an invalid response',
        },
        502,
      );
    }

    let entry: DictionaryEntry | null;

    try {
      entry = parseEntry(upstreamData, word);
    } catch (error) {
      console.error(
        '[dictionary-lookup] Invalid Datamuse response:',
        error,
      );

      return json(
        {
          error:
            'Dictionary provider returned an invalid response',
        },
        502,
      );
    }

    return json({ entry });
  } catch (error) {
    console.error(
      '[dictionary-lookup] Unexpected error:',
      error,
    );

    return json(
      { error: 'Internal server error' },
      500,
    );
  }
});
// lib/dictionary.ts


import { supabase } from './supabase';

export type DictionaryEntry = {
  word: string;
  partOfSpeech: string | null;
  definition: string | null;
  example: string | null;
  phonetic: string | null;
  audioUrl: string | null;
};


type DictionaryLookupResponse = {
  entry: DictionaryEntry | null;
};

type DictionaryErrorResponse = {
  error?: unknown;
  upstreamStatus?: unknown;
};

function isNullableString(
  value: unknown,
): value is string | null {
  return typeof value === 'string' || value === null;
}

function isDictionaryEntry(
  value: unknown,
): value is DictionaryEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const entry = value as Record<string, unknown>;

  return (
    typeof entry.word === 'string' &&
    isNullableString(entry.partOfSpeech) &&
    isNullableString(entry.definition) &&
    isNullableString(entry.example) &&
    isNullableString(entry.phonetic) &&
    isNullableString(entry.audioUrl)
  );
}

export async function lookupWord(raw: string): Promise<DictionaryEntry | null> {
  const word = raw.trim();

  if (!word) return null;

  const {
    data,
    error,
    response,
  } = await supabase.functions.invoke<DictionaryLookupResponse>(
    'dictionary-lookup',
    {
      body: { word },
      // The function stops waiting for Datamuse after 8 seconds.
      // Give the complete app-to-function request slightly longer.
      timeout: 12_000,
    },
  );

  if (error) {
    let detail =
      error instanceof Error
        ? error.message
        : 'Unknown Edge Function error';

    // A non-2xx function response has a Response containing the
    // structured error returned by dictionary-lookup.
    if (response) {
      const payload = await response
        .json()
        .catch(() => null) as DictionaryErrorResponse | null;

      if (typeof payload?.error === 'string') {
        detail = payload.error;
      }

      if (typeof payload?.upstreamStatus === 'number') {
        detail += ` (${payload.upstreamStatus})`;
      }
    }

    throw new Error(`Dictionary lookup failed: ${detail}`);
  }

  if (
    !data ||
    typeof data !== 'object' ||
    !Object.prototype.hasOwnProperty.call(data, 'entry')
  ) {
    throw new Error(
      'Dictionary lookup failed: invalid Edge Function response',
    );
  }

  if (data.entry === null) {
    return null;
  }

  if (!isDictionaryEntry(data.entry)) {
    throw new Error(
      'Dictionary lookup failed: malformed dictionary entry',
    );
  }

  return data.entry;


}

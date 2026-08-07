/**
 * Filler word configuration. Conservative 5-filler set per M4 decisions.
 * "you know" is a bigram — handled separately in metrics.ts.
 */

// lib/filler-words.ts
export const SINGLE_FILLERS = new Set([
  'um', 'umm', 'uhm',
  'uh', 'uhh',
  'er', 'erm', 'ah',
  'mm', 'hmm',
  'like',
]);

export const BIGRAM_FILLERS: ReadonlyArray<readonly [string, string]> = [
  ['you', 'know'],
];

/** Lowercase + strip punctuation. Keeps apostrophes for contractions. */
export const normalizeWord = (s: string): string =>
  s.toLowerCase().replace(/[^\w']/g, '');

// The effective filler vocabulary for one detection pass: the built-in set plus
// whatever the user added. Detection reads from one of these instead of the
// module constants, so a per-user custom list never mutates shared state.
export type FillerLexicon = {
  singles: ReadonlySet<string>;
  bigrams: ReadonlyArray<readonly [string, string]>;
};

// The built-in lexicon — used when there are no custom words. Shared instance so
// the common (no-custom-fillers) path allocates nothing.
export const BASE_FILLER_LEXICON: FillerLexicon = {
  singles: SINGLE_FILLERS,
  bigrams: BIGRAM_FILLERS,
};

/**
 * Merge a user's custom filler entries into the built-in lexicon for a detection
 * pass. Each entry is normalized and split on whitespace: 1 token → a single
 * filler, 2 tokens → a bigram (the detector only handles 1- and 2-word fillers).
 * Entries that normalize to 0 or >2 tokens are dropped (the editor restricts
 * input to 1–2 words; this is a defensive backstop). Never mutates the base sets.
 * Returns the shared BASE_FILLER_LEXICON unchanged when there are no custom words.
 */
export function buildFillerLexicon(custom?: readonly string[] | null): FillerLexicon {
  if (!custom || custom.length === 0) return BASE_FILLER_LEXICON;

  const singles = new Set(SINGLE_FILLERS);
  const bigrams: Array<readonly [string, string]> = [...BIGRAM_FILLERS];

  for (const entry of custom) {
    const tokens = entry.split(/\s+/).map(normalizeWord).filter((t) => t.length > 0);
    if (tokens.length === 1) singles.add(tokens[0]);
    else if (tokens.length === 2) bigrams.push([tokens[0], tokens[1]]);
  }

  return { singles, bigrams };
}
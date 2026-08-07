// lib/filler-validate.ts
//
// SECURITY: TEMPORARY — calls OpenAI directly from the client.
// Move to a Supabase Edge Function before external user testing (M6).
//
// Context-checks AMBIGUOUS filler candidates. The lexical detector in metrics.ts
// flags every "like" / "you know" as a filler, but those words have meaningful
// uses ("it tastes like a dessert", "do you know him"). This sends just the
// ambiguous occurrences (in the full transcript, for context) to a cheap model
// and returns the word indices that were NOT real fillers — to be excluded from
// the count via computeMetrics's excludeFillerIndices param.
//
// Pure vocalizations (um, uh, er, mm, hmm, ah) can't be real words, so they're
// never sent. Designed word-agnostically: anything outside NEVER_VALIDATE is
// checked, so a future custom-filler feature gets the same protection for free.

import type { DeepgramWord } from './deepgram';
import type { FillerInstance } from './metrics';
import { normalizeWord } from './filler-word';
import { openaiChat } from './ai-proxy';

// Cheap + fast: contextual classification, not a judgment task.
const MODEL = 'gpt-4o-mini';
const TEMPERATURE = 0; // deterministic — same transcript → same verdicts
const MAX_TOKENS = 300;

// Vocalizations that are never a meaningful word → always a filler, never worth an
// AI round-trip. Everything else detected (today "like" / "you know"; later custom
// words) is ambiguous and gets context-checked.
const NEVER_VALIDATE = new Set([
  'um', 'umm', 'uhm',
  'uh', 'uhh',
  'er', 'erm', 'ah',
  'mm', 'hmm',
]);

type Candidate = { id: number; instance: FillerInstance };

/**
 * Returns the set of word indices to EXCLUDE from the filler count — flagged
 * words that were actually used meaningfully. An empty set means "exclude
 * nothing": no ambiguous candidates, or the call failed (we fall back to the
 * lexical result rather than block finalize).
 */
export async function validateFillers(
  words: DeepgramWord[],
  instances: FillerInstance[],
  options?: { signal?: AbortSignal },
): Promise<Set<number>> {
  const exclude = new Set<number>();

  // Only ambiguous candidates need checking (skip the pure vocalizations).
  const candidates: Candidate[] = instances
    .filter((inst) => !NEVER_VALIDATE.has(normalizeWord(inst.text.split(' ')[0])))
    .map((instance, id) => ({ id, instance }));

  if (candidates.length === 0) return exclude; // nothing ambiguous → no call

  try {
    const userMessage = buildMessage(words, candidates);

    const res = await openaiChat(
      {
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        response_format: { type: 'json_object' },
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS,
      },
      options?.signal,
    );
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);

    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (!content) throw new Error('No content in response');

    const parsed = JSON.parse(content) as { verdicts?: { id: number; filler: boolean }[] };
    const verdicts = parsed?.verdicts ?? [];

    // Only remove on an explicit filler:false — a missing/uncertain verdict keeps
    // the word counted (conservative about removal).
    for (const v of verdicts) {
      if (v && typeof v.id === 'number' && v.filler === false) {
        const cand = candidates.find((c) => c.id === v.id);
        if (cand) for (const i of cand.instance.indices) exclude.add(i);
      }
    }

  } catch (err) {
    console.warn('[filler-validate] failed, keeping lexical fillers:', err);
    return new Set(); // fall back: exclude nothing, never block finalize
  }

  return exclude;
}

const SYSTEM_PROMPT = `You decide whether specific flagged words in a speech transcript were spoken as FILLER words or as MEANINGFUL words.

A FILLER is a hesitation, verbal tic, or discourse marker that carries no meaning and could be deleted without changing the sentence. "like" as a filler: "it was, like, really big", "I was like, no way". "you know" as a filler: "it was great, you know, really fun".

A MEANINGFUL use carries actual meaning and cannot be deleted. "like" is meaningful when it is the VERB meaning to enjoy or want ("I like it", "I like to drink coffee", "I like running", "I would like to", "they like each other", "what I like about it") OR a comparison/manner word meaning "similar to" or "in the manner of": "it tastes like a dessert", "things like that", "be like this", "act like that", "do it like this", "someone like you", "looks like rain". In particular, "like" right before "this", "that", or "these" is MEANINGFUL when it means "in this/that manner" — e.g. "they tell you to do this, be like this, do that" (here "be like this" means "be this way", so it cannot be deleted). "you know" as meaningful: "do you know him", "you know the rules".

You are given a transcript with certain occurrences wrapped in markers of the form «ID|word», where ID is a number. For EACH marked occurrence, decide whether that specific use was a filler.

Judge only by context. "like" is STILL a filler even when "this"/"that" follows if it is a deletable hesitation rather than a comparison — approximating ("it was, like, this big") or quotative ("and I was like, this is wild"). So decide by whether the word carries the "similar to / in the manner of" meaning, not by the word that follows it. When a marked word clearly carries meaning, it is NOT a filler. Only call it a filler when it is clearly a hesitation or verbal tic. If a case is genuinely 50/50, treat it as meaningful (not a filler).

OUTPUT: a JSON object {"verdicts": [{"id": <number>, "filler": <boolean>}, ...]} with exactly one entry per marked occurrence. No other fields, no markdown.`;

function buildMessage(words: DeepgramWord[], candidates: Candidate[]): string {
  const candByStart = new Map<number, Candidate>();
  for (const c of candidates) candByStart.set(c.instance.indices[0], c);

  // Non-first indices of multi-word candidates ("you know") — emitted as part of
  // the phrase, skipped when reached.
  const skip = new Set<number>();
  for (const c of candidates) {
    for (let k = 1; k < c.instance.indices.length; k++) skip.add(c.instance.indices[k]);
  }

  const wordText = (i: number) => words[i].punctuated_word ?? words[i].word;

  const parts: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (skip.has(i)) continue;
    const cand = candByStart.get(i);
    if (cand) {
      const phrase = cand.instance.indices.map(wordText).join(' ');
      parts.push(`«${cand.id}|${phrase}»`);
    } else {
      parts.push(wordText(i));
    }
  }

  return `Transcript (only the marked «ID|word» occurrences need a verdict):\n\n${parts.join(' ')}\n\nReturn the JSON now.`;
}
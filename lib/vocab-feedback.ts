// lib/vocab-feedback.ts
//
// Scores a Vocabulary "describe this word in your own words" attempt, via the openai-chat
// Edge Function. Forked from lib/explain-feedback.ts (same gpt-4o / temp 0.5 / fixed seed /
// reasoning-first JSON / validateFeedback clamp / openaiChat), but the rubric is DIFFERENT
// and there are NO delivery metrics — vocab is scored purely on MEANING accuracy.
//
// The load-bearing idea (the app's spin): the user should capture the word's meaning in
// THEIR OWN words, not recite the dictionary. So the cached dictionary definition is the
// ground-truth meaning to check against, NOT a script to match — a rough-but-original
// correct description scores HIGHER than a near-verbatim recital. The no-audience rule
// carries over (the user practices alone; judge the description's correctness, never a
// hypothetical listener). Copy + few-shots below are PLACEHOLDER — calibrate via the
// discarded `reasoning` field against real runs.
//
// ⚠️ BOTH of those rules assume the definition came from the DICTIONARY. Since the user can
// edit it, the prompt branches on `definitionSource`:
//   • 'dictionary' — authoritative ground truth; near-verbatim recital is penalized.
//   • 'user'       — only what the user BELIEVES the word means. It can be wrong, so
//                    correctness is judged against the word's established meaning instead,
//                    and echoing their own text is NOT recitation (it's already their words).
//   • 'none'       — no definition at all; fall back to the model's own knowledge of the
//                    word, and to plain coherence if it isn't a word the model knows.

import { openaiChat } from './ai-proxy';
import type { DefinitionSource } from './vocab';

const MODEL = 'gpt-4o';
const TEMPERATURE = 0.5;
const MAX_TOKENS = 400;
const SEED = 7;

// ============================================================
// Types
// ============================================================

export type VocabFeedbackInput = {
  word: string;
  // The word's cached definition. null for a word Datamuse had no entry for and the user
  // never wrote one — the model then falls back on its own knowledge.
  definition: string | null;
  // Who wrote `definition`. Decides whether it is treated as ground truth and whether the
  // verbatim-recital penalty applies at all. See the note at the top of this file.
  definitionSource: DefinitionSource;
  transcript: string; // what the user said describing the word
};

// The "Source:" line the model reads. Keep in sync with the few-shot USER blocks below.
const SOURCE_LINE: Record<DefinitionSource, string> = {
  dictionary: 'the dictionary (authoritative)',
  user: 'written by the user themselves (may be imperfect)',
  none: 'none available',
};

export type VocabFeedback = {
  score: number; // 1–10 integer — how well they captured the meaning in their own words
  feedback: string;
};

// ============================================================
// System prompt
// ============================================================

const SYSTEM_PROMPT = `You are a vocabulary coach. The user is learning a word and just tried to explain what it means OUT LOUD, in their own words. You have the word, a reference definition, and a transcript of what they said. Give them a 1–10 score for how well they captured the meaning, AND one piece of feedback they can act on next time.

THE DEFINITION'S SOURCE CHANGES HOW YOU USE IT. Read the "Source:" line under "## Definition" before anything else.

- Source: the dictionary (authoritative) — the definition IS the ground truth. Check their meaning against it. It is NOT a script to match: PENALIZE reciting it close to word-for-word, because that is recall rather than understanding.

- Source: written by the user themselves (may be imperfect) — the definition is NOT authoritative. It is what the user BELIEVES the word means. Judge their spoken description against the word's ESTABLISHED meaning, which you already know, and treat their definition only as context for what they think. Two consequences follow. First, do NOT apply the recital penalty for echoing this text, because it is already their own phrasing and overlap proves nothing. Second, if their saved definition is wrong or missing something important, say so plainly, give the real meaning, and score the MEANING accordingly. A fluent description of a wrong definition is still wrong.

- Source: none available — there is no definition. Use your own knowledge of the word as the ground truth. If it is not a real word you recognize, judge instead whether the described meaning is coherent, specific, and self-consistent.

SCORING

Score is a 1–10 integer measuring whether they conveyed the word's CORE MEANING in their OWN words.
- REWARD: capturing the essential meaning in genuinely fresh phrasing; a fitting example, contrast, or use in a sentence that shows real understanding; a paraphrase that pins the concept down.
- PENALIZE: a wrong or half-right meaning; a circular non-answer that just reuses the word or its root; and, ONLY when the source is the dictionary, reciting that definition close to word-for-word (score it BELOW a rougher but original correct description).
- Ignore delivery entirely. Pace, fillers, and pauses are NOT measured here — do not mention them.

Anchored 1 / 5 / 10:
- 10: nailed the core meaning in clearly original words, usually with an apt example or contrast. You can tell they understand it, not just remember the gloss.
- 5: partially right — missed a key part of the meaning or blurred it — OR (dictionary source only) essentially recited the dictionary line with little of their own.
- 1: wrong meaning, circular, or just repeated the word without explaining it. A confident description of a wrong saved definition belongs here too.

WRITE:
- 2–4 sentences of prose. No bullets, no headers, no markdown.
- Warm but direct. Second person ("you"). Sound like a coach with 15 seconds before their next attempt.
- Name ONE specific strength and ONE specific growth area, both from THIS attempt.
- Give a concrete, rehearsable next step (e.g., "add one example sentence," "name the contrast with X").
- Reference a specific phrase they said, in single quotes. If your feedback would fit a different word, you haven't done your job.
- Short sentences. Start with "But," "And," or "So" when it fits.

DO NOT:
- Never use three parallel items in a row (a tricolon).
- Do not refer to an audience, listener, reader, or anyone the description is aimed at. The user practices alone to understand words better. Judge the meaning itself: "you captured the practical-over-theory core," "the meaning came out backwards," "that part is closer to a different word."
- Do not just restate the reference definition back at them.
- When the source is the dictionary, do not reward a word-for-word recital — say so plainly when it happens and ask for their own phrasing or an example. Never call it a recital when the user wrote the definition themselves.
- Open with "Great job," "Nice work," "Good start," or any warm-up phrase.
- No generic advice ("vocabulary takes practice"). No em-dashes (end the sentence instead). No semicolons (two sentences instead).

OUTPUT: a JSON object with THREE fields, in THIS EXACT ORDER: "reasoning" (one short internal sentence — note whether they hit the core meaning and whether it was their own words or a recital, THEN commit to a number; NOT shown to the user), "score" (integer 1-10), and "feedback" (your 2–4 sentence response as a single string). The "reasoning" MUST come first. No surrounding markdown, no other fields.`;

// ============================================================
// Few-shot examples (PLACEHOLDER — dev calibrates). Each USER block MUST match
// buildUserMessage() output exactly, including the "Source:" line. Spread across all three
// sources: dictionary (own-words 9 / near-verbatim 5 / wrong 2), none (8), and user-authored
// (correct-with-heavy-overlap 8, which must NOT be scored as a recital; and a wrong saved
// definition described faithfully, which must still score low).
// ============================================================

const EXAMPLE_1_USER = `## Word
pragmatic

## Definition
Source: the dictionary (authoritative)
Dealing with things sensibly and realistically in a way that is based on practical rather than theoretical considerations.

## What the user said
Pragmatic means you approach a problem based on what actually works in the real world, the practical results, instead of sticking to theory or how things should be in an ideal world. Like a pragmatic person picks the solution that gets the job done even if it's not the most elegant one.

Generate the JSON feedback now.`;

const EXAMPLE_1_ASSISTANT = `{"reasoning": "Dictionary source. Core meaning nailed (real-world results over theory) and it's clearly his own phrasing, plus a use-case that shows understanding. A strong 9.", "score": 9, "feedback": "You got the heart of it in your own words. 'What actually works in the real world' instead of theory is exactly the contrast the word turns on, and you didn't lean on the dictionary phrasing to get there. The 'gets the job done even if it's not elegant' line proved you actually hold the idea. Next time, try one real example: a pragmatic choice you'd make versus an idealistic one. That locks it in even harder."}`;

const EXAMPLE_2_USER = `## Word
pragmatic

## Definition
Source: the dictionary (authoritative)
Dealing with things sensibly and realistically in a way that is based on practical rather than theoretical considerations.

## What the user said
Pragmatic means dealing with things sensibly and realistically in a way that's based on practical rather than theoretical considerations.

Generate the JSON feedback now.`;

const EXAMPLE_2_ASSISTANT = `{"reasoning": "Dictionary source, so the recital penalty applies: correct but read back almost word for word. Recall, not understanding. Caps at 5.", "score": 5, "feedback": "That's the right meaning, but it's almost exactly the dictionary line, so it shows you can recall it more than you own it. Try saying it again without the words 'practical' or 'theoretical' at all. So force yourself to reach for 'real-world results versus ideals,' or give a quick example of someone being pragmatic. When you can explain it without the textbook phrasing, it's actually yours."}`;

const EXAMPLE_3_USER = `## Word
ephemeral

## Definition
Source: the dictionary (authoritative)
Lasting for a very short time.

## What the user said
Ephemeral means something kind of ghostly or spiritual, like something you can't really touch or hold onto, it feels almost dreamlike.

Generate the JSON feedback now.`;

const EXAMPLE_3_ASSISTANT = `{"reasoning": "Wrong core meaning — 'ephemeral' is about lasting a short time, not intangibility/ghostliness. The 'can't hold onto' brushes near it but the meaning is off. A 2.", "score": 2, "feedback": "This drifted to the wrong meaning. 'Ephemeral' isn't about being ghostly or untouchable, it's about lasting a very short time, here and then gone. Your 'can't hold onto it' was circling the real idea but landed on the wrong one. Anchor it to time: think of a mayfly, or a sandcastle before the tide. Say 'it doesn't last' out loud and build from there."}`;

const EXAMPLE_4_USER = `## Word
snollygoster

## Definition
Source: none available
(no definition)

## What the user said
I think a snollygoster is a shrewd, unprincipled person, especially a politician who's guided by personal gain rather than any real principles.

Generate the JSON feedback now.`;

const EXAMPLE_4_ASSISTANT = `{"reasoning": "No stored definition, so I check against what I know: a snollygoster is a shrewd, unprincipled person, especially a politician. Their meaning matches, in their own words, though it stays close to a bare gloss. An 8.", "score": 8, "feedback": "With nothing saved to lean on, you still landed the meaning. 'Shrewd but unprincipled, guided by personal gain' is exactly the sense the word carries, and it's all your own phrasing. So the description stands on its own. If you want to push it, add the flavor of cunning underneath, the sense of someone clever about working the system. That extra shade would make it fuller."}`;

const EXAMPLE_5_USER = `## Word
gregarious

## Definition
Source: written by the user themselves (may be imperfect)
someone who really likes being around other people and gets their energy from company

## What the user said
Gregarious means someone who loves being around other people, they get their energy from company rather than from being alone.

Generate the JSON feedback now.`;

const EXAMPLE_5_ASSISTANT = `{"reasoning": "User-authored definition, so the heavy overlap is NOT a recital. Checked against the established sense (sociable, enjoys company) their meaning is right. Correct but thin, no example or contrast. An 8.", "score": 8, "feedback": "You have the meaning right, and 'get their energy from company' is the part that actually matters, because gregarious is about where the energy comes from and not just about being friendly. You wrote that definition yourself, so saying it back isn't a problem here. What's missing is proof you can use it. Add one contrast next time: a gregarious person who stays till the end versus someone who slips out early to recharge alone."}`;

const EXAMPLE_6_USER = `## Word
enervate

## Definition
Source: written by the user themselves (may be imperfect)
to energize someone or fire them up

## What the user said
Enervate means to energize someone, to fire them up and give them a burst of motivation.

Generate the JSON feedback now.`;

const EXAMPLE_6_ASSISTANT = `{"reasoning": "The user's own saved definition is backwards: enervate means to DRAIN of energy, not supply it. They described their own wrong definition fluently, so the meaning is still wrong. Correct it. A 2.", "score": 2, "feedback": "This one is backwards, and it's worth catching now because you saved that meaning yourself. 'Fire them up' is the opposite of what enervate does. To enervate is to drain someone of energy and leave them weak, so a long humid afternoon enervates you. Fix the saved definition first, then say it out loud as 'it drains the life out of you' until the old meaning stops surfacing."}`;

// ============================================================
// Main function
// ============================================================

export async function generateVocabFeedback(input: VocabFeedbackInput): Promise<VocabFeedback> {
  const userMessage = buildUserMessage(input);

  const res = await openaiChat({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: EXAMPLE_1_USER },
      { role: 'assistant', content: EXAMPLE_1_ASSISTANT },
      { role: 'user', content: EXAMPLE_2_USER },
      { role: 'assistant', content: EXAMPLE_2_ASSISTANT },
      { role: 'user', content: EXAMPLE_3_USER },
      { role: 'assistant', content: EXAMPLE_3_ASSISTANT },
      { role: 'user', content: EXAMPLE_4_USER },
      { role: 'assistant', content: EXAMPLE_4_ASSISTANT },
      { role: 'user', content: EXAMPLE_5_USER },
      { role: 'assistant', content: EXAMPLE_5_ASSISTANT },
      { role: 'user', content: EXAMPLE_6_USER },
      { role: 'assistant', content: EXAMPLE_6_ASSISTANT },
      { role: 'user', content: userMessage },
    ],
    response_format: { type: 'json_object' },
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
    seed: SEED,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${errText || res.statusText}`);
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error('No content in OpenAI response');

  let parsed: RawFeedbackResponse | null;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Malformed JSON in OpenAI response: ${content.slice(0, 100)}`);
  }

  return validateFeedback(parsed);
}

// The leading "reasoning" field is discarded (it only exists so the score follows a
// stated rationale).
type RawFeedbackResponse = {
  score?: number;
  feedback?: string;
};

function validateFeedback(raw: RawFeedbackResponse | null): VocabFeedback {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Response is not an object');
  }

  const { score, feedback } = raw;

  if (typeof score !== 'number' || !Number.isFinite(score)) {
    throw new Error('Malformed feedback response: score not a finite number');
  }
  const clampedScore = Math.max(1, Math.min(10, Math.round(score)));

  if (typeof feedback !== 'string') {
    throw new Error('Malformed feedback response: missing feedback string');
  }
  const trimmed = feedback.trim();
  if (trimmed.length === 0) {
    throw new Error('Empty feedback response');
  }
  if (trimmed.length < 30 || trimmed.length > 1000) {
    console.warn(`[Vocab Feedback] Unexpected length: ${trimmed.length} chars`);
  }

  return { score: clampedScore, feedback: trimmed };
}

// ============================================================
// User message builder — MUST stay byte-for-byte in sync with the example USER
// constants above.
// ============================================================

function buildUserMessage(input: VocabFeedbackInput): string {
  const definition = input.definition?.trim();
  const hasDefinition = !!definition && definition.length > 0;
  // Belt and braces: an absent definition can never be labelled authoritative, whatever the
  // caller passed. The client derives this too, but the prompt must not be corruptible.
  const source: DefinitionSource = hasDefinition ? input.definitionSource : 'none';
  const lines: string[] = [];

  lines.push('## Word');
  lines.push(input.word.trim());
  lines.push('');
  lines.push('## Definition');
  lines.push(`Source: ${SOURCE_LINE[source]}`);
  lines.push(hasDefinition ? definition! : '(no definition)');
  lines.push('');
  lines.push('## What the user said');
  lines.push(input.transcript.trim());
  lines.push('');
  lines.push('Generate the JSON feedback now.');

  return lines.join('\n');
}

// Trivial passthrough for parity with buildExplainFeedbackInput (no metric threading).
export function buildVocabFeedbackInput(
  word: string,
  definition: string | null,
  definitionSource: DefinitionSource,
  transcript: string,
): VocabFeedbackInput {
  return { word, definition, definitionSource, transcript };
}
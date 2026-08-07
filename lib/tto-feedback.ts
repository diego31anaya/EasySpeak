// lib/tto-feedback.ts
//
// Generates per-round scores and feedback for a complete 3-2-1 (TTO) session via
// the openai-chat Edge Function (which holds the key). ONE call per session,
// returning all three rounds, so the model can reason about cross-round trajectory.
// The score is HOLISTIC: framework adherence dominant, delivery shifting it ±1–2.

import type { Shape } from './tto-framework-prompt';
import type { PaceVerdict, PaceConsistencyVerdict } from './metrics';
import { paceStatus, fillerStatus, pauseStatus, type MetricStatus } from './metric-status';
import { openaiChat } from './ai-proxy';

// Model: gpt-4o, not mini. The task is a judgment task (did the user follow
// the shape?) — mini under-scores nuance and tends to over-score length.
// Cost is ~$0.012 per session, not meaningful at any reasonable scale.
const MODEL = 'gpt-4o';

// Temperature: 0.4. We want consistency between calls (similar input →
// similar score) more than we want variety, but the per-round feedback prose
// needs SOME variation to not feel templated. 0.4 is the same as the old
// coach.ts. (ai-feedback runs 0.5 for the same balance, lowered from 0.7 once it
// moved to reasoning-first scoring.)
const TEMPERATURE = 0.4;

// Three rounds × (1 short internal reasoning line + 1 score + ~50-word feedback).
// Bumped from 600 to fit the added per-round reasoning without truncating prose.
const MAX_TOKENS = 800;

// Fixed seed → OpenAI best-effort reproducibility, a nudge toward stable scores.
const SEED = 7;

// ============================================================
// Types
// ============================================================

export type TTORoundInput = {
  shape: Shape;
  prompt: string;
  transcript: string;
  metrics: {
    wpm: number;
    paceVerdict: PaceVerdict;
    paceConsistencyVerdict: PaceConsistencyVerdict;
    fillerCount: number;
    hesitationPauseCount: number;
    intentionalPauseCount: number;
    totalWords: number;
    // Precomputed delivery ratings (good/warning/danger) from lib/metric-status —
    // the SAME source the round's metric rows use, so the score can't disagree
    // with them. The prompt defers to these instead of re-deriving from raw counts.
    paceRating: MetricStatus;
    fillerRating: MetricStatus;
    pauseRating: MetricStatus;
  };
};

export type TTORoundFeedback = {
  score: number;        // 1–10 integer, holistic (framework + delivery)
  feedback: string;     // 2–3 sentences referencing this round and, when
                        // relevant, patterns across rounds
};

export type TTOFeedback = {
  rounds: [TTORoundFeedback, TTORoundFeedback, TTORoundFeedback];
};

// ============================================================
// System prompt
// ============================================================

const SYSTEM_PROMPT = `You are a speech coach reviewing one 3-2-1 Framework practice session. The user spoke three impromptu responses, each using a different "shape" — a way of organizing the answer.

The three shapes:

"1 Thing" — The user picks one single point, observation, or position and elaborates on it. The framework's value is in CHOOSING what to focus on, then sticking with it instead of listing several things.

"2 Types" — The user picks two different examples, approaches, kinds, or instances within the topic and talks about each. The two do NOT need to be opposites, complements, or in any kind of contrast. They just need to be two distinct things within the same category. (For example, answering "how do you eat an avocado" with "you can put it on bread, or eat it plain" — the two answers aren't opposites, they're just two of many possible ways.) The framework's value is in CHOOSING which two out of many possibilities, then giving each its own treatment instead of trying to cover everything.

"3 Steps" — The user walks through something in order, three sequential pieces. The framework's value is in IMPOSING order on something, then narrating it clearly.

For each round, you have the shape, the prompt, the user's transcript, and computed delivery metrics.

Your job: produce a holistic score (1-10 integer) and 2-3 sentence prose feedback for each round.

SCORING

The score reflects BOTH framework adherence (did they use the shape correctly?) AND delivery (pace, fillers, pauses). Framework is the primary driver; delivery modulates within ~2 points.

Shape rubric, anchored at 1 / 5 / 10:

1 Thing — 10: picked one point, committed to it, developed it with detail. 5: picked one but drifted to other topics, OR picked one but didn't develop it. 1: listed several things; never committed to one.

2 Types — 10: picked two distinct things within the topic and gave each its own treatment. 5: named two but only really developed one, OR named more than two. 1: only one example, OR the "two" weren't actually distinct (just rephrased the same thing).

3 Steps — 10: three pieces in a clear sequence — a listener can tell what's first, second, and third. 5: three things but no real sequence (could be reordered without losing meaning), OR named two or four instead of three. 1: no ordering imposed at all; stream of consciousness.

Each delivery dimension (pace, fillers, pauses) is ALREADY rated for you in each round's metrics as good, warning, or danger. USE those ratings, and do not re-derive a delivery judgment from the raw numbers. A "danger" rating pulls the score down, a "warning" pulls it down a little, a "good" not at all. Delivery should not move a round's score more than 2 points combined from its framework baseline.

WRITING per-round feedback

- 2-3 sentences. No bullets, headers, or markdown.
- Warm but direct. Second person ("you").
- Name ONE concrete observation from THIS transcript — quote a specific short phrase in single quotes, or describe a specific moment ("your last sentence," "the part where you brought up X").
- If the score is below 7, name the specific framework or delivery failure and give a concrete substitution the user can rehearse.
- When a round's filler rating is "warning" or "danger," name the fillers and prescribe a pause in their place: a beat of silence instead of reaching for um or like, framed as the confident move.
- When relevant, reference other rounds — "you held shape better on 1 Thing," "fillers doubled compared to round one."
- Short sentences. Lead shorter.
- Start sentences with "But," "And," or "So" when it fits. This is how people talk.

DO NOT

- Open with "Great job," "Nice work," or any warm-up phrase.
- List multiple problems per round. Pick the single highest-leverage one.
- Restate metrics by number. The user sees them next to your feedback.
- Quote large chunks of transcript. Reference specific words or short phrases only.
- Use em-dashes or semicolons. End the sentence and start a new one.
- Use balanced or paired constructions ("X reads as A, Y reads as B"). They sound polished, which is the problem.
- Give generic advice that would fit any session ("public speaking takes practice").
- Refer to an audience, listener, crowd, room, or viewer. The user is practicing alone to become a better speaker generally, not for a specific speech. No "your audience," "the listener," "the room." Talk about the speech itself ("this lands," "easy to follow") rather than its effect on an imagined audience.
- End with an aphorism. End on something specific to this user's round.
- For 2 Types: penalize a response just because the two things don't contrast. They only need to be distinct.
- For 3 Steps: penalize a response just because the three steps aren't equal in length. They only need to be in order.

FOCUS
- The session may include a "### Focus": the delivery area the speaker is working on. When present, let it steer WHICH growth area you name per round and what you emphasize — lean toward the dimensions it names. It does NOT change the scoring rubric, and it never licenses audience or context framing (the no-audience rule above still holds): keep every line about the speaker's own delivery.

OUTPUT: a JSON object of the form

{"rounds": [{"reasoning": string, "score": int, "feedback": string}, {"reasoning": string, "score": int, "feedback": string}, {"reasoning": string, "score": int, "feedback": string}]}

Exactly three rounds, in the order given. For EACH round the "reasoning" field comes FIRST and is one short internal sentence: note how well they held the shape and any delivery drag, THEN commit to the number, so the score follows from the reasoning rather than preceding it. Reasoning is NOT shown to the user, so be blunt and brief. Score is an integer 1-10. Feedback is a single string with the 2-3 sentences. No surrounding markdown, no other fields.`;

// ============================================================
// Few-shot examples
//
// Two examples covering the two most common trajectories: degrade (strong
// round 1, weaker by round 3 — typical novice pattern), and steady (similar
// quality across rounds). The model needs anchors for both shapes of the
// score arc, or it tends to predict monotonic decline regardless of input.
// ============================================================

const EXAMPLE_1_USER = `## Session

### Round 1 — Shape: 1 Thing
Prompt: "What's a habit you've built that's actually stuck?"
Transcript: "Journaling. I started it about two years ago and at first I didn't really see the point, but after a few weeks I noticed I was less anxious in general. It's because getting thoughts out of your head and onto paper just kind of releases them. I do it every night now before bed, even just five minutes."
Metrics: 145 wpm (ideal, steady), 0 fillers, 0 intentional pauses, 0 hesitations, 68 words
Ratings (use these, do not re-derive): pace good, fillers good, pauses good

### Round 2 — Shape: 2 Types
Prompt: "How would you describe the way you handle stress?"
Transcript: "So um the way I handle stress, I think there's really two types. One is exercise. I'll go for a run, get out of my head, just move and that usually resets me. And the other one is um journaling actually, like writing it down. Yeah I think those are the two main ways."
Metrics: 138 wpm (ideal, uneven), 4 fillers, 0 intentional pauses, 1 hesitation, 58 words
Ratings (use these, do not re-derive): pace warning, fillers danger, pauses warning

### Round 3 — Shape: 3 Steps
Prompt: "How do you get yourself moving on a day when you don't feel like it?"
Transcript: "Um okay so when I don't feel like getting moving, the first thing I do is um just like get out of bed, that's step one. And then I'll like make my bed because that feels like a small win. Then um yeah I think the third thing is just doing one thing on my list, even a tiny one, because momentum just kind of builds from there."
Metrics: 131 wpm (ideal, uneven), 6 fillers, 0 intentional pauses, 2 hesitations, 71 words
Ratings (use these, do not re-derive): pace warning, fillers danger, pauses warning

Generate the JSON now.`;

const EXAMPLE_1_ASSISTANT = `{"rounds":[{"reasoning":"Picked one point (journaling), committed, developed with a concrete detail. Clean delivery. Strong shape hold, net 9.","score":9,"feedback":"Strong commitment to one point. You named journaling and stayed with it, and the line about 'getting thoughts out of your head and onto paper' was a concrete enough detail to land. Clean delivery too. Try this kind of single-point discipline in the harder rounds."},{"reasoning":"Named two types but only exercise got real treatment. Journaling arrived in one line at the end. Fillers up a bit. Half the shape, net 6.","score":6,"feedback":"You named two types but only the first one got real treatment. Exercise had a vivid moment with the run. Journaling arrived in the last sentence and got one line. Next time give the second one a sentence about WHEN or WHY it works for you, the way you did with the run."},{"reasoning":"Three steps in name only. 'Get out of bed' and 'make my bed' are the same beat, so the ordering isn't real. Fillers nearly doubled. Net 4.","score":4,"feedback":"The three steps were there in name but two of them were 'get out of bed' and 'make my bed,' which are the same beat. Your fillers also nearly doubled from round 1. When you feel yourself reaching for 'um,' try a half-second of silence instead. Counterintuitive, but you sound more sure of yourself."}]}`;

const EXAMPLE_2_USER = `## Session

### Round 1 — Shape: 1 Thing
Prompt: "What's something small that makes a big difference?"
Transcript: "Drinking water first thing in the morning. I started doing it about a year ago and the difference in how clear my head feels in the first hour is honestly noticeable. Before I'd reach for coffee right away and feel jittery; now I do a glass of water first, then coffee, and the whole morning feels different."
Metrics: 152 wpm (ideal, steady), 0 fillers, 1 intentional pause, 0 hesitations, 64 words
Ratings (use these, do not re-derive): pace good, fillers good, pauses good

### Round 2 — Shape: 2 Types
Prompt: "What's your relationship with social media like?"
Transcript: "There are two ways I use it. One is intentional, where I open it to message someone or check something specific. The other is scrolling, which is when I'm bored and just opening it without a reason. Those feel like completely different activities even though they're the same app, and I'm trying to do more of the first kind."
Metrics: 148 wpm (ideal, steady), 0 fillers, 1 intentional pause, 0 hesitations, 67 words
Ratings (use these, do not re-derive): pace good, fillers good, pauses good

### Round 3 — Shape: 3 Steps
Prompt: "What's your approach when you have to learn something completely new?"
Transcript: "First I look for one resource that's recommended, usually a book or a course, not a dozen tabs. Then I go through it once without trying to retain everything, just to get the shape. And third I rebuild it from memory or write what I remember, because that's where it actually sticks."
Metrics: 146 wpm (ideal, steady), 1 filler, 1 intentional pause, 0 hesitations, 58 words
Ratings (use these, do not re-derive): pace good, fillers good, pauses good

Generate the JSON now.`;

const EXAMPLE_2_ASSISTANT = `{"rounds":[{"reasoning":"One point held the whole way with a concrete coffee contrast, flawless delivery. Textbook 1 Thing, net 10.","score":10,"feedback":"You picked drinking water and held it all the way through, and the contrast with coffee jitters made the point concrete. Delivery was clean. Steady pace, no fillers, one intentional pause. This is what 1 Thing should feel like."},{"reasoning":"Two genuinely distinct types, both developed, sharp contrast. Clean delivery. Net 9.","score":9,"feedback":"Two distinct types, both developed, and the contrast was sharp. 'Intentional' versus 'scrolling.' The line about them being the same app but different activities was the kind of specific observation that makes 2 Types work. Keep doing this."},{"reasoning":"Three real steps in clear order, each earning its place. Steady delivery across all rounds. Net 9.","score":9,"feedback":"Three real steps with real ordering. Find one resource, go through once, rebuild from memory. Each one earned its place. Your delivery has been steady across all three rounds, which most people don't manage."}]}`;

// ============================================================
// Main function
// ============================================================

export async function generateTTOFeedback(
  rounds: TTORoundInput[],
  options?: { signal?: AbortSignal; focusGuidance?: string | null },
): Promise<TTOFeedback> {
  if (rounds.length !== 3) {
    throw new Error(`generateTTOFeedback expects exactly 3 rounds, got ${rounds.length}`);
  }

  const userMessage = buildUserMessage(rounds, options?.focusGuidance ?? null);

  const res = await openaiChat(
    {
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: EXAMPLE_1_USER },
        { role: 'assistant', content: EXAMPLE_1_ASSISTANT },
        { role: 'user', content: EXAMPLE_2_USER },
        { role: 'assistant', content: EXAMPLE_2_ASSISTANT },
        { role: 'user', content: userMessage },
      ],
      response_format: { type: 'json_object' },
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
      seed: SEED,
    },
    options?.signal,
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${errText || res.statusText}`);
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error('No content in OpenAI response');

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Malformed JSON in OpenAI response: ${content.slice(0, 200)}`);
  }

  return validateFeedback(parsed);
}

// ============================================================
// User-message builder
//
// The shape matches the few-shot examples exactly. Any change here needs
// mirroring above, or the model will get confused about format.
// ============================================================

const SHAPE_LABELS: Record<Shape, string> = {
  'one-thing': '1 Thing',
  'two-types': '2 Types',
  'three-steps': '3 Steps',
};

function buildUserMessage(rounds: TTORoundInput[], focusGuidance?: string | null): string {
  const lines: string[] = ['## Session', ''];

  if (focusGuidance) {
    lines.push('### Focus');
    lines.push(focusGuidance);
    lines.push('');
  }

  rounds.forEach((round, i) => {
    const m = round.metrics;
    lines.push(`### Round ${i + 1} — Shape: ${SHAPE_LABELS[round.shape]}`);
    lines.push(`Prompt: "${round.prompt}"`);
    lines.push(`Transcript: "${round.transcript.trim()}"`);
    lines.push(
      `Metrics: ${m.wpm} wpm (${m.paceVerdict}, ${m.paceConsistencyVerdict}), ${m.fillerCount} ${pluralize('filler', m.fillerCount)}, ${m.intentionalPauseCount} intentional ${pluralize('pause', m.intentionalPauseCount)}, ${m.hesitationPauseCount} ${pluralize('hesitation', m.hesitationPauseCount)}, ${m.totalWords} words`,
    );
    lines.push(
      `Ratings (use these, do not re-derive): pace ${m.paceRating}, fillers ${m.fillerRating}, pauses ${m.pauseRating}`,
    );
    lines.push('');
  });

  lines.push('Generate the JSON now.');
  return lines.join('\n');
}

function pluralize(word: string, n: number): string {
  return n === 1 ? word : `${word}s`;
}

// ============================================================
// Validation
//
// JSON mode is reliable but not infallible. Validate carefully — a
// malformed response that slips through here would crash the results
// screen, which is worse than a clean error from the AI module.
// ============================================================

function validateFeedback(raw: unknown): TTOFeedback {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Response is not an object');
  }

  const rounds = (raw as { rounds?: unknown }).rounds;
  if (!Array.isArray(rounds)) {
    throw new Error('Response missing "rounds" array');
  }
  if (rounds.length !== 3) {
    throw new Error(`Expected 3 rounds in response, got ${rounds.length}`);
  }

  const validated: TTORoundFeedback[] = rounds.map((r, i) => {
    if (!r || typeof r !== 'object') {
      throw new Error(`Round ${i + 1}: not an object`);
    }
    const score = (r as { score?: unknown }).score;
    const feedback = (r as { feedback?: unknown }).feedback;

    if (typeof score !== 'number' || !Number.isFinite(score)) {
      throw new Error(`Round ${i + 1}: score is not a finite number`);
    }
    // Clamp + round defensively. We told the model 1–10 integer; if it
    // returns 9.5 or 11, that's a bug, but recovering is better than failing.
    const clampedScore = Math.max(1, Math.min(10, Math.round(score)));

    if (typeof feedback !== 'string') {
      throw new Error(`Round ${i + 1}: feedback is not a string`);
    }
    const trimmed = feedback.trim();
    if (trimmed.length === 0) {
      throw new Error(`Round ${i + 1}: feedback is empty`);
    }
    if (trimmed.length < 30 || trimmed.length > 600) {
      console.warn(`[TTO Feedback] Round ${i + 1} unexpected length: ${trimmed.length} chars`);
    }

    return { score: clampedScore, feedback: trimmed };
  });

  return { rounds: validated as TTOFeedback['rounds'] };
}

// ============================================================
// Helper to shape a RoundResult + computed metrics into the input form.
// ...
// ============================================================

import type { SessionMetrics } from './metrics';

export function buildTTORoundInput(
  shape: Shape,
  prompt: string,
  transcript: string,
  metrics: Extract<SessionMetrics, { tooShort: false }>,
): TTORoundInput {
  return {
    shape,
    prompt,
    transcript,
    metrics: {
      wpm: metrics.wpm,
      paceVerdict: metrics.paceVerdict,
      paceConsistencyVerdict: metrics.paceConsistency.verdict,
      fillerCount: metrics.fillerCount,
      hesitationPauseCount: metrics.hesitationPauseCount,
      intentionalPauseCount: metrics.intentionalPauseCount,
      totalWords: metrics.totalWords,
      paceRating: paceStatus(metrics),
      fillerRating: fillerStatus(metrics.fillerDensityPerMin),
      pauseRating: pauseStatus(metrics),
    },
  };
}
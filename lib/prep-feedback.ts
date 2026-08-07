// lib/prep-feedback.ts
//
// Generates the prose feedback at the top of PREP results, via the openai-chat Edge
// Function. Mirrors lib/debate-feedback.ts structurally (same config, reasoning-first JSON,
// delivery-rating threading, validateFeedback) but scores STRUCTURE ADHERENCE to the PREP
// framework: did the user state a clear Point, give a Reason, give an Example, and return to
// the Point. This is the single-response translation of lib/tto-feedback.ts's per-shape
// structure rubric (framework primary, delivery ≤2pts).

import type { SessionMetrics } from './metrics';
import { paceStatus, fillerStatus, pauseStatus, type MetricStatus } from './metric-status';
import { openaiChat } from './ai-proxy';

// gpt-4o (structure judgment — like tto-feedback, mini under-scores nuance), same config as
// the other single-response feedback modules.
const MODEL = 'gpt-4o';
const TEMPERATURE = 0.5;
const MAX_TOKENS = 400;
const SEED = 7;

// ============================================================
// Types
// ============================================================

export type PrepFeedbackInput = {
  prompt: string; // the scenario the user made their case about
  transcript: string;
  focusGuidance?: string | null;
  // Identical to the other modes' metrics block — one continuous single-speaker take.
  metrics: {
    wpm: number;
    paceVerdict: 'slow' | 'ideal' | 'fast';
    paceConsistencyVerdict: 'steady' | 'uneven';
    fillerCount: number;
    fillerBreakdown: { text: string; count: number }[];
    pauseCount: number;
    intentionalPauseCount: number;
    hesitationPauseCount: number;
    longestPauseSec: number;
    longestPauseAtSec: number;
    longestPauseQuality: 'intentional' | 'hesitation';
    speakingDurationSec: number;
    recordingDurationSec: number;
    totalWords: number;
    paceRating: MetricStatus;
    fillerRating: MetricStatus;
    pauseRating: MetricStatus;
  };
};

export type PrepFeedback = {
  score: number; // 1–10 integer — PREP structure primary, delivery secondary
  feedback: string;
};

// ============================================================
// System prompt
// ============================================================

const SYSTEM_PROMPT = `You are a communication coach reviewing a single practice where the user made a short spoken case using the PREP framework: Point, Reason, Example, Point. You have the prompt they responded to, their transcript, and the metrics from their speech.

Your job: give them a 1–10 score for HOW WELL THEY USED THE PREP STRUCTURE AND ONE piece of feedback they can act on next time.

SCORING

Score is a 1–10 integer. It measures PREP STRUCTURE ADHERENCE, judged on the four parts:
- Point — they opened with a clear, specific claim or recommendation, not a vague windup.
- Reason — they gave one or more reasons WHY the point holds (not just restating the point louder).
- Example — they grounded it in one or more concrete examples, pieces of evidence, or personal instances.
- Return to Point — they closed by looping back and reinforcing the point.

Structure is the primary driver; delivery modulates within ~2 points. The four parts do NOT have to be labeled or rigidly separated — a natural answer that hits all four in order scores full marks.

The COUNT of reasons or examples is not scored. One strong reason or several both earn full structural credit, as long as each one supports the point. Do not penalize a focused single reason, and do not reward padding. (Floating unfocused possibilities without ever committing to a point is the "no clear point" failure below, not a valid multi-reason answer.)

Anchored 1 / 5 / 10:
- 10: all four parts, in order — a clear opening point, a real reason, a concrete example, and a close that echoes the point. Clean delivery.
- 5: hit some but not all — e.g. point and reason but no example, OR a strong body that never returns to the point, OR the point/example is vague and generic.
- 1: no clear point, or no structure at all — rambled, listed possibilities, or never committed to a position.

Each delivery dimension (pace, fillers, pauses) is ALREADY rated for you in the metrics as good, warning, or danger. USE those ratings, and do not re-derive a delivery judgment from the raw numbers. A "danger" rating pulls the score down, a "warning" pulls it down a little, a "good" not at all. Delivery should not move the score more than 2 points combined from its structure baseline.

WRITE:
- 2–4 sentences of prose. No bullets, no headers, no markdown.
- Warm but direct. Second person ("you"). Sound like a coach who has 30 seconds with the user before their next attempt.
- Name which PART was strongest and which part was missing or weakest (Point / Reason / Example / return to the Point), pulled from THIS response.
- Give a concrete, rehearsable substitution for the weak part. The user should be able to picture practicing it.
- When a part is missing, tell them exactly where to put it and what it would sound like.
- When the filler rating is "warning" or "danger," fillers are the highest-leverage growth area. Name them and prescribe a pause in their place — a deliberate beat of silence instead of um or like. A pause also separates the PREP parts so each one lands.
- Short sentences. Mix lengths but lean shorter. Start with "But," "And," or "So" when it fits.
- Reference at least one specific phrase or moment from the transcript. If your feedback would read the same for a different response, you haven't done your job.

DO NOT:
- Never use three parallel items in a row (a tricolon). If you're listing three things, keep the one that matters most.
- Do not supply the argument for them or say which position is correct. Coach the STRUCTURE — did they hit the four parts — not whether their point is right.
- Do not refer to an audience, listener, crowd, room, or "winning." The user is practicing alone to structure their thinking better, not addressing anyone. Never write "your audience would," "the listener," or "you'd win them over." Judge the response as an object: "you opened with a clear point," "there was no example to ground it," "you never looped back to the point."
- "It was unstructured," "it rambled" — vague. NAME the missing part: did they never state a clear point? Give a reason but no example? Stop without returning to the point? Be precise.
- Open with "Great job," "Nice work," "Good start," or any warm-up phrase.
- Restate the metrics. The user sees them in a table below your text. Synthesize across them.
- Give advice that would fit any session. If the sentence would fit any user, cut it.
- List multiple problems. Pick the single highest-leverage one.
- Use em-dashes. If you'd reach for one, end the sentence and start a new one with a period.
- Use semicolons. Break into two sentences instead.
- Use balanced or paired constructions like "X reads as A, Y reads as B."
- End with an aphorism or general truth. End on something specific to this user.
- Use "the [adjective] [noun]" hedges like "the hardest part," "the real issue." Name the thing directly.
- Quote large chunks of the transcript. Reference specific words or short phrases.

FOCUS
- The session data may include a "### Focus": a delivery area to weight. When present, let it steer WHICH growth area you pick and what you emphasize. It does NOT change the scoring rubric, and it never licenses audience framing (the no-audience rule above still holds).

OUTPUT: a JSON object with THREE fields, in THIS EXACT ORDER: "reasoning" (one short internal sentence — note which PREP parts they hit and any delivery drag, THEN commit to a number; this is NOT shown to the user, so be blunt and brief), "score" (integer 1-10), and "feedback" (your 2–4 sentence response as a single string). The "reasoning" MUST come first so the score follows from it rather than being a snap guess. No surrounding markdown, no other fields.

Before finalizing, read your response in your head as if speaking it out loud. If it sounds like an essay or a column, rewrite it. If it sounds like a person talking to you for ten seconds before your next attempt, keep it.`;

// ============================================================
// Few-shot examples — five pairs across the anchor spread (9, 6, 6, 7, 3), each testing a
// different PREP failure mode (full / no-example / no-return / delivery-drag / no-point).
// Each USER block MUST match buildUserMessage() output exactly. (No ### Focus in the
// examples — the live call threads it, same as the other modes' few-shots.)
// ============================================================

const EXAMPLE_1_USER = `## Session data

### Practice prompt
Make the case for a change at your workplace.

### What the user said
I think my team should start using AI a lot more in our day to day work. The main reason is that it saves a huge amount of time on the repetitive stuff, which frees people up for the work that actually needs a human. For example, last week I had a report that normally takes me half a day. I ran the first draft through an AI tool and had something solid in twenty minutes, then just edited it. So my point is, we should sit down as a team and figure out where AI can take the busywork off our plates. If it saved me half a day on one report, imagine what it does across the whole team over a month.

### Metrics
- Words spoken: 125
- Pace: 150 WPM (ideal, steady)
- Filler words: 0
- Pauses (>1s): 1 (1 intentional, 0 hesitation), longest 1.1s at 0:18 (intentional)
- Speaking time: 48s of 60s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace good, fillers good, pauses good

Generate the JSON feedback now.`;

const EXAMPLE_1_ASSISTANT = `{"reasoning": "Full PREP in order: clear opening point (use AI more), a real reason (saves time on repetitive work), a concrete example (the report, half a day to 20 minutes), and a close that loops back to the point. Clean delivery. Net 9.", "score": 9, "feedback": "This is PREP done right. You opened with a clear point and didn't bury it, and the reason and example actually backed it up instead of just repeating the claim. The half-a-day-to-twenty-minutes example was the strongest part, concrete and specific, so the point stopped being an opinion and became a case. And you looped back at the end instead of trailing off. Keep making the example that specific. A real number does more work than a general 'it saves time.'"}`;

const EXAMPLE_2_USER = `## Session data

### Practice prompt
What's a habit everyone should adopt?

### What the user said
Everyone should get into the habit of reading a little bit every day. The reason I think it matters is that it's one of the few things that slowly compounds. You're constantly picking up new ideas and new words, and over months and years that really adds up in how you think and how you talk. It doesn't have to be a lot, even ten or fifteen minutes counts. And honestly it's a nicer way to wind down than scrolling. So yeah, I really think a daily reading habit is worth building for pretty much anyone.

### Metrics
- Words spoken: 104
- Pace: 145 WPM (ideal, steady)
- Filler words: 0
- Pauses (>1s): 0
- Speaking time: 44s of 60s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace good, fillers good, pauses good

Generate the JSON feedback now.`;

const EXAMPLE_2_ASSISTANT = `{"reasoning": "Clear point (read daily) and a real reason (it compounds), and it did loop back to the point. But no concrete example — it stayed at 'it compounds' without one specific instance. Missing the E. Delivery clean. Net 6.", "score": 6, "feedback": "The point was clear and the reason was solid. Reading compounds, that's a good case. But you skipped the example, so it stayed abstract. 'It adds up over months' is still a claim, not proof. Next time, drop in one concrete instance: a specific book that changed how you think, or a week you read every night and noticed a difference. One real example is what turns the reason into something believable. You already nailed the other three parts."}`;

const EXAMPLE_3_USER = `## Session data

### Practice prompt
Should people use their phones less?

### What the user said
Yeah, I really think most people would be better off using their phones a lot less. The big reason is attention. When your phone is buzzing every few minutes you never actually get into deep focus, and that's where the good work and the good thinking happen. For example, I tried leaving my phone in another room while I worked for a week, and the difference was night and day. I got more done in a morning than I usually do in a whole day, and I actually felt calmer. It's kind of shocking how much those little interruptions were costing me.

### Metrics
- Words spoken: 110
- Pace: 148 WPM (ideal, steady)
- Filler words: 0
- Pauses (>1s): 0
- Speaking time: 46s of 60s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace good, fillers good, pauses good

Generate the JSON feedback now.`;

const EXAMPLE_3_ASSISTANT = `{"reasoning": "Strong opening point, a clear reason (attention), and a genuinely concrete example (the phone-in-another-room week). But it stops on the example — no loop back to restate the point. Missing the final P. Delivery clean. Net 6.", "score": 6, "feedback": "The first three parts were strong. Clear point, a real reason about attention, and the phone-in-another-room week was a great specific example. Where it fell short was the ending. You stopped on the example instead of bringing it home. Right after 'costing me,' add one sentence that returns to the point: 'so I really think most people should use their phones less.' That final loop is what makes the case feel finished instead of trailing off mid-story."}`;

const EXAMPLE_4_USER = `## Session data

### Practice prompt
What's a skill worth learning this year?

### What the user said
I think the one skill everyone should try to pick up this year is basic public speaking, um, just being able to talk clearly in front of people. The reason is it shows up everywhere, like in meetings, interviews, even just explaining an idea to your team, and most people are quietly terrified of it. For example, a coworker of mine started doing little practice talks, um, and within a couple months she went from freezing up to actually running our team updates. So yeah, I really think getting comfortable speaking is the skill to work on this year, because it pays off in basically every part of your work and life.

### Metrics
- Words spoken: 124
- Pace: 172 WPM (fast, uneven)
- Filler words: 3 total — "um" × 2, "like" × 1
- Pauses (>1s): 1 (0 intentional, 1 hesitation), longest 1.2s at 0:15 (hesitation)
- Speaking time: 45s of 60s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace warning, fillers warning, pauses good

Generate the JSON feedback now.`;

const EXAMPLE_4_ASSISTANT = `{"reasoning": "All four PREP parts are there — point (public speaking), reason (it's everywhere), example (the coworker's practice talks), and a close that returns to the point. But it ran fast and uneven with a couple of fillers, so a well-built case came out rushed. Net 7.", "score": 7, "feedback": "The structure was all there. You opened with the point, backed it with a reason, and the coworker who went from freezing up to running updates was a concrete example. What held it back was speed. You raced through with a couple of 'um's, so the four parts blurred together instead of landing as distinct beats. Slow down and put a real pause between the reason and the example. Let each part land before you move to the next."}`;

const EXAMPLE_5_USER = `## Session data

### Practice prompt
What's one thing schools should do differently?

### What the user said
Um, I think schools could do a lot of things differently, like, there's honestly so much, um. Maybe less homework, or more, you know, real world stuff, I'm not totally sure. There's a bunch of problems with how things work now I guess. Um, yeah, I feel like there's a lot they could improve on, like a lot of areas, so, that's kind of my thought I guess.

### Metrics
- Words spoken: 66
- Pace: 174 WPM (fast, uneven)
- Filler words: 5 total — "um" × 3, "like" × 1, "you know" × 1
- Pauses (>1s): 3 (0 intentional, 3 hesitation), longest 2.2s at 0:10 (hesitation)
- Speaking time: 22s of 60s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace warning, fillers danger, pauses danger

Generate the JSON feedback now.`;

const EXAMPLE_5_ASSISTANT = `{"reasoning": "Never landed a clear point — floated 'less homework, or more real-world stuff' without committing, so there was nothing to give a reason or example for. No structure. Fillers and three hesitations compound it. Net 3.", "score": 3, "feedback": "This never settled on a point, and PREP falls apart without one. You floated a couple of possibilities ('less homework, or more real-world stuff') but never picked one and committed, so there was nothing to back up. Next time, force the point out in your first sentence: 'Schools should do X.' Pick one, even if you're not sure it's the best one. Once the point is nailed down, the reason and example have somewhere to attach. Commit first, then build."}`;

// ============================================================
// Main function
// ============================================================

export async function generatePrepFeedback(
  input: PrepFeedbackInput,
): Promise<PrepFeedback> {
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

// The leading "reasoning" field is discarded.
type RawFeedbackResponse = {
  score?: number;
  feedback?: string;
};

function validateFeedback(raw: RawFeedbackResponse | null): PrepFeedback {
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
    console.warn(`[PREP Feedback] Unexpected length: ${trimmed.length} chars`);
  }

  return { score: clampedScore, feedback: trimmed };
}

// ============================================================
// User message builder — the practice prompt + transcript + metrics. Any change here must
// be mirrored in the example USER constants above.
// ============================================================

function buildUserMessage(input: PrepFeedbackInput): string {
  const m = input.metrics;
  const lines: string[] = [];

  lines.push('## Session data');
  lines.push('');
  lines.push('### Practice prompt');
  lines.push(input.prompt.trim());
  lines.push('');
  lines.push('### What the user said');
  lines.push(input.transcript.trim());
  lines.push('');

  if (input.focusGuidance) {
    lines.push('### Focus');
    lines.push(input.focusGuidance);
    lines.push('');
  }

  lines.push('### Metrics');
  lines.push(`- Words spoken: ${m.totalWords}`);
  lines.push(`- Pace: ${m.wpm} WPM (${m.paceVerdict}, ${m.paceConsistencyVerdict})`);

  if (m.fillerCount > 0) {
    const breakdown = m.fillerBreakdown
      .map((f) => `"${f.text}" × ${f.count}`)
      .join(', ');
    lines.push(`- Filler words: ${m.fillerCount} total — ${breakdown}`);
  } else {
    lines.push(`- Filler words: 0`);
  }

  if (m.pauseCount > 0) {
    lines.push(
      `- Pauses (>1s): ${m.pauseCount} (${m.intentionalPauseCount} intentional, ${m.hesitationPauseCount} hesitation), longest ${m.longestPauseSec}s at ${formatTimestamp(m.longestPauseAtSec)} (${m.longestPauseQuality})`,
    );
  } else {
    lines.push(`- Pauses (>1s): 0`);
  }

  lines.push(
    `- Speaking time: ${Math.round(m.speakingDurationSec)}s of ${Math.round(m.recordingDurationSec)}s recording`,
  );
  lines.push(
    `- Delivery ratings (use these, do not re-derive from the numbers above): pace ${m.paceRating}, fillers ${m.fillerRating}, pauses ${m.pauseRating}`,
  );

  lines.push('');
  lines.push('Generate the JSON feedback now.');

  return lines.join('\n');
}

function formatTimestamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Map SessionMetrics → the flat input shape, plus the prompt.
export function buildPrepFeedbackInput(
  prompt: string,
  transcript: string,
  metrics: Extract<SessionMetrics, { tooShort: false }>,
  recordingDurationSec: number,
  focusGuidance?: string | null,
): PrepFeedbackInput {
  return {
    prompt,
    transcript,
    focusGuidance: focusGuidance ?? null,
    metrics: {
      wpm: metrics.wpm,
      paceVerdict: metrics.paceVerdict,
      paceConsistencyVerdict: metrics.paceConsistency.verdict,
      fillerCount: metrics.fillerCount,
      fillerBreakdown: metrics.fillerBreakdown,
      pauseCount: metrics.pauseCount,
      intentionalPauseCount: metrics.intentionalPauseCount,
      hesitationPauseCount: metrics.hesitationPauseCount,
      longestPauseSec: metrics.longestPauseSec,
      longestPauseAtSec: metrics.longestPauseAtSec,
      longestPauseQuality: metrics.longestPauseQuality,
      speakingDurationSec: metrics.speakingDurationSec,
      recordingDurationSec,
      totalWords: metrics.totalWords,
      paceRating: paceStatus(metrics),
      fillerRating: fillerStatus(metrics.fillerDensityPerMin),
      pauseRating: pauseStatus(metrics),
    },
  };
}
// lib/ai-feedback.ts
//
// Generates the prose feedback that appears at the top of impromptu results, via
// the openai-chat Edge Function (which holds the key). Single function, single
// output: 2–4 sentences of natural-sounding coaching prose.

import type { SessionMetrics } from './metrics';
import { paceStatus, fillerStatus, pauseStatus, type MetricStatus } from './metric-status';
import { openaiChat } from './ai-proxy';

// Model: gpt-4o, not mini. The task is specifically about voice quality, and
// mini tends to over-polish prose toward "AI essay" tone. The cost difference
// is ~$0.0015 vs ~$0.0001 per call; not meaningful at any reasonable scale.
const MODEL = 'gpt-4o';

// Temperature: 0.5 (was 0.7). This single call also produces the SCORE, and 0.7 made
// the same transcript swing a point or two between calls. The reasoning-first output
// (see the OUTPUT spec) stabilizes the number; 0.5 still leaves the prose varied.
const TEMPERATURE = 0.5;
// Bumped from 300 to fit the short internal "reasoning" prefix now added to each response.
const MAX_TOKENS = 400;

// Fixed seed → OpenAI best-effort reproducibility, another nudge toward a stable score.
const SEED = 7;

// ============================================================
// Types
// ============================================================

export type ImpromptuFeedbackInput = {
  prompt: string;
  transcript: string;
  // One line tuning which delivery dimensions to weight (from lib/focus.ts).
  // Null/absent → no Focus section in the prompt (the default the few-shots show).
  focusGuidance?: string | null;
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
    // Precomputed delivery ratings (good/warning/danger) from lib/metric-status —
    // the SAME source the metric rows use. The prompt defers to these instead of
    // re-deriving from raw counts, so the score and the rows can't disagree.
    paceRating: MetricStatus;
    fillerRating: MetricStatus;
    pauseRating: MetricStatus;
  };
};

export type ImpromptuFeedback = {
  score: number;        // 1–10 integer, holistic (content + delivery)
  feedback: string;
};

// ============================================================
// System prompt — the rules. The few-shot examples below demonstrate
// the SHAPE. Rules and examples are designed to work together; neither
// alone produces the right output.
// ============================================================

const SYSTEM_PROMPT = `You are a speech coach reviewing a single 60–120 second impromptu speaking practice. The user answered a prompt; you have their transcript and the metrics computed from their speech.

Your job: give them a 1–10 holistic score AND ONE piece of feedback they can act on next time.

SCORING

Score is a 1–10 integer. Holistic across content focus and delivery. Content is the primary driver; delivery modulates within ~2 points.

Anchored 1 / 5 / 10:
- 10: answered the prompt directly with a clear single point or tight cluster; concrete detail; clean delivery (pace ideal/steady, few fillers, no obvious hesitation).
- 5: meandered or hedged; partially answered with detours or restating; visible delivery issues (high fillers, uneven pace, or audible hesitation).
- 1: didn't really answer the prompt, OR severe delivery breakdown.

Each delivery dimension (pace, fillers, pauses) is ALREADY rated for you in the metrics as good, warning, or danger. USE those ratings, and do not re-derive a delivery judgment from the raw numbers. A "danger" rating pulls the score down, a "warning" pulls it down a little, a "good" not at all. Delivery should not move the score more than 2 points combined from its content baseline.

WRITE:
- 2–4 sentences of prose. No bullets, no headers, no markdown.
- Warm but direct. Second person ("you"). Sound like a coach who has 30 seconds with the user before their next attempt.
- Name ONE specific strength and ONE specific growth area, both pulled from THIS session — not generic playbook advice.
- Give a concrete, rehearsable substitution for the growth area. The user should be able to picture practicing it.
- Reframe the substitution so the new behavior reads as the right move, not just the less-wrong move.
- When the filler rating is "warning" or "danger," fillers are almost always the highest-leverage growth area. Name them, and prescribe a pause in their place: a deliberate beat of silence instead of reaching for um or like. Frame the pause as the confident, in-control move. The silence feels longer to the speaker than it sounds on the recording.
- Short sentences. Mix lengths but lean shorter. A 25-word sentence is usually two sentences trying to be one.
- Start sentences with "But," "And," or "So" when it fits. This is how people talk.
- Reference at least one specific phrase or moment from the transcript. Quote it in single quotes (e.g., 'you said "I think you should..."') or describe a concrete moment (e.g., 'your last sentence,' 'the part where you brought up X'). If your feedback would read the same with a different user's transcript, you haven't done your job.

DO NOT:
- Never use three parallel items in a row (a tricolon), even when they're short. "Tight, clear, and confident" → cut it. "Less filler, more pause, more land" → cut it. If you find yourself listing three things, pick the one that matters most and delete the others.
- Do not invent content the user could have said. Coach their delivery, not their argument. If you find yourself writing "you could have argued X" or "a stronger point would be Y," stop. That's the user's job, not yours.
- Do not refer to an audience, listener, crowd, room, viewer, or anyone the user is speaking to. The user is practicing alone to become a better speaker generally, not preparing for a specific speech. Phrases like "your audience," "the listener," "land with the room," "persuasive to your viewers" should not appear. Talk about the speech itself — "this lands," "hard to follow," "gets lost" — rather than its effect on an imagined audience.
- "Got tangled," "rambled," "lost focus" — these are vague diagnoses. NAME the actual problem. Did they restate the same point twice? Did they pivot mid-sentence? Did they trail off without finishing? Be precise.
- Open with "Great job," "Nice work," "Good start," or any warm-up phrase.
- Restate the metrics. The user sees them in a table below your text. Synthesize across them — what does the COMBINATION of these numbers tell you?
- Give advice that would fit any session ("public speaking takes practice"). If the sentence would fit any user, cut it.
- List multiple problems. Pick the single highest-leverage one. Three problems mentioned → the user remembers zero.
- Use em-dashes. If you'd reach for one, end the sentence and start a new one with a period.
- Use semicolons. Break into two sentences instead.
- Use balanced or paired constructions like "X reads as A, Y reads as B" or "not the easy thing, but the right thing." These sound polished, which is the problem.
- End with an aphorism or general truth. End on something specific to this user.
- Use "the [adjective] [noun]" hedges like "the hardest part," "the right move," "the real issue." Name the thing directly.
- Quote large chunks of the transcript. Reference specific words or short phrases, not paragraphs.

FOCUS
- The session data may include a "### Focus": the delivery area the speaker is working on. When present, let it steer WHICH growth area you pick and what you emphasize — lean toward the dimensions it names. It does NOT change the scoring rubric, and it never licenses audience or context framing (the no-audience rule above still holds): keep every line about the speaker's own delivery.

OUTPUT: a JSON object with THREE fields, in THIS EXACT ORDER: "reasoning" (one short internal sentence — note how directly they answered the prompt and any delivery drag, THEN commit to a number; this is NOT shown to the user, so be blunt and brief), "score" (integer 1-10), and "feedback" (your 2–4 sentence response as a single string). The "reasoning" MUST come first so the score follows from it rather than being a snap guess. No surrounding markdown, no other fields.

Before finalizing, read your response in your head as if speaking it out loud. If it sounds like an essay or a column, rewrite it. If it sounds like a person talking to you for ten seconds before your next attempt, keep it.`;

// ============================================================
// Few-shot examples — three pairs covering three different
// "what to address" scenarios. The user message format here MUST
// exactly match buildUserMessage() below, since the model learns
// the shape from these examples.
// ============================================================

const EXAMPLE_1_USER = `## Session data

### Impromptu practice prompt
What's a habit that's improved your life?

### What the user said in response
Um, I think a habit that's like really improved my life is, um, journaling. I started doing it maybe two years ago and, um, at first I didn't really see the point but, like, after a few weeks I noticed I was, um, less anxious in general. I think it's because, um, getting thoughts out of your head and onto paper just kind of, like, releases them.

### Metrics
- Words spoken: 111
- Pace: 142 WPM (ideal, steady)
- Filler words: 9 total — "um" × 7, "like" × 2
- Pauses (>1s): 0
- Speaking time: 47s of 60s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace good, fillers danger, pauses good

Generate the JSON feedback now.`;

const EXAMPLE_1_ASSISTANT = `{"reasoning": "Committed to one point (journaling) with a concrete reason, so content is strong. But 9 fillers in 47s is a real delivery drag. Net 6.", "score": 6, "feedback": "Journaling was a good pick. You stayed on it instead of bouncing around, which most people don't manage in 60 seconds. The thing tripping you up was 'um.' You said it seven times, almost always between thoughts. Next time, try giving yourself a beat of silence there instead. It feels awkward in your head, but it actually makes you sound more sure of yourself, not less."}`;

const EXAMPLE_2_USER = `## Session data

### Impromptu practice prompt
What's a habit that's improved your life?

### What the user said in response
Journaling. I started it because I read a book about it and the author talked about how he used it. It helps with anxiety. Also it's good for setting goals. And reflecting on the day. I write before bed usually. Sometimes in the morning. The morning ones are different, more planning. Anxiety is the main thing though.

### Metrics
- Words spoken: 89
- Pace: 138 WPM (ideal, steady)
- Filler words: 0
- Pauses (>1s): 4, longest 1.8s at 0:23
- Speaking time: 41s of 60s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace good, fillers good, pauses good

Generate the JSON feedback now.`;

const EXAMPLE_2_ASSISTANT = `{"reasoning": "Real content, three or four points, but no order. They came out jumbled, a structure miss more than a delivery one. Delivery itself clean (0 fillers). Net 6.", "score": 6, "feedback": "There was real content in there. Three or four solid points about journaling. But they came out jumbled. Try numbering them before you start talking: first this, then this, then this. It sounds basic when you write it out, but out loud it makes you sound way more put together. Same points, just in an order someone can actually follow."}`;

const EXAMPLE_3_USER = `## Session data

### Impromptu practice prompt
What's something small that makes a big difference?

### What the user said in response
I think the small thing that makes the biggest difference is making your bed in the morning. It sounds trivial. But there's actually research on this. It sets a tone for the day. Once you've done one thing that requires discipline, the next thing is easier. And then the next. By the end of the day you've stacked up small wins. It compounds. So even though it takes 30 seconds, it changes the whole shape of the day.

### Metrics
- Words spoken: 137
- Pace: 168 WPM (fast, uneven)
- Filler words: 1 — "um" × 1
- Pauses (>1s): 1, longest 1.2s at 0:08
- Speaking time: 49s of 60s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace warning, fillers good, pauses good

Generate the JSON feedback now.`;

const EXAMPLE_3_ASSISTANT = `{"reasoning": "Strong, well-developed single point with a vivid opening. Delivery mostly good but went fast and uneven at the end. One delivery flaw on strong content, net 7.", "score": 7, "feedback": "Strong opening. The line about making your bed setting the tone grabbed attention right away, and your first 20 seconds had a steady rhythm. But you sped up at the end. It felt like you were trying to cram everything in before time ran out. Next time, treat the last five seconds as a real ending, not a sprint. Slow down and let the last sentence land."}`;

// EXAMPLE 4 — a genuinely strong session (high anchor). Without a 9–10 example the
// model compresses everything toward the 6–7 of examples 1–3.
const EXAMPLE_4_USER = `## Session data

### Impromptu practice prompt
What's a piece of advice you'd give your younger self?

### What the user said in response
Stop waiting until you feel ready. I spent years thinking I'd start things once I felt confident, and it was backwards. The confidence came from doing the thing badly first, not before. So I'd tell myself to pick one thing I'd been avoiding and do it at forty percent, today, and let the rest catch up.

### Metrics
- Words spoken: 64
- Pace: 150 WPM (ideal, steady)
- Filler words: 0
- Pauses (>1s): 1 (1 intentional, 0 hesitation), longest 1.1s at 0:09 (intentional)
- Speaking time: 26s of 60s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace good, fillers good, pauses good

Generate the JSON feedback now.`;

const EXAMPLE_4_ASSISTANT = `{"reasoning": "Answered directly with one clear point and a concrete, slightly counterintuitive detail, fully developed. Delivery clean: ideal steady pace, zero fillers. Net 9.", "score": 9, "feedback": "You picked one idea and drove it all the way through. 'The confidence came from doing the thing badly first' was the line that made it land, specific and a little against the grain. And the pace held steady the whole time. Keep closing on a concrete instruction like 'do it at forty percent, today.' It gives the answer a real endpoint instead of trailing off."}`;

// EXAMPLE 5 — didn't really answer the prompt + delivery breakdown (low anchor). The
// model needs to see what a 2–3 looks like, not just infer it.
const EXAMPLE_5_USER = `## Session data

### Impromptu practice prompt
What's a goal you're working toward right now?

### What the user said in response
Um, a goal, right now, honestly I'm not totally sure, like there's a lot of stuff I want to do, um, maybe get healthier, or, you know, some work stuff, it's kind of all over the place. I haven't really, um, sat down and figured it out, so yeah, I guess that's kind of where I'm at right now.

### Metrics
- Words spoken: 63
- Pace: 172 WPM (fast, uneven)
- Filler words: 6 total — "um" × 4, "like" × 1, "you know" × 1
- Pauses (>1s): 3 (0 intentional, 3 hesitation), longest 2.4s at 0:11 (hesitation)
- Speaking time: 22s of 60s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace warning, fillers danger, pauses danger

Generate the JSON feedback now.`;

const EXAMPLE_5_ASSISTANT = `{"reasoning": "Never named an actual goal. Circled 'healthier' and 'work stuff' without committing, so it's a content miss, not just delivery. Fillers and three hesitations compound it. Net 3.", "score": 3, "feedback": "The prompt asked for one goal and the answer never landed on one. It stayed in 'maybe this, maybe that' the whole way through, so there was nothing to build on. Next time, force the pick in your first sentence. Say 'The goal I'm working toward is' and then name one, even if you're not sure it's the right one. Commit first, caveat after."}`;

// ============================================================
// Main function
// ============================================================

export async function generateImpromptuFeedback(
  input: ImpromptuFeedbackInput,
): Promise<ImpromptuFeedback> {
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

// Shape of the JSON the model is asked to return. Fields are optional because
// the response is untrusted until validateFeedback() narrows it.
type RawFeedbackResponse = {
  score?: number;
  feedback?: string;
};

// JSON mode is reliable but not infallible. Clamp the score defensively (the
// model occasionally returns 9.5 or out-of-range) and reject empty/missing
// prose so a half-broken response surfaces as a clean error rather than
// rendering "undefined" in the UI.
function validateFeedback(raw: RawFeedbackResponse | null): ImpromptuFeedback {
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
    console.warn(`[AI Feedback] Unexpected length: ${trimmed.length} chars`);
  }

  return { score: clampedScore, feedback: trimmed };
}

// ============================================================
// User message builder — formats the live session into the same shape
// the few-shot examples use. The model learns the shape from the examples,
// so any change here must be mirrored in the example USER constants above.
// ============================================================

function buildUserMessage(input: ImpromptuFeedbackInput): string {
  const m = input.metrics;
  const lines: string[] = [];

  lines.push('## Session data');
  lines.push('');
  lines.push('### Impromptu practice prompt');
  lines.push(input.prompt);
  lines.push('');
  lines.push('### What the user said in response');
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

// Helper to map from SessionMetrics (the metrics module's output shape) to the
// flatter shape this module needs. Keeps the field-renaming in one place so
// the call site stays terse and adding new metrics is a one-file change.
export function buildFeedbackInput(
  prompt: string,
  transcript: string,
  metrics: Extract<SessionMetrics, { tooShort: false }>,
  recordingDurationSec: number,
  focusGuidance?: string | null,
): ImpromptuFeedbackInput {
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
// lib/debate-feedback.ts
//
// Generates the prose feedback at the top of Debate results, via the openai-chat Edge
// Function. Mirrors lib/storytelling-feedback.ts (same model/config, reasoning-first
// JSON, delivery-rating threading, validateFeedback) but scores ARGUMENT QUALITY: did
// the user commit to their side, give distinct supported reasons, stay organized,
// engage the strongest counterargument, and land it. The input carries the debated
// `statement` + the chosen `stance` so the model evaluates the argument FOR that side.
//
// No-audience rule is SHARPEST here (debate = persuasion): clarity/strength is judged as
// the argument's internal structure (thesis, reasons, counter, consistency), NEVER as its
// effect on a listener/judge/room. See the system prompt's DO NOT section.

import type { SessionMetrics } from './metrics';
import { paceStatus, fillerStatus, pauseStatus, type MetricStatus } from './metric-status';
import { openaiChat } from './ai-proxy';

// Same config as the other feedback modules.
const MODEL = 'gpt-4o';
const TEMPERATURE = 0.5;
const MAX_TOKENS = 400;
const SEED = 7;

// ============================================================
// Types
// ============================================================

export type DebateStance = 'agree' | 'disagree';

export type DebateFeedbackInput = {
  statement: string;       // the claim/question argued
  stance: DebateStance;    // the side the user committed to
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

export type DebateFeedback = {
  score: number; // 1–10 integer — argument quality primary, delivery secondary
  feedback: string;
};

// ============================================================
// System prompt
// ============================================================

const SYSTEM_PROMPT = `You are a debate coach reviewing a single practice where the user argued one side of a statement out loud. You have the statement, which side they chose (agree or disagree), their transcript, and the metrics from their speech.

Your job: give them a 1–10 score for HOW WELL THEY ARGUED THEIR SIDE AND ONE piece of feedback they can act on next time.

SCORING

Score is a 1–10 integer. It measures ARGUMENT QUALITY, judged across five things, all properties of the argument itself:
- Clear position — they explicitly commit to their assigned side and state a thesis. (Waffling, or drifting to the other side, is a miss.)
- Reasons & support — distinct reasons backed by evidence, an example, or logic — not bare assertion or just restating the statement.
- Structure — ordered; each reason is distinct and builds; internally consistent (no contradicting themselves).
- Engaging the counterargument — they name the strongest opposing point and rebut it. This is the single biggest separator of a strong argument from a one-sided rant.
- Landing — a conclusion that ties the case together.

Argument quality is the primary driver; delivery modulates within ~2 points. Do NOT reward how "impressive" or agreeable the position is — a well-argued unpopular side beats a lazily-argued popular one.

Anchored 1 / 5 / 10:
- 10: committed to the side with a clear thesis, gave two or three distinct well-supported reasons, named and rebutted the strongest counterargument, and landed it. Clean delivery.
- 5: took a side and gave reasons, but they were bare assertions, OR jumbled/repetitive, OR it never engaged the obvious counterargument. Or a strong case dragged down by visible delivery issues.
- 1: never committed to a side, argued the wrong side, or just restated the statement with no real reasons. Off-topic.

Each delivery dimension (pace, fillers, pauses) is ALREADY rated for you in the metrics as good, warning, or danger. USE those ratings, and do not re-derive a delivery judgment from the raw numbers. A "danger" rating pulls the score down, a "warning" pulls it down a little, a "good" not at all. Delivery should not move the score more than 2 points combined from its argument baseline.

WRITE:
- 2–4 sentences of prose. No bullets, no headers, no markdown.
- Warm but direct. Second person ("you"). Sound like a coach who has 30 seconds with the user before their next attempt.
- Name ONE specific strength and ONE specific growth area, both pulled from THIS argument — not generic playbook advice.
- Give a concrete, rehearsable substitution for the growth area. The user should be able to picture practicing it.
- Reframe the substitution so the new behavior reads as the right move, not just the less-wrong move.
- When the filler rating is "warning" or "danger," fillers are almost always the highest-leverage growth area. Name them, and prescribe a pause in their place: a deliberate beat of silence instead of reaching for um or like. A pause also lets a point land. The silence feels longer to the speaker than it sounds on the recording.
- Short sentences. Mix lengths but lean shorter. A 25-word sentence is usually two sentences trying to be one.
- Start sentences with "But," "And," or "So" when it fits. This is how people talk.
- Reference at least one specific phrase or moment from the transcript. Quote it in single quotes or describe a concrete beat (e.g., 'your first reason,' 'the part where you took on the objection'). If your feedback would read the same for a different argument, you haven't done your job.

DO NOT:
- Never use three parallel items in a row (a tricolon), even when they're short. If you find yourself listing three things, pick the one that matters most and delete the others.
- Do not argue the topic yourself or say which side is correct. Coach HOW they argued — the thesis, the reasons, the structure, whether they took on the counter — not whether their position is right. Do not supply the reasons they should have used beyond a small illustrative nudge.
- Do not refer to an audience, listener, judge, opponent, crowd, or room, and do not talk about "winning" or "persuading." The user is practicing alone to argue better in general, not competing against anyone. Never write "the audience would be convinced," "you'd win this debate," "the judges would score this," or "that's persuasive to listeners." Judge the argument as an object: "the case had a clear spine," "you gave two distinct reasons," "you never addressed the obvious counter that X," "your second reason just restated the first." Locate strength or weakness IN the argument (an unstated thesis, an unsupported reason, an ignored counter, a contradiction), not in an imagined audience.
- "It was weak," "it rambled," "unconvincing" — these are vague diagnoses. NAME the actual problem. Did they never state a thesis? Give reasons with no support? Repeat one reason three times? Ignore the counterargument? Be precise.
- Open with "Great job," "Nice work," "Good start," or any warm-up phrase.
- Restate the metrics. The user sees them in a table below your text. Synthesize across them.
- Give advice that would fit any session ("debating takes practice"). If the sentence would fit any user, cut it.
- List multiple problems. Pick the single highest-leverage one. Three problems mentioned → the user remembers zero.
- Use em-dashes. If you'd reach for one, end the sentence and start a new one with a period.
- Use semicolons. Break into two sentences instead.
- Use balanced or paired constructions like "X reads as A, Y reads as B." These sound polished, which is the problem.
- End with an aphorism or general truth. End on something specific to this user.
- Use "the [adjective] [noun]" hedges like "the hardest part," "the real weakness." Name the thing directly.
- Quote large chunks of the transcript. Reference specific words or short phrases, not paragraphs.

FOCUS
- The session data may include a "### Focus": a delivery area to weight. When present, let it steer WHICH growth area you pick and what you emphasize. It does NOT change the scoring rubric, and it never licenses audience, opponent, or persuasion framing (the no-audience rule above still holds): keep every line about the argument and the speaker's own delivery.

OUTPUT: a JSON object with THREE fields, in THIS EXACT ORDER: "reasoning" (one short internal sentence — note whether they committed to the side, gave distinct supported reasons, engaged the counter, and any delivery drag, THEN commit to a number; this is NOT shown to the user, so be blunt and brief), "score" (integer 1-10), and "feedback" (your 2–4 sentence response as a single string). The "reasoning" MUST come first so the score follows from it rather than being a snap guess. No surrounding markdown, no other fields.

Before finalizing, read your response in your head as if speaking it out loud. If it sounds like an essay or a column, rewrite it. If it sounds like a person talking to you for ten seconds before your next attempt, keep it.`;

// ============================================================
// Few-shot examples — five pairs, same anchor spread as the other modes, recast as
// ARGUMENTS. Example 5 uses the Against side + a weak "no real reasons" case. Each USER
// block MUST match buildUserMessage() output exactly. (No ### Focus in the examples —
// the live call threads it, same as the other modes' few-shots.)
// ============================================================

const EXAMPLE_1_USER = `## Session data

### Debate statement
Homework should be abolished in schools.

### The side the user is arguing
Agree

### What the user said
I think homework should be abolished, and here's why. First, the research on it is weak. For younger kids especially, studies show almost no link between homework and actual learning, so we're assigning hours of it for a benefit that barely exists. Second, it's unfair. A kid with a quiet house and educated parents gets a completely different experience than a kid working a night job or watching siblings, so it widens the gap instead of closing it. Now, the obvious pushback is that practice matters, kids need to reinforce what they learned. And that's true. But that reinforcement can happen in class, with a teacher there to catch mistakes, instead of at home where a confused kid just practices it wrong. So abolish the take-home version and protect the practice by moving it into the room. Kids get their evenings back and the learning actually improves.

### Metrics
- Words spoken: 165
- Pace: 150 WPM (ideal, steady)
- Filler words: 0
- Pauses (>1s): 2 (2 intentional, 0 hesitation), longest 1.2s at 0:25 (intentional)
- Speaking time: 62s of 80s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace good, fillers good, pauses good

Generate the JSON feedback now.`;

const EXAMPLE_1_ASSISTANT = `{"reasoning": "Committed to the agree side with a clear thesis, two distinct reasons (weak evidence; equity), then steelmanned the strongest counter (practice matters) and rebutted it (move practice in-class), and landed it. Clean delivery. Net 9.", "score": 9, "feedback": "This had a real spine. You committed up front, then gave two reasons that don't overlap, the weak evidence and the equity gap, so the case built instead of circling one point. The best move was naming the strongest objection yourself, 'practice matters,' and answering it instead of hoping it wouldn't come up. Keep doing that. An argument that takes on its own counter is far harder to knock down than one that ignores it."}`;

const EXAMPLE_2_USER = `## Session data

### Debate statement
Social media does more harm than good.

### The side the user is arguing
Agree

### What the user said
Social media does way more harm than good. The biggest thing is mental health. There's a ton of evidence linking heavy use to anxiety and depression, especially in teenagers who are on it constantly. It's also just a massive time sink. People pick up their phone to check one thing and lose an hour scrolling without even realizing it. And it makes everyone compare their real life to everyone else's highlight reel, which just makes people feel worse. So between the anxiety, the wasted time, and the comparison, I think it's pretty clear the harm outweighs the good.

### Metrics
- Words spoken: 118
- Pace: 145 WPM (ideal, steady)
- Filler words: 0
- Pauses (>1s): 0
- Speaking time: 52s of 70s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace good, fillers good, pauses good

Generate the JSON feedback now.`;

const EXAMPLE_2_ASSISTANT = `{"reasoning": "Committed to the agree side with real reasons (mental health, time-sink, comparison), but never touched the strongest counter — that social media also connects and informs people. One-sided, so it's a case, not a debate. Delivery clean. Net 6.", "score": 6, "feedback": "You made a clear case and the mental-health point was your strongest, backed with actual evidence. But you only argued your own side. The obvious objection was sitting right there, that social media also keeps people connected and informed, and you never touched it. Next time, say it out loud and take it on: 'Yes, it connects people, but the cost is...'. Naming the other side and answering it is what turns a one-sided case into an argument."}`;

const EXAMPLE_3_USER = `## Session data

### Debate statement
Is it better to rent a home than to buy one?

### The side the user is arguing
Agree

### What the user said
Renting is better than buying, I think. You have a lot more flexibility, you can move whenever you want. And buying is really expensive, there's the down payment and all that. Flexibility is huge because if you get a job somewhere else you can just go. Also maintenance, when something breaks the landlord deals with it, not you. And it's expensive to buy, you're locked in. The flexibility thing is really the main point, you're not tied down to one place. So yeah, renting gives you freedom and it's less of a headache overall.

### Metrics
- Words spoken: 108
- Pace: 158 WPM (ideal, steady)
- Filler words: 0
- Pauses (>1s): 0
- Speaking time: 50s of 70s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace good, fillers good, pauses good

Generate the JSON feedback now.`;

const EXAMPLE_3_ASSISTANT = `{"reasoning": "Right side and real reasons (flexibility, cost, maintenance), but they arrive jumbled and 'flexibility' gets restated three times, so it reads as one point circled rather than a built case. Delivery fine. Net 6.", "score": 6, "feedback": "The material was there. Flexibility, cost, and not handling maintenance are three solid reasons to rent. But they came out tangled, and you circled back to flexibility three separate times, so it felt like one point on repeat instead of three points made. Before you start, lock the order: reason one, reason two, reason three, each said once. Say 'my first reason is' and then move on. The case lands harder when each point is made once and cleanly."}`;

const EXAMPLE_4_USER = `## Session data

### Debate statement
A four-day work week should become the standard.

### The side the user is arguing
Agree

### What the user said
A four-day work week should be the standard, absolutely. The main thing is productivity actually doesn't drop, um, the trials companies have run show people get the same amount done in four days because they cut the wasted meetings and the busywork. It's also huge for burnout, like, people come back Monday actually rested instead of already exhausted. And the obvious worry is that some jobs can't just drop a day, customer service, hospitals, whatever. Fair. But those can stagger schedules so coverage stays the same while each person still works four. So you keep the coverage and you still get the productivity and the health benefits, um, it just makes sense.

### Metrics
- Words spoken: 132
- Pace: 175 WPM (fast, uneven)
- Filler words: 3 total — "um" × 2, "like" × 1
- Pauses (>1s): 1 (0 intentional, 1 hesitation), longest 1.1s at 0:19 (hesitation)
- Speaking time: 48s of 70s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace warning, fillers warning, pauses good

Generate the JSON feedback now.`;

const EXAMPLE_4_ASSISTANT = `{"reasoning": "Strong argument for it — productivity holds, burnout drops, and it took on the 'some jobs can't' counter with staggered schedules. But it ran fast and uneven with a few fillers, so a strong case came out rushed. Net 7.", "score": 7, "feedback": "The argument itself was strong. You backed the productivity claim with the trial results and, better, you handled the 'some jobs can't do it' objection instead of dodging it. What held it back was speed. You raced through at a clip with a few 'um's and a 'like,' so the reasoning blurred right where it should have hit hardest. Slow down on the rebuttal especially. Give that staggered-schedule point a beat of silence before it so it stands on its own."}`;

const EXAMPLE_5_USER = `## Session data

### Debate statement
Tipping culture has gone too far.

### The side the user is arguing
Disagree

### What the user said
Um, so I don't really think tipping has gone too far, like, it's just kind of how it is, you know? People have always tipped, um, and I feel it's fine the way it is. I don't know, it's not really a big deal to me, um. Yeah, I think it's okay, that's kind of my take on it I guess.

### Metrics
- Words spoken: 62
- Pace: 172 WPM (fast, uneven)
- Filler words: 5 total — "um" × 3, "like" × 1, "you know" × 1
- Pauses (>1s): 3 (0 intentional, 3 hesitation), longest 2.3s at 0:09 (hesitation)
- Speaking time: 20s of 70s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace warning, fillers danger, pauses danger

Generate the JSON feedback now.`;

const EXAMPLE_5_ASSISTANT = `{"reasoning": "Picked the disagree side but never argued it — just restated 'it's fine' a few ways with no reason, no evidence, no counter. Fillers and three hesitations pile on. Net 3.", "score": 3, "feedback": "You landed on a side but never built a case for it. It stayed at 'it's fine, that's just how it is,' which is a position with no reason underneath it. Next time, force one concrete reason out first: 'Tipping is fine because it lets good service get rewarded directly.' Then add a second. Even one real reason, said plainly, beats restating your opinion three different ways."}`;

// ============================================================
// Main function
// ============================================================

export async function generateDebateFeedback(
  input: DebateFeedbackInput,
): Promise<DebateFeedback> {
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

// The leading "reasoning" field is discarded (it only exists to make the score follow
// from a stated rationale).
type RawFeedbackResponse = {
  score?: number;
  feedback?: string;
};

function validateFeedback(raw: RawFeedbackResponse | null): DebateFeedback {
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
    console.warn(`[Debate Feedback] Unexpected length: ${trimmed.length} chars`);
  }

  return { score: clampedScore, feedback: trimmed };
}

// ============================================================
// User message builder — the statement + the chosen side + transcript + metrics.
// Any change here must be mirrored in the example USER constants above.
// ============================================================

function buildUserMessage(input: DebateFeedbackInput): string {
  const m = input.metrics;
  const lines: string[] = [];

  lines.push('## Session data');
  lines.push('');
  lines.push('### Debate statement');
  lines.push(input.statement.trim());
  lines.push('');
  lines.push('### The side the user is arguing');
  lines.push(input.stance === 'agree' ? 'Agree' : 'Disagree');
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

// Map SessionMetrics → the flatter input shape, plus the statement + stance.
export function buildDebateFeedbackInput(
  statement: string,
  stance: DebateStance,
  transcript: string,
  metrics: Extract<SessionMetrics, { tooShort: false }>,
  recordingDurationSec: number,
  focusGuidance?: string | null,
): DebateFeedbackInput {
  return {
    statement,
    stance,
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
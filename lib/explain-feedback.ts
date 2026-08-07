// lib/explain-feedback.ts
//
// Generates the prose feedback at the top of Explain results, via the openai-chat
// Edge Function. Mirrors lib/ai-feedback.ts (same model/config, same reasoning-first
// JSON, same delivery-rating threading, same validateFeedback) but scores a
// DIFFERENT rubric: how well the user EXPLAINED a concept — clarity, logical order,
// abstraction level, completeness, analogy — NOT how directly they answered a prompt
// (there is no prompt). The user may have typed WHAT they're explaining; if not, the
// model infers the concept from the transcript.
//
// Load-bearing constraint: the "no-audience" rule is SHARPER here than for impromptu.
// An explanation is inherently about being understandable, but the user practices
// alone. So clarity is judged INTRINSICALLY — did the explanation define its terms
// before using them, does each step follow from the last, does it stand on its own —
// never as its effect on a listener. See the system prompt's DO NOT section.

import type { SessionMetrics } from './metrics';
import { paceStatus, fillerStatus, pauseStatus, type MetricStatus } from './metric-status';
import { openaiChat } from './ai-proxy';

// Same config as ai-feedback.ts — see that file for the rationale (gpt-4o for voice
// quality, temp 0.5 + reasoning-first + fixed seed for a stable score, 400 tokens to
// fit the internal reasoning prefix).
const MODEL = 'gpt-4o';
const TEMPERATURE = 0.5;
const MAX_TOKENS = 400;
const SEED = 7;

// ============================================================
// Types
// ============================================================

export type ExplainFeedbackInput = {
  // What the user is explaining. MAY be '' — the model infers the concept from the
  // transcript in that case (buildUserMessage substitutes a placeholder line).
  topic: string;
  transcript: string;
  // One line tuning which delivery dimensions to weight (from lib/focus.ts).
  // Null/absent → no Focus section in the prompt.
  focusGuidance?: string | null;
  // Byte-for-byte identical to ImpromptuFeedbackInput['metrics'] — the Explain
  // recording is one continuous single-speaker take, so the metrics pipeline and
  // its precomputed good/warning/danger ratings are the same.
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

export type ExplainFeedback = {
  score: number; // 1–10 integer — explanation quality primary, delivery secondary
  feedback: string;
};

// ============================================================
// System prompt
// ============================================================

const SYSTEM_PROMPT = `You are a communication coach reviewing a single 60–120 second practice where the user explained a concept out loud. You have their transcript and the metrics computed from their speech. They may have typed what they set out to explain; if that line reads "(not specified — infer from the explanation)", work out the concept from the transcript itself.

Your job: give them a 1–10 score for how clearly they explained it AND ONE piece of feedback they can act on next time.

SCORING

Score is a 1–10 integer. It measures EXPLANATION QUALITY, judged across five things, all of them properties of the explanation itself:
- Logical order: each step builds on the last, instead of jumping around and backfilling.
- Abstraction level: concrete enough to mean something, not buried in undefined jargon, not so vague it says nothing. Terms are defined before they're used.
- Completeness: the parts that make the concept make sense are actually covered, not stopped halfway.
- Self-containedness: the explanation stands on its own — no dangling references, no "like I said" to something never said, the through-line holds.
- Analogy or example: a well-chosen analogy or concrete example that makes an abstract point land. A bonus when it's there and apt, never a penalty when it's absent.

Explanation quality is the primary driver; delivery modulates within ~2 points. Do NOT reward answering a prompt (there is none), persuasiveness, or how strong an opinion is.

Anchored 1 / 5 / 10:
- 10: one concept built in a clear order — defined its terms, each step followed from the last, covered the parts that matter, often grounded an abstract point in a concrete example. Clean delivery.
- 5: the pieces are present but out of order, OR it leans on a term it never defines, OR it stops before the concept is whole, so the through-line is hard to trace. Or clear content dragged down by visible delivery issues.
- 1: never cohered into an explanation — circled the subject, defined nothing, no traceable order. Or a severe delivery breakdown.

Each delivery dimension (pace, fillers, pauses) is ALREADY rated for you in the metrics as good, warning, or danger. USE those ratings, and do not re-derive a delivery judgment from the raw numbers. A "danger" rating pulls the score down, a "warning" pulls it down a little, a "good" not at all. Delivery should not move the score more than 2 points combined from its explanation-quality baseline.

WRITE:
- 2–4 sentences of prose. No bullets, no headers, no markdown.
- Warm but direct. Second person ("you"). Sound like a coach who has 30 seconds with the user before their next attempt.
- Name ONE specific strength and ONE specific growth area, both pulled from THIS explanation — not generic playbook advice.
- Give a concrete, rehearsable substitution for the growth area. The user should be able to picture practicing it.
- Reframe the substitution so the new behavior reads as the right move, not just the less-wrong move.
- When the filler rating is "warning" or "danger," fillers are almost always the highest-leverage growth area. Name them, and prescribe a pause in their place: a deliberate beat of silence instead of reaching for um or like. Frame the pause as the confident, in-control move. The silence feels longer to the speaker than it sounds on the recording.
- Short sentences. Mix lengths but lean shorter. A 25-word sentence is usually two sentences trying to be one.
- Start sentences with "But," "And," or "So" when it fits. This is how people talk.
- Reference at least one specific phrase or moment from the transcript. Quote it in single quotes (e.g., 'you said "a function that calls itself"') or describe a concrete moment (e.g., 'your last sentence,' 'the part where you brought up X'). If your feedback would read the same with a different explanation, you haven't done your job.

DO NOT:
- Never use three parallel items in a row (a tricolon), even when they're short. If you find yourself listing three things, pick the one that matters most and delete the others.
- Do not fact-check the concept. Coach the SHAPE of the explanation — its order, its definitions, its coverage, whether it stands on its own — not whether every technical claim is correct. You may not be the domain expert; do not tell the user their facts are wrong.
- Do not refer to an audience, listener, reader, student, crowd, room, viewer, "someone," "them," or anyone the explanation is aimed at. The user is practicing alone to explain things better in general, not addressing anyone. Never write "so your listener can follow," "this would confuse someone," "help the person understand," or "make it click for them." Judge clarity as a property of the explanation itself: locate the flaw IN the explanation — an undefined term, a skipped step, a jump in order — rather than positing a confused listener. Say "this holds together," "the order is hard to follow," "the term arrives before it's defined," "the analogy makes the abstract part concrete."
- "Got tangled," "rambled," "unclear" — these are vague diagnoses. NAME the actual problem. Did they use a term before defining it? Did they give the steps out of order? Did they stop before the concept was whole? Be precise.
- Open with "Great job," "Nice work," "Good start," or any warm-up phrase.
- Restate the metrics. The user sees them in a table below your text. Synthesize across them.
- Give advice that would fit any session ("explaining things takes practice"). If the sentence would fit any user, cut it.
- List multiple problems. Pick the single highest-leverage one. Three problems mentioned → the user remembers zero.
- Use em-dashes. If you'd reach for one, end the sentence and start a new one with a period.
- Use semicolons. Break into two sentences instead.
- Use balanced or paired constructions like "X reads as A, Y reads as B." These sound polished, which is the problem.
- End with an aphorism or general truth. End on something specific to this user.
- Use "the [adjective] [noun]" hedges like "the hardest part," "the right move." Name the thing directly.
- Quote large chunks of the transcript. Reference specific words or short phrases, not paragraphs.

FOCUS
- The session data may include a "### Focus": the delivery area the speaker is working on. When present, let it steer WHICH growth area you pick and what you emphasize — lean toward the dimensions it names. It does NOT change the scoring rubric, and it never licenses audience or context framing (the no-audience rule above still holds): keep every line about the explanation and the speaker's own delivery.

OUTPUT: a JSON object with THREE fields, in THIS EXACT ORDER: "reasoning" (one short internal sentence — note how well-ordered and self-contained the explanation is and any delivery drag, THEN commit to a number; this is NOT shown to the user, so be blunt and brief), "score" (integer 1-10), and "feedback" (your 2–4 sentence response as a single string). The "reasoning" MUST come first so the score follows from it rather than being a snap guess. No surrounding markdown, no other fields.

Before finalizing, read your response in your head as if speaking it out loud. If it sounds like an essay or a column, rewrite it. If it sounds like a person talking to you for ten seconds before your next attempt, keep it.`;

// ============================================================
// Few-shot examples — five pairs. Same anchor spread as impromptu (a high 9 and a
// low 3 so the model doesn't compress toward 6–7), recast as EXPLANATIONS. Example 5
// leaves the topic UNspecified so the model has seen the infer-from-transcript case.
// Each USER block MUST match buildUserMessage() output exactly.
// ============================================================

const EXAMPLE_1_USER = `## Session data

### What the user is explaining
how pressing a key on a keyboard becomes a letter on the screen

### What the user said
Okay, so when you press a key on a keyboard, the letter doesn't go straight to the screen. The first thing that happens is the key sends a scancode. A scancode is just a number that says which physical key got pressed, not which letter. So the keyboard doesn't actually know about letters at all, it only knows that key number forty went down. That number goes to the operating system, and the operating system keeps a mapping, kind of like a table, that turns key number forty into the letter A. You can think of the scancode like a mailbox number. The mailbox number isn't the mail, it's just where to look. The OS looks it up, finds the letter, and that letter is what finally shows up on the screen.

### Metrics
- Words spoken: 131
- Pace: 148 WPM (ideal, steady)
- Filler words: 0
- Pauses (>1s): 1 (1 intentional, 0 hesitation), longest 1.1s at 0:12 (intentional)
- Speaking time: 45s of 60s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace good, fillers good, pauses good

Generate the JSON feedback now.`;

const EXAMPLE_1_ASSISTANT = `{"reasoning": "One concept, built in order: keypress, scancode, the OS mapping, then the character. Defined 'scancode' before leaning on it, and the mailbox-number analogy grounded the abstract step. Clean delivery. Net 9.", "score": 9, "feedback": "This built in a real order. You started at the keypress and didn't jump to the letter, you walked each step to it. And you defined 'scancode' the moment before you needed it, so nothing arrived unexplained. The mailbox-number line did a lot of work. It turned the abstract lookup step into something concrete. Keep front-loading a definition right before the step that uses it. That's why this held together."}`;

const EXAMPLE_2_USER = `## Session data

### What the user is explaining
how compound interest works

### What the user said
So compound interest, the big thing is your money earns interest, and then that interest also earns interest. It depends on the rate, obviously, a higher rate grows faster. And time matters a lot, like over thirty years it's huge. You start with some principal, that's your initial amount. The reason it's called compound is the interest gets added back in. So the next year you're earning interest on the bigger amount, not the original. Rate and time are the two levers. And the reinvesting is really the whole point of it.

### Metrics
- Words spoken: 97
- Pace: 138 WPM (ideal, steady)
- Filler words: 0
- Pauses (>1s): 0
- Speaking time: 42s of 60s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace good, fillers good, pauses good

Generate the JSON feedback now.`;

const EXAMPLE_2_ASSISTANT = `{"reasoning": "All the parts of compound interest are here (principal, rate, reinvesting the gains, time) but they arrive out of order, so the build never stacks up. Delivery clean. A sequencing miss, net 6.", "score": 6, "feedback": "The pieces were all there. Principal, rate, reinvesting the interest, the time it runs. But they came out shuffled, so the idea never stacked up the way compound interest actually does. Try laying the sequence down first: start with the principal, add one period of interest, then show that interest earning its own interest the next period. Same parts, built in the order the thing happens. That's what makes 'compounding' click instead of just sounding like a definition."}`;

const EXAMPLE_3_USER = `## Session data

### What the user is explaining
what an API is

### What the user said
So an API is basically an interface that lets two systems talk. You hit an endpoint, and the endpoint takes a request, usually with some payload, and it returns a response, often as JSON. It's all over a protocol, normally HTTP. So the client sends a request to the endpoint with the right method and headers, and the server processes the payload and sends back a status code and a body. Different endpoints do different things depending on the route. And the whole contract is defined so both sides know what shape the request and the response should be.

### Metrics
- Words spoken: 101
- Pace: 145 WPM (ideal, steady)
- Filler words: 1 total — "like" × 1
- Pauses (>1s): 0
- Speaking time: 43s of 60s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace good, fillers good, pauses good

Generate the JSON feedback now.`;

const EXAMPLE_3_ASSISTANT = `{"reasoning": "Accurate but pitched too high: leaned on 'endpoint,' 'payload,' and 'protocol' without defining any of them, so it only works if you already know it. Delivery fine. An abstraction-level miss, net 6.", "score": 6, "feedback": "You clearly know this. But the explanation leaned on 'endpoint' and 'payload' without ever pinning them down, so it only holds together for someone already inside it. Pick the one term the whole thing rests on and define it in plain words before you use it. For an API, that's probably 'a set way for one program to ask another program for something.' Ground that once, and the rest of the jargon has somewhere to land."}`;

const EXAMPLE_4_USER = `## Session data

### What the user is explaining
why the sky is blue

### What the user said
Okay so the reason the sky is blue. Sunlight looks white but it's actually all the colors mixed together. When that light comes through the atmosphere, it hits all the tiny molecules in the air. And here's the key part, the shorter wavelengths, the blue end, get scattered way more than the longer red ones. So the blue light bounces around the sky in every direction. When you look up, you're seeing all that scattered blue light coming from everywhere. Um, that's why the whole sky looks blue and not just the sun. Violet actually scatters even more but our eyes are more sensitive to blue and some violet gets absorbed higher up, so blue is what wins out.

### Metrics
- Words spoken: 124
- Pace: 170 WPM (fast, uneven)
- Filler words: 1 total — "um" × 1
- Pauses (>1s): 1 (0 intentional, 1 hesitation), longest 1.2s at 0:41 (hesitation)
- Speaking time: 44s of 60s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace warning, fillers good, pauses good

Generate the JSON feedback now.`;

const EXAMPLE_4_ASSISTANT = `{"reasoning": "Well-ordered explanation of scattering: white light to short wavelengths scattering more to why we see blue. Content strong; the only drag is a fast, uneven finish that rushes the payoff. Net 7.", "score": 7, "feedback": "The build was solid. Light is a mix of colors, the short blue wavelengths scatter more off the air, so blue fills the sky. But you sped up right as you reached the payoff, so the best part came out in a rush. Treat the 'that's why it's blue' line as the one to slow down for. Land it instead of sprinting it. The explanation earned a real ending and you skipped past it."}`;

const EXAMPLE_5_USER = `## Session data

### What the user is explaining
(not specified — infer from the explanation)

### What the user said
Um, so it's basically when, like, a function calls itself, you know? So it just kind of keeps going, um, calling itself over and over again. It's, like, a function that uses itself inside itself, which sounds kind of weird, um. And it's used for a lot of things, like, in programming, you know, it comes up a lot. Yeah, so that's, um, kind of the idea of it I guess.

### Metrics
- Words spoken: 62
- Pace: 172 WPM (fast, uneven)
- Filler words: 6 total — "um" × 4, "like" × 1, "you know" × 1
- Pauses (>1s): 3 (0 intentional, 3 hesitation), longest 2.4s at 0:11 (hesitation)
- Speaking time: 21s of 60s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace warning, fillers danger, pauses danger

Generate the JSON feedback now.`;

const EXAMPLE_5_ASSISTANT = `{"reasoning": "Inferred topic: recursion. It never cohered — restated 'a function that calls itself' without a base case, an example, or any order, and stopped before a single part was whole. Fillers and three hesitations compound it. Net 3.", "score": 3, "feedback": "This didn't settle into an explanation. It kept circling 'a function that calls itself' without ever showing one step of it happening or where it stops, so there was no order to follow and nothing got pinned down. Next time, force the first concrete piece out loud: say 'here's the smallest case' and name one, then show it calling into the next. Build one link before reaching for the next. Right now it starts everywhere at once."}`;

// ============================================================
// Main function
// ============================================================

export async function generateExplainFeedback(
  input: ExplainFeedbackInput,
): Promise<ExplainFeedback> {
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

// Shape of the JSON the model returns. The leading "reasoning" field is discarded
// (it only exists to make the score follow from a stated rationale).
type RawFeedbackResponse = {
  score?: number;
  feedback?: string;
};

function validateFeedback(raw: RawFeedbackResponse | null): ExplainFeedback {
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
    console.warn(`[Explain Feedback] Unexpected length: ${trimmed.length} chars`);
  }

  return { score: clampedScore, feedback: trimmed };
}

// ============================================================
// User message builder — mirrors ai-feedback.ts's builder. The only differences:
// the "what the user is explaining" header (with the empty-topic placeholder the
// system prompt references) and dropping the "in response" wording (there's no
// prompt to respond to). Any change here must be mirrored in the example USER
// constants above.
// ============================================================

function buildUserMessage(input: ExplainFeedbackInput): string {
  const m = input.metrics;
  const lines: string[] = [];

  const topic = input.topic.trim();

  lines.push('## Session data');
  lines.push('');
  lines.push('### What the user is explaining');
  lines.push(topic.length > 0 ? topic : '(not specified — infer from the explanation)');
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

// Map SessionMetrics → the flatter input shape. Identical to buildFeedbackInput in
// ai-feedback.ts except `prompt` becomes `topic` (passed through as-is, '' included —
// the builder substitutes the infer-from-transcript placeholder, not this function).
export function buildExplainFeedbackInput(
  topic: string,
  transcript: string,
  metrics: Extract<SessionMetrics, { tooShort: false }>,
  recordingDurationSec: number,
  focusGuidance?: string | null,
): ExplainFeedbackInput {
  return {
    topic,
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
// lib/storytelling-feedback.ts
//
// Generates the prose feedback at the top of Storytelling results, via the openai-chat
// Edge Function. Mirrors lib/explain-feedback.ts (same model/config, reasoning-first
// JSON, delivery-rating threading, validateFeedback) but scores a DIFFERENT rubric:
// NARRATIVE CRAFT — does the story have an arc, concrete scene, momentum, and a point
// that lands — NOT explanation clarity. The user may have typed what the story is about;
// if not, the model infers it from the transcript.
//
// Same no-audience discipline as explain: judge the story's structure and landing as
// properties of the story itself (arc, stakes, scene, resolution), never as its effect
// on a listener. See the system prompt's DO NOT section.

import type { SessionMetrics } from './metrics';
import { paceStatus, fillerStatus, pauseStatus, type MetricStatus } from './metric-status';
import { openaiChat } from './ai-proxy';

// Same config as explain-feedback.ts / ai-feedback.ts.
const MODEL = 'gpt-4o';
const TEMPERATURE = 0.5;
const MAX_TOKENS = 400;
const SEED = 7;

// ============================================================
// Types
// ============================================================

export type StorytellingFeedbackInput = {
  // What the story is about. MAY be '' — the model infers it from the transcript.
  topic: string;
  transcript: string;
  focusGuidance?: string | null;
  // Identical to ExplainFeedbackInput['metrics'] — one continuous single-speaker take.
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

export type StorytellingFeedback = {
  score: number; // 1–10 integer — narrative quality primary, delivery secondary
  feedback: string;
};

// ============================================================
// System prompt
// ============================================================

const SYSTEM_PROMPT = `You are a storytelling coach reviewing a single practice where the user told a story out loud. You have their transcript and the metrics computed from their speech. They may have typed what the story is about; if that line reads "(not specified — infer from the story)", work out what it was from the transcript itself.

Your job: give them a 1–10 score for how well they TOLD THE STORY AND ONE piece of feedback they can act on next time.

SCORING

Score is a 1–10 integer. It measures NARRATIVE QUALITY, judged across five things, all of them properties of the story itself:
- Arc / shape — an opening that sets something up, a middle with stakes or tension or a change, an ending that resolves. NOT a flat sequence of events.
- Concrete scene — specific, sensory moments that show what happened ("she slammed the laptop shut") instead of summarizing it ("it was a frustrating meeting").
- Momentum — it moves forward; it doesn't stall, loop, over-explain, or trail off. Every beat earns its place.
- A point / emotional core — the story is ABOUT something and lands on a meaning or a feeling, not "...and then we went home."
- Economy of setup — it gets into the story quickly instead of a long throat-clearing preamble.

Narrative quality is the primary driver; delivery modulates within ~2 points. Do NOT reward answering a prompt (there is none) or how impressive the events were — a small story told well beats a big one told flat.

Anchored 1 / 5 / 10:
- 10: a clear arc — set up, built with real stakes or a turn, landed on a moment that means something — carried by at least one concrete scene. Clean delivery.
- 5: events in order but no arc ("and then, and then"), OR all summary with no scene, OR it trails off without landing. Or a genuinely good story dragged down by visible delivery issues.
- 1: not a story — a list of facts or an abstract musing, no arc, no scene, no point.

Each delivery dimension (pace, fillers, pauses) is ALREADY rated for you in the metrics as good, warning, or danger. USE those ratings, and do not re-derive a delivery judgment from the raw numbers. A "danger" rating pulls the score down, a "warning" pulls it down a little, a "good" not at all. Delivery should not move the score more than 2 points combined from its narrative baseline.

WRITE:
- 2–4 sentences of prose. No bullets, no headers, no markdown.
- Warm but direct. Second person ("you"). Sound like a coach who has 30 seconds with the user before their next attempt.
- Name ONE specific strength and ONE specific growth area, both pulled from THIS story — not generic playbook advice.
- Give a concrete, rehearsable substitution for the growth area. The user should be able to picture practicing it.
- Reframe the substitution so the new behavior reads as the right move, not just the less-wrong move.
- When the filler rating is "warning" or "danger," fillers are almost always the highest-leverage growth area. Name them, and prescribe a pause in their place: a deliberate beat of silence instead of reaching for um or like. A pause also does storytelling work — it lets a moment land. The silence feels longer to the speaker than it sounds on the recording.
- Short sentences. Mix lengths but lean shorter. A 25-word sentence is usually two sentences trying to be one.
- Start sentences with "But," "And," or "So" when it fits. This is how people talk.
- Reference at least one specific phrase or moment from the transcript. Quote it in single quotes (e.g., 'you said "I never got his name"') or describe a concrete beat (e.g., 'your last line,' 'the part where the phone died'). If your feedback would read the same with a different story, you haven't done your job.

DO NOT:
- Never use three parallel items in a row (a tricolon), even when they're short. If you find yourself listing three things, pick the one that matters most and delete the others.
- Do not invent the story or tell the user what should have happened in it. Coach how they TOLD it — the shape, the scene, the pacing of the telling — not the events of their life. If you find yourself writing "you should have done X in the story," stop.
- Do not refer to an audience, listener, reader, crowd, room, or anyone the story is told to. The user is practicing alone to tell stories better in general, not performing for anyone. Never write "your audience was hooked," "listeners would feel the tension," "you had the room," "keep them on the edge of their seat." Judge the story as an object: "the story built to a clear turn," "the ending landed," "the middle sagged because nothing raised the stakes," "you opened in summary instead of a scene." When something is unclear or flat, locate the flaw IN the story (no stakes, a flat sequence, a missing scene), not in an imagined listener.
- "It dragged," "it was flat," "it rambled" — these are vague diagnoses. NAME the actual problem. Was it a sequence of events with no turn? All summary and no scene? A two-sentence story buried under a minute of setup? Be precise.
- Open with "Great job," "Nice work," "Good start," or any warm-up phrase.
- Restate the metrics. The user sees them in a table below your text. Synthesize across them.
- Give advice that would fit any session ("storytelling takes practice"). If the sentence would fit any user, cut it.
- List multiple problems. Pick the single highest-leverage one. Three problems mentioned → the user remembers zero.
- Use em-dashes. If you'd reach for one, end the sentence and start a new one with a period.
- Use semicolons. Break into two sentences instead.
- Use balanced or paired constructions like "X reads as A, Y reads as B." These sound polished, which is the problem.
- End with an aphorism or general truth. End on something specific to this user.
- Use "the [adjective] [noun]" hedges like "the hardest part," "the real turn." Name the thing directly.
- Quote large chunks of the transcript. Reference specific words or short phrases, not paragraphs.

FOCUS
- The session data may include a "### Focus": the delivery area to weight. When present, let it steer WHICH growth area you pick and what you emphasize — lean toward the dimensions it names (for storytelling that's usually expressive pauses that let a beat land, and pitch that isn't flat). It does NOT change the scoring rubric, and it never licenses audience or performance framing (the no-audience rule above still holds): keep every line about the story and the speaker's own delivery.

OUTPUT: a JSON object with THREE fields, in THIS EXACT ORDER: "reasoning" (one short internal sentence — note whether it had an arc + a concrete scene + a landing, and any delivery drag, THEN commit to a number; this is NOT shown to the user, so be blunt and brief), "score" (integer 1-10), and "feedback" (your 2–4 sentence response as a single string). The "reasoning" MUST come first so the score follows from it rather than being a snap guess. No surrounding markdown, no other fields.

Before finalizing, read your response in your head as if speaking it out loud. If it sounds like an essay or a column, rewrite it. If it sounds like a person talking to you for ten seconds before your next attempt, keep it.`;

// ============================================================
// Few-shot examples — five pairs, same anchor spread as explain (a 9 and a 3 so the
// model doesn't compress toward 6–7), recast as STORIES. Example 5 leaves the topic
// unspecified so the model has seen the infer-from-transcript case. Each USER block
// MUST match buildUserMessage() output exactly. (No ### Focus in the examples — the
// live call threads it, same as explain's few-shots.)
// ============================================================

const EXAMPLE_1_USER = `## Session data

### What the story is about
the time I got lost in Tokyo on my first night

### What the user said
So the first night I was in Tokyo, I was way too confident. I had a paper map, I spoke zero Japanese, and I decided to walk back to my hostel instead of taking the train. Twenty minutes in, nothing on the map matched the street signs. Then my phone died. It's getting dark, I'm turning the map upside down like that's going to help, and I genuinely have no idea where I am. I must have looked pretty lost, because this older man stops, and he doesn't speak English either, but he just points at my map and starts walking. I follow him for maybe ten minutes, no words the whole time. He stops at a corner, points down the street, and there's my hostel sign. He gave a little bow and walked off. I never got his name. I still think about that guy.

### Metrics
- Words spoken: 156
- Pace: 150 WPM (ideal, steady)
- Filler words: 0
- Pauses (>1s): 2 (2 intentional, 0 hesitation), longest 1.3s at 0:20 (intentional)
- Speaking time: 58s of 75s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace good, fillers good, pauses good

Generate the JSON feedback now.`;

const EXAMPLE_1_ASSISTANT = `{"reasoning": "Real arc: cocky setup, the phone-dies escalation, the wordless stranger as the turn, a landing that means something ('I never got his name. I still think about that guy'). Concrete throughout, clean delivery. Net 9.", "score": 9, "feedback": "This had a real shape. You set up the overconfidence, let it get worse step by step (the map fails, then the phone dies), and the wordless stranger was a genuine turn, not just the next thing that happened. And you didn't explain the ending to death. 'I never got his name. I still think about that guy' landed it on a feeling and stopped. Keep trusting that. The restraint at the end is what made it stick."}`;

const EXAMPLE_2_USER = `## Session data

### What the story is about
my first day at a new job

### What the user said
So my first day at the job. I woke up early, I was pretty nervous. I took the train in and I got there maybe fifteen minutes early. My manager met me at the front and introduced me to the team, everyone seemed nice. Then I had a bunch of onboarding stuff, setting up my laptop, going through some documents, the usual. We went to lunch around noon at a place nearby, it was good. In the afternoon I mostly shadowed someone. And then I went home. It was a pretty normal first day honestly, nothing crazy happened.

### Metrics
- Words spoken: 108
- Pace: 140 WPM (ideal, steady)
- Filler words: 0
- Pauses (>1s): 0
- Speaking time: 50s of 75s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace good, fillers good, pauses good

Generate the JSON feedback now.`;

const EXAMPLE_2_ASSISTANT = `{"reasoning": "All events, no arc — woke up, arrived, onboarding, lunch, home, in order but with no tension, no turn, no point ('nothing crazy happened'). Delivery clean. A structure miss, net 6.", "score": 6, "feedback": "You walked through the day in order, but it stayed a list. Wake up, train, onboarding, lunch, home. Nothing built and nothing turned, so there was never a moment for it to be about. Next time, find the one beat that mattered, the second you felt out of place or the person who surprised you, and make the story just that. Start right before that moment and cut most of the rest. One real beat beats a full timeline."}`;

const EXAMPLE_3_USER = `## Session data

### What the story is about
how my grandfather influenced me

### What the user said
My grandfather had a huge influence on me. He was one of the hardest working people I've ever known, he immigrated with basically nothing and built a life for the whole family. He taught me a lot about, um, patience and not complaining and just showing up every day. He was really generous too, always putting other people first. I think a lot of who I am comes from watching him. He had this quiet strength about him. Even when things were hard he never really let it show. I really look up to him and I try to carry those lessons with me.

### Metrics
- Words spoken: 110
- Pace: 143 WPM (ideal, steady)
- Filler words: 1 total — "um" × 1
- Pauses (>1s): 0
- Speaking time: 48s of 75s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace good, fillers good, pauses good

Generate the JSON feedback now.`;

const EXAMPLE_3_ASSISTANT = `{"reasoning": "A tribute, not a story — all summary ('hardest working', 'quiet strength', 'generous'), no single scene where any of it actually happens. Delivery fine. Net 6.", "score": 6, "feedback": "Everything you said about him was clearly true, but it stayed at the level of description. Hard-working, generous, quiet strength. Those are conclusions, not scenes. Pick ONE specific moment that shows it. The morning he did the thing, the exact words he said one time, and let it play out instead of summarizing him. Show him doing one small thing and the rest comes through without you naming it."}`;

const EXAMPLE_4_USER = `## Session data

### What the story is about
the time I almost missed a flight to a wedding

### What the user said
Okay so I almost missed my flight to my best friend's wedding. I'd given myself plenty of time, but the highway was completely shut down, an accident, everything stopped. I'm sitting there watching the minutes go and doing the math and it's not looking good. I finally get to the airport, I park in the wrong lot, I'm sprinting with my garment bag, the security line is huge, um, I'm basically begging people to let me cut. I get through, I'm running to the gate and they're literally about to close the door and the agent sees me and holds it and I make it and I collapse into my seat and I made the wedding. So yeah. That was close.

### Metrics
- Words spoken: 138
- Pace: 172 WPM (fast, uneven)
- Filler words: 1 total — "um" × 1
- Pauses (>1s): 1 (0 intentional, 1 hesitation), longest 1.2s at 0:35 (hesitation)
- Speaking time: 47s of 75s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace warning, fillers good, pauses good

Generate the JSON feedback now.`;

const EXAMPLE_4_ASSISTANT = `{"reasoning": "Strong arc and real tension — the highway, doing the math, the sprint. But the climax ran fast and uneven, so the payoff came out in a breathless clump instead of landing. One delivery drag on a good story. Net 7.", "score": 7, "feedback": "The tension was real. The shutdown, doing the math in the car, the sprint through security, each beat raised the stakes. But you sped up right at the climax and it turned into one long run-on ('running to the gate and they're about to close the door and the agent sees me and I make it'). The best moment blurred past. Slow down at the door. Let the held-open door be its own beat. The story earned that pause and you rushed straight through it."}`;

const EXAMPLE_5_USER = `## Session data

### What the story is about
(not specified — infer from the story)

### What the user said
Um, so I guess like a story about, honestly I'm not sure, um. I've had a lot of things happen I guess but nothing's really coming to mind right now, you know? Like, life has its ups and downs and you kind of just learn from all of it, um. I don't know, I feel like every experience kind of shapes you in some way. Yeah, I guess that's kind of it.

### Metrics
- Words spoken: 66
- Pace: 174 WPM (fast, uneven)
- Filler words: 5 total — "um" × 3, "like" × 1, "you know" × 1
- Pauses (>1s): 3 (0 intentional, 3 hesitation), longest 2.3s at 0:10 (hesitation)
- Speaking time: 22s of 75s recording
- Delivery ratings (use these, do not re-derive from the numbers above): pace warning, fillers danger, pauses danger

Generate the JSON feedback now.`;

const EXAMPLE_5_ASSISTANT = `{"reasoning": "Never became a story — no moment, no scene, no arc, just a vague musing about ups and downs. Fillers and three hesitations pile on. Net 3.", "score": 3, "feedback": "This never got to a story. It stayed in general reflection ('life has its ups and downs', 'every experience shapes you') without one moment actually happening. Next time, don't hunt for the meaning first. Pick one concrete thing that happened to you, the smaller the better, and just start telling it: 'It was a Tuesday and I was...'. Open on the scene, and the point shows up on its own."}`;

// ============================================================
// Main function
// ============================================================

export async function generateStorytellingFeedback(
  input: StorytellingFeedbackInput,
): Promise<StorytellingFeedback> {
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

function validateFeedback(raw: RawFeedbackResponse | null): StorytellingFeedback {
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
    console.warn(`[Storytelling Feedback] Unexpected length: ${trimmed.length} chars`);
  }

  return { score: clampedScore, feedback: trimmed };
}

// ============================================================
// User message builder — same shape as explain's, with the story-flavored headers.
// Any change here must be mirrored in the example USER constants above.
// ============================================================

function buildUserMessage(input: StorytellingFeedbackInput): string {
  const m = input.metrics;
  const lines: string[] = [];

  const topic = input.topic.trim();

  lines.push('## Session data');
  lines.push('');
  lines.push('### What the story is about');
  lines.push(topic.length > 0 ? topic : '(not specified — infer from the story)');
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

// Map SessionMetrics → the flatter input shape. Identical to explain's builder except
// `prompt` is `topic` (passed through as-is, '' included — buildUserMessage substitutes
// the infer-from-transcript placeholder, not this function).
export function buildStorytellingFeedbackInput(
  topic: string,
  transcript: string,
  metrics: Extract<SessionMetrics, { tooShort: false }>,
  recordingDurationSec: number,
  focusGuidance?: string | null,
): StorytellingFeedbackInput {
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
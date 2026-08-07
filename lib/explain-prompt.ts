// lib/explain-prompt.ts
//
// Generates the TOPIC for the Explain exercise (a concept the user spends ~1 minute
// explaining out loud). Mirrors lib/prep-prompt.ts / lib/debate-prompt.ts: an async
// generator that builds a system prompt, calls the model through lib/ai-proxy, quote-strips,
// logs, and falls back to a static pool on any error (never rejects). Variety comes from a
// random domain seed (lib/explain-seeds).
//
// No question-guard (unlike debate): an Explain topic can be phrased "How X works" OR
// "Why is X?" — both read fine. NOT focus-steered (the focus presets don't map to a topic;
// Explain FEEDBACK still uses the profile focus).

import { takeExplainSeed } from './explain-seeds';
import { openaiChat } from './ai-proxy';

// Hand-written topics — the offline/error fallback AND ground truth for "good".
// PLACEHOLDER; grow/tune freely.
const FALLBACK_TOPICS: string[] = [
  'How compound interest works',
  'Why we have seasons',
  'How a bill becomes a law',
  'What causes jet lag',
  'How vaccines work',
  'Why the sky is blue',
  'How a recession happens',
  'The rules of offside in soccer',
];

export async function generateExplainTopic(): Promise<string> {
  const seed = await takeExplainSeed();
  const systemPrompt = buildSystemPrompt(seed);

  try {
    const res = await openaiChat({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Generate one topic to explain.' },
      ],
      temperature: 1.0,
      max_tokens: 40,
    });

    if (!res.ok) {
      console.warn('Explain topic generation failed:', res.status);
      return pickFallback();
    }

    const json = await res.json();
    const content: string | undefined = json?.choices?.[0]?.message?.content;
    if (!content) return pickFallback();

    const topic = content.trim().replace(/^["'“”]|["'“”]$/g, '');
    console.log('[AI Prompt][explain]', { seed, topic });
    return topic;
  } catch (e) {
    console.warn('Explain topic generation threw:', e);
    return pickFallback();
  }
}

// ============================================================
// System prompt — a positive spec + annotated WRONG examples (the TTO discipline). The key
// distinction from Debate/PREP: a topic to EXPLAIN, never an opinion to argue.
// ============================================================

function buildSystemPrompt(seed: string): string {
  return `You generate a single TOPIC for a speaking-practice app.

The user will read the topic and spend about a minute EXPLAINING it out loud, in their own words. So the topic must be a concept, phenomenon, process, or idea that a regular person could explain from general knowledge.

Rules:
- One topic only. Phrase it naturally as the thing to explain: "How compound interest works", "Why we have seasons", "The water cycle", "What causes jet lag". A "How..." or "Why..." phrasing usually works best.
- 2-10 words. Concrete and specific enough to explain in about a minute, but common enough that a curious non-expert could take a real shot at it.
- It must be a topic to EXPLAIN, not an opinion to argue. No "should", no yes/no positions, nothing with a "right side" — that is a different exercise.
- General knowledge only. No niche jargon, no obscure trivia, nothing that needs a specialist. Understandable by anyone.
- Civil and everyday: science, nature, money, technology, health, history, sports, how-things-work. No partisan politics, religion as truth, tragedy, or anything targeting a group.

Examples of GOOD topics:
- "How compound interest works"
- "Why the sky is blue"
- "How a bill becomes a law"
- "What causes jet lag"
- "The rules of offside in soccer"

Examples of BAD topics (do NOT generate these):
- "Should people use their phones less?" ← an opinion to argue, not a concept to explain
- "The socioeconomic effects of quantitative easing" ← too academic and niche
- "Your favorite movie" ← a preference, nothing to explain
- "Quantum chromodynamics" ← needs a specialist, most people can't explain it

This topic's subject area: ${seed}. Draw the topic from this area; the phrase itself need not appear.

Return ONLY the topic text. No quotes, no commentary, no preamble.`;
}

const pickFallback = (): string => {
  return FALLBACK_TOPICS[Math.floor(Math.random() * FALLBACK_TOPICS.length)];
};
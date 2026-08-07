// lib/prep-prompt.ts
//
// Generates the PRACTICE PROMPT for the PREP framework mode (a scenario the user makes a
// short spoken CASE about). Mirrors lib/debate-prompt.ts: an async generator that builds a
// system prompt, calls the model through lib/ai-proxy, quote-strips, logs, and falls back
// to a static pool on any error (never rejects). Variety comes from a random domain seed
// (lib/prep-seeds).
//
// CRITICAL discipline (from lib/tto-framework-prompt.ts): the prompt must NOT reveal or set
// up the Point-Reason-Example-Point structure — it's a topic; the user applies PREP to their
// answer themselves. NOT focus-steered (the focus presets don't map to a "make a point"
// topic; PREP FEEDBACK still uses the profile focus).

import { takePrepSeed } from './prep-seeds';
import { openaiChat } from './ai-proxy';

// Hand-written practice prompts — the offline/error fallback AND ground truth for "good".
// PLACEHOLDER; grow/tune freely.
const FALLBACK_PROMPTS: string[] = [
  'What\'s a habit everyone should adopt?',
  'Make the case for a change at your workplace.',
  'Should people use their phones less?',
  'What\'s a skill worth learning this year?',
  'Is working from home better than the office?',
  'What\'s one thing schools should do differently?',
  'Make the case for a technology people should use more.',
  'What\'s a small change that would improve daily life?',
];

export async function generatePrepPrompt(): Promise<string> {
  const seed = await takePrepSeed();
  const systemPrompt = buildSystemPrompt(seed);

  try {
    const res = await openaiChat({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Generate one practice prompt. Do NOT reveal the point/reason/example structure.' },
      ],
      temperature: 1.0,
      max_tokens: 40,
    });

    if (!res.ok) {
      console.warn('PREP prompt generation failed:', res.status);
      return pickFallback();
    }

    const json = await res.json();
    const content: string | undefined = json?.choices?.[0]?.message?.content;
    if (!content) return pickFallback();

    const prompt = content.trim().replace(/^["'“”]|["'“”]$/g, '');
    console.log('[AI Prompt][prep]', { seed, prompt });
    return prompt;
  } catch (e) {
    console.warn('PREP prompt generation threw:', e);
    return pickFallback();
  }
}

// ============================================================
// System prompt — teaches by a positive spec + annotated WRONG examples (the TTO
// discipline). The key rule: never reveal the P·R·E·P structure in the prompt itself.
// ============================================================

function buildSystemPrompt(seed: string): string {
  return `You generate a single PRACTICE PROMPT for a speaking-practice app.

The user will read the prompt and make a short spoken CASE for their view on it. They structure the answer themselves, so the prompt should invite an OPINION, a RECOMMENDATION, or a position — something a reasonable person could argue for.

Rules:
- One prompt only. A question or an invitation to make a case: "What's a habit everyone should adopt?", "Should X...?", "Make the case for...", "What's a change you'd push for at work?".
- 6-16 words. Conversational and clear, not academic.
- It must invite a POINT the user can back up — not a bare fact, not a pure preference with nothing to argue, not a yes/no with one obvious answer.
- Understandable by anyone. Civil and everyday: work, habits, technology, health, money, learning, lifestyle. No partisan politics, religion, tragedy, or anything targeting a group.
- CRITICAL: do NOT reveal or set up a structure in the prompt. Do NOT tell the user to give a point, a reason, an example, or to restate their point, and do not name those parts. The prompt is just a topic; the user applies the structure on their own.

Examples of GOOD prompts:
- "What's a habit everyone should adopt?"
- "Make the case for a change at your workplace."
- "Should people use their phones less?"
- "What's a skill worth learning this year?"

Examples of BAD prompts (do NOT generate these):
- "State your point, give a reason and an example, then restate it." ← reveals the framework
- "What's the capital of France?" ← a bare fact, nothing to argue
- "What's your favorite color?" ← a preference with nothing to make a case for
- "Should murder be illegal?" ← an obvious yes/no, no real position to argue

This prompt's subject area: ${seed}. Draw the prompt from this area; the phrase itself need not appear.

Return ONLY the prompt text. No quotes, no commentary, no preamble.`;
}

const pickFallback = (): string => {
  return FALLBACK_PROMPTS[Math.floor(Math.random() * FALLBACK_PROMPTS.length)];
};
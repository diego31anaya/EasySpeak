// lib/debate-prompt.ts
//
// Generates a DEBATE STATEMENT (a two-sided DECLARATIVE claim — never a question, so it
// fits the Agree/Disagree buttons) for the Debate practice mode, via the openai-chat Edge
// Function (which holds the key). Mirrors
// lib/prompt-generator.ts: an async generator that builds a system prompt, calls the
// model through lib/ai-proxy, strips quotes, logs, and falls back to a static pool on
// any error (never rejects). Variety comes from a random domain seed (lib/debate-seeds)
// so the model doesn't collapse to the same five motions.
//
// NOTE: unlike impromptu, the statement is NOT focus-steered — the existing focus presets
// (interview/storytelling/…) describe genres that don't map to a debate topic, so
// threading them here would produce nonsense. The Debate FEEDBACK still uses the profile
// focus (see lib/debate-feedback.ts); only statement GENERATION ignores it.

import { takeDebateSeed } from './debate-seeds';
import { openaiChat } from './ai-proxy';

// Hand-written debatable statements — the offline/error fallback AND the ground truth
// for what "good" looks like. PLACEHOLDER; grow/tune freely.
const FALLBACK_STATEMENTS: string[] = [
  'Homework should be abolished in schools.',
  'Remote work is better than working in an office.',
  'Social media does more harm than good.',
  'Renting a home is better than buying one.',
  'Tipping culture has gone too far.',
  'A four-day work week should become the standard.',
  'Video games are a waste of time.',
  "It's better to be a generalist than a specialist.",
];

export async function generateDebateStatement(): Promise<string> {
  // Seed each generation with a random domain so statements spread out instead of
  // collapsing to the model's handful of go-to motions.
  const seed = await takeDebateSeed();
  const systemPrompt = buildSystemPrompt(seed);

  try {
    const res = await openaiChat({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Generate one debate statement.' },
      ],
      temperature: 1.0,
      max_tokens: 40,
    });

    if (!res.ok) {
      console.warn('Debate statement generation failed:', res.status);
      return pickFallback();
    }

    const json = await res.json();
    const content: string | undefined = json?.choices?.[0]?.message?.content;
    if (!content) return pickFallback();

    const statement = content.trim().replace(/^["'“”]|["'“”]$/g, '');
    // Belt-and-suspenders: the buttons are Agree/Disagree, so a question doesn't fit. If
    // the model slips and returns one, fall back to a (declarative) statement.
    if (statement.endsWith('?')) {
      console.warn('[AI Prompt][debate] discarded a question, using fallback:', statement);
      return pickFallback();
    }
    console.log('[AI Prompt][debate]', { seed, statement });
    return statement;
  } catch (e) {
    console.warn('Debate statement generation threw:', e);
    return pickFallback();
  }
}

// ============================================================
// System prompt — teaches by a positive spec + annotated WRONG examples (the TTO
// discipline). Impromptu's generator forbids exactly what we want ("not a debate
// motion", "not a yes/no"), so this is greenfield.
// ============================================================

function buildSystemPrompt(seed: string): string {
  return `You generate a single DEBATE STATEMENT for a speaking-practice app.

The user will read the statement, tap Agree or Disagree, and argue that side out loud for a minute or two. So the statement MUST have two genuinely defensible sides that a reasonable person could argue either way.

Rules:
- One statement only, phrased as a DECLARATIVE CLAIM the user can agree or disagree with — e.g. "X should be Y", "X is better than Y", "X does more harm than good".
- NEVER a question. The app's buttons say Agree / Disagree, so "Should X...?" or "Is X...?" doesn't fit — write it as a statement ("X should...", "X is...") instead. The statement ends with a period, never a question mark.
- 6-16 words. Conversational and clear, not academic.
- Understandable by anyone — no specialized knowledge required.
- BOTH sides must be reasonable. Not a settled fact, and not something with one obviously-right answer.
- Range: everyday life (technology, work, school, lifestyle, culture, money, habits) AND big-picture ideas the way a debate club runs them — economic systems (capitalism vs socialism), the role of government, society, ethics, and philosophy. Substantive is good.
- Keep even the big topics ABSTRACT and civil — argue the idea, not a tribe. Do NOT touch: current partisan politics (specific parties, politicians, or elections), culture-war identity flashpoints, religion as a question of truth, tragedy or violence, or anything that targets or demeans a group of people.

Examples of GOOD debate statements:
- "Homework should be abolished in schools."
- "Remote work is better than working in an office."
- "Renting a home is better than buying one."
- "Tipping culture has gone too far."
- "Capitalism is better than socialism."
- "Democracy is the best form of government."

Examples of BAD statements (do NOT generate these):
- "Is remote work better than office work?" ← a question; state it as a claim ("Remote work is better than working in an office.") so it fits the Agree/Disagree buttons
- "Water is essential for life." ← a fact, nothing to argue
- "Kindness matters." ← one obviously-right side, no defensible opposite
- "What's your favorite season?" ← a personal preference, not a two-sided claim
- "Multitasking both helps and hurts productivity." ← not a single clean claim to pick a side on
- "Which political party governs better?" ← current partisan politics (big ideas like capitalism vs socialism are fine, party politics is not)

This statement's subject area: ${seed}. Draw the claim from this area; the phrase itself need not appear.

Return ONLY the statement text. No quotes, no commentary, no preamble.`;
}

const pickFallback = (): string => {
  return FALLBACK_STATEMENTS[Math.floor(Math.random() * FALLBACK_STATEMENTS.length)];
};
// lib/tto-framework-prompt.ts
// Generates a single prompt for one shape in the 3-2-1 Framework via the openai-chat
// Edge Function (which holds the key). Called once per round (three per session);
// per-round generation hides latency in the user's active time + gives per-round
// fallback granularity.

import { focusPromptGuidance } from './focus';
import { openaiChat } from './ai-proxy';

export type Shape = 'one-thing' | 'two-types' | 'three-steps';

// ============================================================
// Hand-written fallbacks
//
// Used when the OpenAI key is missing or the call fails. These are also
// the ground truth for what "good" looks like — when calibrating the
// system prompt, generated outputs should sit in roughly the same
// register as these.
// ============================================================

const FALLBACK_PROMPTS: Record<Shape, string[]> = {
  'one-thing': [
    "What's something about your job that people usually get wrong?",
    "What's a habit you've built that's actually stuck?",
    "When was a time you changed your mind about something?",
    "What's something small that genuinely improves your day?",
  ],
  'two-types': [
    "How would you describe the way you handle stress?",
    "What's your relationship with social media like?",
    "What's something you do to recharge after a long week?",
    "How do you decide when to push through something versus quit?",
  ],
  'three-steps': [
    "How would you help a friend get better at having hard conversations?",
    "How do you get yourself moving on a day when you don't feel like it?",
    "What's your approach when you have to learn something completely new?",
    "How do you prepare when something important is coming up?",
  ],
};

export async function generateTTOPrompt(shape: Shape, focus?: string | null): Promise<string> {
    const systemPrompt = buildSystemPrompt(shape, focusPromptGuidance(focus));

    try {
        const res = await openaiChat({
                model: 'gpt-4o-mini',
                messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: 'Generate one prompt. Must be a single conversational question. Do NOT reveal the framework structure or mention numbers.' },
                ],
                temperature: 0.7,
                max_tokens: 50,
            });

        if (!res.ok) {
            console.warn('TTO prompt generation failed:', res.status);
            return pickFallback(shape);
        }

        const json = await res.json();
        const content: string | undefined = json?.choices?.[0]?.message?.content;
        if (!content) {
            console.warn('No content from json')
            return pickFallback(shape);
        }
        console.log('[AI Prompt][tto]', { shape, focus: focus ?? null, content })
        return content.trim().replace(/^["'"']|["'"']$/g, '');

    } catch (e) {
        console.warn('TTO prompt generation threw:', e)
        return pickFallback(shape)
    }
}

// ============================================================
// System prompt builder
// ============================================================

const SHARED_HEADER = `You generate single speaking-practice prompts for the 3-2-1 Framework, a structure for organizing spoken answers.

The user will hear your prompt read aloud and respond spontaneously. The prompt should feel like a question a real person might ask in conversation — not an essay topic, not a debate motion, not a writing prompt.

Universal rules:
- One question only. No multi-part prompts.
- 8 to 16 words.
- Conversational tone. Avoid academic or formal phrasing.
- Answerable by anyone — no required domain knowledge, no current-events knowledge, no insider context.
- Should provoke a real opinion, story, observation, or explanation — never yes/no.
- Avoid sensitive topics: politics, religion, tragedy, mental health, weight or appearance.
- Vary the opening — don't always start with "What do you think about". Mix in "How would you", "What's the best", "When was a time", "If you had to", etc.
- Bias toward easy-to-medium difficulty. The user should be able to start answering within a few seconds of hearing the question. They are practicing structure, not expertise.

CRITICAL — do NOT set up the shape in the question itself. The prompt should be a normal conversational question whose answer the user has to STRUCTURE on their own. The framework is something the user applies to the answer; it is not handed to them by the question.

Return ONLY the prompt text. No quotes, no commentary, no preamble, no explanation.`;

const SHAPE_BLOCKS: Record<Shape, string> = {
  'one-thing': `Shape context (do NOT reveal in the prompt):
The user will answer using the "1 Thing" structure — they pick one single point, observation, or position and elaborate on it. The framework's value is in the user CHOOSING what to focus on, then sticking with it instead of listing several things.

What this means for the question you generate:
- It should be a question that has many plausible answers, so different users would land on different "one things." This forces a real choice.
- It should NOT use "one thing", "single", "most important", "the main", or any language that signals only one answer is expected.
- It can be a question that naturally invites listing several things — the user's practice is choosing one anyway.

Examples of the right shape of question:
- "What's something about your job that people usually get wrong?"
- "What's a habit you've built that's actually stuck?"
- "When was a time you changed your mind about something?"
- "What's something small that genuinely improves your day?"

Examples of the WRONG shape (these set up the framework — do not generate prompts like these):
- "What's one thing you wish more people knew about [topic]?" ← explicitly says "one thing"
- "If you had to name a single most useful skill, what would it be?" ← says "single"
- "What's the most important quality in a friend?" ← says "most important"`,

  'two-types': `Shape context (do NOT reveal in the prompt):
The user will answer using the "2 Types" structure — they pick two different examples, approaches, kinds, or instances within the topic and talk about each. The two do NOT need to be opposites, complements, or in any kind of contrast. They just need to be two distinct things within the same category. (For example, answering "how do you eat an avocado" with "you can put it on bread, or eat it plain" — the two answers aren't opposites, they're just two of many possible ways.)

The framework's value is in the user CHOOSING which two to focus on out of many possibilities, then giving each its own treatment instead of trying to cover everything.

What this means for the question you generate:
- It should be a question that has many possible answers, where the user can comfortably pick any two to talk about.
- It should NOT use the word "two", "both", "different ways", "types of", "kinds of", or any number. Never reveal how many to pick.
- It should NOT specify or imply two specific categories. Avoid "What's the difference between X and Y", "Compare A and B", or any phrasing that hands the user the two things to talk about.
- Questions about how, ways, approaches, or what you do work well — anything where the user could reasonably name several things and choose two.

Examples of the right shape of question:
- "How would you describe the way you handle stress?"
- "What's your relationship with social media like?"
- "What's something you do to recharge after a long week?"

Examples of the WRONG shape (these set up the framework — do not generate prompts like these):
- "How would you describe two different ways you enjoy spending your weekends?" ← explicitly says "two different ways"
- "What are the two kinds of people you meet at work?" ← says "two"
- "Compare working from home and working in an office." ← sets up two specific things to compare
- "Name two things you wish you'd learned earlier." ← says "two"
- "What are both sides of...?" ← uses "both"`,

  'three-steps': `Shape context (do NOT reveal in the prompt):
The user will answer using the "3 Steps" structure — they walk through something in order, three sequential pieces. The framework's value is in the user IMPOSING order on something that may not have an obvious sequence, then narrating it clearly.

What this means for the question you generate:
- It should be a question whose answer has natural sequence — a process, a how-to, an unfolding, advice for someone starting out — but the steps themselves should be up to the user.
- It should NOT specify a number ("three steps", "steps", "first, second, third", "step by step") or use "process for" or "the way you". Never tell the user to break it into steps.
- "How would you", "How do you", "What's your approach" openings work well. Vary them — don't repeat the same phrasing.

Examples of the right shape of question:
- "How would you help a friend get better at having hard conversations?"
- "How do you get yourself moving on a day when you don't feel like it?"
- "What's your approach when you have to learn something completely new?"
- "How would you prepare when something important is coming up?"

Examples of the WRONG shape (these set up the framework — do not generate prompts like these):
- "What are the three steps to..." ← says "three steps"
- "Walk me through your morning routine step by step." ← explicitly asks for steps
- "What's your process for getting things done?" ← says "process" (implies steps)
- "Describe the steps you take when..." ← mentions "steps"`,
};

function buildSystemPrompt(shape: Shape, focusSteer?: string | null): string {
  // The focus tint is strictly SECONDARY to the shape — the shape rules (incl.
  // never revealing the structure) always win. It only nudges subject/flavor.
  const tint = focusSteer
    ? `\n\nSubject lean (SECONDARY — the shape rules above ALWAYS take priority; if this conflicts with the shape, ignore it and follow the shape): gently prefer ${focusSteer}.`
    : '';
  return `${SHARED_HEADER}\n\n${SHAPE_BLOCKS[shape]}${tint}`;
}

function pickFallback(shape: Shape): string {
    console.log('Fallback Prompt used')
    const list = FALLBACK_PROMPTS[shape];
    return list[Math.floor(Math.random() * list.length)]
}
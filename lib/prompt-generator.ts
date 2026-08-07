// lib/prompt-generator.ts
// Prompts are generated via the openai-chat Edge Function (which holds the key).

import { TYPES, getTopic, getType, type TopicId, type TypeId } from './impromptu-config';
import { takeSeedWord } from './impromptu-seeds';
import { focusPromptGuidance } from './focus';
import { openaiChat } from './ai-proxy';

const FALLBACK_PROMPTS: Record<string, string[]> = {
  default: [
    "Tell me about something you've changed your mind about recently.",
    "What's a small habit that has had a big impact on your life?",
    "If you could give your 18-year-old self one piece of advice, what would it be?",
  ],
};

export type PromptOptions = {
  topic?: TopicId;        // undefined = random topic
  type?: TypeId;          // undefined = random type
  focus?: string | null;  // focus key; when it has a prompt steer it supersedes `type`
};

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export async function generateImpromptuPrompt(
  options: PromptOptions = {},
): Promise<string> {
  // Resolve "random" (undefined) to a specific topic/type. Genuine variety in
  // inputs produces genuine variety in outputs; unconstrained calls collapse to
  // the model's most-common outputs.
  const focusSteer = focusPromptGuidance(options.focus);
  // Default (random) path: seed each generation with a random word so prompts
  // don't collapse to the model's handful of most-common questions. An explicit
  // topic (API/legacy) still uses the fixed topic pool instead of a seed.
  const seed = options.topic ? null : await takeSeedWord();
  const topic = options.topic ?? null;
  // Focus owns the "mode": when it has a steer it sets it and the type axis is
  // dropped; otherwise fall back to the (random or selected) opinion/story/pitch.
  const type = focusSteer ? null : options.type ?? pickRandom(TYPES).id;

  const systemPrompt = buildSystemPrompt({ topic, seed, type, focusSteer });

  try {
    const res = await openaiChat({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Generate one prompt.' },
      ],
      temperature: 1.0,
      max_tokens: 60,
    });

    if (!res.ok) {
      console.warn('Prompt generation failed:', res.status);
      return pickFallback();
    }

    const json = await res.json();
    const content: string | undefined = json?.choices?.[0]?.message?.content;
    if (!content) {
      console.log('fallback')
return pickFallback();
    } 

    const prompt = content.trim().replace(/^["'""]|["'""]$/g, '');
    console.log('[AI Prompt][impromptu]', { focus: options.focus ?? null, seed, topic, type, prompt });
    return prompt;
  } catch (e) {
    console.warn('Prompt generation threw:', e);
    return pickFallback();
  }
}

// ============================================================
// System prompt builder. Topic constrains the subject; the MODE comes from the
// focus steer when present (it supersedes the opinion/story/pitch type), else the
// type. A focus steer is a hard "Mode:" constraint, same strength as the old type.
// ============================================================

function buildSystemPrompt(opts: { topic?: TopicId | null; seed?: string | null; type?: TypeId | null; focusSteer?: string | null }): string {
  const base = `You generate single conversation prompts for a speaking-practice app.

The user will be asked the prompt out loud and given 60 seconds to respond
spontaneously. The prompt should feel like a question a real person might ask
in a conversation — not an essay topic, not a debate motion.

Universal rules:
- One question only. No multi-part prompts.
- 8-20 words.
- Conversational tone. Avoid academic or formal phrasing.
- Should be answerable by anyone (no required domain knowledge).
- Should provoke a real opinion, story, or explanation — not a yes/no.
- Avoid sensitive topics (politics, religion, tragedy).
- Vary the angle — don't always lead with "What do you think about...".

Return ONLY the prompt text. No quotes, no commentary, no preamble.`;

  const constraints: string[] = [];

  if (opts.seed) {
    constraints.push(
      `Inspiration: use the word "${opts.seed}" as a creative seed. Build a prompt sparked by it — an idea, memory, opinion, or scenario it brings to mind. The word itself does NOT need to appear in the prompt; let it pull you somewhere specific and unexpected rather than a generic question.`,
    );
  } else if (opts.topic) {
    const t = getTopic(opts.topic);
    constraints.push(`Topic: the prompt MUST be about ${t.llmDescription}.`);
  }

  if (opts.focusSteer) {
    constraints.push(`Mode: the prompt MUST be ${opts.focusSteer}.`);
  } else if (opts.type) {
    const ty = getType(opts.type);
    constraints.push(`Type: the prompt MUST be one that ${ty.llmDescription}`);
  }

  if (constraints.length === 0) {
    return base;
  }

  return `${base}\n\nThis specific prompt's requirements:\n${constraints.map((c) => `- ${c}`).join('\n')}`;
}

const pickFallback = (): string => {
  const list = FALLBACK_PROMPTS.default;
  return list[Math.floor(Math.random() * list.length)];
};
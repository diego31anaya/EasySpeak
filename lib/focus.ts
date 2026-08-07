// lib/focus.ts
//
// Practice-focus presets — the "What you're working on" setting. A single-select
// goal the user picks; stored as a stable KEY in profiles.focus (null = not set /
// general, where the AI behaves as it does today). The key is decoupled from the
// label so renaming a label never orphans stored data.
//
// Each preset carries one line of `aiGuidance` fed into the feedback prompts. It
// tunes WHICH delivery dimensions the AI weights and which growth area it picks —
// it does NOT change the scoring rubric, and it stays about the speaker's own
// delivery (NO audience/listener framing — see the prompts' no-audience rule).
//
// NOTE: labels + guidance are PLACEHOLDER copy, to be finalized.

export type FocusId = 'interview' | 'conversation' | 'presentation' | 'storytelling';

export type FocusPreset = {
  id: FocusId;
  label: string;
  aiGuidance: string;
  // How this focus steers PROMPT generation — a neutral genre description the
  // generators wrap at the right strength (Impromptu as a hard "Mode:" constraint
  // that supersedes the opinion/story/pitch type; TTO as a soft tint kept strictly
  // subordinate to the shape rules). null = no prompt steer: prompts stay the
  // default conversational pool (the focus still tunes feedback via aiGuidance).
  promptGuidance: string | null;
};

export const FOCUS_PRESETS: FocusPreset[] = [
  {
    id: 'interview',
    label: 'Interviews',
    aiGuidance:
      'The speaker is working on interview-style answers. Weight concision and clear structure most, and be tougher on rambling, tangents, and filler use.',
    promptGuidance:
      "an interview-style question — behavioral or competency-based, about the speaker's experiences, decisions, or how they approach things (answerable by anyone, not tied to a specific job)",
  },
  {
    id: 'conversation',
    label: 'Everyday conversation',
    aiGuidance:
      'The speaker is working on everyday conversation. Weight a relaxed, natural, steady pace and low filler use; do not reward stiffness.',
    // No prompt steer — everyday conversation IS the default prompt register; this
    // focus differentiates on feedback only.
    promptGuidance: null,
  },
  {
    id: 'presentation',
    label: 'Presentations',
    aiGuidance:
      'The speaker is working on presentation delivery. Weight a steady, unrushed pace and deliberate pauses, and where emphasis lands.',
    promptGuidance:
      'a question that asks the speaker to explain a concept simply, or make the case for something',
  },
  {
    id: 'storytelling',
    label: 'Storytelling',
    aiGuidance:
      'The speaker is working on storytelling. Weight pitch variation and expressive, varied pacing, and pauses used for effect.',
    promptGuidance: 'a question that invites a personal story or vivid anecdote',
  },
];

const BY_ID = new Map(FOCUS_PRESETS.map((p) => [p.id, p]));

// Defensive lookups: an unknown / legacy / null key resolves to "no focus" so a
// stale value can never crash a render or inject garbage into the prompt.
export function focusPreset(focus: string | null | undefined): FocusPreset | null {
  return focus ? BY_ID.get(focus as FocusId) ?? null : null;
}

// The Settings row + picker display label. "Not set" when no (valid) focus.
export function focusLabel(focus: string | null | undefined): string {
  return focusPreset(focus)?.label ?? 'Not set';
}

// The line fed into the feedback prompts. Null → the prompt gets no Focus section.
export function focusGuidance(focus: string | null | undefined): string | null {
  return focusPreset(focus)?.aiGuidance ?? null;
}

// The genre steer for PROMPT generation. Null → no steer (default prompts). The
// generators decide how strongly to apply it (Impromptu hard, TTO soft).
export function focusPromptGuidance(focus: string | null | undefined): string | null {
  return focusPreset(focus)?.promptGuidance ?? null;
}
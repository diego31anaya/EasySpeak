// lib/practice-config.ts
//
// Catalog of Practice-tab content. Mirrors lib/impromptu-config.ts: arrays of
// records with a UI label + description. `href` is set only when a lesson
// has a real screen behind it — right now, only the 3-2-1 Framework
// (existing tto-explainer route). Every other lesson is press-only and
// logs to console until content is written.
//
// ALL COPY HERE IS PLACEHOLDER. Dev will rewrite category descriptions and
// lesson descriptions before shipping.

import type { SessionMode } from './sessions';

export type CategoryId = 'frameworks' | 'engagement' | 'delivery' | 'exercises';

export type Category = {
  id: CategoryId;
  label: string;
  description: string;
};

export type Lesson = {
  id: string;
  categoryId: CategoryId;
  label: string;
  description: string;
  // Route to navigate to when the row is pressed. Undefined → press handler
  // just logs.
  href?: string;
  // Ring score (1–10) or null for "not practiced". Runtime-derived from the
  // user's session history via withRealScore() below (keyed by LESSON_MODE) — the
  // live lessons carry NO static value. Only a fallback for a future UNMAPPED
  // lesson (one with no associated session mode). DEFERRED_LESSONS keep static
  // demo values since they never render.
  score?: number | null;
};

// v0 ships ONLY Frameworks. Engagement + Delivery are DEFERRED (preserved in
// DEFERRED_CATEGORIES / DEFERRED_LESSONS below) — intentionally NOT in these
// live arrays, so they never render and the hero card can't recommend a hidden
// lesson. To re-enable later, move the entry back into CATEGORIES and its
// lessons back into LESSONS.
export const CATEGORIES: Category[] = [
  // Interactive speaking exercises (not frameworks) — modes launched from the
  // Practice tab. Rendered FIRST, above Frameworks. Labels/description PLACEHOLDER.
  {
    id: 'exercises',
    label: 'Exercises',
    description: 'Try new speaking exercises.',
  },
  {
    id: 'frameworks',
    label: 'Frameworks',
    description: 'Templates to fall back on when your mind goes blank.',
  },
];

export const LESSONS: Lesson[] = [
  // Frameworks
  {
    id: 'three-two-one',
    categoryId: 'frameworks',
    label: '3-2-1 Framework',
    description: '1 Thing, 2 Types, or 3 Steps.',
    href: '/tto-explainer',
  },
  {
    id: 'prep',
    categoryId: 'frameworks',
    label: 'PREP',
    description: 'Point, Reason, Example, Point. Classic for opinions.',
    href: '/prep-explainer',
  },

  // Exercises (display order: Impromptu, Debate, Explain, Storytelling)
  {
    id: 'impromptu',
    categoryId: 'exercises',
    label: 'Impromptu',
    description: 'Answer a random question on the spot and get feedback.',
    href: '/impromptu',
  },
  {
    id: 'debate',
    categoryId: 'exercises',
    label: 'Debate',
    description: 'Argue a side of a statement and get feedback.',
    href: '/debate',
  },
  {
    id: 'explain',
    categoryId: 'exercises',
    label: 'Explain',
    description: 'Record yourself explaining a concept and get feedback.',
    href: '/explain',
  },
  {
    id: 'storytelling',
    categoryId: 'exercises',
    label: 'Storytelling',
    description: 'Record yourself telling a story and get feedback.',
    href: '/storytelling',
  },
];

// Lesson id → the session mode whose AI score fills that lesson's ring. Only the
// LIVE lessons (frameworks + exercises) map — DEFERRED_LESSONS have no mode. Note
// the deferred 'storytelling' (Engagement) shares this id with the live one, but
// it never renders, so the shared mapping is harmless.
export const LESSON_MODE: Record<string, SessionMode> = {
  'three-two-one': 'tto',
  prep: 'prep',
  debate: 'debate',
  explain: 'explain',
  storytelling: 'storytelling',
  impromptu: 'impromptu',
};

// The modes to query for the Practice tab (one getLessonScores call). Derived from
// LESSON_MODE so adding a mapped lesson extends the query automatically.
export const LESSON_MODES: SessionMode[] = Object.values(LESSON_MODE);

// Overlay the user's real per-mode score onto a lesson. A mapped lesson takes the
// fetched score (or null → empty ring when that mode has no scored session); an
// unmapped lesson keeps its static `score` fallback.
export function withRealScore(
  lesson: Lesson,
  scoresByMode: Partial<Record<SessionMode, number>>,
): Lesson {
  const mode = LESSON_MODE[lesson.id];
  return { ...lesson, score: mode ? (scoresByMode[mode] ?? null) : lesson.score };
}

// ============================================================
// DEFERRED — NOT shipped in v0. Engagement + Delivery, preserved for a later
// release. These arrays are intentionally UNUSED (nothing imports them), so
// they never render and don't affect any behavior. To ship a category, move
// its entry into CATEGORIES and its lessons into LESSONS above. Scores are
// placeholder (same as the live lessons).
// ============================================================
export const DEFERRED_CATEGORIES: Category[] = [
  {
    id: 'engagement',
    label: 'Engagement',
    description: 'How to be interesting, not just clear.',
  },
  {
    id: 'delivery',
    label: 'Delivery',
    description: 'The mechanical skills the practice metrics measure.',
  },
];

export const DEFERRED_LESSONS: Lesson[] = [
  // Engagement
  {
    id: 'hooks',
    categoryId: 'engagement',
    label: 'Hooks',
    description: 'How to open. Questions, stats, mini-stories.',
    score: 9,
  },
  {
    id: 'storytelling',
    categoryId: 'engagement',
    label: 'Storytelling basics',
    description: 'Setup, conflict, resolution.',
    score: 7,
  },
  {
    id: 'examples',
    categoryId: 'engagement',
    label: 'Using examples',
    description: 'Concrete beats abstract.',
    score: 6,
  },
  {
    id: 'analogies',
    categoryId: 'engagement',
    label: 'Analogies & metaphors',
    description: 'Bridge unfamiliar ideas to familiar ones.',
    score: 4,
  },
  {
    id: 'pacing-impact',
    categoryId: 'engagement',
    label: 'Pacing for impact',
    description: 'When to slow down or hold a pause.',
    score: 2,
  },

  // Delivery
  {
    id: 'pace',
    categoryId: 'delivery',
    label: 'Pace',
    description: 'When to slow down, when to speed up.',
    score: 1,
  },
  {
    id: 'intonation',
    categoryId: 'delivery',
    label: 'Intonation',
    description: 'Pitch variation. Monotone vs dynamic.',
    score: null,
  },
  {
    id: 'fillers',
    categoryId: 'delivery',
    label: 'Filler words',
    description: "Catching 'um' and 'uh'; replacing them with pauses.",
    score: 8,
  },
  {
    id: 'pauses',
    categoryId: 'delivery',
    label: 'Pauses',
    description: 'Strategic pause vs hesitation pause.',
    score: 6,
  },
  {
    id: 'volume',
    categoryId: 'delivery',
    label: 'Volume & projection',
    description: 'Being heard without yelling.',
    score: null,
  },
];

// ============================================================
// Hero card state
//
// The Practice tab renders a hero card at the top that surfaces the recommended
// next lesson. Pure function of the passed lessons (+ the CATEGORIES display
// order) — no persistent "last opened" storage. The "next" lesson is the first
// unmastered one in the SAME top-to-bottom order the tab renders (categories in
// CATEGORIES order, lessons within each in array order), so the recommendation
// always matches what the user sees first. Card hides once everything is mastered.
// ============================================================

export type HeroState =
  | { kind: 'start'; lesson: Lesson }
  | { kind: 'up-next'; lesson: Lesson }
  | { kind: 'retry'; lesson: Lesson }
  | { kind: 'hidden' };

export function computeHeroState(lessons: Lesson[]): HeroState {
  // Walk lessons in the tab's render order (categories top-to-bottom, lessons within
  // each in array order) — mirrors the CATEGORIES.map + filter in practice.tsx — so
  // "first unmastered" is the first one the user actually sees, not raw array order.
  const ordered = CATEGORIES.flatMap((cat) =>
    lessons.filter((l) => l.categoryId === cat.id),
  );

  const firstUnmastered = ordered.find((l) => l.score == null || l.score < 8);
  if (!firstUnmastered) return { kind: 'hidden' };

  const hasAnyScore = ordered.some((l) => l.score != null);
  if (!hasAnyScore) return { kind: 'start', lesson: firstUnmastered };

  if (firstUnmastered.score == null) {
    return { kind: 'up-next', lesson: firstUnmastered };
  }
  return { kind: 'retry', lesson: firstUnmastered };
}
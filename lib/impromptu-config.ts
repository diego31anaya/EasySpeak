// lib/impromptu-config.ts
// Source of truth for impromptu practice topics and types.
// Each entry has a UI label and an LLM-facing description that gets
// injected into the prompt generator's system prompt.

export type TimeId = '60' | '90' | '120';

type TimeEntry = {
  id: TimeId;
  label: string;
  seconds: number;
}

export const TIMES: TimeEntry[] = [
  { id: '60', label: '60 seconds', seconds: 60 },
  { id: '90', label: '90 seconds', seconds: 90 },
  { id: '120', label: '2 minutes', seconds: 120 },
]

export const getTime = (id: TimeId): TimeEntry =>
  TIMES.find((t) => t.id === id)!;

export type TopicId =
  | 'everyday'
  | 'relationships'
  | 'work'
  | 'hobbies'
  | 'personal_growth'
  | 'philosophy';

export type TypeId = 'opinion' | 'story' | 'pitch';

type TopicEntry = {
  id: TopicId;
  label: string;
  llmDescription: string;
};

type TypeEntry = {
  id: TypeId;
  label: string;
  llmDescription: string;
};

export const TOPICS: TopicEntry[] = [
  {
    id: 'everyday',
    label: 'Everyday',
    llmDescription:
      'everyday life — habits, food, sleep, weekends, small moments anyone can relate to',
  },
  {
    id: 'relationships',
    label: 'Relationships',
    llmDescription:
      'friendships, family, dating, or any human connection — keep it broad, not just romantic',
  },
  {
    id: 'work',
    label: 'Work',
    llmDescription:
      'work, career, ambition, or workplace dynamics — accessible regardless of profession',
  },
  {
    id: 'hobbies',
    label: 'Hobbies',
    llmDescription:
      'hobbies, interests, side projects, or things people do for fun',
  },
  {
    id: 'personal_growth',
    label: 'Personal Growth',
    llmDescription:
      'self-improvement, change, learning, regret, or becoming a different version of yourself',
  },
  {
    id: 'philosophy',
    label: 'Philosophy',
    llmDescription:
      'meaning, ethics, identity, free will, or questions about how to live — keep it accessible, not academic',
  },
];

export const TYPES: TypeEntry[] = [
  {
    id: 'opinion',
    label: 'Opinion',
    llmDescription:
      'asks the user to take a clear position. Use phrasing like "Should...", "Is X overrated?", "Are people right to...". Must be debatable, not factual.',
  },
  {
    id: 'story',
    label: 'Story',
    llmDescription:
      'asks the user to tell a personal story. Use phrasing like "Tell me about a time when...", "Describe when you...". Must invite a narrative, not an opinion.',
  },
  {
    id: 'pitch',
    label: 'Pitch',
    llmDescription:
      'asks the user to convince the listener of something. Use phrasing like "Pitch me on...", "Convince me to...", "Sell me on...". Must require persuasion, not just description.',
  },
];

export const getTopic = (id: TopicId): TopicEntry =>
  TOPICS.find((t) => t.id === id)!;

export const getType = (id: TypeId): TypeEntry =>
  TYPES.find((t) => t.id === id)!;
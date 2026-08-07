// lib/explain-seeds.ts
//
// Domain/context seeds for Explain topic generation. Each generation picks one at random
// and hands it to the model as the SUBJECT AREA for a "concept to explain" (the phrase
// itself need not appear). Same anti-repeat technique as lib/prep-seeds.ts /
// lib/debate-seeds.ts: an unseeded model collapses to the same handful of topics, so
// spreading generation across domains keeps them fresh.
//
// Curation: each seed should be an area with concrete, explainable concepts a curious
// non-expert could take a real shot at (so there's something to actually explain). Civil,
// everyday, general-knowledge. PLACEHOLDER set — grow/tune freely.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const EXPLAIN_SEEDS: readonly string[] = [
  // Science & nature
  'a natural phenomenon',
  'a basic science concept',
  'how the human body works',
  'something about space or astronomy',
  'why the weather does what it does',
  'a concept from biology',
  'a concept from physics or chemistry',
  // Everyday how-it-works
  'how an everyday technology works',
  'how something in your home works',
  'how the internet or a computer works',
  // Money & society
  'how something in money or finance works',
  'how a part of the economy works',
  'how a part of government or law works',
  'how an everyday service works',
  // Rules & systems
  'the rules of a game or sport',
  'a common process, step by step',
  // Mind & ideas
  'a concept from psychology',
  'why people behave a certain way',
  'an abstract or philosophical idea',
  // History & world
  'a historical event and why it happened',
  'how something in the world came to be',
  'a cultural tradition and its origin',
  // Practical
  'how a skill or craft works',
  'why a common everyday thing happens',
  // Health & food
  'how something about health or the body works',
  'how something about food or cooking works',
];

// Don't reuse a seed until ~RECENT_MAX generations later, persisted across launches.
const RECENT_KEY = 'explain.recentSeeds';
const RECENT_MAX = 16;

// Own in-memory cache (separate from impromptu/debate/prep seeds).
let recent: string[] | null = null;

async function getRecent(): Promise<string[]> {
  if (recent) return recent;
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    recent = raw ? JSON.parse(raw) : [];
  } catch {
    recent = [];
  }
  return recent!;
}

// Pick a seed that wasn't among the last RECENT_MAX used, then record it. Falls back to
// the full pool if every seed was used recently, so it never deadlocks.
export async function takeExplainSeed(): Promise<string> {
  const used = await getRecent();
  const usedSet = new Set(used);
  const fresh = EXPLAIN_SEEDS.filter((s) => !usedSet.has(s));
  const pool = fresh.length > 0 ? fresh : EXPLAIN_SEEDS;
  const seed = pool[Math.floor(Math.random() * pool.length)];

  recent = [seed, ...used.filter((s) => s !== seed)].slice(0, RECENT_MAX);
  AsyncStorage.setItem(RECENT_KEY, JSON.stringify(recent)).catch(() => {});
  return seed;
}
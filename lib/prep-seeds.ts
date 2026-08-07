// lib/prep-seeds.ts
//
// Domain/context seeds for PREP practice-prompt generation. Each generation picks one
// at random and hands it to the model as the SUBJECT AREA for a "make a point / make a
// case" scenario (the phrase itself need not appear). Same anti-repeat technique as
// lib/debate-seeds.ts / lib/impromptu-seeds.ts: an unseeded model collapses to the same
// few prompts, so spreading generation across domains keeps them fresh.
//
// Curation: each seed should be an area where a person could reasonably advocate for a
// change / hold an opinion / recommend something (so PREP's Point→Reason→Example→Point
// has somewhere to go). Civil, everyday. PLACEHOLDER set — grow/tune freely.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const PREP_SEEDS: readonly string[] = [
  // Work
  'a change at your workplace',
  'a productivity habit worth adopting',
  'a way teams should communicate',
  'a meeting or workflow norm',
  'remote vs in-person work',
  'a skill worth learning for your career',
  // Habits & self-improvement
  'a daily habit everyone should try',
  'a morning or evening routine',
  'a piece of life advice',
  'a way to stay motivated',
  'a way to make better decisions',
  // Technology
  'a technology people should use more (or less)',
  'a way to use AI in daily life',
  'a healthier relationship with your phone',
  'a social media habit',
  // Health & money
  'a health or fitness habit',
  'a food or diet choice',
  'a money or saving habit',
  'a spending decision worth rethinking',
  // Learning & culture
  'a better way to learn something',
  'a book, show, or hobby worth recommending',
  'a way to spend free time well',
  'a travel or vacation choice',
  // Society & lifestyle
  'a small change that would improve daily life',
  'a convenience that is worth it (or not)',
  'a community or environmental habit',
  'the city vs small-town tradeoff',
  'a way schools should change',
  'a norm around work-life balance',
];

// Don't reuse a seed until ~RECENT_MAX generations later, persisted across launches.
const RECENT_KEY = 'prep.recentSeeds';
const RECENT_MAX = 16;

// Own in-memory cache (separate from impromptu/debate seeds).
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
export async function takePrepSeed(): Promise<string> {
  const used = await getRecent();
  const usedSet = new Set(used);
  const fresh = PREP_SEEDS.filter((s) => !usedSet.has(s));
  const pool = fresh.length > 0 ? fresh : PREP_SEEDS;
  const seed = pool[Math.floor(Math.random() * pool.length)];

  recent = [seed, ...used.filter((s) => s !== seed)].slice(0, RECENT_MAX);
  AsyncStorage.setItem(RECENT_KEY, JSON.stringify(recent)).catch(() => {});
  return seed;
}
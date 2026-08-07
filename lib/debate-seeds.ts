// lib/debate-seeds.ts
//
// Domain/angle seeds for debate-statement generation. Each generation picks one at
// random and hands it to the model as the SUBJECT AREA for a debatable claim (the
// phrase itself need not appear in the statement). This is the same anti-repeat
// technique as lib/impromptu-seeds.ts: an unseeded model collapses to the same five
// motions ("social media is bad", "homework should be abolished", …), so spreading
// generation across domains keeps statements fresh.
//
// Curation rules: each seed should be a domain where reasonable people genuinely
// disagree and BOTH sides are defensible. Civil, but substantive is welcome — everyday
// life AND big-picture debate-club topics (economic systems, government, society,
// ethics, philosophy), e.g. capitalism vs socialism. Keep even the big ones ABSTRACT:
// no CURRENT partisan politics (parties, politicians, elections), culture-war identity
// flashpoints, religion as a truth claim, tragedy/violence, or targeting a group (the
// generator's system prompt is a backstop, but keep the pool clean at the source).
// PLACEHOLDER set — grow/tune freely.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const DEBATE_SEEDS: readonly string[] = [
  // Work & productivity
  'a common productivity habit',
  'a workplace norm',
  'the remote vs in-person work tradeoff',
  'a workplace-meeting convention',
  'a career or job-hopping choice',
  'a way people try to stay motivated',
  // Technology & screens
  'a technology most people use daily',
  'a habit around phones or screens',
  'a social media behavior',
  'AI or automation in everyday life',
  'a subscription vs ownership choice',
  'a smart device in the home',
  // Education & learning
  'a school or education practice',
  'a way schools grade or test students',
  'a study or learning method',
  'the value of a college degree',
  // Lifestyle & habits
  'a modern convenience',
  'a morning or daily routine',
  'a self-improvement idea',
  'a piece of popular life advice',
  'a way people make decisions',
  'an everyday etiquette rule',
  // Health & food
  'a health or fitness trend',
  'a food or diet habit',
  'cooking at home vs eating out',
  'a fitness or exercise approach',
  // Money
  'a money or spending habit',
  'a shopping habit',
  'renting vs buying',
  // Culture & free time
  'a form of entertainment (TV, games, movies)',
  'a hobby or pastime',
  'a holiday or tradition practice',
  'a way people spend their free time',
  'a sports or competition norm',
  'a form of art or creative expression',
  // Social & relationships
  'a dating or relationship norm',
  'a parenting or family norm',
  'a communication habit (texting, calling, email)',
  // Place & environment
  'the city vs small-town tradeoff',
  'a commuting or driving norm',
  'an everyday environmental habit',
  // More everyday
  'a travel or vacation choice',
  'a pet or animal-ownership norm',
  'a fashion or dress-code norm',
  'an online etiquette rule',
  'a home or living-space choice',
  'a reading or news-consumption habit',
  // Big ideas — society, economics, government, ethics, philosophy (debate-club level;
  // kept ABSTRACT and civil, NOT current partisan politics or culture-war flashpoints)
  'an economic system (capitalism, socialism, communism)',
  'capitalism and its alternatives',
  'the role of government in everyday life',
  'a form of government (democracy and its alternatives)',
  'wealth and inequality',
  'individual freedom vs the collective good',
  'globalization and its tradeoffs',
  'universal basic income',
  'whether major public services should be free',
  'meritocracy and whether it truly works',
  'whether technology is making society better or worse',
  'the purpose of work in a good life',
  'a big ethical question (honesty, fairness, freedom)',
  'a philosophical question about human nature',
];

// Don't reuse a seed until ~RECENT_MAX generations later, persisted across launches.
// ~half the pool → strong spread without ever deadlocking.
const RECENT_KEY = 'debate.recentSeeds';
const RECENT_MAX = 30;

// In-memory cache (own variable, separate from impromptu-seeds) so only the first
// call per launch touches storage.
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

// Pick a seed that wasn't among the last RECENT_MAX used, then record it. Falls back
// to the full pool if every seed was used recently, so it never deadlocks.
export async function takeDebateSeed(): Promise<string> {
  const used = await getRecent();
  const usedSet = new Set(used);
  const fresh = DEBATE_SEEDS.filter((s) => !usedSet.has(s));
  const pool = fresh.length > 0 ? fresh : DEBATE_SEEDS;
  const seed = pool[Math.floor(Math.random() * pool.length)];

  recent = [seed, ...used.filter((s) => s !== seed)].slice(0, RECENT_MAX);
  AsyncStorage.setItem(RECENT_KEY, JSON.stringify(recent)).catch(() => {});
  return seed;
}
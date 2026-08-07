// lib/impromptu-seeds.ts
//
// A large, deliberately eclectic pool of "seed words" for impromptu prompt
// generation. Each generation picks one at random and hands it to the model as
// a creative spark (it need not appear in the final prompt). This is the
// random-word-generator technique: it explodes the variety space from the old
// 6-topic × 3-type = 18 anchors to hundreds, so the model is pushed somewhere
// specific and fresh each call instead of recycling its most-common questions.
//
// Curation rules for adding words: concrete and evocative beats abstract and
// generic; everything must be answerable by anyone and steer clear of sensitive
// territory (no politics, religion, death, illness, tragedy) — the generator's
// system prompt is a backstop, but keep the pool clean at the source.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const SEED_WORDS: readonly string[] = [
  // Objects & everyday things
  'umbrella', 'lighthouse', 'backpack', 'compass', 'candle', 'mirror', 'keys',
  'ladder', 'lantern', 'telescope', 'vinyl record', 'polaroid', 'typewriter',
  'suitcase', 'hammock', 'kite', 'marbles', 'kaleidoscope', 'snow globe',
  'music box', 'jigsaw puzzle', 'paper airplane', 'fountain pen', 'pocket watch',
  'magnet', 'balloon', 'bubble wrap', 'postcard', 'seashell', 'feather',
  'wind chime', 'lava lamp', 'disco ball', 'neon sign', 'vending machine',
  'jukebox', 'treasure map', 'message in a bottle', 'scrapbook', 'recipe card',
  'fortune cookie', 'sticky notes', 'to-do list', 'spare change', 'house plant',
  'old photographs', 'a handwritten letter', 'a souvenir', 'a time capsule',
  // Food & drink
  'pancakes', 'a midnight snack', 'leftovers', 'street food', 'comfort food',
  'spicy food', 'ice cream', 'coffee', 'lemonade', 'a picnic', 'a barbecue',
  'birthday cake', 'homemade bread', 'breakfast', 'dessert', 'a home-cooked meal',
  'a secret recipe', 'a food you used to hate', 'a guilty pleasure snack',
  // Places & settings
  'the airport', 'a train station', 'a rooftop', 'an attic', 'a treehouse',
  'a library', 'a bookstore', 'a farmers market', 'a flea market', 'an arcade',
  'a carnival', 'an aquarium', 'a museum', 'an observatory', 'a campsite',
  'a cabin in the woods', 'the beach', 'a tide pool', 'a waterfall', 'a meadow',
  'a forest trail', 'a mountain summit', 'a small town', 'a big city', 'an island',
  'a harbor', 'an old bridge', 'a hidden garden', 'a greenhouse', 'a front porch',
  'a diner', 'a corner store', 'a laundromat', 'an elevator', 'a gas station',
  'a rest stop', 'a scenic overlook', 'a quiet street at night',
  // Nature & phenomena
  'a thunderstorm', 'lightning', 'a rainbow', 'sunrise', 'sunset', 'fog',
  'the first snow', 'autumn leaves', 'a full moon', 'a shooting star',
  'the northern lights', 'fireflies', 'the tide', 'an echo', 'your shadow',
  'a reflection', 'a warm breeze', 'a heatwave', 'thunder', 'morning dew',
  // Activities & experiences
  'a road trip', 'camping', 'stargazing', 'people-watching', 'daydreaming',
  'doodling', 'gardening', 'baking', 'a long hike', 'a swim', 'dancing',
  'karaoke', 'board games', 'thrifting', 'collecting something', 'a surprise party',
  'a reunion', 'the first day of something', 'the last day of something',
  'moving house', 'getting lost', 'a wrong turn', 'a detour', 'a shortcut',
  'a comeback', 'a fresh start', 'a do-over', 'a leap of faith', "beginner's luck",
  'trial and error', 'an unexpected detour', 'learning to ride a bike',
  // Time & life
  'childhood', 'growing up', 'the future', 'the good old days', 'a milestone',
  'an anniversary', 'a birthday', 'a new year', 'mondays', 'weekends',
  'summer break', 'school days', 'your twenties', 'bedtime', 'early mornings',
  'late nights', 'a lazy afternoon', 'waiting rooms', 'a deadline', 'free time',
  'a slow day', 'the night before a big day',
  // Social & culture
  'nicknames', 'inside jokes', 'small talk', 'first impressions', 'a compliment',
  'an apology', 'a secret', 'good advice', 'a reputation', 'a trend',
  'a role model', 'a mentor', 'a stranger', 'neighbors', 'teamwork',
  'a friendly rivalry', 'a fan favorite', 'a local legend', 'a family tradition',
  'a superstition', 'an old saying', 'a rumor', 'a first meeting',
  // Quirks & specifics
  'the snooze button', 'autocorrect', 'a group chat', 'an old voicemail',
  'the last slice', 'the aux cord', 'the shotgun seat', 'the middle seat',
  'waiting in line', 'elevator music', 'hold music', 'a lost sock',
  'tangled headphones', 'a dead phone battery', 'a flickering light',
  'a squeaky door', 'a stuck zipper', 'a jar that won\'t open', 'a wobbly table',
  // Skills & small talents
  'handwriting', 'whistling', 'juggling', 'origami', 'reading a map',
  'mental math', 'memorizing things', 'telling a joke', 'keeping a secret',
  'parallel parking', 'packing a suitcase', 'wrapping a gift',
  // Travel
  'a passport', 'jet lag', 'a layover', 'a foreign language', 'a tourist trap',
  'a hidden gem', 'backpacking', 'a solo trip', 'a map of somewhere new',
  // Abstract but relatable
  'nostalgia', 'curiosity', 'patience', 'luck', 'ambition', 'boredom',
  'courage', 'gratitude', 'wonder', 'serendipity', 'spontaneity', 'momentum',
  'hindsight', 'intuition', 'willpower', 'balance', 'simplicity', 'coziness',
  'a routine', 'a ritual', 'a habit', 'an instinct', 'imagination',
  'confidence', 'generosity', 'optimism', 'persistence', 'a fresh perspective',
  // Money & work (light)
  'a first paycheck', 'a side project', 'a splurge', 'a great bargain',
  'saving up', 'a tip jar', 'a lucky find', 'a fixer-upper',
];

// Don't reuse a seed until ~RECENT_MAX prompts later, persisted across launches
// so repeats stay rare session-to-session (the actual complaint).
const RECENT_KEY = 'impromptu.recentSeeds';
const RECENT_MAX = 50;

// In-memory cache so only the first call per launch touches storage.
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

// Pick a seed word that wasn't among the last RECENT_MAX used, then record it.
// When every word has been used recently (pool smaller than RECENT_MAX, or a
// long streak), it falls back to the full pool so it never deadlocks.
export async function takeSeedWord(): Promise<string> {
  const used = await getRecent();
  const usedSet = new Set(used);
  const fresh = SEED_WORDS.filter((w) => !usedSet.has(w));
  const pool = fresh.length > 0 ? fresh : SEED_WORDS;
  const word = pool[Math.floor(Math.random() * pool.length)];

  recent = [word, ...used.filter((w) => w !== word)].slice(0, RECENT_MAX);
  AsyncStorage.setItem(RECENT_KEY, JSON.stringify(recent)).catch(() => {});
  return word;
}
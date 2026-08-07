// lib/dev-streak.ts
//
// DEV-only streak test helpers, wired to the Placeholder tab. They poke the
// profiles streak counter directly (RLS scopes the update to the signed-in user's
// own row) so we can exercise the streak feature without waiting real days.
// Delete alongside the dev seeder once the streak is device-verified.
//
// NOTE: these are the only client-side writes to `profiles` in the app, so they
// depend on profiles having an own-row UPDATE RLS policy. updateOwnProfile uses
// `.select()` + a 0-row guard so a missing policy fails LOUDLY (a clear error)
// instead of silently no-op'ing under RLS.

import { supabase } from './supabase';
import { deviceLocalDate, getStreak } from './streak';

async function updateOwnProfile(userId: string, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(
      'profiles update affected 0 rows — the table likely lacks an own-row UPDATE RLS policy (the dev streak tools need one).',
    );
  }
}

/** Reset the streak to "never started": current=0, longest=0, last_active=null. */
export async function devClearStreak(userId: string): Promise<void> {
  await updateOwnProfile(userId, {
    current_streak: 0,
    longest_streak: 0,
    last_active_date: null,
  });
}

/**
 * Simulate one day passing WITHOUT practicing by moving last_active_date back a
 * day (the stored count is left as-is — exactly what a real missed day looks like
 * before the next practice). Press once → last_active becomes "yesterday" (streak
 * still alive); press again → "2 days ago" so the read derives 0 (lapsed). A real
 * practice afterward then resets the streak to 1. Returns the new date, or null if
 * there's no streak to skip yet. Handles month/year boundaries via Date rollover.
 */
export async function devSkipDay(userId: string): Promise<string | null> {
  const { lastActiveDate } = await getStreak();
  if (!lastActiveDate) return null;
  const [y, m, d] = lastActiveDate.split('-').map(Number);
  const prev = new Date(y, m - 1, d); // local midnight of last_active_date
  prev.setDate(prev.getDate() - 1); // -1 day, rolls month/year correctly
  const next = deviceLocalDate(prev);
  await updateOwnProfile(userId, { last_active_date: next });
  return next;
}

/** Set a streak of N days ending today — quick visual test of the badge. */
export async function devSetStreak(userId: string, n: number): Promise<void> {
  await updateOwnProfile(userId, {
    current_streak: n,
    longest_streak: n,
    last_active_date: deviceLocalDate(),
  });
}

/** The device's local date N days ago, 'YYYY-MM-DD' (0 = today, 1 = yesterday). */
function localDateDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return deviceLocalDate(d);
}

// The 7 streaks-modal states from the state table, IN ORDER, as concrete streak
// data to apply. `daysAgo` is how long since last activity (0 = today, 1 =
// yesterday, null = never) — computed to a real date at apply time so it's always
// fresh. Each row's (current, longest, daysAgo) lands the streakState() classifier
// in exactly that state.
export type StreakScenario = {
  label: string;
  current: number;
  longest: number;
  daysAgo: number | null;
};

export const STREAK_SCENARIOS: StreakScenario[] = [
  { label: '1. New — no streak ever', current: 0, longest: 0, daysAgo: null },
  { label: '2. Lapsed — has a best', current: 5, longest: 12, daysAgo: 3 },
  { label: '3. Lapsed — trivial (best 1)', current: 1, longest: 1, daysAgo: 3 },
  { label: '4. Alive — at risk (yesterday)', current: 5, longest: 10, daysAgo: 1 },
  { label: '5. Alive — done today, Day 1', current: 1, longest: 1, daysAgo: 0 },
  { label: '6. Alive — done today, ongoing', current: 5, longest: 12, daysAgo: 0 },
  { label: '7. Alive — done today, best', current: 12, longest: 12, daysAgo: 0 },
];

/** Apply one scenario to the profile so the Streaks modal renders that state. */
export async function devApplyScenario(userId: string, sc: StreakScenario): Promise<void> {
  await updateOwnProfile(userId, {
    current_streak: sc.current,
    longest_streak: sc.longest,
    last_active_date: sc.daysAgo === null ? null : localDateDaysAgo(sc.daysAgo),
  });
}
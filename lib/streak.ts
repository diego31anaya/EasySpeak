// lib/streak.ts
//
// Daily streak: read side + the device-local-date helper used by both the save
// path (the immutable day-bucket on a session) and the read path (deriving
// whether the cached streak is still alive). The counter itself lives on
// `profiles`. The first unconfirmed session of a local day advances it through
// `save_session_with_streak`; later same-day sessions use the normal insert.
//
// Pure + dependency-light (only `./supabase`) so `lib/sessions.ts` can import
// `deviceLocalDate` without a cycle (streak.ts never imports sessions.ts).

import { supabase } from './supabase';

/**
 * The device's LOCAL calendar date as 'YYYY-MM-DD'. Local-tz, not UTC — only the
 * device knows its timezone and the streak counts "consecutive local days".
 * `en-CA` formats as ISO YYYY-MM-DD and is Hermes-safe (Intl.DateTimeFormat is
 * supported in Hermes; only Intl.Segmenter is not). The regex-guarded manual
 * fallback means this can never return a non-ISO string.
 */
export function deviceLocalDate(d: Date = new Date()): string {
  const iso = d.toLocaleDateString('en-CA'); // 'YYYY-MM-DD' in the device tz
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export type Streak = {
  current: number; // raw cached current_streak from the profile (may be stale)
  longest: number;
  lastActiveDate: string | null; // 'YYYY-MM-DD' or null (never practiced)
};

/** Read the cached streak counter off the signed-in user's profile (RLS-scoped). */
export async function getStreak(): Promise<Streak> {
  const { data: authData, error: authError } = await supabase.auth.getSession();
  if (authError) throw authError;

  const userId = authData.session?.user.id;
  if (!userId) throw new Error('Not signed in — cannot read streak.');

  const { data, error } = await supabase
    .from('profiles')
    .select('current_streak, longest_streak, last_active_date')
    // RLS is the security boundary; this explicit predicate also ensures the
    // read asks PostgREST for only the currently authenticated profile row.
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return {
    current: data?.current_streak ?? 0,
    longest: data?.longest_streak ?? 0,
    lastActiveDate: data?.last_active_date ?? null,
  };
}

// The streaks-modal display states (see the streaks state table). Derived entirely
// from the stored counter + the device's local today — no extra data.
export type StreakState =
  | { kind: 'new' } // never practiced
  | { kind: 'lapsedTrivial' } // lapsed and the best was only 1 day (treat like new)
  | { kind: 'lapsed'; longest: number } // lapsed with a real best to show
  | { kind: 'atRisk'; current: number; longest: number; isRecord: boolean } // last = yesterday
  | { kind: 'doneToday'; current: number; longest: number; isRecord: boolean; isDayOne: boolean };

/**
 * The daily practice-reminder notification copy for the user's current streak
 * state — three buckets (mirrors the modal's aliveCopy tone):
 *   A — no active streak (new / lapsedTrivial / lapsed) → nudge to start one.
 *   B — atRisk (streak alive, not practiced today) → keep the N-day streak going.
 *   C — doneToday (already practiced today) → keep improving.
 * Consumed by lib/notifications.ts to build the notification content (baked at
 * schedule time; the reschedule triggers there keep it fresh). Pure.
 * COPY IS PLACEHOLDER (dev to finalize).
 */
export function reminderCopy(s: StreakState): { title: string; body: string } {
  switch (s.kind) {
    case 'atRisk': // B — streak in danger
      return {
        title: 'Keep your streak alive',
        body: `Practice today to keep your ${s.current}-day streak going.`,
      };
    case 'doneToday': // C — already practiced today (don't acknowledge it — just nudge more practice)
      return {
        title: 'Keep practicing',
        body: 'A quick session keeps your skills sharp.',
      };
    default: // A — no active streak (new / lapsedTrivial / lapsed)
      return {
        title: 'Ready to practice?',
        body: 'Do a quick session to start a streak.',
      };
  }
}

// What saving a session TODAY did to the streak — drives the results-screen banner.
// `none` = the day was already counted (a same-day repeat practice), so nothing
// started or continued and no banner shows.
export type StreakEvent =
  | { kind: 'started'; count: number } // this practice began a new streak (day 1)
  | { kind: 'continued'; count: number } // extended an existing streak
  | { kind: 'none' };
/**
 * Returns the calendar day immediately before a YYYY-MM-DD label.
 *
 * UTC is only used for date-component arithmetic. This is not converting a
 * local instant to UTC, so DST cannot create a 23/25-hour-day error.
 */
export function previousLocalDay(localDay: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDay);

  if (!match) {
    throw new Error(`Invalid local day: ${localDay}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(Date.UTC(year, month - 1, day, 12));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid local day: ${localDay}`);
  }

  date.setUTCDate(date.getUTCDate() - 1);

  return date.toISOString().slice(0, 10);
}

export function liveStreakCount(streak: Streak, localDay: string): number {
  if (!streak.lastActiveDate || streak.current <= 0) {
    return 0;
  }

  const previousDay = previousLocalDay(localDay);

  return streak.lastActiveDate === localDay || streak.lastActiveDate === previousDay
    ? streak.current
    : 0;
}

export function streakState(streak: Streak, localDay: string): StreakState {
  const last = streak.lastActiveDate;

  if (!last) {
    return { kind: 'new' };
  }

  const previousDay = previousLocalDay(localDay);

  if (last === localDay) {
    return {
      kind: 'doneToday',
      current: streak.current,
      longest: streak.longest,
      isRecord:
        streak.current > 1 &&
        streak.current === streak.longest,
      isDayOne: streak.current === 1,
    };
  }

  if (last === previousDay) {
    return {
      kind: 'atRisk',
      current: streak.current,
      longest: streak.longest,
      isRecord:
        streak.current > 1 &&
        streak.current === streak.longest,
    };
  }

  if (streak.longest <= 1) {
    return { kind: 'lapsedTrivial' };
  }

  return {
    kind: 'lapsed',
    longest: streak.longest,
  };
}

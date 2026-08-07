// lib/streak.ts
//
// Daily streak: read side + the device-local-date helper used by both the save
// path (the immutable day-bucket on a session) and the read path (deriving
// whether the cached streak is still alive). The counter itself lives on
// `profiles` and is maintained by an AFTER INSERT trigger on `sessions` — see
// supabase/migrations/*_add_local_date_and_streak_trigger.sql.
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

/** 'YYYY-MM-DD' for the device's local yesterday (used by the aliveness check). */
function yesterdayLocalDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return deviceLocalDate(d);
}

export type Streak = {
  current: number; // raw cached current_streak from the profile (may be stale)
  longest: number;
  lastActiveDate: string | null; // 'YYYY-MM-DD' or null (never practiced)
};

/** Read the cached streak counter off the signed-in user's profile (RLS-scoped). */
export async function getStreak(): Promise<Streak> {
  const { data, error } = await supabase
    .from('profiles')
    .select('current_streak, longest_streak, last_active_date')
    .maybeSingle();
  if (error) throw error;
  return {
    current: data?.current_streak ?? 0,
    longest: data?.longest_streak ?? 0,
    lastActiveDate: data?.last_active_date ?? null,
  };
}

/**
 * The streak count to DISPLAY. The cached counter goes stale after a missed day
 * (nothing decrements it until the next practice resets it), so derive aliveness
 * on read: show `current` only if the last active local day is today or yesterday
 * — otherwise the streak has lapsed → 0. No cron, no stored boolean.
 */
export function liveStreakCount(s: Streak): number {
  if (!s.lastActiveDate || s.current <= 0) return 0;
  const today = deviceLocalDate();
  const yesterday = yesterdayLocalDate();
  return s.lastActiveDate === today || s.lastActiveDate === yesterday ? s.current : 0;
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
 * Classify the streak for the modal. Mutually exclusive on where last_active sits
 * relative to today (null / today / yesterday / older); the current-vs-longest
 * checks split the "done today" and "lapsed" buckets. `isRecord` = the current run
 * is the all-time best; `isDayOne` = a brand-new (or just-restarted) streak.
 */
export function streakState(s: Streak): StreakState {
  const last = s.lastActiveDate;
  if (!last) return { kind: 'new' };

  const today = deviceLocalDate();
  const yesterday = yesterdayLocalDate();

  if (last === today) {
    return {
      kind: 'doneToday',
      current: s.current,
      longest: s.longest,
      isRecord: s.current > 1 && s.current === s.longest,
      isDayOne: s.current === 1,
    };
  }
  if (last === yesterday) {
    return {
      kind: 'atRisk',
      current: s.current,
      longest: s.longest,
      isRecord: s.current > 1 && s.current === s.longest,
    };
  }

  // last is 2+ days ago → lapsed.
  if (s.longest <= 1) return { kind: 'lapsedTrivial' };
  return { kind: 'lapsed', longest: s.longest };
}

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
 * Classify the streak event from the snapshot taken BEFORE this session's insert
 * (the AFTER INSERT trigger bumps the counter, so we read the pre-insert state and
 * mirror the trigger's rules against the device's local today):
 *   last == today      → already counted today → no change (`none`).
 *   last == yesterday  → +1 day → `continued` (new count = before + 1).
 *   null / a 2+ day gap → reset to day 1 → `started`.
 */
export function classifyStreakEvent(before: Streak): StreakEvent {
  const last = before.lastActiveDate;
  if (last === deviceLocalDate()) return { kind: 'none' };
  if (last === yesterdayLocalDate() && before.current >= 1) {
    return { kind: 'continued', count: before.current + 1 };
  }
  return { kind: 'started', count: 1 };
}
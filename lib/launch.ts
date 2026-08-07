// lib/launch.ts
//
// First-paint data for the Home tab, prefetched DURING the splash so the streak
// badge and the Recent feed render with real data instead of grey-0 / a skeleton on
// launch. The root AppReadyGate (app/_layout.tsx) awaits prefetchLaunchData() before
// it reveals the app; `StreakProvider` and the Home screen (`(tabs)/index.tsx`, via
// `consumeLaunchSessions`) consume the cached values as their initial state.
//
// Consume-once (cleared on read): under a normally completed prefetch, only the
// first mount seeds from these and later mounts fetch on focus. The existing 4s
// AppReadyGate timeout can still permit a late write after consumption; that
// generation-keying follow-up is documented in CLAUDE.md.

import { getStreak, type Streak } from './streak';
import { listSessions, type SessionListItem } from './sessions';

// How many recent sessions to prefetch for the Home Recent feed's first paint. The
// Home shows 4 and refetches a 20-row window on focus; this seed just covers the
// cold-start flash. (Bump toward 20 if you want the week strip instant on launch too.)
const RECENT_LIMIT = 5;

let launchStreak: Streak | null = null;
let launchSessions: SessionListItem[] | null = null;

// Best-effort: each half swallows its own error (the components re-fetch on focus
// regardless), and the whole thing resolves once both settle so the splash can lift.
export async function prefetchLaunchData(): Promise<void> {
  await Promise.all([
    getStreak()
      .then((streak) => {
        launchStreak = streak;
      })
      .catch((e) => console.warn('[launch] streak prefetch failed:', e)),
    listSessions({ limit: RECENT_LIMIT })
      .then((rows) => {
        launchSessions = rows;
      })
      .catch((e) => console.warn('[launch] sessions prefetch failed:', e)),
  ]);
}

export function consumeLaunchStreak(): Streak | null {
  const v = launchStreak;
  launchStreak = null;
  return v;
}

export function consumeLaunchSessions(): SessionListItem[] | null {
  const v = launchSessions;
  launchSessions = null;
  return v;
}

// hooks/use-streak.tsx
//
// Tabs-scoped streak state. StreakProvider owns the single profile read shared by
// every tab badge; useStreak exposes that snapshot without each tab fetching its
// own copy. The provider is mounted around the Tabs navigator in `(tabs)/_layout`.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { consumeLaunchStreak } from '../lib/launch';
import { subscribeToStreakChanges } from '../lib/streak-events';
import {
  deviceLocalDate,
  getStreak,
  liveStreakCount,
  type Streak,
} from '../lib/streak';

type StreakContextValue = {
  streak: Streak | null;
  count: number;
  isLoading: boolean;
  refresh: () => Promise<void>;
};

const StreakContext = createContext<StreakContextValue | null>(null);

type StreakProviderProps = {
  children: ReactNode;
};

export function StreakProvider({ children }: StreakProviderProps) {
  // The root launch gate prefetches the full streak while the splash is visible.
  // Consume it once here so every tab starts from the same first-paint snapshot.
  const [state, setState] = useState<{
    streak: Streak | null;
    isLoading: boolean;
  }>(() => {
    const streak = consumeLaunchStreak();
    return { streak, isLoading: streak === null };
  });
  const requestIdRef = useRef(0);
  // Forces the derived count to be reevaluated if the app stays open across a
  // local midnight. No database write or cron is involved.
  const [, setLocalDay] = useState(deviceLocalDate);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      const next = await getStreak();
      if (requestId !== requestIdRef.current) return;
      setState((current) => {
        if (!current.isLoading && streaksEqual(current.streak, next)) return current;
        return { streak: next, isLoading: false };
      });
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      console.warn('[streak] load failed:', error);
      setState((current) =>
        current.isLoading ? { ...current, isLoading: false } : current,
      );
    }
  }, []);

  // The tabs route loses focus while a practice flow is on top. Returning to the
  // tabs performs one refresh for all badges, instead of one request per tab.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  // Session flows sit beside the tabs route, not under this context. Their
  // successful inserts publish this signal after the streak trigger has run, so
  // even a save that finishes after the user returns cannot leave badges stale.
  useEffect(() => subscribeToStreakChanges(refresh), [refresh]);

  // Re-derive aliveness after the app returns from the background. Refreshing the
  // snapshot also picks up sessions completed elsewhere or other profile changes.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const scheduleNextDay = () => {
      timeout = setTimeout(() => {
        setLocalDay(deviceLocalDate());
        scheduleNextDay();
      }, millisecondsUntilNextLocalDay());
    };
    scheduleNextDay();
    return () => clearTimeout(timeout);
  }, []);

  // Invalidate any in-flight request before an account change unmounts this
  // provider, so it cannot commit into a later provider instance.
  useEffect(
    () => () => {
      requestIdRef.current += 1;
    },
    [],
  );

  const count = state.streak ? liveStreakCount(state.streak) : 0;
  const value = useMemo<StreakContextValue>(
    () => ({
      streak: state.streak,
      count,
      isLoading: state.isLoading,
      refresh,
    }),
    [count, refresh, state.isLoading, state.streak],
  );

  return <StreakContext.Provider value={value}>{children}</StreakContext.Provider>;
}

export function useStreak(): StreakContextValue {
  const context = useContext(StreakContext);
  if (!context) throw new Error('useStreak must be used within StreakProvider');
  return context;
}

function streaksEqual(a: Streak | null, b: Streak): boolean {
  return (
    a !== null &&
    a.current === b.current &&
    a.longest === b.longest &&
    a.lastActiveDate === b.lastActiveDate
  );
}

function millisecondsUntilNextLocalDay(now: Date = new Date()): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  // One extra second avoids firing inside the final millisecond of the old day.
  return Math.max(1000, next.getTime() - now.getTime() + 1000);
}

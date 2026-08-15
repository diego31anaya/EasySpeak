import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../lib/auth';
import { useLocalDay } from './use-local-day';
import {
  getStreak,
  liveStreakCount,
  type Streak,
} from '../lib/streak';

type StreakContextValue = {
  streak: Streak | null;
  isPending: boolean;
  isError: boolean;
  count: number;
  isStreakDone: boolean;
  updateStreak: (streak: Streak) => void;
};

const StreakContext = createContext<StreakContextValue | null>(null);

export function StreakProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const localDay = useLocalDay();
  const queryClient = useQueryClient();

  const userId = session?.user.id ?? '';

  const streakQueryKey = ['streak', userId] as const;

  const {
    data: streak = null,
    isPending,
    isError,
  } = useQuery({
    queryKey: streakQueryKey,
    queryFn: getStreak,
    enabled: Boolean(userId),
    staleTime: Infinity,
    refetchOnMount: 'always',
  });

  const count = streak ? liveStreakCount(streak, localDay) : 0;

  const isStreakDone = streak?.lastActiveDate === localDay;

  const updateStreak = useCallback(
    (nextStreak: Streak) => {
      if (!userId) return;

      queryClient.setQueryData<Streak>(['streak', userId], nextStreak);
    },
    [queryClient, userId],
  );

  const value = useMemo(
    () => ({
      streak,
      isPending,
      isError,
      count,
      isStreakDone,
      updateStreak,
    }),
    [streak, isPending, isError, count, isStreakDone, updateStreak],
  );

  return (
    <StreakContext.Provider value={value}>
      {children}
    </StreakContext.Provider>
  );
}

export function useStreak(): StreakContextValue {
  const context = useContext(StreakContext);

  if (!context) {
    throw new Error(
      'useStreak must be used within StreakProvider',
    );
  }

  return context;
}

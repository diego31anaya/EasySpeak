// lib/streak-events.ts
//
// Small in-process invalidation channel between session saves (which live in flow
// routes outside the tabs provider) and the tabs-scoped StreakProvider. The
// database trigger remains the source of truth; this only tells the provider when
// to read that truth again.

type StreakChangeListener = () => void | Promise<void>;

const listeners = new Set<StreakChangeListener>();

export function subscribeToStreakChanges(listener: StreakChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyStreakChanged(): void {
  listeners.forEach((listener) => {
    try {
      Promise.resolve(listener()).catch((error) => {
        console.warn('[streak] change listener failed:', error);
      });
    } catch (error) {
      // A UI observer must never turn a successfully inserted session into a
      // reported save failure.
      console.warn('[streak] change listener failed:', error);
    }
  });
}

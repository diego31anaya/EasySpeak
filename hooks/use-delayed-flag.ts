// hooks/use-delayed-flag.ts
//
// Returns true only once `active` has stayed true for `delayMs`. Used to gate
// skeleton loaders so a fast load never flashes a skeleton: if the data arrives
// before delayMs, the timer is cleared and the flag never flips.

import { useEffect, useState } from 'react';

export function useDelayedFlag(active: boolean, delayMs = 150): boolean {
  const [flag, setFlag] = useState(false);

  useEffect(() => {
    if (!active) {
      setFlag(false);
      return;
    }
    const id = setTimeout(() => setFlag(true), delayMs);
    return () => clearTimeout(id);
  }, [active, delayMs]);

  return flag;
}
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { deviceLocalDate } from '../lib/streak';

const LocalDayContext = createContext<string | null>(null);

export function LocalDayProvider({ 
    children,
}: {
    children: ReactNode;
}) {
    const [localDay, setLocalDay] = useState(deviceLocalDate)

    useEffect(() => {
        let timeout: ReturnType<typeof setTimeout> | null = null;

        const clearScheduledUpdate = () => {
            if (timeout === null) return;

            clearTimeout(timeout);
            timeout = null;
        };

        const updateLocalDay = () => {
            const nextLocalDay = deviceLocalDate();
            
            setLocalDay((currentLocalDay) => currentLocalDay === nextLocalDay ? currentLocalDay : nextLocalDay);
        }

        const scheduleNextMidnight = () => {
            clearScheduledUpdate();

            const now = new Date();
            const nextMidnight = new Date(now);

            nextMidnight.setDate(now.getDate() + 1);
            nextMidnight.setHours(0, 0, 1, 0);

            const millisecondsUntilMidnight = nextMidnight.getTime() - now.getTime();

            timeout = setTimeout(() => {
                updateLocalDay();
                scheduleNextMidnight();
            }, Math.max(1000, millisecondsUntilMidnight));
        }

        updateLocalDay();
        scheduleNextMidnight();

        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active') {
                updateLocalDay();
                scheduleNextMidnight();
                return;
            }

            // Do not keep the timeout while the app is inactive/background
            clearScheduledUpdate();
        })

        return () => {
            clearScheduledUpdate();
            subscription.remove();
        }
    }, [])

    return (
        <LocalDayContext.Provider value={localDay}>
            {children}
        </LocalDayContext.Provider>
    )
}

export function useLocalDay(): string {
    const localDay = useContext(LocalDayContext);

    if (localDay === null) {
        throw new Error(
        'useLocalDay must be used within LocalDayProvider',
        );
    }

    return localDay;
}

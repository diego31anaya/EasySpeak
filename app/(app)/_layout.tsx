import { Redirect, Stack } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { useAuth } from '../../lib/auth';
import { syncReminderOnLaunch } from '../../lib/notifications';

export default function AppLayout() {
    const { session, loading, recoveryMode } = useAuth();

    // Once signed in, make the OS reminder schedule match the stored pref
    // (re-asserts the daily notification; adopts the account's Supabase mirror on
    // a fresh device). Fire-and-forget; runs once per signed-in user.
    useEffect(() => {
      if (session && !recoveryMode) syncReminderOnLaunch().catch(() => {});
    }, [session?.user.id, recoveryMode]);

    // Also re-run it whenever the app returns to the foreground, so the streak-aware
    // reminder content (baked at schedule time) is refreshed to the current state —
    // e.g. a new day where the streak is now at risk. Fire-and-forget.
    useEffect(() => {
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active' && session && !recoveryMode) {
          syncReminderOnLaunch().catch(() => {});
        }
      });
      return () => sub.remove();
    }, [session?.user.id, recoveryMode]);

    if(loading) {
        return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    );
    }

    if(!session) return <Redirect href="/sign-in" />
    // A recovery session must finish the password reset before entering the app
    // (closes the kill-mid-reset bypass; recoveryMode is persisted + rehydrated).
    if(recoveryMode) return <Redirect href="/new-password" />


     return (
       <Stack
         screenOptions={{
           headerShown: false,
           animation: 'default',
         }}
       >
         {/* Practice flows: disable the iOS swipe-back so users can't bypass
             the exit-confirmation sheet and silently lose in-progress state. */}
         <Stack.Screen name="impromptu" options={{ gestureEnabled: false }} />
         <Stack.Screen name="explain" options={{ gestureEnabled: false }} />
         <Stack.Screen name="storytelling" options={{ gestureEnabled: false }} />
         <Stack.Screen name="debate" options={{ gestureEnabled: false }} />
         <Stack.Screen name="prep-practice" options={{ gestureEnabled: false }} />
         <Stack.Screen name="tto-practice" options={{ gestureEnabled: false }} />
         <Stack.Screen name="vocab-practice" options={{ gestureEnabled: false }} />
         {/* Streaks + Settings: card modals (slide up, swipe-down to dismiss). */}
         <Stack.Screen name="streaks" options={{ presentation: 'modal' }} />
         <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
         {/* Profile config pages — bottom-sheet modals when reached from anywhere
             OTHER than Settings (a future Home link, a metric expansion). The
             Settings entry uses the right-sliding settings/* nested routes instead. */}
         <Stack.Screen name="pace-target" options={{ presentation: 'modal' }} />
         <Stack.Screen name="custom-fillers" options={{ presentation: 'modal' }} />
         <Stack.Screen name="practice-focus" options={{ presentation: 'modal' }} />
       </Stack>
     );
}
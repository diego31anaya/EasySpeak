import { Stack } from 'expo-router';
import { AuthProvider, useAuth } from '../lib/auth';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from '@expo-google-fonts/outfit';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { useEffect, useState, type ReactNode } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { colors } from '../lib/theme';
import { prefetchLaunchData } from '../lib/launch';
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';

const queryClient = new QueryClient()

SplashScreen.preventAutoHideAsync();

// If the signed-in prefetch is slow, reveal anyway after this so the splash can't
// hang on a bad connection (the Home cards then fall back to their skeletons).
const SPLASH_MAX_MS = 4000;

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });

  // Hold the splash until fonts are ready (the tree doesn't mount without them).
  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>

      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <BottomSheetModalProvider>
          <AuthProvider>
            <StatusBar style="light" />
            <AppReadyGate>
              <Stack
                screenOptions={{
                  headerShown: false,
                  animation: 'none',
                  contentStyle: { backgroundColor: colors.bg },
                }}
              />
            </AppReadyGate>
          </AuthProvider>
          </BottomSheetModalProvider>
        </QueryClientProvider>
      </SafeAreaProvider>

    </GestureHandlerRootView>
  );
}

// Keeps the splash up until the app is genuinely ready to show: the auth session is
// resolved AND (if signed in) the Home tab's first-paint data is prefetched. Only
// then does it mount the navigator and hide the splash — so the user goes straight
// from the splash to a fully-loaded Home (or the sign-in screen), with no
// white-screen-spinner or grey-streak / skeleton flash in between.
function AppReadyGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (loading || ready) return; // session not resolved yet, or already revealed
    let cancelled = false;
    const reveal = () => {
      if (!cancelled) setReady(true);
    };
    if (!session) {
      reveal(); // signed out — the (app) layout redirects to sign-in
    } else {
      // Signed in — prefetch Home's data, but never hang the splash on it.
      Promise.race([prefetchLaunchData(), wait(SPLASH_MAX_MS)]).finally(reveal);
    }
    return () => {
      cancelled = true;
    };
  }, [loading, session, ready]);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  // Until ready, render nothing — the native splash covers the screen.
  if (!ready) return null;
  return <>{children}</>;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

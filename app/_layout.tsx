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
import { useEffect, type ReactNode } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { colors } from '../lib/theme';
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';


const queryClient = new QueryClient()

SplashScreen.preventAutoHideAsync();

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

// Keep the native splash visible until Supabase resolves the cached auth session.
// Screen-owned TanStack queries begin after the navigator mounts and use their own
// loading states; launch no longer waits for server data.
function AppReadyGate({ children }: { children: ReactNode }) {
  const { loading } = useAuth();

  useEffect(() => {
    if (!loading) void SplashScreen.hideAsync();
  }, [loading]);

  // Until auth resolves, render nothing and let the native splash cover the app.
  if (loading) return null;
  return <>{children}</>;
}

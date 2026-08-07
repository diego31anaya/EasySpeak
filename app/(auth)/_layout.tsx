import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../../lib/auth';

export default function AuthLayout() {
    const { session, loading, recoveryMode } = useAuth();

    if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

    // Already signed in? Bounce to home — UNLESS we're mid password-reset (a verified
    // recovery code mints a session, but the user still needs to set a new password
    // on /new-password before they go in). finishRecovery() clears the flag.
    if (session && !recoveryMode) return <Redirect href="/" />;

    return (
      <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
        {/* Can't swipe-back off the new-password step mid password-reset. */}
        <Stack.Screen name="new-password" options={{ gestureEnabled: false }} />
      </Stack>
    );

}
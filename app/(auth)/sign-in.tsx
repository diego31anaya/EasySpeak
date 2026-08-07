// app/(auth)/sign-in.tsx — dark sign-in screen.
// On success the auth listener + (auth) layout redirect into the app. If the email
// isn't confirmed yet, we send a fresh code and route to the verify screen.

import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { colors, fontSize, fonts, radius, spacing, GRADIENT_ACTIVE } from '../../lib/theme';
import { useAuth } from '../../lib/auth';

export default function SignIn() {
  const { signIn, resendSignupCode } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    const e = email.trim().toLowerCase();
    if (!e || !password) {
      setError('Enter your email and password.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);
    setError(null);
    const { error: err } = await signIn(e, password);
    if (err) {
      // Signed up but never confirmed → send a fresh code and go verify.
      if (/not confirmed|not been confirmed/i.test(err.message)) {
        const { error: resendErr } = await resendSignupCode(e);
        setSubmitting(false);
        if (resendErr) {
          // Resend failed (e.g. the email rate limit). Don't drop the user on a code
          // screen that will never receive a code — show why and let them retry here.
          setError(resendErr.message);
          return;
        }
        router.push({ pathname: '/verify-code', params: { email: e, purpose: 'signup' } });
        return;
      }
      setSubmitting(false);
      setError(err.message);
      return;
    }
    // Success — the auth state change drives the redirect; leave the spinner up.
  };

  return (
    <LinearGradient
      colors={[colors.surfaceElevated, colors.bg]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.flex}
    >
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>Sign in to keep your streak going.</Text>

            <TextInput
              style={styles.field}
              placeholder="Email"
              placeholderTextColor={colors.textSubtle}
              selectionColor={colors.accent}
              keyboardAppearance="dark"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              editable={!submitting}
              returnKeyType="next"
            />
            <TextInput
              style={styles.field}
              placeholder="Password"
              placeholderTextColor={colors.textSubtle}
              selectionColor={colors.accent}
              keyboardAppearance="dark"
              secureTextEntry
              autoComplete="current-password"
              value={password}
              onChangeText={setPassword}
              editable={!submitting}
              returnKeyType="go"
              onSubmitEditing={onSubmit}
            />

            <View style={styles.forgotRow}>
              <Pressable
                onPress={() => router.push('/forgot-password')}
                hitSlop={8}
                accessibilityRole="button"
                style={({ pressed }) => pressed && styles.pressedDim}
              >
                <Text style={styles.forgotText}>Forgot password?</Text>
              </Pressable>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              onPress={onSubmit}
              disabled={submitting}
              accessibilityRole="button"
              style={({ pressed }) => [pressed && !submitting && styles.ctaPressed, submitting && styles.ctaDisabled]}
            >
              <LinearGradient
                colors={GRADIENT_ACTIVE}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={styles.cta}
              >
                {submitting ? (
                  <ActivityIndicator color={colors.bg} />
                ) : (
                  <Text style={styles.ctaText}>Sign In</Text>
                )}
              </LinearGradient>
            </Pressable>

            <View style={styles.footer}>
              <Text style={styles.footerText}>Don&apos;t have an account? </Text>
              <Pressable
                onPress={() => router.replace('/sign-up')}
                hitSlop={8}
                accessibilityRole="button"
                style={({ pressed }) => pressed && styles.pressedDim}
              >
                <Text style={styles.link}>Sign up</Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressedDim: { opacity: 0.6 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    gap: spacing.md,
  },
  title: {
    fontSize: fontSize.xxxl,
    fontFamily: fonts.semibold,
    color: colors.text,
    letterSpacing: -0.8,
  },
  subtitle: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    lineHeight: 22,
  },
  field: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  forgotRow: { alignItems: 'flex-end', marginTop: -spacing.xs },
  forgotText: {
    fontSize: fontSize.sm,
    fontFamily: fonts.medium,
    color: colors.textMuted,
  },
  error: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.danger,
    lineHeight: 20,
  },
  cta: {
    paddingVertical: spacing.lg,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  ctaPressed: { opacity: 0.85 },
  ctaDisabled: { opacity: 0.45 },
  ctaText: {
    fontSize: fontSize.lg,
    fontFamily: fonts.semibold,
    color: colors.bg,
    letterSpacing: 0.2,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  footerText: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  link: {
    fontSize: fontSize.md,
    fontFamily: fonts.semibold,
    color: colors.accent,
  },
});
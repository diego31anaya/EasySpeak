// app/(auth)/sign-up.tsx — dark sign-up screen.
// On success with "Confirm email" on, routes to the verify-code screen; if it's off
// (dev), the new session redirects into the app via the auth listener.

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

const PASSWORD_MIN = 6;

export default function SignUp() {
  const { signUp } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    const name = displayName.trim();
    const e = email.trim().toLowerCase();
    if (!name || !e || !password) {
      setError('Fill in every field to continue.');
      return;
    }
    if (password.length < PASSWORD_MIN) {
      setError(`Use at least ${PASSWORD_MIN} characters for your password.`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords don’t match.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);
    setError(null);
    const { error: err, needsConfirmation } = await signUp(e, password, name);
    if (err) {
      setSubmitting(false);
      setError(err.message);
      return;
    }
    if (needsConfirmation) {
      setSubmitting(false);
      router.push({ pathname: '/verify-code', params: { email: e, purpose: 'signup' } });
    }
    // else: session created (confirmation off) → the auth listener redirects home.
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
            <Text style={styles.title}>Create account</Text>
            <Text style={styles.subtitle}>Start practicing today.</Text>

            <TextInput
              style={styles.field}
              placeholder="First name"
              placeholderTextColor={colors.textSubtle}
              selectionColor={colors.accent}
              keyboardAppearance="dark"
              autoCapitalize="words"
              autoCorrect={false}
              value={displayName}
              onChangeText={setDisplayName}
              editable={!submitting}
              returnKeyType="next"
            />
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
              placeholder={`Password (${PASSWORD_MIN}+ characters)`}
              placeholderTextColor={colors.textSubtle}
              selectionColor={colors.accent}
              keyboardAppearance="dark"
              secureTextEntry
              autoComplete="new-password"
              value={password}
              onChangeText={setPassword}
              editable={!submitting}
              returnKeyType="next"
            />
            <TextInput
              style={styles.field}
              placeholder="Confirm password"
              placeholderTextColor={colors.textSubtle}
              selectionColor={colors.accent}
              keyboardAppearance="dark"
              secureTextEntry
              autoComplete="new-password"
              value={confirm}
              onChangeText={setConfirm}
              editable={!submitting}
              returnKeyType="go"
              onSubmitEditing={onSubmit}
            />

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
                  <Text style={styles.ctaText}>Create Account</Text>
                )}
              </LinearGradient>
            </Pressable>

            <View style={styles.footer}>
              <Text style={styles.footerText}>Already have an account? </Text>
              <Pressable
                onPress={() => router.replace('/sign-in')}
                hitSlop={8}
                accessibilityRole="button"
                style={({ pressed }) => pressed && styles.pressedDim}
              >
                <Text style={styles.link}>Sign in</Text>
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
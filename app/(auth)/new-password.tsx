// app/(auth)/new-password.tsx — step 3 of password reset. Reached only with a
// verified recovery session (recoveryMode is set, so the (auth) layout keeps us
// here instead of redirecting in). Saving the password clears recoveryMode → the
// layout then redirects into the app.

import { useState } from 'react';
import {
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

export default function NewPassword() {
  const { updatePassword, finishRecovery, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    if (password.length < PASSWORD_MIN) {
      setError(`Use at least ${PASSWORD_MIN} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords don’t match.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);
    setError(null);
    const { error: err } = await updatePassword(password);
    // A real failure stops here, but Supabase's "must differ from the old password"
    // isn't a failure for a reset — re-entering the password they already know still
    // lets them sign in, so treat it as done rather than trapping them on this screen.
    if (err && !/different from the old|should be different/i.test(err.message)) {
      setSubmitting(false);
      setError(err.message);
      return;
    }
    // Done — drop recoveryMode so the (auth) layout redirects into the app.
    finishRecovery();
  };

  const onCancel = async () => {
    if (submitting) return;
    // Bail out of the reset. The old password still works (the reset email never changed
    // it), so this is safe. Sign out FIRST: dropping the session fires onAuthStateChange,
    // which clears the recovery lock atomically (see lib/auth.tsx). We deliberately do
    // NOT clear the lock before the session is gone — recoveryMode=false while the
    // recovery session is still live would let the (auth) layout flash us into the app.
    try {
      await signOut();
    } catch {
      // ignore — best-effort; fall through to sign-in regardless
    }
    router.replace('/sign-in');
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
            <Text style={styles.title}>New password</Text>
            <Text style={styles.subtitle}>Choose a new password for your account.</Text>

            <TextInput
              style={styles.field}
              placeholder={`New password (${PASSWORD_MIN}+ characters)`}
              placeholderTextColor={colors.textSubtle}
              selectionColor={colors.accent}
              keyboardAppearance="dark"
              secureTextEntry
              autoComplete="new-password"
              autoFocus
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
                <Text style={styles.ctaText}>{submitting ? 'Saving…' : 'Save password'}</Text>
              </LinearGradient>
            </Pressable>

            <Pressable
              onPress={onCancel}
              disabled={submitting}
              hitSlop={8}
              accessibilityRole="button"
              style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressedDim]}
            >
              <Text style={styles.cancelText}>Back to sign in</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  pressedDim: { opacity: 0.6 },
  cancelBtn: {
    alignSelf: 'center',
    marginTop: spacing.lg,
    paddingVertical: spacing.xs,
  },
  cancelText: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
});
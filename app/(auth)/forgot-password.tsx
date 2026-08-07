// app/(auth)/forgot-password.tsx — step 1 of password reset: enter email → email a
// recovery code → go to the shared verify-code screen (purpose=recovery).

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
import Svg, { Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

import { colors, fontSize, fonts, radius, spacing, GRADIENT_ACTIVE } from '../../lib/theme';
import { useAuth } from '../../lib/auth';

export default function ForgotPassword() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    const e = email.trim().toLowerCase();
    if (!e) {
      setError('Enter your email.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);
    setError(null);
    const { error: err } = await requestPasswordReset(e);
    setSubmitting(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.push({ pathname: '/verify-code', params: { email: e, purpose: 'recovery' } });
  };

  return (
    <LinearGradient
      colors={[colors.surfaceElevated, colors.bg]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.flex}
    >
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => [styles.backBtn, pressed && styles.pressedDim]}
          >
            <ChevronLeft color={colors.text} />
          </Pressable>
        </View>

        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.title}>Reset password</Text>
            <Text style={styles.subtitle}>
              Enter your email and we&apos;ll send you a 6-digit code to reset your password.
            </Text>

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
              autoFocus
              value={email}
              onChangeText={setEmail}
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
                <Text style={styles.ctaText}>{submitting ? 'Sending…' : 'Send code'}</Text>
              </LinearGradient>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function ChevronLeft({ size = 24, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="m15.75 4.5-7.5 7.5 7.5 7.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressedDim: { opacity: 0.6 },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
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
});
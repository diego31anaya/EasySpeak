// components/CodeEntryForm.tsx
//
// Reusable "enter the 6-digit code" page. The caller supplies the email (shown to
// the user), an `onVerify(code)` that does the actual Supabase verifyOtp, and an
// `onResend()`. Used by signup confirmation and password reset today, and ready for
// the Settings email-change flow (same component, different callbacks).
//
// On a successful verify the caller's `onVerify` owns what happens next (a session
// appearing → the layout redirects, or an explicit navigation) — this component just
// surfaces the error if one comes back, and otherwise gets out of the way.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
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
import Svg, { Path } from 'react-native-svg';

import { colors, fontSize, fonts, radius, spacing } from '../lib/theme';

const CODE_LENGTH = 6;
const RESEND_COOLDOWN = 30; // seconds; a code was just sent when this mounts

type Props = {
  email: string;
  title?: string;
  // Shown under the title; `{email}` is appended automatically.
  subtitle?: string;
  onVerify: (code: string) => Promise<{ error: { message: string } | null }>;
  onResend: () => Promise<{ error: { message: string } | null }>;
  onBack?: () => void;
};

export function CodeEntryForm({
  email,
  title = 'Check your email',
  subtitle = 'Enter the 6-digit code we sent to',
  onVerify,
  onResend,
  onBack,
}: Props) {
  const [code, setCode] = useState('');
  const [focused, setFocused] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);
  const inputRef = useRef<TextInput>(null);

  // Resend cooldown tick.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submit = useCallback(
    async (value: string) => {
      if (verifying) return;
      Keyboard.dismiss();
      setVerifying(true);
      setError(null);
      const { error: err } = await onVerify(value);
      setVerifying(false);
      if (err) {
        setError(err.message || 'That code didn’t work. Try again.');
        setCode('');
        inputRef.current?.focus();
      }
      // Success: the caller takes it from here (session change / navigation).
    },
    [verifying, onVerify],
  );

  const onChangeCode = useCallback(
    (text: string) => {
      const digits = text.replace(/[^0-9]/g, '').slice(0, CODE_LENGTH);
      setCode(digits);
      setError(null);
      if (digits.length === CODE_LENGTH) submit(digits);
    },
    [submit],
  );

  const handleResend = useCallback(async () => {
    if (cooldown > 0 || resending || verifying) return;
    setResending(true);
    setError(null);
    const { error: err } = await onResend();
    setResending(false);
    setCooldown(RESEND_COOLDOWN); // always gate — a rate-limit error must NOT let them spam
    if (err) setError(err.message || 'Couldn’t resend the code.');
  }, [cooldown, resending, verifying, onResend]);

  return (
    <LinearGradient
      colors={[colors.surfaceElevated, colors.bg]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.flex}
    >
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        {onBack ? (
          <View style={styles.header}>
            <Pressable
              onPress={onBack}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={({ pressed }) => [styles.backBtn, pressed && styles.pressedDim]}
            >
              <ChevronLeft color={colors.text} />
            </Pressable>
          </View>
        ) : null}

        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>
              {subtitle} <Text style={styles.email}>{email}</Text>.
            </Text>

            {/* Six cells with an invisible TextInput on top capturing the digits. */}
            <Pressable style={styles.codeRow} onPress={() => inputRef.current?.focus()}>
              {Array.from({ length: CODE_LENGTH }).map((_, i) => {
                const active = focused && i === code.length;
                return (
                  <View
                    key={i}
                    style={[
                      styles.cell,
                      code[i] ? styles.cellFilled : null,
                      active ? styles.cellActive : null,
                      error ? styles.cellError : null,
                    ]}
                  >
                    <Text style={styles.cellText}>{code[i] ?? ''}</Text>
                  </View>
                );
              })}
              <TextInput
                ref={inputRef}
                value={code}
                onChangeText={onChangeCode}
                keyboardType="number-pad"
                maxLength={CODE_LENGTH}
                autoFocus
                caretHidden
                editable={!verifying}
                textContentType="oneTimeCode"
                keyboardAppearance="dark"
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                style={styles.hiddenInput}
              />
            </Pressable>

            {verifying ? (
              <View style={styles.verifyingRow}>
                <ActivityIndicator color={colors.textMuted} />
                <Text style={styles.verifyingText}>Verifying…</Text>
              </View>
            ) : error ? (
              <Text style={styles.error}>{error}</Text>
            ) : (
              <View style={styles.verifyingRow} />
            )}

            <View style={styles.resendRow}>
              <Text style={styles.resendPrompt}>Didn’t get it? </Text>
              <Pressable
                onPress={handleResend}
                disabled={cooldown > 0 || resending || verifying}
                hitSlop={8}
                accessibilityRole="button"
                style={({ pressed }) => pressed && styles.pressedDim}
              >
                <Text style={[styles.resendLink, cooldown > 0 && styles.resendLinkDisabled]}>
                  {resending ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </Text>
              </Pressable>
            </View>
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
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  email: {
    fontFamily: fonts.medium,
    color: colors.text,
  },

  // Code cells
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cell: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellFilled: { borderColor: colors.textSubtle },
  cellActive: { borderColor: colors.accent },
  cellError: { borderColor: colors.danger },
  cellText: {
    fontSize: fontSize.xxl,
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  // Invisible input layered over the cells to capture taps + digits.
  hiddenInput: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0,
    color: 'transparent',
  },

  verifyingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 20,
  },
  verifyingText: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  error: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.danger,
    lineHeight: 20,
    minHeight: 20,
  },

  resendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  resendPrompt: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  resendLink: {
    fontSize: fontSize.md,
    fontFamily: fonts.semibold,
    color: colors.accent,
  },
  resendLinkDisabled: { color: colors.textSubtle },
});
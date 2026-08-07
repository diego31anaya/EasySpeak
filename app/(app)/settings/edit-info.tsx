// app/(app)/settings/edit-info.tsx
//
// Edit one piece of account info (first name / email / password). Pushed from a
// Settings row as a CARD that slides in from the right WITHIN the Settings modal
// (this is a screen in the modal's nested stack — see ./_layout.tsx), so it reads as
// navigating inside the modal rather than popping up as its own bottom sheet. The
// back chevron pops back to the list (backFlow).
//
// Header = back chevron (left) · the field's title (centered). Body is EMPTY for now
// — the input + Save land next.

import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';

import { colors, fontSize, fonts, radius, spacing } from '../../../lib/theme';
import { backFlow } from '../../../lib/navigation';
import { useAuth } from '../../../lib/auth';

export type EditField = 'firstName' | 'email' | 'password';

const FIELD_TITLE: Record<EditField, string> = {
  firstName: 'First name',
  email: 'Email',
  password: 'Password',
};

// Small label above the input.
const FIELD_PROMPT: Record<EditField, string> = {
  firstName: 'Enter new name',
  email: 'Enter new email',
  password: 'Enter new password',
};

// Per-field TextInput config (keyboard, autofill, capitalization, secure entry).
const FIELD_INPUT: Record<EditField, Partial<TextInputProps>> = {
  firstName: {
    placeholder: 'First name',
    autoCapitalize: 'words',
    autoComplete: 'name',
    textContentType: 'givenName',
    maxLength: 50,
  },
  email: {
    placeholder: 'name@example.com',
    keyboardType: 'email-address',
    autoCapitalize: 'none',
    autoCorrect: false,
    autoComplete: 'email',
    textContentType: 'emailAddress',
  },
  password: {
    placeholder: 'New password',
    secureTextEntry: true,
    autoCapitalize: 'none',
    autoComplete: 'new-password',
    textContentType: 'newPassword',
  },
};

// Loose email shape — the server is the real check; this just gates the button.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Supabase's default minimum password length. Keep in step with the actual auth
// policy (and the sign-up screen) if it changes.
const PASSWORD_MIN = 6;

export default function EditInfo() {
  const { field } = useLocalSearchParams<{ field: EditField }>();
  const { session, profile, updateDisplayName, updatePassword } = useAuth();
  const title = FIELD_TITLE[field] ?? '';

  // Seed name/email with the current account value (so the user edits in place);
  // password starts empty (you enter a NEW one — the current is never shown).
  const current =
    field === 'firstName'
      ? profile?.display_name ?? ''
      : field === 'email'
        ? session?.user.email ?? ''
        : '';
  const [value, setValue] = useState(current);

  // Password has a second "confirm" field; the two must match. (confirm/ref unused
  // for name/email.)
  const isPassword = field === 'password';
  const [confirm, setConfirm] = useState('');
  const confirmRef = useRef<TextInput>(null);

  // True while the backend write is in flight — the Save action shows a spinner.
  const [saving, setSaving] = useState(false);

  // Per-field validity, then Save = valid AND actually changed. Password also needs
  // the confirmation to match; names/emails are trimmed and must differ from current.
  const trimmed = value.trim();
  let valid = false;
  if (field === 'firstName') valid = trimmed.length >= 1;
  else if (field === 'email') valid = EMAIL_RE.test(trimmed);
  else if (field === 'password') valid = value.length >= PASSWORD_MIN;

  const canSave = isPassword ? valid && value === confirm : valid && trimmed !== current.trim();

  // Inline password errors — shown only once the user has typed (not on an empty
  // field). COPY IS PLACEHOLDER.
  const passwordError =
    isPassword && value.length > 0 && value.length < PASSWORD_MIN
      ? `Invalid password. Passwords must be at least ${PASSWORD_MIN} characters.`
      : null;
  const confirmError =
    isPassword && confirm.length > 0 && confirm !== value ? "Passwords don't match." : null;

  const back = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    backFlow();
  };

  const save = async () => {
    if (!canSave || saving) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Keyboard.dismiss();

    // Email isn't wired to the backend yet.
    if (field === 'email') {
      console.log('Save pressed:', field, value);
      return;
    }

    setSaving(true);
    const { error } =
      field === 'firstName'
        ? await updateDisplayName(value.trim())
        : await updatePassword(value);
    if (error) {
      setSaving(false);
      Alert.alert("Couldn't save", error.message);
      return;
    }
    // Success — pop back to the settings list.
    backFlow();
  };

  return (
    <LinearGradient
      colors={[colors.surfaceElevated, colors.bg]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.gradientBg}
    >
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Pressable
              onPress={back}
              hitSlop={12}
              accessibilityLabel="Back"
              style={({ pressed }) => [styles.side, pressed && styles.pressed]}
            >
              <BackIcon color={colors.text} />
            </Pressable>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            {/* Save — accent text like FilterSheet's "Reset"; greyed + disabled
                until the field holds valid input (canSave). */}
            <Pressable
              onPress={save}
              disabled={!canSave || saving}
              hitSlop={12}
              accessibilityLabel="Save"
              style={({ pressed }) => [
                styles.side,
                styles.sideRight,
                pressed && canSave && !saving && styles.pressed,
              ]}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Text style={[styles.save, !canSave && styles.saveDisabled]}>Save</Text>
              )}
            </Pressable>
          </View>
        </View>

        <View style={styles.body}>
          <Text style={styles.prompt}>{FIELD_PROMPT[field] ?? ''}</Text>
          <View style={styles.inputWrap}>
            <TextInput
              {...FIELD_INPUT[field]}
              style={styles.input}
              value={value}
              onChangeText={setValue}
              placeholderTextColor={colors.textSubtle}
              selectionColor={colors.accent}
              keyboardAppearance="dark"
              autoFocus
              returnKeyType={isPassword ? 'next' : 'done'}
              onSubmitEditing={isPassword ? () => confirmRef.current?.focus() : save}
            />
          </View>
          {passwordError ? <Text style={styles.error}>{passwordError}</Text> : null}

          {/* Password is entered twice — the confirm field must match to save. */}
          {isPassword ? (
            <>
              <Text style={[styles.prompt, styles.promptSpaced]}>Confirm password</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  {...FIELD_INPUT.password}
                  ref={confirmRef}
                  style={styles.input}
                  placeholder="Confirm password"
                  value={confirm}
                  onChangeText={setConfirm}
                  placeholderTextColor={colors.textSubtle}
                  selectionColor={colors.accent}
                  keyboardAppearance="dark"
                  returnKeyType="done"
                  onSubmitEditing={save}
                />
              </View>
              {confirmError ? <Text style={styles.error}>{confirmError}</Text> : null}
            </>
          ) : null}
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

// Chevron-left — sized to match the other back chevrons (24).
function BackIcon({ size = 24, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="m15.75 19.5-7.5-7.5 7.5-7.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  gradientBg: { flex: 1 },
  safe: { flex: 1 },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Equal side widths (back chevron left, Save right) wide enough for "Save" so the
  // title stays optically centered.
  side: { width: 56, height: 36, justifyContent: 'center' },
  sideRight: { alignItems: 'flex-end' },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.xxl,
    fontFamily: fonts.regular,
    color: colors.text,
    letterSpacing: -0.5,
  },
  // Save — accent text (matches FilterSheet's "Reset"); greyed when disabled
  // (matches RenameSheet's dirty-gated Save).
  save: { fontSize: fontSize.md, fontFamily: fonts.medium, color: colors.accent },
  saveDisabled: { color: colors.textSubtle },
  pressed: { opacity: 0.6 },
  body: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  // Small, subtle label above the field — same as settings' "Edit Information".
  prompt: {
    fontSize: fontSize.sm,
    fontFamily: fonts.medium,
    color: colors.textMuted,
    paddingHorizontal: spacing.xs,
    letterSpacing: 0.2,
    marginBottom: spacing.sm,
  },
  // Extra gap above the second ("Confirm password") label.
  promptSpaced: { marginTop: spacing.lg },
  // Inline validation error under a field.
  error: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.danger,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.xs,
  },
  // Recessed field — darker than the surface so it reads as input (matches the
  // RenameSheet field).
  inputWrap: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  input: {
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.text,
  },
});
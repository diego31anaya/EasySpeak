// components/RenameSheet.tsx
//
// Small bottom sheet for renaming a session. Visually a smaller sibling of
// ConfirmationSheet/FilterSheet (same slide-up + fading backdrop), but with a
// nav-style header (Cancel · title · Save) over a single text field instead of a
// body of rows. Save is dirty-gated like FilterSheet's "Save Changes": greyed +
// disabled until the name actually changes, then full accent + tappable.
//
// NOT a RN Modal (unlike the other sheets): it renders as an in-tree absolute
// overlay so `useAnimatedKeyboard` reliably tracks the keyboard and the sheet can
// ride up "attached" to it. RN Modal hosts content in a separate iOS window where
// keyboard tracking is unreliable; an in-tree overlay sidesteps that. Render it as
// a SIBLING of (not inside) the screen's SafeAreaView so the backdrop fills the
// whole screen.
//
// onSave hands back the new title, or null to clear back to the default; the
// caller persists it (setCustomTitle) and updates the displayed title.

import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';

import { colors, spacing, fontSize, fonts, radius } from '../lib/theme';
import { ANIM_DURATION, ANIM_EASING } from '../lib/animation';

// Cap on a session name — long enough to be descriptive, short enough to fit the
// card/header without wrapping. Tune freely (enforced at the input, not the DB).
const MAX_LENGTH = 60;

// Drag-to-dismiss (matches FilterSheet): releasing past this distance (px) OR flicking faster
// than this velocity (px/s) closes the sheet; otherwise it springs back.
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;

type RenameSheetProps = {
  visible: boolean;
  // The session's current custom title (null = none → the field starts empty and
  // the default shows as a greyed placeholder).
  currentTitle: string | null;
  // The per-mode default, shown as the greyed placeholder.
  placeholder: string;
  // Sheet heading.
  title?: string;
  onCancel: () => void;
  // Fired on Save with the new title, or null to clear back to the default.
  onSave: (name: string | null) => void;
};

export function RenameSheet({
  visible,
  currentTitle,
  placeholder,
  title = 'Rename Session?',
  onCancel,
  onSave,
}: RenameSheetProps) {
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);
  const [shouldRender, setShouldRender] = useState(visible);
  const sheetHeight = useSharedValue(0);
  const keyboard = useAnimatedKeyboard();
  // Live downward-drag offset (added onto the open/close translateY). kb0 snapshots the keyboard
  // offset at drag-start so dismissing the keyboard mid-drag doesn't fight the finger.
  const dragY = useSharedValue(0);
  const kb0 = useSharedValue(0);

  const [value, setValue] = useState(currentTitle ?? '');
  const inputRef = useRef<TextInput>(null);

  // Open/close animation lifecycle (mirrors ConfirmationSheet).
  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      dragY.value = 0; // reset a prior drag-dismiss so a reopen starts clean
      kb0.value = 0;
      progress.value = withTiming(1, { duration: ANIM_DURATION, easing: ANIM_EASING });
    } else {
      progress.value = withTiming(
        0,
        { duration: ANIM_DURATION, easing: ANIM_EASING },
        (finished) => {
          if (finished) scheduleOnRN(setShouldRender, false);
        },
      );
    }
  }, [visible, progress, dragY, kb0]);

  // Seed the field from the current custom title each time the sheet opens (empty
  // when there's none — the default then shows as the placeholder). Discards any
  // abandoned edit from a previous open.
  useEffect(() => {
    if (visible) setValue(currentTitle ?? '');
  }, [visible, currentTitle]);

  const trimmed = value.trim();
  // null = clear back to the default; a non-empty string = a custom title.
  const next = trimmed === '' ? null : trimmed;
  // Dirty when the result differs from what's saved — so clearing an existing
  // title also enables Save.
  const dirty = next !== currentTitle;

  // Scrim fades as the sheet is dragged down (and with the open/close progress).
  const backdropStyle = useAnimatedStyle(() => {
    const h = sheetHeight.value || 1;
    const dragProgress = Math.min(Math.max(dragY.value, 0) / h, 1);
    return { opacity: progress.value * 0.5 * (1 - dragProgress) };
  });

  // Open/close offset plus the keyboard rise. keyboard.height includes the bottom safe area,
  // which the sheet already pads for, so subtract insets.bottom; clamp so a hidden keyboard adds
  // 0. The live drag offset rides on top.
  const sheetStyle = useAnimatedStyle(() => {
    const closed = (1 - progress.value) * sheetHeight.value;
    const kb = Math.max(keyboard.height.value - insets.bottom, 0);
    return { transform: [{ translateY: closed - kb + dragY.value }] };
  });

  // Dismiss the keyboard from the JS thread. Referencing Keyboard.dismiss DIRECTLY inside the
  // gesture worklet crashes (reanimated tries to capture the native Keyboard module on the UI
  // thread), so the worklet calls this plain JS callback via scheduleOnRN instead.
  const dismissKeyboard = () => Keyboard.dismiss();

  // Drag DOWN from anywhere on the sheet to dismiss. activeOffsetY(10) claims only downward drags
  // past ~10px, so taps + typing pass through. On drag start the keyboard is dismissed and its
  // offset snapshotted (kb0), then compensated in onUpdate so the keyboard-close animation doesn't
  // add motion — only the finger moves the sheet.
  const pan = Gesture.Pan()
    .activeOffsetY(10)
    .onStart(() => {
      kb0.value = Math.max(keyboard.height.value - insets.bottom, 0);
      scheduleOnRN(dismissKeyboard);
    })
    .onUpdate((e) => {
      const kbNow = Math.max(keyboard.height.value - insets.bottom, 0);
      dragY.value = Math.max(0, e.translationY) - kb0.value + kbNow;
    })
    .onEnd((e) => {
      const dismiss =
        e.translationY > 0 && (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY);
      if (dismiss) {
        dragY.value = withTiming(
          sheetHeight.value + kb0.value,
          { duration: ANIM_DURATION, easing: ANIM_EASING },
          (finished) => {
            if (finished) scheduleOnRN(onCancel);
          },
        );
      } else {
        dragY.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });

  const handleCancel = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Keyboard.dismiss();
    onCancel();
  };

  const handleSave = () => {
    if (!dirty) {
      Keyboard.dismiss();
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Keyboard.dismiss();
    onSave(next);
  };

  const handleClear = () => {
    setValue('');
    // Keep the field focused (and the keyboard up) so the user can keep typing.
    inputRef.current?.focus();
  };

  if (!shouldRender) return null;

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleCancel} />
      </Animated.View>

      <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.positioner, sheetStyle]}
        onLayout={(e) => {
          sheetHeight.value = e.nativeEvent.layout.height;
        }}
      >
        <View style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            <Pressable
              onPress={handleCancel}
              hitSlop={12}
              style={({ pressed }) => [styles.headerSide, pressed && styles.pressed]}
            >
              <Text style={styles.headerCancel}>Cancel</Text>
            </Pressable>

            <Text style={styles.headerTitle} numberOfLines={1}>
              {title}
            </Text>

            <Pressable
              onPress={handleSave}
              disabled={!dirty}
              hitSlop={12}
              style={({ pressed }) => [
                styles.headerSide,
                styles.headerSideRight,
                pressed && dirty && styles.pressed,
              ]}
            >
              <Text style={[styles.headerSave, !dirty && styles.headerSaveDisabled]}>Save</Text>
            </Pressable>
          </View>

          <View style={styles.inputRow}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={value}
              onChangeText={setValue}
              placeholder={placeholder}
              placeholderTextColor={colors.textSubtle}
              selectionColor={colors.accent}
              keyboardAppearance="dark"
              // "return" key (not "Done"): just lowers the keyboard and leaves the
              // sheet open — saving is the top-right Save button's job.
              returnKeyType="default"
              maxLength={MAX_LENGTH}
              onSubmitEditing={() => Keyboard.dismiss()}
            />
            {/* Custom clear "x": the native clearButtonMode can't be recolored,
                and its system grey is nearly invisible on the dark field. Fixed
                slot so the field width doesn't shift when it appears. */}
            <View style={styles.clearSlot}>
              {value.length > 0 ? (
                <Pressable onPress={handleClear} hitSlop={8}>
                  <ClearIcon />
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </Animated.View>
      </GestureDetector>
    </View>
  );
}

// Clear "x" — Heroicons solid x-circle (the x is knocked out via evenodd, so the
// dark field shows through it). Recolored to a visible grey, unlike the native one.
function ClearIcon({ size = 20, color = colors.textMuted }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill={color}>
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: '#000' },
  // Bottom-attached sheet: top corners rounded, flat bottom (meets the edge).
  positioner: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  sheet: {
    backgroundColor: colors.surfaceElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.textSubtle,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  // Equal side widths keep the title optically centered.
  headerSide: { width: 64, justifyContent: 'center' },
  headerSideRight: { alignItems: 'flex-end' },
  headerCancel: { fontSize: fontSize.md, fontFamily: fonts.medium, color: colors.text },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.lg,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  // Save: accent blue when dirty, greyed + disabled until the name changes.
  headerSave: { fontSize: fontSize.md, fontFamily: fonts.semibold, color: colors.accent },
  headerSaveDisabled: { color: colors.textSubtle },
  // Recessed field: darker than the sheet's surfaceElevated so it reads as input.
  // The frame (bg/border) lives on the row so the text input + clear icon sit
  // inside one bordered box.
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
  },
  input: {
    flex: 1,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  // Fixed-width trailing slot so showing/hiding the clear icon never reflows the
  // field.
  clearSlot: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
});
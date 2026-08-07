// components/ScreenHeader.tsx
//
// Shared PLAIN header for simple flow/config screens. The dismiss affordance
// depends on HOW the screen was opened:
//   - 'back'  → back chevron, top-LEFT  (pushed from the right, e.g. a Settings sub-page)
//   - 'close' → X, top-RIGHT            (presented as a bottom modal, e.g. from the Home tab)
// Both call onDismiss (router.back pops a card OR a modal alike). Used by the
// Profile config pages via ProfilePageShell; the bespoke headers (Home masthead,
// results, history, edit-info) stay custom. Geometry matches the Settings header.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors, fontSize, fonts, spacing } from '../lib/theme';

type Props = {
  title: string;
  dismissKind: 'back' | 'close';
  onDismiss: () => void;
  // Optional trailing slot (e.g. a Save action). Only used in 'back' mode — in
  // 'close' mode the X owns the right slot.
  right?: React.ReactNode;
};

export function ScreenHeader({ title, dismissKind, onDismiss, right }: Props) {
  const isClose = dismissKind === 'close';
  return (
    <View style={styles.header}>
      {/* Left slot — back chevron when pushed; empty spacer in modal mode. */}
      {isClose ? (
        <View style={styles.side} />
      ) : (
        <Pressable
          onPress={onDismiss}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [styles.side, pressed && styles.pressed]}
        >
          <ChevronLeft color={colors.text} />
        </Pressable>
      )}

      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>

      {/* Right slot — X when presented as a modal; otherwise the optional `right`. */}
      {isClose ? (
        <Pressable
          onPress={onDismiss}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={({ pressed }) => [styles.side, styles.sideRight, pressed && styles.pressed]}
        >
          <CloseIcon color={colors.text} />
        </Pressable>
      ) : (
        <View style={[styles.side, styles.sideRight]}>{right}</View>
      )}
    </View>
  );
}

function ChevronLeft({ size = 24, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="m15.75 4.5-7.5 7.5 7.5 7.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function CloseIcon({ size = 24, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 18L18 6M6 6l12 12"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  side: { width: 36, height: 36, justifyContent: 'center' },
  sideRight: { alignItems: 'flex-end' },
  pressed: { opacity: 0.6 },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.xxl,
    fontFamily: fonts.regular,
    color: colors.text,
    letterSpacing: -0.5,
  },
});
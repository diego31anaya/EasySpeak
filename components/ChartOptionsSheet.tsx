// components/ChartOptionsSheet.tsx
//
// Bottom-sheet picker for the Profile chart's RANGE (Recent / All time). Metric selection
// lives in the chip row above the graph, so this sheet holds only the range. An inline RN
// <Modal> sheet — a contextual control tied to the Profile screen (the FilterSheet /
// ConfirmationSheet family), reusing ConfirmationSheet's backdrop-fade + slide-up
// lifecycle. The parent owns `visible`, the current selection, and the onSelect
// callback (so the sheet stays presentational).

import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

import { colors, spacing, fontSize, fonts, radius } from '../lib/theme';
import { ANIM_DURATION, ANIM_EASING } from '../lib/animation';

export type ChartRange = 'recent' | 'allTime';

const RANGE_OPTIONS: { id: ChartRange; label: string }[] = [
  { id: 'recent', label: 'Recent' },
  { id: 'allTime', label: 'All time' },
];

// Drag-to-dismiss (matches FilterSheet): releasing past this distance (px) OR flicking faster
// than this velocity (px/s) closes the sheet; otherwise it springs back.
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;

type Props = {
  visible: boolean;
  range: ChartRange;
  onSelectRange: (r: ChartRange) => void;
  onClose: () => void;
};

export function ChartOptionsSheet({ visible, range, onSelectRange, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);
  const [shouldRender, setShouldRender] = useState(visible);
  // Measured sheet height (shared value — the slide-up worklet reads it on the UI thread).
  const sheetHeight = useSharedValue(0);
  // Live downward-drag offset, added on top of the open/close translateY.
  const dragY = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      dragY.value = 0; // reset a prior drag-dismiss so a reopen starts clean
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
  }, [visible, progress, dragY]);

  // Scrim fades as the sheet is dragged down (and with the open/close progress).
  const backdropStyle = useAnimatedStyle(() => {
    const h = sheetHeight.value || 1;
    const dragProgress = Math.min(dragY.value / h, 1);
    return { opacity: progress.value * 0.5 * (1 - dragProgress) };
  });
  // Open/close translateY plus the live drag offset.
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * sheetHeight.value + dragY.value }],
  }));

  // Drag DOWN from anywhere on the sheet to dismiss. activeOffsetY(10) claims only downward
  // drags past ~10px, so taps on the option rows pass through.
  const pan = Gesture.Pan()
    .activeOffsetY(10)
    .onUpdate((e) => {
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      const dismiss =
        e.translationY > 0 && (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY);
      if (dismiss) {
        dragY.value = withTiming(
          sheetHeight.value,
          { duration: ANIM_DURATION, easing: ANIM_EASING },
          (finished) => {
            if (finished) scheduleOnRN(onClose);
          },
        );
      } else {
        dragY.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });

  if (!shouldRender) return null;

  return (
    <Modal transparent animationType="none" onRequestClose={onClose}>
      {/* Modals render outside the app-root GestureHandlerRootView, so the drag gesture
          needs its own root here. */}
      <GestureHandlerRootView style={styles.root}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      {/* Drag down from anywhere on the sheet to dismiss. */}
      <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }, sheetStyle]}
        onLayout={(e) => {
          sheetHeight.value = e.nativeEvent.layout.height;
        }}
      >
        <View style={styles.handle} />
        <Text style={styles.title}>Range</Text>

        {RANGE_OPTIONS.map((o, i) => (
          <OptionRow
            key={o.id}
            label={o.label}
            selected={o.id === range}
            showDivider={i > 0}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onSelectRange(o.id);
            }}
          />
        ))}
      </Animated.View>
      </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

function OptionRow({
  label,
  selected,
  showDivider,
  onPress,
}: {
  label: string;
  selected: boolean;
  showDivider: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, showDivider && styles.rowDivider, pressed && styles.rowPressed]}
    >
      <Text style={[styles.rowLabel, selected && styles.rowLabelSelected]}>{label}</Text>
      {selected ? <CheckIcon color={colors.accent} /> : null}
    </Pressable>
  );
}

// Heroicons check (outline) — marks the selected option.
function CheckIcon({ color, size = 20 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4.5 12.75l6 6 9-13.5"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  // Fills the Modal so the gesture root + absolute children lay out correctly.
  root: { flex: 1 },
  backdrop: {
    backgroundColor: '#000',
  },
  // Full-width bottom sheet pinned to the screen's bottom edge, rounded top corners.
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surfaceElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    // paddingBottom is applied inline so it can include the safe-area inset.
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.lg,
    fontFamily: fonts.regular,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  rowPressed: { opacity: 0.6 },
  rowLabel: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  rowLabelSelected: {
    fontFamily: fonts.medium,
    color: colors.accent,
  },
});
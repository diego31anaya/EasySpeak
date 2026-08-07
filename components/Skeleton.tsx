// components/Skeleton.tsx
//
// Reusable loading-placeholder primitive: a single pulsing box. Compose several
// of these to mimic real content (see SessionCardSkeleton). The pulse animation
// and the placeholder fill live here only, so every skeleton in the app shares
// one source of truth — tweak the timing/fill once and they all update.

import { useEffect } from 'react';
import {
  StyleSheet,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors, radius } from '../lib/theme';

type SkeletonProps = {
  width?: DimensionValue;
  height?: DimensionValue;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
};

export function Skeleton({ width, height, borderRadius = radius.sm, style }: SkeletonProps) {
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    // Pulse 0.5 → 1 → 0.5 forever (reverse:true eases it back down).
    opacity.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[styles.base, { width, height, borderRadius }, style, animatedStyle]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.skeleton,
  },
});
// components/Shimmer.tsx
//
// A loading affordance: a soft highlight band that sweeps left → right across
// its parent, looping. Render it as an absolute overlay inside a parent that
// has `overflow: 'hidden'` (position defaults to relative). pointerEvents is
// none so it never blocks touches. Distinct from Skeleton (which pulses
// opacity in place) — this one travels.

import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

type ShimmerProps = {
  // Peak color of the sweep. Default is a soft accent-blue so it reads as
  // "active / loading" against the matte surfaces.
  highlight?: string;
  durationMs?: number;
};

export function Shimmer({
  highlight = 'rgba(168, 213, 255, 0.12)',
  durationMs = 1100,
}: ShimmerProps) {
  const widthSV = useSharedValue(0);
  const [hasWidth, setHasWidth] = useState(false);
  const progress = useSharedValue(0);
  // Key the start on whether width is KNOWN (a boolean), not on its value.
  // onLayout can re-fire with a slightly different width mid-sweep; keying on
  // the value would re-run this effect and reset progress to 0 — the band
  // would paint at its current (mid) spot, then snap back to the left. That's
  // the "starts in the middle, then teleports" glitch. The transform reads
  // `width` live below, so a re-measure just repositions the band, never
  // restarts the loop. Width lives in a shared value (widthSV) so a re-measure
  // updates the sweep on the UI thread with NO React re-render — re-renders are
  // what could repaint the band mid-stroke. hasWidth is a one-time boolean flip
  // (set in onLayout) that reveals the band and starts the loop exactly once.

  useEffect(() => {
    if (!hasWidth) return;
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: durationMs, easing: Easing.linear }),
      -1,
      false,
    );
    // Cancel on unmount so the value can't keep advancing off-screen.
    return () => cancelAnimation(progress);
  }, [hasWidth, durationMs, progress]);

  // Band is the parent's width; slide it from fully-left-off to fully-right-off
  // so the highlight peak sweeps across.
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -widthSV.value + progress.value * 2 * widthSV.value }],
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    widthSV.value = w; // UI thread: a re-measure won't trigger a React re-render
    if (!hasWidth && w > 0) setHasWidth(true);
  };

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={onLayout}>
      {hasWidth && (
        <Animated.View
          style={[
            // Static off-left baseline. If Reanimated lags applying the worklet
            // by a frame (likely while the push hammers the UI thread), the band
            // still starts off-screen-left instead of flashing at its default
            // (centered) transform — that flash was the residual "starts in the
            // middle, then snaps left" glitch.
            StyleSheet.absoluteFill,
            { transform: [{ translateX: '-100%' }] },
            animatedStyle,
          ]}
        >
          <LinearGradient
            colors={['transparent', highlight, 'transparent']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </View>
  );
}
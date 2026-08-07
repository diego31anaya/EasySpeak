// components/AnimatedFlame.tsx
//
// A flickering flame for the streaks-modal "alive" states (at-risk / done-today).
// Reuses the badge's silhouette + palette (OUTER_FLAME / INNER_FLAME / FLAME_COLORS)
// so the hero reads as the same fire as the header badge.
//
// All motion is Reanimated transforms/opacity on the UI thread — the SVG paths are
// STATIC, so nothing re-renders per frame (only native view props change):
//   - a warm radial glow halo pulses behind the flame,
//   - the flame body bobs (height), sways, and tilts,
//   - a brighter inner core flickers on top.
// Each oscillator runs at its own near-coprime period so the combined motion never
// visibly loops. Judge smoothness on a RELEASE build (debug Reanimated is slow on
// the iPhone XS — see CLAUDE.md "Build & run").

import { useEffect, useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';

import { FLAME_COLORS, INNER_FLAME, OUTER_FLAME } from './StreakBadge';

type Props = {
  size?: number;
  // The warm halo behind the flame. On by default (the modal hero); pass false for
  // small inline uses (e.g. the banner) where the halo would bleed past the icon.
  glow?: boolean;
};

export function AnimatedFlame({ size = 140, glow = true }: Props) {
  // Colon-free, per-instance gradient ids (useId emits ':r0:', an invalid SVG
  // fragment id) so two flames on screen can't collide on a shared id.
  const uid = useId().replace(/:/g, '');
  const bodyId = 'flameBody' + uid;
  const glowId = 'flameGlow' + uid;

  // Each value oscillates start↔end on its own period (reverse:true eases back).
  const bob = useSharedValue(1); // flame height (scaleY)
  const sway = useSharedValue(-1); // horizontal drift (translateX)
  const tilt = useSharedValue(-1); // slight lean (rotateZ)
  const core = useSharedValue(0.55); // inner-core opacity flicker
  const glowScale = useSharedValue(0.92);
  const glowOpacity = useSharedValue(0.35);

  useEffect(() => {
    const sin = Easing.inOut(Easing.sin);
    bob.value = withRepeat(withTiming(1.09, { duration: 700, easing: sin }), -1, true);
    sway.value = withRepeat(withTiming(1, { duration: 1500, easing: sin }), -1, true);
    tilt.value = withRepeat(withTiming(1, { duration: 1900, easing: sin }), -1, true);
    core.value = withRepeat(
      withTiming(1, { duration: 430, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    glowScale.value = withRepeat(withTiming(1.12, { duration: 1300, easing: sin }), -1, true);
    glowOpacity.value = withRepeat(withTiming(0.6, { duration: 1100, easing: sin }), -1, true);
    return () => {
      // Stop the loops on unmount (the modal closing) so they can't keep running.
      cancelAnimation(bob);
      cancelAnimation(sway);
      cancelAnimation(tilt);
      cancelAnimation(core);
      cancelAnimation(glowScale);
      cancelAnimation(glowOpacity);
    };
  }, [bob, sway, tilt, core, glowScale, glowOpacity]);

  const swayPx = size * 0.018; // size-relative so it's not disproportionate when small
  const flameStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: sway.value * swayPx },
      { rotateZ: `${tilt.value * 2}deg` },
      { scaleY: bob.value },
      { scaleX: 1 - (bob.value - 1) * 0.4 }, // narrow a touch as it stretches up
    ],
  }));
  const coreStyle = useAnimatedStyle(() => ({ opacity: core.value }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
    transform: [{ scale: glowScale.value }],
  }));

  const glowSize = size * 1.6;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {glow ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.glow, { width: glowSize, height: glowSize }, glowStyle]}
        >
          <Svg width={glowSize} height={glowSize} viewBox="0 0 100 100">
            <Defs>
              <RadialGradient id={glowId} cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor={FLAME_COLORS.glow} stopOpacity={0.55} />
                <Stop offset="60%" stopColor={FLAME_COLORS.glow} stopOpacity={0.18} />
                <Stop offset="100%" stopColor={FLAME_COLORS.glow} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx="50" cy="50" r="50" fill={`url(#${glowId})`} />
          </Svg>
        </Animated.View>
      ) : null}

      <Animated.View style={[styles.flame, flameStyle]}>
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Defs>
            <RadialGradient id={bodyId} cx="50%" cy="58%" r="60%">
              <Stop offset="0%" stopColor={FLAME_COLORS.core} />
              <Stop offset="55%" stopColor={FLAME_COLORS.mid} />
              <Stop offset="100%" stopColor={FLAME_COLORS.edge} />
            </RadialGradient>
          </Defs>
          <Path d={OUTER_FLAME} fill={`url(#${bodyId})`} />
        </Svg>
        {/* Brighter inner core, flickering on top of the static body. */}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, coreStyle]}>
          <Svg width={size} height={size} viewBox="0 0 24 24">
            <Path d={INNER_FLAME} fill={FLAME_COLORS.innerCore} />
          </Svg>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  // Anchor the bob/scale at the flame base so it grows upward like a real flame
  // (no-op on RN versions without transformOrigin → falls back to center scale).
  flame: { transformOrigin: 'center bottom' },
});
// components/StreakBanner.tsx
//
// A small banner that drops down from the top of a results screen after a practice
// that started or continued a streak: a fire icon on the left, text on the right.
// Self-contained motion — on mount it drops in from above the top edge, holds for a
// beat, then retracts up (pointerEvents none, so it never blocks the header it
// passes over). Mount it once with the event kind; it plays and parks off-screen.
//
// The flame: a `continued` streak shows the lit animated flame straight away; a
// `started` (day-one) streak begins as a grey silhouette and IGNITES — crossfading
// into the lit, flickering AnimatedFlame once the banner has dropped in.
//
// The text: `started` reads "New streak"; `continued` reads "{n} day streak" and
// TICKS UP while the banner rests — it shows the previous count, then bumps to the
// new one (with a little pop) so the user sees the streak increase.

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { BOX_SHADOW_ELEVATED, colors, fontSize, fonts, radius, spacing } from '../lib/theme';
import type { StreakEvent } from '../lib/streak';
import { OUTER_FLAME } from './StreakBadge';
import { AnimatedFlame } from './AnimatedFlame';

const BANNER_HEIGHT = 48; // approx, only used to size the off-screen offset
const HOLD_MS = 2200; // time the banner rests on screen before retracting

const COUNT_BUMP_MS = 1100; // after the drop settles, tick the count up

type Props = { event: Exclude<StreakEvent, { kind: 'none' }> };

export function StreakBanner({ event }: Props) {
  const insets = useSafeAreaInsets();
  const restY = insets.top + spacing.sm; // resting spot, just below the notch
  const hiddenY = -(BANNER_HEIGHT + insets.top + spacing.xl); // fully above the edge

  const y = useSharedValue(hiddenY);

  useEffect(() => {
    // Drop in → hold → retract.
    y.value = withSequence(
      withTiming(restY, { duration: 420, easing: Easing.out(Easing.cubic) }),
      withDelay(HOLD_MS, withTiming(hiddenY, { duration: 320, easing: Easing.in(Easing.cubic) })),
    );
  }, [y, restY, hiddenY]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  // Continued: start on the previous count, then bump to the new one while resting.
  const counting = event.kind === 'continued';
  const [count, setCount] = useState(counting ? event.count - 1 : event.count);
  const pop = useSharedValue(1);

  useEffect(() => {
    if (!counting) return;
    const t = setTimeout(() => {
      setCount(event.count);
      // A quick scale pop on the label so the increase catches the eye (kept modest
      // so the enlarged text stays within the pill's padding / off the flame).
      pop.value = withSequence(
        withTiming(1.15, { duration: 150, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 230, easing: Easing.in(Easing.quad) }),
      );
    }, COUNT_BUMP_MS);
    return () => clearTimeout(t);
  }, [counting, event, pop]);

  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  const text = counting ? `${count} day streak` : 'New streak';

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, style]}>
      <Animated.View style={styles.banner}>
        <BannerFlame kind={event.kind} />
        <Animated.Text style={[styles.text, popStyle]}>{text}</Animated.Text>
      </Animated.View>
    </Animated.View>
  );
}

const FLAME_SIZE = 24;

// The banner's flame. `continued` is lit (animated) from the start; `started`
// begins as a grey silhouette and ignites — crossfading into the lit AnimatedFlame
// (which flickers underneath the whole time) a beat after the banner drops in. One
// `lit` value drives both layers (grey = 1 - lit) so the crossfade stays clean.
function BannerFlame({ kind }: { kind: 'started' | 'continued' }) {
  const lit = useSharedValue(kind === 'started' ? 0 : 1);

  useEffect(() => {
    if (kind === 'started') {
      lit.value = withDelay(500, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
    }
  }, [kind, lit]);

  const litStyle = useAnimatedStyle(() => ({ opacity: lit.value }));
  const greyStyle = useAnimatedStyle(() => ({ opacity: 1 - lit.value }));

  return (
    <View style={{ width: FLAME_SIZE, height: FLAME_SIZE }}>
      <Animated.View style={[StyleSheet.absoluteFill, litStyle]}>
        <AnimatedFlame size={FLAME_SIZE} glow={false} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, greyStyle]}>
        <Svg width={FLAME_SIZE} height={FLAME_SIZE} viewBox="0 0 24 24">
          <Path d={OUTER_FLAME} fill={colors.textMuted} />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Pinned to the top edge and horizontally centered; the translateY drives the
  // drop. Absolute so it overlays the screen's header as it passes.
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    boxShadow: BOX_SHADOW_ELEVATED,
  },
  text: { fontFamily: fonts.semibold, fontSize: fontSize.md, color: colors.text },
});
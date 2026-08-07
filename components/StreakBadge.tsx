// components/StreakBadge.tsx
//
// Flame icon + day count. Appears in tab-screen headers (Home, Practice).
//   count === 0 → muted grey (no streak yet / lapsed)
//   count > 0   → warm orange (active streak)
//
// Presentational only — the count comes from `useStreak()` (hooks/use-streak.tsx),
// which reads the cached counter off the profile and derives the live value (0 if
// the streak has lapsed). See lib/streak.ts + the streak migrations.

import { useId } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Path, RadialGradient, Stop } from 'react-native-svg';

import { colors, fontSize, fonts, spacing } from '../lib/theme';

// Active-flame palette. Shared with AnimatedFlame (the streaks-modal hero) so the
// animated flame and the badge read as the same fire. Radial body: amber core →
// orange → deep-red edge; `innerCore` is the brighter inner-flame fill; `glow` is
// the warm halo color (and the active count-text color).
export const FLAME_COLORS = {
  core: '#FFC24D',
  mid: '#FF6F2C',
  edge: '#DC2A15',
  innerCore: '#FFD884',
  glow: '#FF8C42',
};

const ACTIVE_COLOR = FLAME_COLORS.glow;

// Heroicons "fire" — outer flame body + inner flame. Stroked grey when dormant,
// filled (orange-core → red-edge gradient + amber inner core) when active.
export const OUTER_FLAME =
  'M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.047 8.287 8.287 0 0 0 9 9.601a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z';
export const INNER_FLAME =
  'M12 18a3.75 3.75 0 0 0 .495-7.467 5.99 5.99 0 0 0-1.925 3.546 5.974 5.974 0 0 1-2.133-1A3.75 3.75 0 0 0 12 18Z';

type Props = { count: number; iconSize?: number; onPress?: () => void };

export function StreakBadge({ count, iconSize = 20, onPress }: Props) {
  const active = count > 0;
  const textColor = active ? ACTIVE_COLOR : colors.textMuted;
  const content = (
    <>
      <FireIcon size={iconSize} active={active} />
      <Text style={[styles.count, { color: textColor }]}>{count}</Text>
    </>
  );
  // Tappable when an onPress is given (opens the Streaks modal from the headers).
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        hitSlop={8}
        style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      >
        {content}
      </Pressable>
    );
  }
  return <View style={styles.container}>{content}</View>;
}

function FireIcon({ size, active }: { size: number; active: boolean }) {
  // Unique, colon-free gradient id per instance (useId emits ':r0:' which is an
  // invalid SVG fragment id) so the two header badges can't collide.
  const gid = 'flame' + useId().replace(/:/g, '');

  if (!active) {
    // Dormant (no streak / lapsed): subtle grey outline.
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path d={OUTER_FLAME} stroke={colors.textMuted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <Path d={INNER_FLAME} stroke={colors.textMuted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    );
  }

  // Active: filled flame — orange core grading to red at the edges/tips (radial),
  // with a brighter amber inner core for depth.
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Defs>
        <RadialGradient id={gid} cx="50%" cy="58%" r="60%">
          <Stop offset="0%" stopColor={FLAME_COLORS.core} />
          <Stop offset="55%" stopColor={FLAME_COLORS.mid} />
          <Stop offset="100%" stopColor={FLAME_COLORS.edge} />
        </RadialGradient>
      </Defs>
      <Path d={OUTER_FLAME} fill={`url(#${gid})`} />
      <Path d={INNER_FLAME} fill={FLAME_COLORS.innerCore} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  count: {
    fontSize: fontSize.lg,
    fontFamily: fonts.medium,
  },
  pressed: { opacity: 0.6 },
});

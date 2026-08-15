// app/(app)/streaks.tsx
//
// Streaks modal — presented as a card (presentation: 'modal' in (app)/_layout.tsx),
// so it slides up and swipes down to dismiss. Opened by tapping the StreakBadge in
// the Home/Practice headers. Header = centered title + X to close; the body branches
// on streakState() (see the streaks state table) — a big flame + text per state.
// Only the NO-STREAK state (new / lapsed-with-a-1-day-best) is built so far; the
// rest are stubbed.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';

import { colors, fontSize, fonts, spacing } from '../../lib/theme';
import { backFlow } from '../../lib/navigation';
import {
  streakState,
  type StreakState,
} from '../../lib/streak';
import { OUTER_FLAME } from '../../components/StreakBadge';
import { AnimatedFlame } from '../../components/AnimatedFlame';
import { useLocalDay } from '../../hooks/use-local-day';
import { useStreak } from '../../hooks/use-streak';

export default function Streaks() {
  const localDay = useLocalDay();

  const {
    streak,
    isPending,
    isError,
  } = useStreak();

  const close = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
            {/* Left spacer keeps the title optically centered against the X. */}
            <View style={styles.side} />
            <Text style={styles.title}>Streaks</Text>
            <Pressable
              onPress={close}
              hitSlop={12}
              style={({ pressed }) => [styles.side, styles.sideRight, pressed && styles.pressed]}
            >
              <CloseIcon color={colors.text} />
            </Pressable>
          </View>
        </View>

        <View style={styles.body}>
          {streak ? (
            <StreakBody state={streakState(streak, localDay)} />
          ) : isPending ? null : isError ? (
            <Text style={styles.errorText}>Couldn&apos;t load your streak.</Text>
          ) : null}
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

function StreakBody({ state }: { state: StreakState }) {
  switch (state.kind) {
    case 'new':
    case 'lapsedTrivial':
      return <NoStreak />;
    case 'lapsed':
      return <Lapsed longest={state.longest} />;
    case 'atRisk':
    case 'doneToday':
      return <AliveStreak state={state} />;
  }
}

// No streak yet (never started, or a lapsed 1-day "streak"): a big greyed flame +
// a nudge to start. COPY IS PLACEHOLDER.
function NoStreak() {
  return (
    <View style={styles.hero}>
      <Flame size={140} color={colors.textMuted} />
      <Text style={styles.heroTitle}>No streak yet</Text>
      <Text style={styles.heroBody}>Practice today to start one.</Text>
    </View>
  );
}

// Lapsed with a real best (>1 day) to chase: greyed flame + the previous record,
// nudging a fresh streak to beat it. COPY IS PLACEHOLDER.
function Lapsed({ longest }: { longest: number }) {
  return (
    <View style={styles.hero}>
      <Flame size={140} color={colors.textMuted} />
      <Text style={styles.heroTitle}>Streak reset</Text>
      <Text style={styles.heroBody}>
        Your best was {longest} days. Practice today to start a new one and beat it.
      </Text>
    </View>
  );
}

// Alive states (at-risk + done-today): the animated flame + a count and a nudge.
// Same shape as the other states (flame in the middle + text below).
function AliveStreak({
  state,
}: {
  state: Extract<StreakState, { kind: 'atRisk' | 'doneToday' }>;
}) {
  const { title, body } = aliveCopy(state);
  return (
    <View style={styles.hero}>
      <AnimatedFlame size={140} />
      <Text style={styles.heroTitle}>{title}</Text>
      <Text style={styles.heroBody}>{body}</Text>
    </View>
  );
}

// Title + nudge for the four alive cases. COPY IS PLACEHOLDER (dev to finalize).
//   atRisk    — practiced yesterday, not yet today → today keeps it alive.
//   doneToday — already practiced today, so every nudge points at tomorrow:
//     isDayOne  — a brand-new (or just-restarted) streak.
//     isRecord  — the current run is their all-time best.
//     otherwise — ongoing, but not yet back to their record.
function aliveCopy(
  state: Extract<StreakState, { kind: 'atRisk' | 'doneToday' }>,
): { title: string; body: string } {
  const streakTitle = `${state.current} day streak`;

  if (state.kind === 'atRisk') {
    return { title: streakTitle, body: 'Practice today to keep your streak going.' };
  }
  if (state.isDayOne) {
    return { title: 'Day 1', body: 'Practice again tomorrow to keep your new streak alive.' };
  }
  if (state.isRecord) {
    return { title: streakTitle, body: 'Keep practicing to keep your best streak alive.' };
  }
  return { title: streakTitle, body: `Keep it up to beat your best of ${state.longest} days.` };
}

// Solid single-color flame silhouette (shared shape from StreakBadge). The active
// states will swap in the colored / animated flame.
function Flame({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={OUTER_FLAME} fill={color} />
    </Svg>
  );
}

// X / close — sized to match the back-chevron icons (24) for header consistency.
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
  // Equal side widths (match the review screens' back button) so the title centers.
  side: { width: 36, height: 36, justifyContent: 'center' },
  sideRight: { alignItems: 'flex-end' },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.xxl,
    fontFamily: fonts.regular,
    color: colors.text,
    letterSpacing: -0.5,
  },
  pressed: { opacity: 0.6 },

  // Body: centered hero (flame + text), fills the space below the header.
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  hero: { alignItems: 'center', gap: spacing.sm },
  heroTitle: {
    marginTop: spacing.md,
    fontSize: fontSize.xl,
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  heroBody: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
  },
  errorText: { fontSize: fontSize.md, fontFamily: fonts.regular, color: colors.danger },
});

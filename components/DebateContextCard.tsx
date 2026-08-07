// components/DebateContextCard.tsx
//
// The "here's what you argued" context block shown between the metrics and the transcript
// on the Debate results + review bodies: the statement + the side taken. The "Statement"
// label matches the AiFeedbackCard "AI Feedback" title. Presentational; both debate-results
// and debate-review render it.

import { StyleSheet, Text } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { ANIM_DURATION, ANIM_EASING } from '../lib/animation';
import { colors, spacing, fontSize, fonts } from '../lib/theme';
import type { DebateStance } from '../lib/debate-feedback';

export function DebateContextCard({ statement, stance }: { statement: string; stance: DebateStance }) {
  return (
    <Animated.View
      style={styles.card}
      layout={LinearTransition.duration(ANIM_DURATION).easing(ANIM_EASING)}
    >
      <Text style={styles.label}>Statement</Text>
      <Text style={styles.statement}>{statement}</Text>
      <Text style={styles.stance}>You argued: {stance === 'agree' ? 'Agree' : 'Disagree'}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.xs,
  },
  label: {
    fontSize: fontSize.lg,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  statement: {
    fontSize: fontSize.md,
    fontFamily: fonts.medium,
    color: colors.text,
    lineHeight: 24,
  },
  stance: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
});

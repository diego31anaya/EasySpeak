// components/OverallCard.tsx
//
// The "Overall" summary card for a 3-2-1 session: total filler words across the
// three rounds + the average AI score. Extracted from tto-results so both the
// practice results screen and the review screen render the same card.

import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, spacing, fontSize, fonts, radius, HERO_FILL, BOX_SHADOW_ELEVATED } from '../lib/theme';
import { scoreStatus, scoreColor } from './metric-scoring';

type OverallCardProps = {
  totalFillers: number;
  averageScore: number | null;
  hasError: boolean;
};

export function OverallCard({ totalFillers, averageScore, hasError }: OverallCardProps) {
  let scoreDisplay: ReactNode;
  if (averageScore !== null) {
    const status = scoreStatus(averageScore);
    scoreDisplay = (
      <Text style={[styles.statValue, { color: scoreColor(status) }]}>
        {averageScore.toFixed(1)}
        <Text style={styles.statValueSuffix}> / 10</Text>
      </Text>
    );
  } else {
    scoreDisplay = (
      <Text style={[styles.statValue, { color: scoreColor('pending') }]}>
        —<Text style={styles.statValueSuffix}> / 10</Text>
      </Text>
    );
  }
  return (
    <LinearGradient
      colors={HERO_FILL}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.card}
    >
      <Text style={styles.cardTitle}>Overall</Text>
      <View style={styles.statsGrid}>
        <View style={styles.statCell}>
          <Text style={styles.statValue}>{totalFillers}</Text>
          <Text style={styles.statLabel}>filler words</Text>
        </View>
        <View style={styles.statCell}>
          {scoreDisplay}
          <Text style={styles.statLabel}>
            {hasError ? 'score unavailable' : 'average score'}
          </Text>
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    // backgroundColor handled by the HERO_FILL LinearGradient.
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    // Two stacked shadows: a soft white highlight above (lit-from-above
    // hint) and a deeper black shadow below (the card "lifts" off the
    // background). Requires RN 0.76+ — confirmed by package.json.
    boxShadow: BOX_SHADOW_ELEVATED,
  },
  cardTitle: {
    fontSize: fontSize.lg,
    fontFamily: fonts.regular,
    color: colors.text,
    marginBottom: spacing.md,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statCell: {
    flexDirection: 'column',
  },
  statValue: {
    fontSize: fontSize.xxl,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: fontSize.xxl * 1.1,
  },
  // Inline suffix like "/ 10" — smaller and muted so it doesn't compete with
  // the headline number.
  statValueSuffix: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  statLabel: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 4,
  },
});
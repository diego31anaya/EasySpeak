// components/ReviewSkeleton.tsx
//
// Loading skeletons for the two review screens, shaped to match the real
// content so the loading→loaded swap doesn't jump:
//   - ImpromptuReviewSkeleton — the contentCard body.
//   - TtoReviewSkeleton — the Overall card + the first round expanded (it's
//     defaultExpanded in the real screen) + two collapsed rounds.
//
// MetricBlockSkeleton is the shared inner block (AI feedback + four metric
// rows + transcript + audio) — the same body the impromptu screen shows and a
// tto expanded round shows. It returns a fragment so the parent card's `gap`
// spaces its pieces exactly like the real components (whose four metric rows
// are likewise direct children of the card via MetricRowGroup's fragment).

import { StyleSheet, View } from 'react-native';

import { colors, spacing, radius, BOX_SHADOW_ELEVATED } from '../lib/theme';
import { Skeleton } from './Skeleton';

function MetricBlockSkeleton() {
  return (
    <>
      {/* AI feedback: 44px orb slot + title, then a few prose lines. */}
      <View>
        <View style={s.feedbackHeader}>
          <Skeleton width={44} height={44} borderRadius={22} />
          <Skeleton width="45%" height={18} />
        </View>
        <View style={s.prose}>
          <Skeleton width="100%" height={14} />
          <Skeleton width="100%" height={14} />
          <Skeleton width="70%" height={14} />
        </View>
      </View>

      {/* Four metric rows — each with the top hairline + vertical padding of a
          flat MetricRow, an icon, two stacked text lines, and a chevron. */}
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={s.metricRow}>
          <Skeleton width={24} height={24} borderRadius={radius.md} />
          <View style={s.metricText}>
            <Skeleton width="38%" height={16} />
            <Skeleton width="55%" height={12} />
          </View>
          <Skeleton width={16} height={16} borderRadius={8} />
        </View>
      ))}

      {/* Transcript — top hairline, header (title + legend), then the body. */}
      <View style={s.transcript}>
        <View style={s.transcriptHeader}>
          <Skeleton width={96} height={18} />
          <Skeleton width={120} height={12} />
        </View>
        <Skeleton width="100%" height={150} borderRadius={radius.md} />
      </View>

      {/* Audio — track, time labels, and the three-button transport. */}
      <View style={s.audio}>
        <Skeleton width="100%" height={3} borderRadius={2} />
        <View style={s.audioMeta}>
          <Skeleton width={32} height={11} />
          <Skeleton width={32} height={11} />
        </View>
        <View style={s.transport}>
          <Skeleton width={36} height={36} borderRadius={18} />
          <Skeleton width={44} height={44} borderRadius={22} />
          <Skeleton width={36} height={36} borderRadius={18} />
        </View>
      </View>
    </>
  );
}

export function ImpromptuReviewSkeleton() {
  return (
    <View style={s.scrollContent}>
      <View style={s.contentCard}>
        <MetricBlockSkeleton />
      </View>
    </View>
  );
}

export function TtoReviewSkeleton() {
  return (
    <View style={s.scrollContent}>
      {/* Overall card */}
      <View style={s.overall}>
        <Skeleton width={80} height={18} />
        <View style={s.statsRow}>
          <View style={s.statCell}>
            <Skeleton width={56} height={28} />
            <Skeleton width={70} height={12} />
          </View>
          <View style={s.statCell}>
            <Skeleton width={56} height={28} />
            <Skeleton width={84} height={12} />
          </View>
        </View>
      </View>

      {/* "1 Thing" — expanded by default in the real screen. */}
      <View style={s.roundCard}>
        <RoundHeaderSkeleton />
        <View style={s.roundExpanded}>
          <MetricBlockSkeleton />
        </View>
      </View>

      {/* "2 Types" / "3 Steps" — collapsed. */}
      <View style={s.roundCard}>
        <RoundHeaderSkeleton />
      </View>
      <View style={s.roundCard}>
        <RoundHeaderSkeleton />
      </View>
    </View>
  );
}

function RoundHeaderSkeleton() {
  return (
    <>
      <View style={s.roundHeader}>
        <Skeleton width={72} height={18} />
        <View style={s.roundHeaderRight}>
          <Skeleton width={50} height={18} />
          <Skeleton width={18} height={18} borderRadius={9} />
        </View>
      </View>
      <Skeleton width={70} height={14} style={s.roundLine} />
      <Skeleton width="90%" height={14} style={s.roundLine} />
    </>
  );
}

const s = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },

  // Mirrors the impromptu contentCard (and a tto expanded round shares the same
  // inner block via MetricBlockSkeleton).
  contentCard: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    boxShadow: BOX_SHADOW_ELEVATED,
  },

  // ----- MetricBlockSkeleton -----
  feedbackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  prose: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  metricRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  metricText: {
    flex: 1,
    gap: 6,
  },
  transcript: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  transcriptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  audio: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  audioMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  transport: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },

  // ----- Overall card (tto) -----
  overall: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    boxShadow: BOX_SHADOW_ELEVATED,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statCell: {
    gap: 4,
  },

  // ----- Round card (tto) -----
  roundCard: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    overflow: 'hidden',
    boxShadow: BOX_SHADOW_ELEVATED,
  },
  roundHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  roundHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  roundLine: {
    marginTop: spacing.xs,
  },
  roundExpanded: {
    marginTop: spacing.lg,
    gap: spacing.md,
  },
});

// components/TranscriptCard.tsx
//
// Renders the transcript with inline filler highlighting (amber tag) and
// hesitation markers (red ellipsis between words). Tapping either seeks the
// linked audio player to that moment in the recording.
//
// Variants:
//   - 'card' (default): self-contained surface — surfaceElevated background,
//     border, rounded corners, internal padding. Used in impromptu-results.
//   - 'flat': no surface chrome, no padding, top hairline divider for
//     separation from preceding content. For placement inside a parent card
//     that owns the padding (e.g. TTO results round cards).

import { Fragment, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { ANIM_DURATION, ANIM_EASING } from '../lib/animation';
import { colors, spacing, fontSize, fonts, radius } from '../lib/theme';
import type { DeepgramWord } from '../lib/deepgram';

// --- Constants ---------------------------------------------------------------

// When the user taps a filler or hesitation, seek slightly before its onset
// so they hear the lead-in rather than landing mid-word.
const SEEK_LEAD_SEC = 0.5;

// --- Public types ------------------------------------------------------------

export type TranscriptCardVariant = 'card' | 'flat';

export type TranscriptCardProps = {
  words: DeepgramWord[];
  fillerIndices: Set<number>;
  hesitationPauseBeforeIndices: number[];
  intentionalPauseBeforeIndices: number[];
  onSeek?: (timeSec: number) => void;
  variant?: TranscriptCardVariant;
  // When false, render the SAME text/styles/wrapping but without the per-word
  // tap handlers — a cheaper first paint with byte-identical layout (no shift).
  // Flip true after the screen settles to enable tap-to-seek.
  interactive?: boolean;
};

// --- Component ---------------------------------------------------------------

export function TranscriptCard({
  words,
  fillerIndices,
  hesitationPauseBeforeIndices,
  intentionalPauseBeforeIndices,
  onSeek,
  variant = 'card',
  interactive = true,
}: TranscriptCardProps) {
  if (words.length === 0) return null;

  const hesitationSet = useMemo(
    () => new Set(hesitationPauseBeforeIndices),
    [hesitationPauseBeforeIndices],
  );

  const intentionalSet = useMemo(
    () => new Set(intentionalPauseBeforeIndices),
    [intentionalPauseBeforeIndices],
  );

  const handlePressFiller = (wordIndex: number) => {
    const time = Math.max(0, words[wordIndex].start - SEEK_LEAD_SEC);
    onSeek?.(time);
  };

  const handlePressHesitation = (wordIndex: number) => {
    const prevWordEnd = words[wordIndex - 1]?.end ?? 0;
    const time = Math.max(0, prevWordEnd - SEEK_LEAD_SEC);
    onSeek?.(time);
  };

  // Intentional pauses sit between words like hesitations, so seek the same way:
  // to just before the next word's onset.
  const handlePressIntentional = (wordIndex: number) => {
    const prevWordEnd = words[wordIndex - 1]?.end ?? 0;
    const time = Math.max(0, prevWordEnd - SEEK_LEAD_SEC);
    onSeek?.(time);
  };

  const outerStyle = variant === 'flat' ? styles.outerFlat : styles.outerCard;

  return (
    <Animated.View style={outerStyle} layout={LinearTransition.duration(ANIM_DURATION).easing(ANIM_EASING)}>
      <View style={styles.header}>
        <Text style={styles.title}>Transcript</Text>
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={styles.legendSwatchFiller} />
            <Text style={styles.legendText}>Filler</Text>
          </View>
          <View style={styles.legendItem}>
            <Text style={styles.legendSwatchHesitation}>…</Text>
            <Text style={styles.legendText}>Hesitation</Text>
          </View>
          <View style={styles.legendItem}>
            <Text style={styles.legendSwatchIntentional}>…</Text>
            <Text style={styles.legendText}>Intentional</Text>
          </View>
        </View>
      </View>

      <Text style={styles.body}>
        {words.map((word, i) => {
          const isFiller = fillerIndices.has(i);
          const hasHesitationBefore = hesitationSet.has(i);
          const hasIntentionalBefore = intentionalSet.has(i);
          const wordText = word.punctuated_word ?? word.word;
          const isFirst = i === 0;

          return (
            <Fragment key={i}>
              {!isFirst &&
                (hasHesitationBefore ? (
                  <Text
                    style={styles.hesitation}
                    onPress={interactive ? () => handlePressHesitation(i) : undefined}
                    suppressHighlighting
                  >
                    {' … '}
                  </Text>
                ) : hasIntentionalBefore ? (
                  <Text
                    style={styles.intentional}
                    onPress={interactive ? () => handlePressIntentional(i) : undefined}
                    suppressHighlighting
                  >
                    {' … '}
                  </Text>
                ) : (
                  ' '
                ))}
              {isFiller ? (
                <Text
                  style={styles.filler}
                  onPress={interactive ? () => handlePressFiller(i) : undefined}
                  suppressHighlighting
                >
                  {wordText}
                </Text>
              ) : (
                wordText
              )}
            </Fragment>
          );
        })}
      </Text>
    </Animated.View>
  );
}

// --- Styles ------------------------------------------------------------------

const styles = StyleSheet.create({
  outerCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  outerFlat: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.lg,
    fontFamily: fonts.regular,
    color: colors.text,
  },

  legend: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendSwatchFiller: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: 'rgba(239, 159, 39, 0.22)',
    borderWidth: 0.5,
    borderColor: 'rgba(239, 159, 39, 0.5)',
  },
  legendSwatchHesitation: {
    fontSize: fontSize.md,
    fontFamily: fonts.semibold,
    color: colors.danger,
    width: 14,
    textAlign: 'center',
  },
  legendSwatchIntentional: {
    fontSize: fontSize.md,
    fontFamily: fonts.semibold,
    color: colors.success,
    width: 14,
    textAlign: 'center',
  },
  legendText: {
    fontSize: fontSize.xs,
    fontFamily: fonts.medium,
    color: colors.textMuted,
  },

  // Generous lineHeight because this is the screen meant for careful reading,
  // not skimming.
  body: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 28,
  },

  // Inline padding on nested Text renders as a highlight "tag" on iOS;
  // Android renders it less consistently but still readable.
  filler: {
    backgroundColor: 'rgba(239, 159, 39, 0.22)',
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  hesitation: {
    color: colors.danger,
    fontFamily: fonts.semibold,
  },
  intentional: {
    color: colors.success,
    fontFamily: fonts.semibold,
  },
});
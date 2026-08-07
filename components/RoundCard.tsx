// components/RoundCard.tsx
//
// One collapsible round of a 3-2-1 session: header (shape label + AI score +
// chevron) and the question, expanding to the AI feedback + the four metric
// rows + transcript + audio. Extracted from tto-results so both the practice
// results screen and the review screen render rounds identically.
//
// `RoundData` is the per-round payload both screens build (the tto practice
// screen from nav params, the review screen from the stored session); it's
// exported here as the shared contract.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { colors, spacing, fontSize, fonts, radius, BOX_SHADOW_ELEVATED } from '../lib/theme';
import { ANIM_DURATION, ANIM_EASING } from '../lib/animation';
import type { SessionMetrics } from '../lib/metrics';
import type { DeepgramWord } from '../lib/deepgram';
import type { Shape } from '../lib/tto-framework-prompt';
import { AiFeedbackCard } from './AiOrb';
import { MetricRowGroup } from './MetricRowGroup';
import { scoreStatus, scoreColor } from './metric-scoring';
import { TranscriptCard } from './TranscriptCard';
import { AudioPlayback, type AudioPlaybackHandle } from './AudioPlayback';

const SHAPE_LABEL: Record<Shape, string> = {
  'one-thing': '1 Thing',
  'two-types': '2 Types',
  'three-steps': '3 Steps',
};

export type RoundData = {
  shape: Shape;
  prompt: string;
  transcript: string;
  words: DeepgramWord[];
  durationSec: number;
  audioUri: string;
};

type RoundCardProps = {
  shape: Shape;
  prompt: string;
  score: number | null;
  feedback: string | null;
  metrics: SessionMetrics | undefined;
  words: DeepgramWord[];
  durationSec: number;
  audioUri: string;
  onAudioRef: (handle: AudioPlaybackHandle | null) => void;
  onAudioPlay: () => void;
  defaultExpanded?: boolean;
};

export function RoundCard({
  shape,
  prompt,
  score,
  feedback,
  metrics,
  words,
  durationSec,
  audioUri,
  onAudioRef,
  onAudioPlay,
  defaultExpanded = false,
}: RoundCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const rotation = useSharedValue(0);

  const audioHandleRef = useRef<AudioPlaybackHandle | null>(null);

  useEffect(() => {
    rotation.value = withTiming(expanded ? 1 : 0, {
      duration: ANIM_DURATION,
      easing: ANIM_EASING,
    });
  }, [expanded, rotation]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value * 180}deg` }],
  }));

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpanded((prev) => !prev);
  };

  const handleSeek = (timeSec: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    audioHandleRef.current?.seekTo(timeSec);
  };

  let scoreDisplay: ReactNode;
  if (score !== null) {
    const status = scoreStatus(score);
    scoreDisplay = (
      <Text style={[styles.roundScore, { color: scoreColor(status) }]}>
        {score}
        <Text style={styles.roundScoreSuffix}> / 10</Text>
      </Text>
    );
  } else {
    scoreDisplay = (
      <Text style={[styles.roundScore, { color: scoreColor('pending') }]}>
        —<Text style={styles.roundScoreSuffix}> / 10</Text>
      </Text>
    );
  }

  return (
    <Animated.View
      style={styles.roundCard}
      layout={LinearTransition.duration(ANIM_DURATION).easing(ANIM_EASING)}
    >
      <Pressable onPress={handlePress}>
        <View style={styles.roundHeader}>
          <Text style={styles.roundTitle}>{SHAPE_LABEL[shape]}</Text>

          <View style={styles.roundHeaderRight}>
            {scoreDisplay}
            <Animated.View style={chevronStyle}>
              <ChevronDownIcon color={colors.textMuted} />
            </Animated.View>
          </View>
        </View>

        <Text style={styles.questionLabel}>Question:</Text>
        <Text style={styles.questionText}>"{prompt}"</Text>
      </Pressable>

      {expanded && (
        <Animated.View
          entering={FadeIn.duration(ANIM_DURATION).easing(ANIM_EASING)}
          exiting={FadeOut.duration(ANIM_DURATION).easing(ANIM_EASING)}
          style={styles.roundExpanded}
        >
          <AiFeedbackCard feedback={feedback ?? ''} error={!feedback} variant="flat" />

          {metrics && !metrics.tooShort && (
            <>
              <MetricRowGroup metrics={metrics} words={words} durationSec={durationSec} />

              <TranscriptCard
                words={words}
                fillerIndices={metrics.fillerIndices}
                hesitationPauseBeforeIndices={metrics.hesitationPauseBeforeIndices}
                intentionalPauseBeforeIndices={metrics.intentionalPauseBeforeIndices}
                onSeek={handleSeek}
                variant="flat"
              />

              {audioUri ? (
                <AudioPlayback
                  uri={audioUri}
                  ref={(handle) => {
                    audioHandleRef.current = handle;
                    onAudioRef(handle);
                  }}
                  onPlay={onAudioPlay}
                  variant="flat"
                />
              ) : null}
            </>
          )}
        </Animated.View>
      )}
    </Animated.View>
  );
}

// Local icon — kept here rather than imported from MetricRow because that
// would couple this component to MetricRow's internals. 12 lines of SVG is
// cheaper than the coupling.
function ChevronDownIcon({ size = 20, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="m19.5 8.25-7.5 7.5-7.5-7.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  roundCard: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    overflow: 'hidden', // keeps the expanded fade clean during the layout slide
    // Two stacked shadows: a soft white highlight above (lit-from-above
    // hint) and a deeper black shadow below (the card "lifts" off the
    // background). Requires RN 0.76+ — confirmed by package.json.
    boxShadow: BOX_SHADOW_ELEVATED,
  },
  roundHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  roundTitle: {
    fontSize: fontSize.lg,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  roundHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  roundScore: {
    fontSize: fontSize.lg,
    fontFamily: fonts.regular,
  },
  // "/ 10" suffix — smaller and always muted, like Overall card's pattern.
  roundScoreSuffix: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  questionLabel: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.text,
    marginTop: spacing.xs,
  },
  questionText: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    fontStyle: 'italic',
    lineHeight: 22,
    marginTop: spacing.xs,
  },
  roundExpanded: {
    marginTop: spacing.lg,
    gap: spacing.md,
  },
});
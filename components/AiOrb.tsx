// components/AiOrb.tsx
//
// Two related visual components used during AI interactions:
//   - <AiOrb amplitude={x}> — pulses/glows in response to audio amplitude
//     during TTS playback. Wire the `amplitude` prop to a live signal
//     (e.g. tts.amplitude from your TTS hook); the orb scales and brightens
//     proportionally.
//   - <AiOrbLoading /> — a comet-trail spinner shown while waiting for an
//     AI call to complete (prompt generation, etc.). Self-animating, no
//     props needed.
//
// Both share the same 200x200 container so they're visually swap-compatible
// in the same layout slot.

import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors, spacing, radius, fontSize, fonts } from '../lib/theme';
import { scoreStatus, scoreColor } from './metric-scoring';

// ============================================================
// AiOrb — amplitude-reactive
// ============================================================

type AiOrbProps = { amplitude: number };

export function AiOrb({ amplitude }: AiOrbProps) {
  // Real amplitude peaks around 0.2; multiply so the orb uses its full
  // visual range. (Empirically tuned in impromptu.tsx — keep in sync if the
  // amplitude source changes.)
  const intensity = Math.min(1, amplitude * 5);

  return (
    <View style={styles.orbContainer}>
      <View
        style={[
          styles.orbRing,
          {
            transform: [{ scale: 1 + intensity * 0.18 }],
            shadowOpacity: 0.7 + intensity * 0.3,
            shadowRadius: 28 + intensity * 22,
          },
        ]}
      />
    </View>
  );
}

// ============================================================
// AiOrbLoading — comet-trail spinner
// ============================================================

const TRAIL_LENGTH = 16;    // number of segments including the head
const TRAIL_DEGREES = 60;   // total angular span of the comet from head to trail

// Pre-compute trail segments. Each is offset further behind the head and dimmer.
// Opacity uses a quadratic falloff so the head reads bright and the tail dissolves.
const TRAIL_SEGMENTS = Array.from({ length: TRAIL_LENGTH }, (_, i) => {
  const t = i / (TRAIL_LENGTH - 1); // 0 at head, 1 at tail
  return {
    angle: -TRAIL_DEGREES * t,
    opacity: Math.pow(1 - t, 1.6),
    isHead: i === 0,
  };
});

export function AiOrbLoading() {
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, {
        // Spin speed: ms for one full 360° revolution. Lower = faster.
        duration: 900,
        easing: Easing.linear,
      }),
      -1,    // infinite
      false, // no reverse — clean clockwise loop
    );
    return () => cancelAnimation(rotation);
  }, [rotation]);

  const orbitStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <View style={styles.orbContainer}>

      <Animated.View style={[styles.orbDotOrbit, orbitStyle]}>
        {TRAIL_SEGMENTS.map((segment, i) => (
          <View
            key={i}
            style={[
              styles.orbTrailSegment,
              { transform: [{ rotate: `${segment.angle}deg` }] },
            ]}
          >
            <View
              style={[
                segment.isHead ? styles.orbDot : styles.orbTrailDot,
                { opacity: segment.opacity },
              ]}
            />
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

// AI ORB ERRORz
export function AiOrbError() {
  return (
    <View style={styles.orbContainer}>
      <View style={[styles.orbRing, styles.orbRingError]} />
    </View>
  )
}

// ============================================================
// AiOrbStatic — non-animated, icon-scale variant of the orb.
// Same visual identity as <AiOrb> and <AiOrbLoading> (ring + glow in
// the accent color), just smaller and without the animation. Use this
// anywhere you need the "AI" visual at icon size: results screens,
// header chips, inline labels, etc.
// ============================================================

export function AiOrbStatic({ error = false }: { error?: boolean } = {}) {
  return (
    <View style={styles.orbStaticContainer}>
      <View style={[
        styles.orbStaticRing,
        error && styles.orbStaticRingError,
      ]} />
    </View>
  );
}

// ============================================================
// AiFeedbackCard — static results-screen surface that displays the
// AI coaching prose. Visually a peer of MetricRow (same card chrome,
// same icon slot size) but never collapses; the prose IS the content.
// ============================================================

type AiFeedbackCardProps = {
  feedback: string;
  error?: boolean;
  variant?: 'card' | 'flat';
  // Optional. When passed and not in error state, the score renders to the
  // right of "AI Feedback" in the header. TTO omits this prop so its layout
  // is unchanged.
  aiScore?: number | null;
};

export function AiFeedbackCard({
  feedback,
  error = false,
  variant = 'card',
  aiScore,
}: AiFeedbackCardProps) {
  const isFlat = variant === 'flat';
  const showScore = !error && typeof aiScore === 'number';
  return (
    <View style={[!isFlat && styles.aiCard, !isFlat && error && styles.aiCardError]}>
      <View style={isFlat ? styles.aiHeaderFlat : styles.aiHeader}>
        <AiOrbStatic error={error} />
        <View style={[styles.aiHeaderText, showScore && styles.aiHeaderTextRow]}>
          <Text style={styles.aiTitle}>AI Feedback</Text>
          {error ? (
            <Text style={styles.aiErrorSubtitle}>Failed to generate a response</Text>
          ) : typeof aiScore === 'number' ? (
            <Text style={[styles.scoreValue, { color: scoreColor(scoreStatus(aiScore)) }]}>
              {aiScore}<Text style={styles.scoreSuffix}> / 10</Text>
            </Text>
          ) : null}
        </View>
      </View>
      {!error && (
        <Text style={isFlat ? styles.aiBodyFlat : styles.aiBody}>{feedback}</Text>
    )}
    </View>
  );
}

// ============================================================
// Styles
// ============================================================

const styles = StyleSheet.create({
  orbContainer: {
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbRing: {
    width: 95,
    height: 95,
    borderRadius: 999,
    borderWidth: 2.5,
    borderColor: colors.accent,
    // iOS gradient bloom — fades smoothly into the dark background.
    // Android will show only the ring without the surrounding halo.
    shadowColor: colors.accent,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 0 },
  },
  orbRingLoading: {
    opacity: 0.3,
    shadowOpacity: 0.3,
    shadowRadius: 14,
  },
  orbDotOrbit: {
    position: 'absolute',
    width: 95,
    height: 95,
    alignItems: 'center',
  },
  orbDot: {
    position: 'absolute',
    top: -5,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  orbTrailSegment: {
    position: 'absolute',
    width: 95,
    height: 95,
    alignItems: 'center',
  },
  orbTrailDot: {
    position: 'absolute',
    top: -5,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  orbRingError: {
    borderColor: colors.danger,
    shadowColor: colors.danger,
    shadowOpacity: 0.6,
    shadowRadius: 22,
},
// AiFeedbackCard styles. Mirrors MetricRow chrome (same surface, border,
  // radius) so the section sits as a visual peer with the metric rows below it.
  aiCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },

  aiTitle: {
    fontSize: fontSize.lg,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  aiBody: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 24,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  orbStaticContainer: {
  width: 44,
  height: 44,
  alignItems: 'center',
  justifyContent: 'center',
},
  orbStaticRing: {
  width: 36,
  height: 36,
  borderRadius: 18,
  borderWidth: 2,
  borderColor: colors.accent,
  shadowColor: colors.accent,
  shadowOpacity: 0.7,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 0 },
},
orbStaticRingError: {
  borderColor: colors.danger,
  shadowColor: colors.danger,
  shadowOpacity: 0.6,
  shadowRadius: 12,
},
aiHeaderText: {
  flex: 1,
},
// Applied on top of aiHeaderText only when a score is shown. Lays title +
// score side-by-side. NOT applied when error is true so the error subtitle
// keeps its column-below-title layout.
aiHeaderTextRow: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
},
scoreValue: {
  fontSize: fontSize.lg,
  fontFamily: fonts.regular,
},
scoreSuffix: {
  fontSize: fontSize.sm,
  color: colors.textMuted,
},
aiErrorSubtitle: {
  fontSize: fontSize.sm,
  fontFamily: fonts.regular,
  color: colors.danger,
  marginTop: 2,
},
aiCardError: {
  paddingBottom: spacing.lg,
},
// Flat variant — no card chrome, no horizontal padding. For placement
// inside a parent card that owns the padding (e.g. TTO results round
// cards). Matches the pattern used by MetricRow / TranscriptCard /
// AudioPlayback.
aiHeaderFlat: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: spacing.lg,
},
aiBodyFlat: {
  fontSize: fontSize.md,
  fontFamily: fonts.regular,
  color: colors.text,
  lineHeight: 24,
  paddingTop: spacing.md,
},
});
// components/ScoreRing.tsx
//
// A small ring that shows a session's 1–10 score: a faint full-circle track with a
// colored arc filled proportional to the score (10/10 = full, 1/10 = a tenth),
// colored by score status (green ≥8 / orange ≥5 / red <5), and the score number
// centered inside. A null score (AI failed / too short) shows just the empty track
// with a muted "—". Shared by the Home Recent feed and the /history rows so they
// read identically.

import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { colors, fontSize, fonts } from '../lib/theme';
import { scoreStatus, scoreColor } from './metric-scoring';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

export const SCORE_RING_SIZE = 40;
const RING_STROKE = 3;

export function ScoreRing({ score }: { score: number | null }) {
  const r = (SCORE_RING_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = score === null ? 0 : Math.max(0, Math.min(10, score));
  const dashOffset = circumference * (1 - clamped / 10);
  const arcColor = score === null ? colors.textMuted : scoreColor(scoreStatus(score));
  const cx = SCORE_RING_SIZE / 2;
  const cy = SCORE_RING_SIZE / 2;

  return (
    <View style={styles.ring}>
      <Svg width={SCORE_RING_SIZE} height={SCORE_RING_SIZE} viewBox={`0 0 ${SCORE_RING_SIZE} ${SCORE_RING_SIZE}`}>
        <Circle cx={cx} cy={cy} r={r} stroke={colors.border} strokeWidth={RING_STROKE} fill="none" />
        {score !== null && (
          <Circle
            cx={cx}
            cy={cy}
            r={r}
            stroke={arcColor}
            strokeWidth={RING_STROKE}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        )}
      </Svg>
      <View style={styles.ringLabel} pointerEvents="none">
        <Text style={[styles.ringScore, { color: arcColor }]}>{formatRingScore(score)}</Text>
      </View>
    </View>
  );
}

const TRAIL_LENGTH = 16;    // number of segments including the head
const TRAIL_DEGREES = 60;   // total angular span of the comet from head to trail
const LOADING_DOT_SIZE = 4;
// Keeping the dot inside the 40pt slot makes the loading and loaded rings layout-compatible.
const LOADING_ORBIT_SIZE = SCORE_RING_SIZE - LOADING_DOT_SIZE;

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

export function ScoreRingLoading() {
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
    <View style={styles.ring}>
      <Animated.View style={[styles.loadingOrbit, orbitStyle]}>
        {TRAIL_SEGMENTS.map((segment, i) => (
          <View
            key={i}
            style={[
              styles.loadingTrailSegment,
              { transform: [{ rotate: `${segment.angle}deg` }] },
            ]}
          >
            <View
              style={[
                segment.isHead ? styles.loadingHead : styles.loadingTrailDot,
                { opacity: segment.opacity },
              ]}
            />
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

export function ScoreRingError() {
  const r = (SCORE_RING_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  const arcColor = colors.danger;
  const cx = SCORE_RING_SIZE / 2;
  const cy = SCORE_RING_SIZE / 2;

  return (
    <View style={styles.ring}>
      <Svg width={SCORE_RING_SIZE} height={SCORE_RING_SIZE} viewBox={`0 0 ${SCORE_RING_SIZE} ${SCORE_RING_SIZE}`}>
        <Circle cx={cx} cy={cy} r={r} stroke={colors.border} strokeWidth={RING_STROKE} fill="none" />

          <Circle
            cx={cx}
            cy={cy}
            r={r}
            stroke={arcColor}
            strokeWidth={RING_STROKE}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={0}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
          />

      </Svg>
      <View style={styles.ringLabel} pointerEvents="none">
        <Text style={[styles.ringScore, { color: arcColor }]}>—</Text>
      </View>
    </View>
  );
}

// Local formatter (kept out of SessionCard to avoid a SessionCard↔ScoreRing import
// cycle): null → "—", integers as-is, else one decimal.
function formatRingScore(score: number | null): string {
  if (score === null) return '—';
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

const styles = StyleSheet.create({
  ring: {
    width: SCORE_RING_SIZE,
    height: SCORE_RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringLabel: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringScore: {
    fontSize: fontSize.sm,
    fontFamily: fonts.semibold,
  },
  loadingOrbit: {
    position: 'absolute',
    width: LOADING_ORBIT_SIZE,
    height: LOADING_ORBIT_SIZE,
    top: LOADING_DOT_SIZE / 2,
    left: LOADING_DOT_SIZE / 2,
  },
  loadingTrailSegment: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
  },
  loadingHead: {
    position: 'absolute',
    top: -LOADING_DOT_SIZE / 2,
    width: LOADING_DOT_SIZE,
    height: LOADING_DOT_SIZE,
    borderRadius: LOADING_DOT_SIZE / 2,
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  loadingTrailDot: {
    position: 'absolute',
    top: -LOADING_DOT_SIZE / 2,
    width: LOADING_DOT_SIZE,
    height: LOADING_DOT_SIZE,
    borderRadius: LOADING_DOT_SIZE / 2,
    backgroundColor: colors.accent,
  },
});

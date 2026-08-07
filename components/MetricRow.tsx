// components/MetricRow.tsx
//
// The expandable metric row component (icon, title, status-colored score,
// chevron) plus the three expansion bodies that render INSIDE its expansion
// slot: PaceExpansion, FillerExpansion, PauseExpansion. The expansions are
// here rather than in their own file because they're 1:1 paired with the
// metric types — adding a new metric type means adding to this file in one
// place.
//
// Variants on MetricRow:
//   - 'card' (default): self-contained surface used as a sibling in
//     impromptu-results, where each row is its own visual unit.
//   - 'flat': no surface chrome, top hairline divider for separation when
//     stacked inside a parent card (e.g. TTO round cards).

import { useEffect, useMemo, useState } from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Svg, { Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';

import { colors, spacing, fontSize, fonts, radius } from '../lib/theme';
import { ANIM_DURATION, ANIM_EASING } from '../lib/animation';
import {
  computePaceTimeline,
  computeContourRange,
  DEFAULT_PACE_TARGET,
  IntonationPoint,
  type PaceSegment,
  type SessionMetrics,
} from '../lib/metrics';
import type { DeepgramWord } from '../lib/deepgram';

// ============================================================
// Public types
// ============================================================

export type RowStatus = 'good' | 'warning' | 'danger';
export type ScorePart = { text: string; status: RowStatus };
export type MetricRowVariant = 'card' | 'flat';

export type MetricRowProps = {
  icon: React.ReactNode;
  title: string;
  score: ScorePart[];
  status: RowStatus;
  variant?: MetricRowVariant;
  children?: React.ReactNode;
};

export function statusForeground(status: RowStatus): string {
  if (status === 'good') return colors.success;
  if (status === 'warning') return colors.warning;
  return colors.danger;
}

export function statusBackground(status: RowStatus): string {
  if (status === 'good') return colors.successBg;
  if (status === 'warning') return colors.warningBg;
  return colors.dangerBg;
}

// ============================================================
// MetricRow — header + expandable body
// ============================================================

export function MetricRow({
  icon,
  title,
  score,
  status: _status,
  variant = 'card',
  children,
}: MetricRowProps) {
  const [expanded, setExpanded] = useState(false);
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withTiming(expanded ? 1 : 0, {
      duration: ANIM_DURATION,
      easing: ANIM_EASING,
    });
  }, [expanded, rotation]);

  const animatedChevron = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value * 180}deg` }],
  }));

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpanded((prev) => !prev);
  };

  const isFlat = variant === 'flat';
  const outerStyle = isFlat ? styles.outerFlat : styles.outerCard;
  const headerStyle = isFlat ? styles.headerFlat : styles.headerCard;
  const expandedStyle = isFlat ? styles.expandedFlat : styles.expandedCard;

  return (
    <Animated.View
      style={outerStyle}
      layout={LinearTransition.duration(ANIM_DURATION).easing(ANIM_EASING)}
    >
      <Pressable onPress={handlePress} style={headerStyle}>
        <View style={styles.iconWrap}>{icon}</View>

        <View style={styles.center}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.score}>
            {score.map((part, i) => (
              <Text key={i}>
                {i > 0 && <Text> · </Text>}
                <Text style={{ color: statusForeground(part.status) }}>
                  {part.text}
                </Text>
              </Text>
            ))}
          </Text>
        </View>

        <Animated.View style={[styles.arrow, animatedChevron]}>
          <ChevronDownIcon color={colors.textMuted} />
        </Animated.View>
      </Pressable>

      {expanded && (
        <Animated.View
          entering={FadeIn.duration(ANIM_DURATION).easing(ANIM_EASING)}
          exiting={FadeOut.duration(ANIM_DURATION).easing(ANIM_EASING)}
          style={expandedStyle}
        >
          {children}
        </Animated.View>
      )}
    </Animated.View>
  );
}

// ============================================================
// PACE EXPANSION
// ============================================================

const PACE_RANGE_MIN = 45;
const PACE_RANGE_MAX = 250;
const PACE_SLOW_END = 130;
const PACE_IDEAL_END = 160;

const PACE_SLOW_WIDTH = PACE_SLOW_END - PACE_RANGE_MIN;
const PACE_IDEAL_WIDTH = PACE_IDEAL_END - PACE_SLOW_END;
const PACE_FAST_WIDTH = PACE_RANGE_MAX - PACE_IDEAL_END;

const PACE_SLOW = '#E6C547';
const ARROW_WIDTH = 10;
const WPM_LINE_WIDTH = 2;
const WPM_LINE_HEIGHT = 24;
const WPM_TEXT_WIDTH = 70;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const capitalizeFirst = (s: string): string =>
  s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);

type PaceExpansionProps = {
  metrics: Extract<SessionMetrics, { tooShort: false }>;
  words: DeepgramWord[];
  durationSec: number;
};

// The WPM-over-time PaceGraph below is BUILT and working but HIDDEN for v0 — flip this
// flag to re-enable it. The PaceGraph component, its computePaceTimeline call, and the
// paceGraphContainer style are all kept intact as the baseline, so re-adding is a one-
// line change. (Hidden 2026-06-23; the PaceMeter needle still shows where the wpm
// lands.) See CLAUDE.md "Deferred features".
const SHOW_PACE_GRAPH = false;

export function PaceExpansion({ metrics, words, durationSec }: PaceExpansionProps) {
  const { paceTargetLow: low, paceTargetHigh: high } = metrics;
  const isCustomTarget = low !== DEFAULT_PACE_TARGET.low || high !== DEFAULT_PACE_TARGET.high;
  return (
    <>
      {/* PLACEHOLDER copy — the custom-target variant especially. */}
      <Text style={styles.description}>
        {isCustomTarget
          ? `Your target is ${low}-${high} wpm. Steady beats fast or slow.`
          : '130-160 wpm is the conversational sweet spot. Steady beats fast or slow.'}
      </Text>
      <Text style={styles.stat}>You spoke at {metrics.wpm} wpm.</Text>
      <PaceMeter wpm={metrics.wpm} low={low} high={high} />
      <Text style={styles.stat}>
        {metrics.paceConsistency.verdict === 'steady'
          ? 'You spoke at a consistent pace.'
          : 'Your pace was inconsistent throughout.'}
      </Text>
      {SHOW_PACE_GRAPH && <PaceGraph words={words} durationSec={durationSec} />}
    </>
  );
}

function PaceMeter({ wpm, low, high }: { wpm: number; low: number; high: number }) {
  const target = clamp01((wpm - PACE_RANGE_MIN) / (PACE_RANGE_MAX - PACE_RANGE_MIN));
  // The colored zones track the (possibly custom) band; the needle stays on the
  // absolute 45–250 scale so its position means the same regardless of target.
  const slowWidth = Math.max(0, low - PACE_RANGE_MIN);
  const idealWidth = Math.max(1, high - low);
  const fastWidth = Math.max(0, PACE_RANGE_MAX - high);
  const position = useSharedValue(0);

  // 700ms intro animation here, deliberately slower than the row-expand
  // transition. The meter is a "reveal" — it should feel like a needle
  // settling, not a row sliding.
  useEffect(() => {
    position.value = withTiming(target, {
      duration: 700,
      easing: Easing.out(Easing.cubic),
    });
  }, [target, position]);

  const animatedArrow = useAnimatedStyle(() => ({
    left: `${position.value * 100}%`,
  }));

  // The arrow animates; the line + label snap to the target so they always
  // mark the destination, not the journey.
  const targetLeft = `${target * 100}%` as const;

  return (
    <View style={styles.paceMeter}>
      <View style={styles.paceArrowTrack}>
        <Animated.View style={[styles.paceArrow, animatedArrow]}>
          <ArrowMarker color={colors.text} />
        </Animated.View>
      </View>

      <View style={styles.paceTrackContainer}>
        <View style={styles.paceTrack}>
          <View style={[styles.paceSegment, styles.paceSegmentSlow, { flex: slowWidth }]} />
          <View style={[styles.paceSegment, styles.paceSegmentIdeal, { flex: idealWidth }]} />
          <View style={[styles.paceSegment, styles.paceSegmentFast, { flex: fastWidth }]} />
        </View>
        {/* Sibling of the bar (not child) so the bar's overflow:hidden
            doesn't clip the line's vertical extension. */}
        <View style={[styles.wpmLine, { left: targetLeft }]} />
      </View>

      <View style={styles.paceLabelsRow}>
        <Text style={styles.paceLabel}>&lt; {PACE_RANGE_MIN}</Text>
        <View style={[styles.wpmTextWrapper, { left: targetLeft }]}>
          <Text style={styles.wpmText}>{wpm} wpm</Text>
        </View>
        <Text style={styles.paceLabel}>{PACE_RANGE_MAX}+</Text>
      </View>
    </View>
  );
}

function ArrowMarker({ size = ARROW_WIDTH, color }: { size?: number; color: string }) {
  // Downward-pointing triangle. 10:8 width:height — sharper reads thin,
  // stubbier reads like a hat.
  return (
    <Svg width={size} height={size * 0.8} viewBox="0 0 10 8" fill={color}>
      <Path d="M0 0 L10 0 L5 8 Z" />
    </Svg>
  );
}

// ============================================================
// PACE GRAPH — WPM over time, broken at long pauses
// ============================================================

const SVG_HEIGHT = 130;
const ARROW_LENGTH_GRAPH = 8;
const ARROW_WIDTH_GRAPH = 6;

const LEFT_PADDING = 0;       // plot's left edge aligns with meter bar
const RIGHT_PADDING = 32;     // Y-axis line + "WPM" label
const TOP_PADDING = ARROW_LENGTH_GRAPH;
const BOTTOM_PADDING = 26;    // X-axis + "Time" label

const GRAPH_WPM_MIN = 45;
const GRAPH_WPM_MAX = 250;

const GRAPH_DANGER_LOW = 110;
const GRAPH_WARNING_LOW = 130;
const GRAPH_WARNING_HIGH = 160;
const GRAPH_DANGER_HIGH = 180;

const ZONE_DANGER_FILL = 'rgba(255, 107, 107, 0.18)';
const ZONE_WARNING_FILL = 'rgba(230, 197, 71, 0.18)';
const ZONE_GOOD_FILL = 'rgba(127, 229, 161, 0.18)';

function PaceGraph({ words, durationSec }: { words: DeepgramWord[]; durationSec: number }) {
  const segments = useMemo(
    () => computePaceTimeline(words, durationSec),
    [words, durationSec],
  );

  const [graphWidth, setGraphWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setGraphWidth(e.nativeEvent.layout.width);

  const plotWidth = graphWidth - LEFT_PADDING - RIGHT_PADDING;
  const plotHeight = SVG_HEIGHT - TOP_PADDING - BOTTOM_PADDING;
  const plotLeft = LEFT_PADDING;
  const plotRight = LEFT_PADDING + plotWidth;
  const plotTop = TOP_PADDING;
  const plotBottom = TOP_PADDING + plotHeight;

  const timeToX = (t: number) => plotLeft + (t / durationSec) * plotWidth;

  const wpmToY = (wpm: number) => {
    const clamped = Math.max(GRAPH_WPM_MIN, Math.min(GRAPH_WPM_MAX, wpm));
    const ratio = (clamped - GRAPH_WPM_MIN) / (GRAPH_WPM_MAX - GRAPH_WPM_MIN);
    return plotTop + (1 - ratio) * plotHeight;
  };

  const buildSegmentPath = (segment: PaceSegment): string => {
    if (segment.points.length === 0) return '';
    const [first, ...rest] = segment.points;
    let d = `M ${timeToX(first.t)} ${wpmToY(first.wpm)}`;
    for (const p of rest) {
      d += ` L ${timeToX(p.t)} ${wpmToY(p.wpm)}`;
    }
    return d;
  };

  // Rotated label sits in the right padding, centered vertically on the plot.
  const yLabelX = plotRight + RIGHT_PADDING / 2;
  const yLabelY = plotTop + plotHeight / 2;
  const xLabelX = plotLeft + plotWidth / 2;
  const xLabelY = SVG_HEIGHT - 6;

  return (
    <View style={styles.paceGraphContainer} onLayout={onLayout}>
      {graphWidth > 0 && (
        <Svg width={graphWidth} height={SVG_HEIGHT}>
          {/* Background zones — danger at the extremes, good in the middle */}
          <Rect
            x={plotLeft}
            y={plotTop}
            width={plotWidth}
            height={wpmToY(GRAPH_DANGER_HIGH) - plotTop}
            fill={ZONE_DANGER_FILL}
          />
          <Rect
            x={plotLeft}
            y={wpmToY(GRAPH_DANGER_HIGH)}
            width={plotWidth}
            height={wpmToY(GRAPH_WARNING_HIGH) - wpmToY(GRAPH_DANGER_HIGH)}
            fill={ZONE_WARNING_FILL}
          />
          <Rect
            x={plotLeft}
            y={wpmToY(GRAPH_WARNING_HIGH)}
            width={plotWidth}
            height={wpmToY(GRAPH_WARNING_LOW) - wpmToY(GRAPH_WARNING_HIGH)}
            fill={ZONE_GOOD_FILL}
          />
          <Rect
            x={plotLeft}
            y={wpmToY(GRAPH_WARNING_LOW)}
            width={plotWidth}
            height={wpmToY(GRAPH_DANGER_LOW) - wpmToY(GRAPH_WARNING_LOW)}
            fill={ZONE_WARNING_FILL}
          />
          <Rect
            x={plotLeft}
            y={wpmToY(GRAPH_DANGER_LOW)}
            width={plotWidth}
            height={plotBottom - wpmToY(GRAPH_DANGER_LOW)}
            fill={ZONE_DANGER_FILL}
          />

          {/* Line segments — one per pace-timeline segment (broken at pauses) */}
          {segments.map((segment, i) => (
            <Path
              key={i}
              d={buildSegmentPath(segment)}
              stroke={colors.text}
              strokeWidth={2}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* Y-axis (right side) */}
          <Line
            x1={plotRight}
            y1={plotTop}
            x2={plotRight}
            y2={plotBottom}
            stroke={colors.textMuted}
            strokeWidth={1}
          />
          <Polygon
            points={[
              `${plotRight},${plotTop - ARROW_LENGTH_GRAPH}`,
              `${plotRight - ARROW_WIDTH_GRAPH / 2},${plotTop}`,
              `${plotRight + ARROW_WIDTH_GRAPH / 2},${plotTop}`,
            ].join(' ')}
            fill={colors.textMuted}
          />

          {/* X-axis — stops short of the Y-axis to make room for its arrow */}
          <Line
            x1={plotLeft}
            y1={plotBottom}
            x2={plotRight - ARROW_LENGTH_GRAPH}
            y2={plotBottom}
            stroke={colors.textMuted}
            strokeWidth={1}
          />
          <Polygon
            points={[
              `${plotRight},${plotBottom}`,
              `${plotRight - ARROW_LENGTH_GRAPH},${plotBottom - ARROW_WIDTH_GRAPH / 2}`,
              `${plotRight - ARROW_LENGTH_GRAPH},${plotBottom + ARROW_WIDTH_GRAPH / 2}`,
            ].join(' ')}
            fill={colors.textMuted}
          />

          {/* "WPM" — rotated, in the right padding */}
          <SvgText
            x={yLabelX}
            y={yLabelY}
            fill={colors.textMuted}
            fontSize={11}
            fontFamily={fonts.regular}
            textAnchor="middle"
            transform={`rotate(-90 ${yLabelX} ${yLabelY})`}
          >
            WPM
          </SvgText>

          {/* "Time" — horizontal, centered below the plot */}
          <SvgText
            x={xLabelX}
            y={xLabelY}
            fill={colors.textMuted}
            fontSize={11}
            fontFamily={fonts.regular}
            textAnchor="middle"
          >
            Time
          </SvgText>
        </Svg>
      )}
    </View>
  );
}

// ============================================================
// FILLER EXPANSION
// ============================================================

type FillerExpansionProps = {
  metrics: Extract<SessionMetrics, { tooShort: false }>;
};

export function FillerExpansion({ metrics }: FillerExpansionProps) {
  if (metrics.fillerBreakdown.length === 0) {
    return <Text style={styles.stat}>No filler words.</Text>;
  }
  return (
    <>
      <Text style={styles.description}>
        Using filler words to fill the silence makes you sound nervous. Instead, try pausing and sitting in the silence while you think about what to say next.
      </Text>
      <View style={styles.fillerList}>
        {metrics.fillerBreakdown.map((f) => (
          <FillerRow key={f.text} text={f.text} count={f.count} />
        ))}
      </View>
    </>
  );
}

// ============================================================
// INTONATION EXPANSION
// ============================================================

type IntonationExpansionProps = {
  metrics: Extract<SessionMetrics, { tooShort: false }>;
  durationSec: number;
};

// The IntonationContourGraph below is BUILT (though the pitch detector is still
// unverified on device — see INTONATION_HANDOFF.md) and is HIDDEN for v0 — flip this
// flag to re-enable it. The component, splitContourRuns, the computeContourRange call,
// and the contour styles are all kept intact as the baseline. (Hidden 2026-06-23.) See
// CLAUDE.md "Deferred features".
const SHOW_INTONATION_GRAPH = false;

export function IntonationExpansion({ metrics, durationSec }: IntonationExpansionProps) {
  const intonation = metrics.intonation;
  if (!intonation) {
    return <Text style={styles.stat}>No intonation data for this recording.</Text>;
  }

  return (
    <>
      {/* PLACEHOLDER COPY — replace. */}
      <Text style={styles.description}>
        Intonation is how much your pitch moves while you speak. A flat,
        unchanging pitch sounds monotone and is harder to stay engaged with. A
        pitch that rises and falls keeps a listener's attention.
      </Text>
      <Text style={styles.stat}>
        {intonation.verdict === 'dynamic'
          ? 'Your pitch varied across the recording.'
          : 'Your pitch stayed fairly flat.'}
      </Text>
      {SHOW_INTONATION_GRAPH && (
        <IntonationContourGraph
          contour={intonation.contour}
          meanF0Hz={intonation.meanF0Hz}
          durationSec={durationSec}
        />
      )}
    </>
  );
}

// ============================================================
// INTONATION CONTOUR GRAPH — pitch (Hz) over time, broken at silence
// ============================================================

const CONTOUR_GAP_FACTOR = 1.5; // a time jump > 1.5x the median step = silence

function splitContourRuns(contour: IntonationPoint[]): IntonationPoint[][] {
  if (contour.length < 2) return contour.length ? [contour] : [];

  const deltas: number[] = [];
  for (let i = 1; i < contour.length; i++) deltas.push(contour[i].t - contour[i - 1].t);
  const sorted = [...deltas].sort((a, b) => a - b);
  const medianStep = sorted[Math.floor(sorted.length / 2)];
  const gapThreshold = medianStep * CONTOUR_GAP_FACTOR;

  const runs: IntonationPoint[][] = [];
  let run: IntonationPoint[] = [contour[0]];
  for (let i = 1; i < contour.length; i++) {
    if (contour[i].t - contour[i - 1].t > gapThreshold) {
      runs.push(run);
      run = [contour[i]];
    } else {
      run.push(contour[i]);
    }
  }
  runs.push(run);
  return runs;
}

function IntonationContourGraph({
  contour,
  meanF0Hz,
  durationSec,
}: {
  contour: IntonationPoint[];
  meanF0Hz: number;
  durationSec: number;
}) {
  const { minHz, maxHz } = useMemo(
    () => computeContourRange(contour, meanF0Hz),
    [contour, meanF0Hz],
  );
  const runs = useMemo(() => splitContourRuns(contour), [contour]);

  const [graphWidth, setGraphWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setGraphWidth(e.nativeEvent.layout.width);

  const plotWidth = graphWidth - LEFT_PADDING - RIGHT_PADDING;
  const plotHeight = SVG_HEIGHT - TOP_PADDING - BOTTOM_PADDING;
  const plotLeft = LEFT_PADDING;
  const plotRight = LEFT_PADDING + plotWidth;
  const plotTop = TOP_PADDING;
  const plotBottom = TOP_PADDING + plotHeight;

  const timeToX = (t: number) => plotLeft + (t / durationSec) * plotWidth;
  const hzToY = (hz: number) => {
    const clamped = Math.max(minHz, Math.min(maxHz, hz));
    const ratio = (clamped - minHz) / (maxHz - minHz);
    return plotTop + (1 - ratio) * plotHeight;
  };

  const buildРath = (run: IntonationPoint[]): string => {
    const [first, ...rest] = run;
    let d = `M ${timeToX(first.t)} ${hzToY(first.f0Hz)}`;
    for (const p of rest) d += ` L ${timeToX(p.t)} ${hzToY(p.f0Hz)}`;
    return d;
  };

  const yLabelX = plotRight + RIGHT_PADDING / 2;
  const yLabelY = plotTop + plotHeight / 2;
  const xLabelX = plotLeft + plotWidth / 2;
  const xLabelY = SVG_HEIGHT - 6;

  return (
    <View style={styles.paceGraphContainer} onLayout={onLayout}>
      {graphWidth > 0 && (
        <Svg width={graphWidth} height={SVG_HEIGHT}>
          {runs.map((run, i) =>
            run.length === 1 ? (
              // A lone voiced point between two silences — draw a dot, since a
              // single point can't form a line.
              <Rect
                key={i}
                x={timeToX(run[0].t) - 1}
                y={hzToY(run[0].f0Hz) - 1}
                width={2}
                height={2}
                fill={colors.text}
              />
            ) : (
              <Path
                key={i}
                d={buildРath(run)}
                stroke={colors.text}
                strokeWidth={2}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ),
          )}

          {/* Y-axis (right) */}
          <Line x1={plotRight} y1={plotTop} x2={plotRight} y2={plotBottom} stroke={colors.textMuted} strokeWidth={1} />
          <Polygon
            points={[`${plotRight},${plotTop - ARROW_LENGTH_GRAPH}`, `${plotRight - ARROW_WIDTH_GRAPH / 2},${plotTop}`, `${plotRight + ARROW_WIDTH_GRAPH / 2},${plotTop}`].join(' ')}
            fill={colors.textMuted}
          />

          {/* X-axis */}
          <Line x1={plotLeft} y1={plotBottom} x2={plotRight - ARROW_LENGTH_GRAPH} y2={plotBottom} stroke={colors.textMuted} strokeWidth={1} />
          <Polygon
            points={[`${plotRight},${plotBottom}`, `${plotRight - ARROW_LENGTH_GRAPH},${plotBottom - ARROW_WIDTH_GRAPH / 2}`, `${plotRight - ARROW_LENGTH_GRAPH},${plotBottom + ARROW_WIDTH_GRAPH / 2}`].join(' ')}
            fill={colors.textMuted}
          />

          <SvgText x={yLabelX} y={yLabelY} fill={colors.textMuted} fontSize={11} fontFamily={fonts.regular} textAnchor="middle" transform={`rotate(-90 ${yLabelX} ${yLabelY})`}>Hz</SvgText>
          <SvgText x={xLabelX} y={xLabelY} fill={colors.textMuted} fontSize={11} fontFamily={fonts.regular} textAnchor="middle">Time</SvgText>
        </Svg>
      )}
    </View>
  );
}

// ============================================================
// PAUSE EXPANSION
// ============================================================

type PauseExpansionProps = {
  metrics: Extract<SessionMetrics, { tooShort: false }>;
};

export function PauseExpansion({ metrics }: PauseExpansionProps) {
  return (
    <>
      <Text style={styles.description}>
        Intentional pauses can be used to emphasize a point. It gives people
        time to stop and think about what you said. Pausing can also be used
        to stop the use of filler words.
      </Text>
      {metrics.pauseCount === 0 ? (
        <Text style={styles.stat}>No pauses over 1 second.</Text>
      ) : (
        <View style={styles.fillerList}>
          <FillerRow text="Intentional" count={metrics.intentionalPauseCount} />
          <FillerRow text="Hesitation" count={metrics.hesitationPauseCount} />
        </View>
      )}
    </>
  );
}

// ============================================================
// FillerRow — small count badge + label, shared by Filler and Pause
// expansions. Private to this file.
// ============================================================

function FillerRow({ text, count }: { text: string; count: number }) {
  return (
    <View style={styles.fillerRow}>
      <View style={styles.fillerCountCircle}>
        <Text style={styles.fillerCountText}>{count}</Text>
      </View>
      <Text style={styles.fillerWord}>{capitalizeFirst(text)}</Text>
    </View>
  );
}

// ============================================================
// Chevron — internal to MetricRow's header
// ============================================================

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

// ============================================================
// Styles
// ============================================================

const styles = StyleSheet.create({
  // ----- MetricRow chrome -----
  outerCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  outerFlat: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
    borderRadius: radius.lg,
  },
  headerFlat: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  iconWrap: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { flex: 1 },
  title: {
    fontSize: fontSize.lg,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  score: {
    fontSize: fontSize.sm,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
    marginTop: 2,
  },
  arrow: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandedCard: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: spacing.xs,
    gap: spacing.sm,
  },
  expandedFlat: {
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
    gap: spacing.sm,
  },

  // ----- Expansion text -----
  description: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    lineHeight: 20,
  },
  stat: {
    fontSize: fontSize.sm,
    fontFamily: fonts.semibold,
    color: colors.text,
  },

  // ----- Pace meter -----
  paceMeter: { marginTop: spacing.sm },
  paceArrowTrack: {
    height: 8,
    marginBottom: 4,
    position: 'relative',
  },
  paceTrackContainer: { position: 'relative' },
  paceArrow: {
    position: 'absolute',
    bottom: 0,
    transform: [{ translateX: -ARROW_WIDTH / 2 }],
  },
  paceTrack: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  paceSegment: { height: '100%' },
  paceSegmentSlow: { flex: PACE_SLOW_WIDTH, backgroundColor: PACE_SLOW },
  paceSegmentIdeal: { flex: PACE_IDEAL_WIDTH, backgroundColor: colors.success },
  paceSegmentFast: { flex: PACE_FAST_WIDTH, backgroundColor: colors.danger },
  wpmLine: {
    position: 'absolute',
    top: -2,
    width: WPM_LINE_WIDTH,
    height: WPM_LINE_HEIGHT,
    backgroundColor: colors.text,
    borderRadius: 1,
    transform: [{ translateX: -WPM_LINE_WIDTH / 2 }],
  },
  wpmTextWrapper: {
    position: 'absolute',
    width: WPM_TEXT_WIDTH,
    alignItems: 'center',
    transform: [{ translateX: -WPM_TEXT_WIDTH / 2 }],
  },
  wpmText: {
    fontSize: fontSize.xs,
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  paceLabelsRow: {
    position: 'relative',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  paceLabel: {
    fontSize: fontSize.xs,
    fontFamily: fonts.regular,
    color: colors.textSubtle,
  },

  // ----- Pace graph -----
  paceGraphContainer: {
    width: '100%',
    height: SVG_HEIGHT,
    marginTop: spacing.md,
  },

  // ----- Filler / pause list -----
  fillerList: { gap: spacing.sm },
  fillerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  fillerCountCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fillerCountText: {
    fontSize: fontSize.sm,
    fontFamily: fonts.semibold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  fillerWord: {
    fontSize: fontSize.md,
    fontFamily: fonts.medium,
    color: colors.text,
  },
});
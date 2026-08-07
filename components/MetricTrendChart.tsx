// components/MetricTrendChart.tsx
//
// The Profile-tab progress chart: a per-session line + dots across the last N sessions,
// over good/warning/danger lanes. Rendered card-less on the Profile tab so the plot runs
// the full content width.
//
// VISUAL LANGUAGE (redesigned): the lanes are a faint wash, not slabs — the data is the
// hero. The plot is a rounded, hairline-bordered rect; lane boundaries are hairlines; only
// the "good" lane is tinted enough to read, and it gets its own edge lines so the target
// zone is legible at a glance. The line is a monotone cubic (smooth but NEVER overshoots,
// so a curve can't bulge into a lane the session didn't earn) with a soft accent glow
// beneath it. Dots are small; the SELECTED dot gets a halo, a white ring, and a dashed
// guide down to the card that slides out below.
//
// The dots + connecting line are ACCENT BLUE, matching the Home tab's "This Week" strip
// (practiced dot + connector). Status is not encoded in the dot color — it's encoded
// positionally by which lane the dot sits in, so coloring the dot too was double-encoding.
// `status` survives on ChartPoint only as the null/gap signal.
//
// PACE dots are placed against each session's OWN baked target band (ChartPoint.zones)
// while the lanes stay fixed, so an on-target session always lands mid-green regardless of
// what that session's target was. See valueToY.
//
// Presentational — takes dumb { value, status } points + a MetricConfig (see
// lib/metric-trends.ts). v1: NO X axis / no dates — X is session index.

import { useId, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { colors, fonts } from '../lib/theme';
import type { MetricConfig, MetricZone, ChartPoint } from '../lib/metric-trends';
import type { MetricStatus } from '../lib/metric-status';

export const CHART_HEIGHT = 200;

// Dot sizing. Small by default so 10 of them don't dominate the line; the selected one
// grows and gains a halo instead of everything being chunky.
const DOT_R = 4.5;
const DOT_R_SELECTED = 6;
const HALO_R = 12;
// The end dots' CENTERS are inset this far from the plot's left/right edge, so the widest
// thing a dot can draw (its selection halo) still clears the rounded border.
const DOT_INSET = HALO_R + 2;

// The plot rectangle is inset from the chart container's left/right edges by this much.
// Exported so the Profile pager's date labels align to the PLOT edges (where the graph
// visibly starts/ends), not the container edges. Independent of the dot radius.
export const PLOT_INSET = 8;
const LEFT_PADDING = PLOT_INSET;
const RIGHT_PADDING = PLOT_INSET;
// Vertical breathing room so a dot pinned to the top/bottom lane (and its halo) isn't
// cropped by the SVG edge. Exported (with PLOT_RADIUS) so the Profile loading skeleton can
// size its plot-shaped block to the same rounded rect and not drift from the real chart.
export const PLOT_VINSET = 16;
const TOP_PADDING = PLOT_VINSET;
const BOTTOM_PADDING = PLOT_VINSET;
export const PLOT_RADIUS = 14;

const LINE_WIDTH = 2.5;
const GLOW_WIDTH = 7;

// Tap-target size around each dot (iOS minimum comfortable target). Height is fixed;
// width is capped at one dot-spacing so neighbors' targets can't overlap.
const HIT_SIZE = 44;

// Lane washes. Deliberately far lighter than a solid band — the good lane carries the
// signal, the grace/danger lanes just orient you. (Was a uniform 0.16 across all three,
// which read as three slabs stacked behind the data.)
const LANE_FILL: Record<MetricStatus, string> = {
  good: 'rgba(127, 229, 161, 0.09)', // colors.success
  warning: 'rgba(255, 181, 114, 0.05)', // colors.warning
  danger: 'rgba(255, 107, 107, 0.05)', // colors.danger
};
// Edge lines that frame the good lane, so "the zone you want to be in" reads without
// needing a heavy fill.
const GOOD_EDGE = 'rgba(127, 229, 161, 0.28)';

/**
 * Monotone cubic interpolation (Fritsch–Carlson). Smooths the line WITHOUT overshooting:
 * at a local extremum the tangent is flattened to zero. That matters here because the lane
 * a point sits in IS its status — a classic spline could bow a segment up into the red lane
 * between two green sessions and imply a bad session that never happened.
 */
function smoothPath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0].x},${pts[0].y}`;
  if (n === 2) return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`;

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    slope[i] = dx[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx[i];
  }

  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      m[i] = 0; // local extremum → flat tangent, no overshoot
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      m[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
    }
  }

  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d +=
      ` C${pts[i].x + h},${pts[i].y + m[i] * h}` +
      ` ${pts[i + 1].x - h},${pts[i + 1].y - m[i + 1] * h}` +
      ` ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return d;
}

export function MetricTrendChart({
  points,
  config,
  selectedId = null,
  onSelectPoint,
  showDots = true,
}: {
  points: ChartPoint[];
  config: MetricConfig;
  selectedId?: string | null;
  onSelectPoint?: (id: string) => void;
  // false → line only (the all-time view, which can have many points). A lone point
  // (a run of length 1, which draws no line) still keeps its dot so it stays visible.
  showDots?: boolean;
}) {
  const [graphWidth, setGraphWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setGraphWidth(e.nativeEvent.layout.width);

  // Per-instance clip id — two charts on one screen would otherwise share `url(#plotClip)`.
  const clipId = `plotClip-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;

  const plotWidth = graphWidth - LEFT_PADDING - RIGHT_PADDING;
  const plotHeight = CHART_HEIGHT - TOP_PADDING - BOTTOM_PADDING;
  const plotLeft = LEFT_PADDING;
  const plotTop = TOP_PADDING;
  const plotBottom = plotTop + plotHeight;
  const plotRight = plotLeft + plotWidth;

  const [yMin, yMax] = config.yDomain;
  const zones = config.zones;

  // Weighted lanes: each color's total height is proportional to its status weight
  // (default 1; pace sets warning=0.5 so its two "grace" lanes read thinner than the red),
  // and zones sharing a color split that share equally. The value axis is thus
  // piecewise-linear: accurate WITHIN a lane, compressed/stretched ACROSS lanes.
  const weightOf = (status: MetricStatus) => config.statusWeights?.[status] ?? 1;
  const totalWeight = [...new Set(zones.map((z) => z.status))].reduce(
    (sum, st) => sum + weightOf(st),
    0,
  );
  const countByStatus = new Map<string, number>();
  for (const z of zones) countByStatus.set(z.status, (countByStatus.get(z.status) ?? 0) + 1);
  const zoneHeight = (z: MetricZone) =>
    ((weightOf(z.status) / totalWeight) * plotHeight) / (countByStatus.get(z.status) ?? 1);

  // Stack bottom→top in value order (zones[0] = lowest values = chart bottom).
  const bands = zones.map((z, i) => {
    const below = zones.slice(0, i).reduce((sum, o) => sum + zoneHeight(o), 0);
    const bottomY = plotBottom - below;
    const height = zoneHeight(z);
    return { z, height, bottomY, topY: bottomY - height };
  });

  // Lane geometry above is fixed — `zoneHeight` splits the plot by statusWeights and never
  // reads z.from/z.to. So a point can be measured against its OWN zone boundaries and still
  // land in the correct lane: zone i always maps to lane bands[i]. Pace uses this (see
  // ChartPoint.zones) so a session scored against a custom target sits in the lane it
  // actually earned, instead of being judged against the default 130/160 decoration.
  // Points with no zones of their own fall back to the config's.
  const valueToY = (v: number, pointZones?: MetricZone[]) => {
    const zs = pointZones ?? zones;
    const clamped = Math.max(yMin, Math.min(yMax, v));
    let zi = zs.findIndex((z) => clamped >= z.from && clamped <= z.to);
    if (zi < 0) zi = zs.length - 1;
    const z = zs[zi];
    const lane = bands[Math.min(zi, bands.length - 1)];
    const span = z.to - z.from;
    // A zero-width zone (target pinned to a domain edge) would divide by zero.
    const ratio = span > 0 ? (clamped - z.from) / span : 0;
    return lane.bottomY - ratio * lane.height;
  };

  // Evenly spaced by session index; a lone point sits centered (no line).
  const n = points.length;
  const dotLeft = plotLeft + DOT_INSET;
  const dotSpan = plotWidth - 2 * DOT_INSET;
  const indexToX = (i: number) =>
    n <= 1 ? plotLeft + plotWidth / 2 : dotLeft + (i / (n - 1)) * dotSpan;

  // Split into runs of consecutive non-null points so the line breaks over gaps.
  // `status` is only the null/gap signal now — the dot color no longer derives from it.
  type Pt = { x: number; y: number; id: string };
  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  points.forEach((p, i) => {
    if (p.value == null || p.status == null) {
      if (cur.length) runs.push(cur);
      cur = [];
      return;
    }
    cur.push({ x: indexToX(i), y: valueToY(p.value, p.zones), id: p.id });
  });
  if (cur.length) runs.push(cur);

  // The plotted dots (flattened) + each session's tap-column width.
  const dots = runs.flat();
  const columnWidth = n > 1 ? dotSpan / (n - 1) : plotWidth;
  const selected = showDots ? dots.find((d) => d.id === selectedId) : undefined;

  return (
    <View style={styles.container} onLayout={onLayout}>
      {graphWidth > 0 && (
        <Svg width={graphWidth} height={CHART_HEIGHT}>
          <Defs>
            {/* Everything behind the dots is clipped to the rounded plot, so lane washes
                and the line's glow follow the border's corners. */}
            <ClipPath id={clipId}>
              <Rect
                x={plotLeft}
                y={plotTop}
                width={plotWidth}
                height={plotHeight}
                rx={PLOT_RADIUS}
                ry={PLOT_RADIUS}
              />
            </ClipPath>
          </Defs>

          <G clipPath={`url(#${clipId})`}>
            {/* Lane washes — faint; the good lane is the only one meant to be noticed. */}
            {bands.map((b, i) => (
              <Rect
                key={`lane${i}`}
                x={plotLeft}
                y={b.topY}
                width={plotWidth}
                height={b.height}
                fill={LANE_FILL[b.z.status]}
              />
            ))}

            {/* Hairline between adjacent lanes (the topmost lane's top edge IS the plot
                border, so skip it). */}
            {bands.slice(0, -1).map((b, i) => (
              <Line
                key={`div${i}`}
                x1={plotLeft}
                x2={plotRight}
                y1={b.topY}
                y2={b.topY}
                stroke={colors.border}
                strokeWidth={1}
              />
            ))}

            {/* Frame the good lane. Only the edges that fall INSIDE the plot are drawn —
                an edge coincident with the border would just double it. */}
            {bands.map((b, i) =>
              b.z.status === 'good' ? (
                <G key={`goodEdge${i}`}>
                  {b.topY > plotTop + 0.5 && (
                    <Line
                      x1={plotLeft}
                      x2={plotRight}
                      y1={b.topY}
                      y2={b.topY}
                      stroke={GOOD_EDGE}
                      strokeWidth={1}
                    />
                  )}
                  {b.bottomY < plotBottom - 0.5 && (
                    <Line
                      x1={plotLeft}
                      x2={plotRight}
                      y1={b.bottomY}
                      y2={b.bottomY}
                      stroke={GOOD_EDGE}
                      strokeWidth={1}
                    />
                  )}
                </G>
              ) : null,
            )}

            {/* Lane labels, centered inside the lane and behind the data — a reference, not
                data. Uppercase + tracked to match the app's section labels ("OR TRY",
                "RECENT"). Unlabeled zones (pace's two grace lanes) render nothing. */}
            {bands.map((b, i) =>
              b.z.label ? (
                <SvgText
                  key={`label${i}`}
                  x={plotLeft + plotWidth / 2}
                  y={(b.topY + b.bottomY) / 2 + 3.5}
                  textAnchor="middle"
                  fontSize={10}
                  fontFamily={fonts.medium}
                  fill={colors.textSubtle}
                  letterSpacing={0.8}
                >
                  {b.z.label.toUpperCase()}
                </SvgText>
              ) : null,
            )}

            {/* Dashed guide from the selected dot down to the card that slides out below. */}
            {selected && (
              <Line
                x1={selected.x}
                x2={selected.x}
                y1={selected.y + DOT_R_SELECTED + 3}
                y2={plotBottom}
                stroke={colors.accent}
                strokeOpacity={0.3}
                strokeWidth={1}
                strokeDasharray="2 3"
              />
            )}

            {/* The line, drawn twice: a wide translucent pass reads as a glow on the dark
                background, then the crisp stroke on top. */}
            {runs.map((run, i) =>
              run.length >= 2 ? (
                <G key={`line${i}`}>
                  <Path
                    d={smoothPath(run)}
                    fill="none"
                    stroke={colors.accent}
                    strokeOpacity={0.14}
                    strokeWidth={GLOW_WIDTH}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <Path
                    d={smoothPath(run)}
                    fill="none"
                    stroke={colors.accent}
                    strokeWidth={LINE_WIDTH}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </G>
              ) : null,
            )}
          </G>

          {/* Plot border, on top of the washes so the corners stay crisp. */}
          <Rect
            x={plotLeft}
            y={plotTop}
            width={plotWidth}
            height={plotHeight}
            rx={PLOT_RADIUS}
            ry={PLOT_RADIUS}
            fill="none"
            stroke={colors.border}
            strokeWidth={1}
          />

          {/* Dots sit OUTSIDE the clip so a dot pinned to the top/bottom lane isn't sliced
              by the border. showDots=false (all-time, line-only) suppresses them EXCEPT for
              a lone point — a run of length 1 draws no line, so its dot must stay visible. */}
          {runs.flatMap((run) =>
            showDots || run.length === 1
              ? run.map((pt) => {
                  const isSel = pt.id === selectedId;
                  return (
                    <G key={`dot${pt.id}`}>
                      {isSel && (
                        <Circle
                          cx={pt.x}
                          cy={pt.y}
                          r={HALO_R}
                          fill={colors.accent}
                          fillOpacity={0.14}
                        />
                      )}
                      <Circle
                        cx={pt.x}
                        cy={pt.y}
                        r={isSel ? DOT_R_SELECTED : DOT_R}
                        fill={colors.accent}
                        stroke={isSel ? colors.text : undefined}
                        strokeWidth={isSel ? 2 : undefined}
                      />
                    </G>
                  );
                })
              : [],
          )}
        </Svg>
      )}

      {/* Tap targets CENTERED ON EACH DOT (only when interactive) — a HIT_SIZE-tall box,
          one dot-spacing wide max, so you must press at the circle (not anywhere in its
          column) and neighbors' targets never overlap. box-none lets the rest of the
          chart fall through. */}
      {graphWidth > 0 && onSelectPoint && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {dots.map((pt) => {
            const w = Math.min(columnWidth, HIT_SIZE);
            // Clamp inside the container — touches outside the parent's bounds
            // wouldn't register anyway.
            const left = Math.max(0, Math.min(graphWidth - w, pt.x - w / 2));
            const top = Math.max(0, Math.min(CHART_HEIGHT - HIT_SIZE, pt.y - HIT_SIZE / 2));
            return (
              <Pressable
                key={`tap${pt.id}`}
                onPress={() => onSelectPoint(pt.id)}
                style={[styles.tapBox, { left, top, width: w }]}
              />
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: CHART_HEIGHT,
  },
  // Invisible tap box centered on a session dot; positioned via inline left/top/width.
  tapBox: {
    position: 'absolute',
    height: HIT_SIZE,
  },
});
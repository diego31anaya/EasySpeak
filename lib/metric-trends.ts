// lib/metric-trends.ts
//
// Pure config for the Profile-tab progress graph. Maps each plottable metric
// (score / pace / fillers / pauses) to: the raw value to plot, the Y-axis domain +
// colored band zones (with labels), and how to resolve each point's
// good/warning/danger band. Imports only the pure lib/ layer (metric-status
// thresholds + metrics constants) so it stays React/SVG-free — the chart component
// maps MetricStatus → color. The MetricTrendRow import is type-only (erased), so no
// cycle with lib/sessions.
//
// Two chart shapes share one zone model (an ordered [from,to] segment list):
//   - directional (score/fillers/pauses): one end is the goal.
//   - goldilocks (pace): target band in the middle.
// The chart renders dots + the connecting line in ACCENT BLUE (matching the Home week
// strip), so good/warning/danger is encoded solely by WHICH background band a dot sits in.
//
// PACE places each dot against THAT SESSION's baked target band (see `zonesFor`), not the
// default 130/160 decoration. This works because the chart's lane geometry is derived from
// `statusWeights` and NEVER from the zone numbers — so every session's five zones map onto
// the same five fixed lanes, and "dead center of my target" always renders mid-green
// whatever that target was. Without it a user on a custom band saw an on-target session
// drawn in the yellow/red lane (the dot color used to paper over this, until dots went
// uniform blue). The background is always drawn from the DEFAULT band.

import type { MetricTrendRow } from './sessions';
import type { MetricStatus } from './metric-status';
import { scoreStatus, paceWpmStatus, fillerStatus, hesitationStatus } from './metric-status';
import { DEFAULT_PACE_TARGET, PACE_WARNING_MARGIN } from './metrics';

export type MetricId = 'score' | 'pace' | 'fillers' | 'pauses';

// A horizontal band on the Y axis: [from,to] in value units + its status color + an
// optional edge label. Listed low→high for readability; the chart maps each edge
// through valueToY.
export type MetricZone = { from: number; to: number; status: MetricStatus; label?: string };

// The subset of fields the chart's value/status resolvers actually read. Both a full
// per-session MetricTrendRow AND an all-time BUCKET row (avg values + a synthetic id +
// paceLow/High = null, so the pace band falls back to the default 130/160) satisfy this,
// so one toChartPoints + METRIC_CONFIGS feed either chart mode.
export type ChartRow = Pick<
  MetricTrendRow,
  'id' | 'score' | 'pace' | 'fillers' | 'pauses' | 'paceLow' | 'paceHigh'
>;

export type MetricConfig = {
  id: MetricId;
  label: string; // selector button + chart heading
  yDomain: [number, number]; // values clamp to this; zones span it
  zones: MetricZone[];
  // Optional per-status band-height weight (default 1 → the colors split the height
  // equally). Lets a metric shrink one color's total band relative to the others —
  // pace uses { warning: 0.5 } so its "grace" zones read thinner than the red.
  statusWeights?: Partial<Record<MetricStatus, number>>;
  // Optional per-row zone override, used only to PLACE a dot — never to draw the
  // background. Only pace needs it: each session bakes its own target band, so the dot
  // must be measured against that band rather than the default decoration. MUST return the
  // same statuses in the same order as `zones`, since zone i maps to fixed lane i.
  zonesFor?: (row: ChartRow) => MetricZone[];
  value: (row: ChartRow) => number | null; // raw value to plot (null → gap)
  status: (row: ChartRow) => MetricStatus | null; // band for the dot (null → gap)
  // Human-readable value + unit, for surfaces that CAN show a number (the selected-session
  // card). The chart itself can't — its Y axis is banded, not proportional.
  format: (value: number) => string;
};

export const METRIC_IDS: MetricId[] = ['score', 'pace', 'fillers', 'pauses'];

const PACE_MIN = 45;
const PACE_MAX = 250; // matches the results-screen PaceGraph clamp
const FILLER_MAX = 10; // fillers-per-minute; clamp beyond
const PAUSE_MAX = 8; // hesitation-pause count; clamp beyond

// 8 → "8", 7.67 → "7.7". Whole numbers stay clean, but TTO round-averages (score, pauses)
// are genuinely fractional, so don't just round them away.
const oneDp = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/**
 * The five pace zones for a target band, low→high (danger · grace · target · grace · danger).
 * Only the edges vary per band — the chart's lane HEIGHTS come from `statusWeights`, not
 * from these numbers, so any band's zones map onto the same five fixed lanes. Edges are
 * clamped into the Y domain so a target sitting near a domain edge can't produce an
 * inverted (to < from) zone; a degenerate zero-width zone is handled by the chart's
 * valueToY. Mirrors `paceWpmStatus`: good inside [low,high], warning within the margin.
 */
export function paceZones(low: number, high: number): MetricZone[] {
  const lo = Math.max(PACE_MIN, Math.min(PACE_MAX, low));
  const hi = Math.max(lo, Math.min(PACE_MAX, high));
  const graceLow = Math.max(PACE_MIN, lo - PACE_WARNING_MARGIN);
  const graceHigh = Math.min(PACE_MAX, hi + PACE_WARNING_MARGIN);
  return [
    { from: PACE_MIN, to: graceLow, status: 'danger', label: 'Slow' },
    { from: graceLow, to: lo, status: 'warning' },
    { from: lo, to: hi, status: 'good', label: 'Target' },
    { from: hi, to: graceHigh, status: 'warning' },
    { from: graceHigh, to: PACE_MAX, status: 'danger', label: 'Fast' },
  ];
}

export const METRIC_CONFIGS: Record<MetricId, MetricConfig> = {
  // Directional — higher is better.
  score: {
    id: 'score',
    label: 'Score',
    yDomain: [0, 10],
    zones: [
      { from: 0, to: 5, status: 'danger', label: '0-4' },
      { from: 5, to: 8, status: 'warning', label: '5-7' },
      { from: 8, to: 10, status: 'good', label: '8-10' },
    ],
    value: (r) => r.score,
    status: (r) => (r.score == null ? null : scoreStatus(r.score)),
    format: (v) => `${oneDp(v)} / 10`,
  },

  // Goldilocks — target band in the middle. `zones` is the fixed BACKGROUND decoration
  // (drawn at the default 130/160 band); `zonesFor` places each dot against the band that
  // session was actually scored against, so an on-target session lands mid-green no matter
  // what the user's target was at the time. All-time buckets carry no band (paceLow/High
  // null) → they fall back to the default, exactly as before.
  pace: {
    id: 'pace',
    label: 'Pace',
    yDomain: [PACE_MIN, PACE_MAX],
    zones: paceZones(DEFAULT_PACE_TARGET.low, DEFAULT_PACE_TARGET.high),
    statusWeights: { warning: 0.5 }, // grace zones read thinner than the red danger bands
    zonesFor: (r) =>
      paceZones(r.paceLow ?? DEFAULT_PACE_TARGET.low, r.paceHigh ?? DEFAULT_PACE_TARGET.high),
    value: (r) => r.pace,
    status: (r) =>
      r.pace == null
        ? null
        : paceWpmStatus(r.pace, r.paceLow ?? DEFAULT_PACE_TARGET.low, r.paceHigh ?? DEFAULT_PACE_TARGET.high),
    format: (v) => `${Math.round(v)} wpm`,
  },

  // Directional — fewer is better.
  fillers: {
    id: 'fillers',
    label: 'Fillers',
    yDomain: [0, FILLER_MAX],
    zones: [
      { from: 0, to: 3, status: 'good', label: 'Clean' },
      { from: 3, to: 6, status: 'warning', label: 'Some' },
      { from: 6, to: FILLER_MAX, status: 'danger', label: 'Frequent' },
    ],
    value: (r) => r.fillers,
    status: (r) => (r.fillers == null ? null : fillerStatus(r.fillers)),
    // This column is a DENSITY, not a raw count — saying "3 filler words" would contradict
    // the dot's own height, which encodes per-minute density.
    format: (v) => (v === 0 ? 'No filler words' : `${oneDp(v)} per minute`),
  },

  // Directional — fewer is better. hesitationStatus: 0 good / ≤2 warning / else danger.
  pauses: {
    id: 'pauses',
    label: 'Pauses',
    yDomain: [0, PAUSE_MAX],
    zones: [
      { from: 0, to: 1, status: 'good', label: 'Clean' },
      { from: 1, to: 3, status: 'warning', label: 'Some' },
      { from: 3, to: PAUSE_MAX, status: 'danger', label: 'Choppy' },
    ],
    value: (r) => r.pauses,
    status: (r) => (r.pauses == null ? null : hesitationStatus(r.pauses)),
    // This column is the HESITATION pause count specifically (intentional pauses aren't
    // plotted), so name it — "1 pause" would imply a total the dot doesn't represent.
    format: (v) =>
      v === 0 ? 'No hesitations' : v === 1 ? '1 hesitation pause' : `${oneDp(v)} hesitation pauses`,
  },
};

// The chart's dumb input: value + resolved status per session, in row order.
// `id` carries the session identity to the chart so it can mark the selected dot and
// report which session was tapped. `zones` (pace only) is that session's OWN target band —
// the chart measures the dot against it, falling back to the config's zones when absent.
export type ChartPoint = {
  id: string;
  value: number | null;
  status: MetricStatus | null;
  zones?: MetricZone[];
};

export function toChartPoints(rows: ChartRow[], metricId: MetricId): ChartPoint[] {
  const cfg = METRIC_CONFIGS[metricId];
  return rows.map((r) => ({
    id: r.id,
    value: cfg.value(r),
    status: cfg.status(r),
    zones: cfg.zonesFor?.(r),
  }));
}
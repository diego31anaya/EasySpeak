// lib/metric-status.ts
//
// Pure delivery-status thresholds — the SINGLE source of truth for whether a
// metric reads good / warning / danger. Imported by BOTH the UI
// (components/metric-scoring.tsx, which colors the metric rows) AND the AI
// feedback prompt builders (lib/ai-feedback.ts, lib/tto-feedback.ts), so the
// headline AI score and the colored rows can't disagree about the same session.
//
// Pure: no React, no SVG, no side effects. Lives in lib/ so the AI modules can
// import it without pulling in component dependencies.

import type { SessionMetrics, PaceConsistencyVerdict } from './metrics';
import { DEFAULT_PACE_TARGET, PACE_WARNING_MARGIN } from './metrics';

// Structurally identical to MetricRow's RowStatus ('good' | 'warning' | 'danger').
// Named separately so this pure module doesn't import a type from components/.
export type MetricStatus = 'good' | 'warning' | 'danger';

type LoadedMetrics = Extract<SessionMetrics, { tooShort: false }>;

// ---- Pace ----
// Good inside the band; warning within PACE_WARNING_MARGIN of it; danger beyond.
// The zones scale with the band, so a custom target colors consistently (the
// built-in 130–160 ± 20 reproduces the old 110/130/160/180 thresholds exactly).
export function paceWpmStatus(
  wpm: number,
  low: number = DEFAULT_PACE_TARGET.low,
  high: number = DEFAULT_PACE_TARGET.high,
): MetricStatus {
  if (wpm < low - PACE_WARNING_MARGIN || wpm > high + PACE_WARNING_MARGIN) return 'danger';
  if (wpm < low || wpm > high) return 'warning';
  return 'good';
}

export function consistencyStatus(verdict: PaceConsistencyVerdict): MetricStatus {
  return verdict === 'steady' ? 'good' : 'warning';
}

export function paceStatus(m: LoadedMetrics): MetricStatus {
  const wpm = paceWpmStatus(m.wpm, m.paceTargetLow, m.paceTargetHigh);
  if (wpm === 'danger') return 'danger';
  if (wpm === 'warning' || m.paceConsistency.verdict !== 'steady') return 'warning';
  return 'good';
}

// ---- Fillers ---- (keys off per-minute DENSITY, not raw count)
export function fillerStatus(densityPerMin: number): MetricStatus {
  if (densityPerMin < 3) return 'good';
  if (densityPerMin < 6) return 'warning';
  return 'danger';
}

// ---- Pauses ---- (keys off hesitation count)
export function hesitationStatus(hesitationPauseCount: number): MetricStatus {
  if (hesitationPauseCount === 0) return 'good';
  if (hesitationPauseCount <= 2) return 'warning';
  return 'danger';
}

export function pauseStatus(m: LoadedMetrics): MetricStatus {
  return hesitationStatus(m.hesitationPauseCount);
}

// ---- AI score ---- (the holistic 1–10; higher is better). The 'pending'/null
// display state (AI failed / too short) stays in components/metric-scoring.tsx —
// this is just the pure good/warning/danger threshold, shared with the progress graph.
export function scoreStatus(score: number): MetricStatus {
  if (score >= 8) return 'good';
  if (score >= 5) return 'warning';
  return 'danger';
}
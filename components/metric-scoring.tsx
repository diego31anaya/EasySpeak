// components/metric-scoring.tsx
//
// Shared scoring logic and icons for MetricRow instances on results screens.
// Pulled out of impromptu-results so both impromptu-results and tto-results can
// score deterministic metrics (pace, fillers, pauses) identically.
//
// Pure functions only — no React state, no side effects. They take
// SessionMetrics and return display-ready data the MetricRow component knows
// how to render.

import Svg, { Path } from 'react-native-svg';

import { colors } from '../lib/theme';
import type {
  SessionMetrics,
  PaceConsistencyVerdict,
  IntonationVerdict,
} from '../lib/metrics';
import type { RowStatus, ScorePart } from './MetricRow';
import {
  paceWpmStatus,
  consistencyStatus,
  paceStatus,
  fillerStatus,
  pauseStatus,
  scoreStatus,
} from '../lib/metric-status';

// The delivery-status thresholds moved to lib/metric-status so the AI feedback
// prompts share ONE source of truth with these rows. Re-export them here so
// existing import sites (which pull them from this file) keep working. scoreStatus
// also lives there now (shared with the Profile progress graph).
export { paceWpmStatus, consistencyStatus, paceStatus, fillerStatus, pauseStatus, scoreStatus };


// ============================================================
// PACE
// ============================================================

function paceWpmLabel(m: Extract<SessionMetrics, { tooShort: false }>): string {
  if (m.paceVerdict === 'fast') return 'A bit fast';
  if (m.paceVerdict === 'slow') return 'A bit slow';
  return 'Ideal Pace';
}

function consistencyLabel(verdict: PaceConsistencyVerdict): string {
  return verdict === 'steady' ? 'Consistent pace' : 'Inconsistent pace';
}

export function paceScoreParts(
  m: Extract<SessionMetrics, { tooShort: false }>,
): ScorePart[] {
  return [
    { text: paceWpmLabel(m), status: paceWpmStatus(m.wpm, m.paceTargetLow, m.paceTargetHigh) },
    {
      text: consistencyLabel(m.paceConsistency.verdict),
      status: consistencyStatus(m.paceConsistency.verdict),
    },
  ];
}

// ============================================================
// FILLERS
// ============================================================

function fillerScoreLabel(count: number): string {
  if (count === 0) return 'No filler words';
  if (count === 1) return '1 filler word';
  return `${count} filler words`;
}

export function fillerScoreParts(
  m: Extract<SessionMetrics, { tooShort: false }>,
): ScorePart[] {
  return [
    {
      text: fillerScoreLabel(m.fillerCount),
      status: fillerStatus(m.fillerDensityPerMin),
    },
  ];
}

// ============================================================
// PAUSES
// ============================================================

export function pauseScoreParts(
  m: Extract<SessionMetrics, { tooShort: false }>,
): ScorePart[] {
  if (m.pauseCount === 0) {
    return [{ text: 'No pauses', status: 'good' }];
  }

  if (m.hesitationPauseCount === 0) {
    const label = m.pauseCount === 1 ? '1 Pause' : `${m.pauseCount} pauses`;
    return [{ text: label, status: 'good' }];
  }

  const parts: ScorePart[] = [];

  // Only show intentional pill when count > 0 — "0 intentional" next to
  // "1 hesitation" reads as the app celebrating the absence of a good thing.
  if (m.intentionalPauseCount > 0) {
    parts.push({
      text: `${m.intentionalPauseCount} intentional`,
      status: 'good',
    });
  }

  parts.push({
    text:
      m.hesitationPauseCount === 1
        ? '1 hesitation'
        : `${m.hesitationPauseCount} hesitations`,
    status: m.hesitationPauseCount <= 2 ? 'warning' : 'danger',
  });

  return parts;
}

// ============================================================
// INTONATION
// ============================================================
export function intonationStatus( m: Extract<SessionMetrics, { tooShort: false }>,): RowStatus {
  if (!m.intonation) return 'good';
  return m.intonation.verdict === 'dynamic' ? 'good' : 'warning';
}

function intonationLabel(verdict: IntonationVerdict): string {
  return verdict === 'dynamic' ? "Dynamic" : "Monotone";
}

export function intonationScoreParts(m: Extract<SessionMetrics, { tooShort: false }>,): ScorePart[] {
  if (!m.intonation) {
    return [{ text: 'Not measured', status: 'good' }];
  }
  return [
    {
      text: intonationLabel(m.intonation.verdict),
      status: intonationStatus(m),
    }
  ]
}

// ============================================================
// AI SCORE — the holistic 1–10 score the AI returns. Distinct from
// RowStatus because the score has a 'pending' state (rendered as "—")
// when the AI call failed or the session was too short to score.
// ============================================================

// 'pending' (rendered "—") = AI failed / too short. scoreStatus (the pure
// good/warning/danger threshold) lives in lib/metric-status.ts and is re-exported above.
export type ScoreStatus = 'good' | 'warning' | 'danger' | 'pending';

export function scoreColor(status: ScoreStatus): string {
  if (status === 'good') return colors.success;
  if (status === 'warning') return colors.warning;
  if (status === 'danger') return colors.danger;
  return colors.textMuted; // pending
}

// ============================================================
// Icons — used by both results screens
// ============================================================

type IconProps = { size?: number; color?: string };

export function BoltIcon({ size = 24, color = colors.text }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function WaveformIcon({ size = 24, color = colors.text }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M2 12h2.5l2-6 3.5 14 3.5-11 2 3H22"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function ChatDotsIcon({ size = 24, color = colors.text }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function PauseOutlineIcon({ size = 24, color = colors.text }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M15.75 5.25v13.5m-7.5-13.5v13.5"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
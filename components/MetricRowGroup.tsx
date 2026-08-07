// components/MetricRowGroup.tsx
//
// The Pace / Filler / Intonation / Pauses block of MetricRows. This exact
// sequence was duplicated in impromptu-results and in tto-results' RoundCard;
// it lives here so both screens (and the review screens) render the same four
// rows from one source. It does NOT include the AI feedback card (impromptu
// passes an aiScore, the tto round does not), the transcript, or the audio
// player — those differ per screen and stay at the call site.

import { colors } from '../lib/theme';
import type { SessionMetrics } from '../lib/metrics';
import type { DeepgramWord } from '../lib/deepgram';
import {
  MetricRow,
  PaceExpansion,
  FillerExpansion,
  PauseExpansion,
  IntonationExpansion,
} from './MetricRow';
import {
  paceScoreParts,
  paceStatus,
  fillerScoreParts,
  fillerStatus,
  pauseScoreParts,
  pauseStatus,
  intonationScoreParts,
  intonationStatus,
  BoltIcon,
  ChatDotsIcon,
  PauseOutlineIcon,
  WaveformIcon,
} from './metric-scoring';

type MetricRowGroupProps = {
  // Callers guard `metrics && !metrics.tooShort` before rendering this, so the
  // narrowed type is what the scoring helpers + expansions all require.
  metrics: Extract<SessionMetrics, { tooShort: false }>;
  words: DeepgramWord[];
  durationSec: number;
};

export function MetricRowGroup({ metrics, words, durationSec }: MetricRowGroupProps) {
  return (
    <>
      <MetricRow
        icon={<BoltIcon color={colors.text} />}
        title="Pace"
        score={paceScoreParts(metrics)}
        status={paceStatus(metrics)}
        variant="flat"
      >
        <PaceExpansion metrics={metrics} words={words} durationSec={durationSec} />
      </MetricRow>

      <MetricRow
        icon={<ChatDotsIcon color={colors.text} />}
        title="Filler Words"
        score={fillerScoreParts(metrics)}
        status={fillerStatus(metrics.fillerDensityPerMin)}
        variant="flat"
      >
        <FillerExpansion metrics={metrics} />
      </MetricRow>

      <MetricRow
        icon={<WaveformIcon color={colors.text} />}
        title="Intonation"
        score={intonationScoreParts(metrics)}
        status={intonationStatus(metrics)}
        variant="flat"
      >
        <IntonationExpansion metrics={metrics} durationSec={durationSec} />
      </MetricRow>

      <MetricRow
        icon={<PauseOutlineIcon color={colors.text} />}
        title="Pauses"
        score={pauseScoreParts(metrics)}
        status={pauseStatus(metrics)}
        variant="flat"
      >
        <PauseExpansion metrics={metrics} />
      </MetricRow>
    </>
  );
}
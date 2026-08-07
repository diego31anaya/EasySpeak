import type { DeepgramWord } from './deepgram';
import { normalizeWord, BASE_FILLER_LEXICON, type FillerLexicon } from '@/lib/filler-word';
// ============================================================
// Public types
// ============================================================

export type IntonationVerdict = 'monotone' | 'dynamic';

export type PitchFrame = { t: number; f0Hz: number };

// An AI sub-score with a one-sentence justification (impromptu coverage/structure).
// Relocated here when the legacy lib/coach.ts was deleted.
export type ScoreWithReasoning = {
  score: number; // 1-10
  reasoning: string; // single sentence
};

export type IntonationPoint = { t: number; f0Hz: number };

export type IntonationResult = {
  verdict: IntonationVerdict;
  varianceSemitones: number; // robust spread of pitch, in semitones
  meanF0Hz: number;
  contour: IntonationPoint[];
}

export type PaceConsistencyVerdict = 'steady' | 'uneven';

export type PaceConsistency = {
  verdict: PaceConsistencyVerdict;
  coefficientOfVariation: number; // std dev / mean, kept for future tuning
};

export type PauseQuality = 'intentional' | 'hesitation';

export type PaceVerdict = 'slow' | 'ideal' | 'fast';

// The user's ideal words-per-minute band. Defaults to the built-in 130–160, but a
// per-user target (profiles.pace_target_low/high) overrides it. Baked into each
// session's metrics at finalize so a past session keeps the band it was scored
// against (its colors/verdict/AI score stay consistent if the user later retunes).
export type PaceTarget = { low: number; high: number };
export const DEFAULT_PACE_TARGET: PaceTarget = { low: 130, high: 160 };
// How far outside the ideal band still reads as "warning" before it becomes
// "danger" (paceWpmStatus). The band's good/warning/danger zones scale with it.
export const PACE_WARNING_MARGIN = 20;

export type FillerInstance = {
  text: string;             // "um" or "you know"
  startSec: number;
  indices: number[];        // original indices in the words[] array
};

export type MisreadEntry = {
  expected: string;
  spoken: string;
};

export type SessionMetrics =
  | {
      tooShort: true;
      reason: string;
    }
  | {
      tooShort: false;
      // Pace
      wpm: number;
      paceVerdict: PaceVerdict;
      paceConsistency: PaceConsistency;
      // The ideal-band this session was scored against (snapshot of the user's
      // pace target at finalize). Drives the verdict, the row color, the meter
      // zones, and the expansion copy — read these, not the live profile.
      paceTargetLow: number;
      paceTargetHigh: number;
      speakingDurationSec: number
      // Disfluency
      fillerCount: number;
      fillerDensityPerMin: number;
      fillerIndices: Set<number>;
      // Flow
      pauseCount: number;
      intentionalPauseCount: number;
      hesitationPauseCount: number;
      hesitationPauseBeforeIndices: number[];
      intentionalPauseBeforeIndices: number[];
      longestPauseSec: number;
      longestPauseAtSec: number;
      longestPauseQuality: PauseQuality;
      // Accuracy
      accuracy: number | null;       // null if no passage given (conversation mode later)
      skippedWords: string[];
      misreadWords: MisreadEntry[];
      misreadIndices: Set<number>;   // original indices in words[] for highlighting
      // Counts for display
      totalWords: number;
      // Impromptu-practice only
      coverage?: ScoreWithReasoning;
      structure?: ScoreWithReasoning;
      intonation?: IntonationResult;
      fillerBreakdown: { text: string; count: number }[];
    };

// ============================================================
// Intonation (pitch variation)
// ============================================================

// Below this spread, delivery reads as monotone. Conservative on purpose: better
// to miss a borderline-flat take than tell an expressive speaker they're flat.
// Placeholder value — set properly in calibration (Phase 6).
const MONOTONE_MAX_SEMITONES = 1.5;

// One-sided spike-rejection cap (semitones above the median). Octave errors are
// a x2 in Hz = +12 semitones, so they only ever push pitch UP. Frames more than
// this far above the median are treated as anomalies and dropped before the
// spread is measured. Set below an octave (12) but above realistic speech peaks
// (~6-7 st) so it gates errors without clipping genuine expressiveness.
// PROVISIONAL — calibrate on device using the rejectedFrames log.
const OCTAVE_SPIKE_CAP = 8;

// At a 25ms hop, 20 frames is -0.5s of voiced pitch. Below this we return null
// and the metric is simply ommited.
const MIN_VOICED_FRAMES = 20;

const CONTOUR_TARGET_POINTS = 80;

// Cross-frame median smoothing window (odd). At a ~25ms hop, 5 frames is ~125ms —
// wide enough to erase a lone octave-jumped frame (a single ~25ms blip) but well
// below syllabic/phrase pitch movement (~150ms+), so genuine expressiveness is
// kept. This is the cheap "tracking" layer the YIN handoff calls for: YIN makes
// octave errors rare, not zero; the median pulls the survivors back toward their
// neighbours before the spread is measured, so a few bad frames can't flip the
// verdict monotone→dynamic.
const PITCH_SMOOTH_WINDOW = 5;

// Sliding-window median over the ordered voiced frames (in Hz — median is
// order-based, so Hz and semitones give the same result). Replaces each frame's
// pitch with the median of itself + its neighbours; isolated octave doublings
// vanish, sustained pitch is untouched.
function medianSmoothFrames(frames: PitchFrame[], window: number): PitchFrame[] {
  if (frames.length < window || window < 3) return frames;
  const half = Math.floor(window / 2);
  return frames.map((f, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(frames.length - 1, i + half);
    const vals = frames.slice(lo, hi + 1).map((g) => g.f0Hz).sort((a, b) => a - b);
    return { t: f.t, f0Hz: vals[Math.floor(vals.length / 2)] };
  });
}

export function computePitchMetrics(frames: PitchFrame[]): IntonationResult | null {
  if (frames.length < MIN_VOICED_FRAMES) return null;

  // Smooth first, then measure spread + draw the contour from the SAME data (so the
  // graph and the verdict can't disagree, the old split-cleaning bug).
  const smoothed = medianSmoothFrames(frames, PITCH_SMOOTH_WINDOW);

  const semitones = smoothed.map((f) => 12 * Math.log2(f.f0Hz));
  const sorted = [...semitones].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // One-sided spike rejection — belt-and-suspenders for any SUSTAINED high outlier
  // the median filter didn't catch (octave errors only push pitch UP, +12 st). With
  // smoothing upstream this rarely fires now; kept as a cheap guard. NOT a symmetric
  // trim (which read dynamic speech as monotone) and NOT an asymmetric percentile
  // trim (rejected) — it gates by a fixed semitone distance: below an octave, above
  // realistic speech peaks.
  const core = semitones.filter((s) => s <= median + OCTAVE_SPIKE_CAP);

  const mean = core.reduce((a, b) => a + b, 0) / core.length;
  const stdDev = Math.sqrt(
    core.reduce((sum, s) => sum + (s - mean) ** 2, 0) / core.length,
  );

  return {
    verdict: stdDev < MONOTONE_MAX_SEMITONES ? 'monotone' : 'dynamic',
    varianceSemitones: Math.round(stdDev * 100) / 100,
    meanF0Hz: Math.round(Math.pow(2, mean / 12)),
    contour: downsampleContour(smoothed),
  };
}

// Y-axis bounds for the contour graph. Auto-scales to the recording's pitch
// range, but never shows a span narrower than CONTOUR_MIN_WINDOW_SEMITONES —
// so a flat (monotone) take renders visibly flat instead of being zoomed up to
// look varied. Defined in semitones, not Hz, so it's voice-independent.
const CONTOUR_MIN_WINDOW_SEMITONES = 4;  // placeholder; tune in Phase 6
const CONTOUR_PAD_RATIO = 0.08;

export function computeContourRange(
  contour: IntonationPoint[],
  meanF0Hz: number,
): { minHz: number; maxHz: number } {
  if (contour.length === 0) {
    return { minHz: meanF0Hz * 0.9, maxHz: meanF0Hz * 1.1 };
  }

  let actualMin = Infinity;
  let actualMax = -Infinity;
  for (const p of contour) {
    if (p.f0Hz < actualMin) actualMin = p.f0Hz;
    if (p.f0Hz > actualMax) actualMax = p.f0Hz;
  }

  const windowMin = meanF0Hz * Math.pow(2, -CONTOUR_MIN_WINDOW_SEMITONES / 2 / 12);
  const windowMax = meanF0Hz * Math.pow(2, CONTOUR_MIN_WINDOW_SEMITONES / 2 / 12);

  const lo = Math.min(actualMin, windowMin);
  const hi = Math.max(actualMax, windowMax);

  const pad = (hi - lo) * CONTOUR_PAD_RATIO;
  return { minHz: Math.round(lo - pad), maxHz: Math.round(hi + pad) };
}

function downsampleContour(frames: PitchFrame[]): IntonationPoint[] {
  if (frames.length <= CONTOUR_TARGET_POINTS) {
    return frames.map((f) => ({ t: f.t, f0Hz: Math.round(f.f0Hz) }));
  }
  const tStart = frames[0].t;
  const binSec = (frames[frames.length - 1].t - tStart) / CONTOUR_TARGET_POINTS;

  const buckets: number[][] = Array.from({ length: CONTOUR_TARGET_POINTS }, () => []);
  const bucketT = new Array(CONTOUR_TARGET_POINTS).fill(0);
  for (const f of frames) {
    const idx = Math.min(CONTOUR_TARGET_POINTS - 1, Math.floor((f.t - tStart) / binSec));
    if (buckets[idx].length === 0) bucketT[idx] = f.t;
    buckets[idx].push(f.f0Hz);
  }

  const out: IntonationPoint[] = [];
  for (let i = 0; i < CONTOUR_TARGET_POINTS; i++) {
    if (buckets[i].length === 0) continue; // unvoiced gap → leave a hole in the line
    out.push({ t: bucketT[i], f0Hz: median(buckets[i]) });
  }
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round(s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]);
}

export const intonationVerdictLabel = (v: IntonationVerdict): string =>
  v === 'dynamic' ? 'Varied pitch' : 'A bit flat';

// ============================================================
// Filler detection
// ============================================================

type FillerScan = {
  count: number;
  instances: FillerInstance[];
  indices: Set<number>;
};

export function detectFillers(
  words: DeepgramWord[],
  lexicon: FillerLexicon = BASE_FILLER_LEXICON,
): FillerScan {
  const { singles, bigrams } = lexicon;
  const instances: FillerInstance[] = [];
  const indices = new Set<number>();

  let i = 0;
  while (i < words.length) {
    const w = normalizeWord(words[i].word);

    // Bigrams take priority (longest-match wins)
    if (i + 1 < words.length) {
      const next = normalizeWord(words[i + 1].word);
      const bigramMatch = bigrams.find(([a, b]) => w === a && next === b);
      if (bigramMatch) {
        instances.push({
          text: `${bigramMatch[0]} ${bigramMatch[1]}`,
          startSec: words[i].start,
          indices: [i, i + 1],
        });
        indices.add(i);
        indices.add(i + 1);
        i += 2;
        continue;
      }
    }

    // Single-word fillers
    if (singles.has(w)) {
      instances.push({ text: w, startSec: words[i].start, indices: [i] });
      indices.add(i);
    }
    i++;
  }

  return { count: instances.length, instances, indices };
}

// Drop confirmed false-positive filler instances (their word indices came back
// from lib/filler-validate as meaningful uses) and recompute the scan. Pure.
function applyFillerExclusions(scan: FillerScan, exclude: ReadonlySet<number>): FillerScan {
  const instances = scan.instances.filter(
    (inst) => !inst.indices.some((i) => exclude.has(i)),
  );
  const indices = new Set<number>();
  for (const inst of instances) for (const i of inst.indices) indices.add(i);
  return { count: instances.length, instances, indices };
}

// ============================================================
// Pause detection
// ============================================================

const PAUSE_THRESHOLD_SEC = 1.0;

type PauseScan = {
  count: number;
  longestSec: number;
  longestAtSec: number;
  longestQuality: PauseQuality;
  intentionalCount: number;
  hesitationCount: number;
  hesitationBeforeIndices: number[];
  intentionalBeforeIndices: number[];
};

// Sentence-terminating punctuation indicates a complete thought before the
// pause — strong signal it was intentional. Comma indicates a natural breath
// point and we treat it the same way (the user had control either way).
const SENTENCE_BOUNDARY_CHARS = new Set(['.', '?', '!', ',']);

// Pauses longer than this read as hesitation regardless of context — no
// human pauses 4+ seconds intentionally outside of theatrical delivery.
const HESITATION_DURATION_SEC = 5.0;
// Pauses with no preceding punctuation that exceed this length are likely
// hesitations (the speaker stopped mid-thought and couldn't continue).
const UNPUNCTUATED_HESITATION_SEC = 1.5;

function classifyPause(
  prevWord: DeepgramWord,
  nextWord: DeepgramWord,
  durationSec: number,
  fillerSingles: ReadonlySet<string> = BASE_FILLER_LEXICON.singles,
): PauseQuality {
  if (durationSec >= HESITATION_DURATION_SEC) return 'hesitation';
  if (fillerSingles.has(normalizeWord(nextWord.word))) return 'hesitation';

  const prevText = (prevWord.punctuated_word ?? prevWord.word).trim();
  const endedSentenceOrClause = SENTENCE_BOUNDARY_CHARS.has(prevText.slice(-1))

  if (!endedSentenceOrClause && durationSec >= UNPUNCTUATED_HESITATION_SEC) {
    return 'hesitation';
  }

  return 'intentional';
}

export function detectPauses(
  words: DeepgramWord[],
  fillerSingles: ReadonlySet<string> = BASE_FILLER_LEXICON.singles,
): PauseScan {
  let count = 0;
  let longestSec = 0;
  let longestAtSec = 0;
  let longestQuality: PauseQuality = 'intentional';
  let intentionalCount = 0;
  let hesitationCount = 0;
  const hesitationBeforeIndices: number[] = [];
  const intentionalBeforeIndices: number[] = [];

  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - words[i - 1].end;
    if (gap >= PAUSE_THRESHOLD_SEC) {
      count++;
      const quality = classifyPause(words[i - 1], words[i], gap, fillerSingles);
      if (quality === 'intentional') {
        intentionalCount++;
        intentionalBeforeIndices.push(i);
      } else {
        hesitationCount++;
        hesitationBeforeIndices.push(i);
      }

      if (gap > longestSec) {
        longestSec = gap;
        longestAtSec = words[i - 1].end;
        longestQuality = quality;
      }
    }
  }

  return {
    count,
    longestSec,
    longestAtSec,
    longestQuality,
    intentionalCount,
    hesitationCount,
    hesitationBeforeIndices,
    intentionalBeforeIndices,
  };
}

// ============================================================
// Pace
// ============================================================

export function computePace(
  totalWords: number,
  durationSec: number,
  low: number = DEFAULT_PACE_TARGET.low,
  high: number = DEFAULT_PACE_TARGET.high,
): { wpm: number; verdict: PaceVerdict } {
  const wpm = Math.round((totalWords / durationSec) * 60);
  const verdict: PaceVerdict =
    wpm < low ? 'slow' : wpm > high ? 'fast' : 'ideal';
  return { wpm, verdict };
}

// ============================================================
// Word-level diff (Levenshtein with traceback)
// ============================================================

type DiffOp =
  | { type: 'match'; spokenIdx: number }
  | { type: 'misread'; passageWord: string; spokenWord: string; spokenIdx: number }
  | { type: 'skipped'; passageWord: string }
  | { type: 'extra'; spokenWord: string; spokenIdx: number };

/**
 * Compute the word-level edit script that turns `passage` into `transcript`.
 * Both arrays should already be normalized (lowercase, no punct).
 *
 * Cost model: match = 0, substitute = delete = insert = 1.
 * Standard Levenshtein DP, then traceback prioritizing match > sub > delete > insert.
 */
function diffWords(passage: string[], transcript: string[]): DiffOp[] {
  const m = passage.length;
  const n = transcript.length;

  // dp[i][j] = min edits to convert passage[0..i] -> transcript[0..j]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (passage[i - 1] === transcript[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] =
          1 +
          Math.min(
            dp[i - 1][j - 1], // substitute
            dp[i - 1][j],     // delete (skipped passage word)
            dp[i][j - 1],     // insert (extra spoken word)
          );
      }
    }
  }

  // Traceback
  const ops: DiffOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && passage[i - 1] === transcript[j - 1]) {
      ops.unshift({ type: 'match', spokenIdx: j - 1 });
      i--;
      j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      ops.unshift({
        type: 'misread',
        passageWord: passage[i - 1],
        spokenWord: transcript[j - 1],
        spokenIdx: j - 1,
      });
      i--;
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.unshift({ type: 'skipped', passageWord: passage[i - 1] });
      i--;
    } else {
      ops.unshift({ type: 'extra', spokenWord: transcript[j - 1], spokenIdx: j - 1 });
      j--;
    }
  }

  return ops;
}

// ============================================================
// Pace consistency
// ============================================================

// 5s windows are right for 30–90s impromptu sessions: enough granularity to
// catch rate shifts, big enough to be statistically meaningful with the
// number of words a user can produce. If/when sessions grow longer
// (e.g. multi-minute conversations), bump WINDOW_SEC to 8 or 10 so the
// per-window variance reflects sustained shifts, not micro-jitter.
const WINDOW_SEC = 5;
const CV_STEADY_MAX = 0.20;
/**
 * Sliding-window pace consistency. Buckets words into N-second windows by start
 * time, computes WPM for each window, then measures how much WPM varies relative
 * to the mean.
 */
export function computePaceConsistency(
  words: DeepgramWord[],
  speakingDurationSec: number,
): PaceConsistency {
  // Need at least 3 windows of data to say anything useful.
  if (speakingDurationSec < WINDOW_SEC * 3 || words.length < 10) {
    return { verdict: 'steady', coefficientOfVariation: 0 };
  }

  const speechStart = words[0].start
  const windowCount = Math.floor(speakingDurationSec / WINDOW_SEC);
  const wordsPerWindow = new Array<number>(windowCount).fill(0);

  for (const word of words) {
    const idx = Math.floor((word.start - speechStart) / WINDOW_SEC);
    if (idx >= 0 && idx < windowCount) {
      wordsPerWindow[idx]++;
    }
  }

  // Convert each window's word count to a per-minute rate.
  const wpms = wordsPerWindow.map((count) => count * (60 / WINDOW_SEC));

  const mean = wpms.reduce((a, b) => a + b, 0) / wpms.length;
  if (mean === 0) {
    return { verdict: 'steady', coefficientOfVariation: 0 };
  }

  // Population variance: mean of squared deviations. The previous code
  // forgot the / wpms.length, which inflated CV by sqrt(N) and made
  // longer sessions read as more erratic than they actually were.
  const variance =
    wpms.reduce((sum, x) => sum + (x - mean) ** 2, 0) / wpms.length;
  const stdDev = Math.sqrt(variance);
  const cv = stdDev / mean;

  const verdict: PaceConsistencyVerdict =
    cv < CV_STEADY_MAX ? 'steady' : 'uneven';

  return { verdict, coefficientOfVariation: Math.round(cv * 100) / 100 };
}

// ============================================================
// Main orchestrator
// ============================================================

const MIN_DURATION_SEC = 5;

export function computeMetrics(
  words: DeepgramWord[],
  passageText: string | null,
  durationSec: number,
  pitchFrames?: PitchFrame[],
  // Word indices to drop from the filler scan — false-positive "like"/"you know"
  // that lib/filler-validate confirmed were meaningful uses. Optional + pure: the
  // network call happens in finalize; this just applies its result.
  excludeFillerIndices?: ReadonlySet<number>,
  // The effective filler vocabulary (built-in + the user's custom words). Built by
  // the caller via buildFillerLexicon so it can also feed the detectFillers call
  // that precedes validateFillers. Defaults to the built-in set.
  fillerLexicon: FillerLexicon = BASE_FILLER_LEXICON,
  // The user's ideal WPM band (profiles.pace_target_low/high). Snapshotted into the
  // result so the verdict/colors/copy stay tied to the band at recording time.
  paceTarget: PaceTarget = DEFAULT_PACE_TARGET,
): SessionMetrics {
  if (durationSec < MIN_DURATION_SEC) {
    return { tooShort: true, reason: 'Recording was too short to analyze (under 5 seconds).' };
  }
  if (words.length === 0) {
    return { tooShort: true, reason: 'No speech was detected in the recording.' };
  }

  // 1. Fillers (uses original indices into words[])
  const rawFillerScan = detectFillers(words, fillerLexicon);
  const fillerScan =
    excludeFillerIndices && excludeFillerIndices.size > 0
      ? applyFillerExclusions(rawFillerScan, excludeFillerIndices)
      : rawFillerScan;
  // Aggregate filler instances by text, sorted by count desc, then alphabetical.
  const fillerCounts = new Map<string, number>();
  for (const inst of fillerScan.instances) {
    fillerCounts.set(inst.text, (fillerCounts.get(inst.text) ?? 0) + 1);
  }
  const fillerBreakdown = Array.from(fillerCounts, ([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));

  // 2. Pace — uses raw word count (filler density is reported separately)
  const speakingDurationSec = words[words.length - 1].end - words[0].start;

  const paceDenominator = speakingDurationSec >= MIN_DURATION_SEC ? speakingDurationSec : durationSec;

  const { wpm, verdict: paceVerdict } = computePace(words.length, paceDenominator, paceTarget.low, paceTarget.high);
  const fillerDensityPerMin =
    Math.round((fillerScan.count / paceDenominator) * 60 * 10) / 10;

  const paceConsistency = computePaceConsistency(words, paceDenominator);

  // 3. Pauses (custom fillers count toward hesitation classification too)
  const pauseScan = detectPauses(words, fillerLexicon.singles);

  // 4. Accuracy — diff non-filler transcript vs passage.
  // We strip fillers before diffing so they don't show up as "extras"
  // and pollute misread/skipped counts.
  let accuracy: number | null = null;
  let skippedWords: string[] = [];
  let misreadWords: MisreadEntry[] = [];
  const misreadIndices = new Set<number>();

  if (passageText && passageText.trim().length > 0) {
    // Build filtered transcript (no fillers, no empty tokens) with mapping
    // back to original indices for highlighting.
    const filteredToOriginal: number[] = [];
    const filteredWords: string[] = [];
    for (let idx = 0; idx < words.length; idx++) {
      if (fillerScan.indices.has(idx)) continue;
      const norm = normalizeWord(words[idx].word);
      if (norm.length === 0) continue;
      filteredWords.push(norm);
      filteredToOriginal.push(idx);
    }

    const passageWords = passageText
      .split(/\s+/)
      .map(normalizeWord)
      .filter((w) => w.length > 0);

    if (passageWords.length > 0) {
      const ops = diffWords(passageWords, filteredWords);

      let matches = 0;
      for (const op of ops) {
        if (op.type === 'match') {
          matches++;
        } else if (op.type === 'misread') {
          misreadWords.push({ expected: op.passageWord, spoken: op.spokenWord });
          misreadIndices.add(filteredToOriginal[op.spokenIdx]);
        } else if (op.type === 'skipped') {
          skippedWords.push(op.passageWord);
        } else if (op.type === 'extra') {
          // Rare for read-aloud after filler stripping. Treat as misread visually.
          misreadIndices.add(filteredToOriginal[op.spokenIdx]);
        }
      }

      accuracy = Math.round((matches / passageWords.length) * 100);
    }
  }

  // 5. Intonation (only when pitch frames were extracted — iOS, Impromptu/TTO)
  const intonation = pitchFrames ? computePitchMetrics(pitchFrames) ?? undefined : undefined;


  return {
    tooShort: false,
    wpm,
    paceVerdict,
    paceConsistency,
    paceTargetLow: paceTarget.low,
    paceTargetHigh: paceTarget.high,
    speakingDurationSec,
    fillerCount: fillerScan.count,
    fillerDensityPerMin,
    fillerIndices: fillerScan.indices,
    fillerBreakdown,
    pauseCount: pauseScan.count,
    intentionalPauseCount: pauseScan.intentionalCount,
    hesitationPauseCount: pauseScan.hesitationCount,
    hesitationPauseBeforeIndices: pauseScan.hesitationBeforeIndices,
    intentionalPauseBeforeIndices: pauseScan.intentionalBeforeIndices,  
    longestPauseSec: Math.round(pauseScan.longestSec * 10) / 10,
    longestPauseAtSec: Math.round(pauseScan.longestAtSec * 10) / 10,
    longestPauseQuality: pauseScan.longestQuality,
    accuracy,
    skippedWords,
    misreadWords,
    misreadIndices,
    totalWords: words.length,
    intonation,
  };
}

// PACE CONSISTENT GRAPH

const TIMELINE_PAUSE_THRESHOLD_SEC = 1.5
const TIMELINE_WINDOW_SEC = 15;
const TIMELINE_STEP_SEC = 1;

export type PaceTimelinePoint = {
  t: number; //seconds from start of recording
  wpm: number;
}

export type PaceSegment = {
  startSec: number;
  endSec: number;
  points: PaceTimelinePoint[];
}

export function computePaceTimeline(words: DeepgramWord[], durationSec: number,): PaceSegment[] {
  if (words.length === 0 || durationSec <= 0) return [];

  // Split words into speech segments at gaps >= TIMELINE_PAUSE_THRESHOLD_SEC
  type RawSegment = { startSec: number; endSec: number; words: DeepgramWord[] };
  const raw: RawSegment[] = []
   let segWords: DeepgramWord[] = [words[0]];
  let segStart = words[0].start;

  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - words[i - 1].end;
    if (gap >= TIMELINE_PAUSE_THRESHOLD_SEC) {
      raw.push({
        startSec: segStart,
        endSec: segWords[segWords.length - 1].end,
        words: segWords,
      });
      segWords = [words[i]];
      segStart = words[i].start;
    } else {
      segWords.push(words[i]);
    }
  }
  raw.push({
    startSec: segStart,
    endSec: segWords[segWords.length - 1].end,
    words: segWords,
  });

  return raw.map((seg) => ({
    startSec: seg.startSec,
    endSec: seg.endSec,
    points: computeSegmentPoints(seg.words, seg.startSec, seg.endSec)
  }))
}

function computeSegmentPoints(
  segWords: DeepgramWord[],
  startSec: number,
  endSec: number,
): PaceTimelinePoint[] {
  const duration = endSec - startSec;
  if (duration <= 0 || segWords.length === 0) return [];

  // Segments shorter than the rolling window can't support a meaningful
  // sliding average — render as a flat line at the segment's overall WPM.
  if (duration < TIMELINE_WINDOW_SEC) {
    const wpm = (segWords.length / duration) * 60;
    return [
      { t: startSec, wpm },
      { t: endSec, wpm },
    ];
  }

  const points: PaceTimelinePoint[] = [];
  for (let t = startSec; t < endSec; t += TIMELINE_STEP_SEC) {
    points.push({ t, wpm: wpmAtTime(segWords, t, startSec, endSec) });
  }
  // Always include the segment end so the rendered line covers its full extent.
  points.push({
    t: endSec,
    wpm: wpmAtTime(segWords, endSec, startSec, endSec),
  });

  return points;
}

function wpmAtTime(
  segWords: DeepgramWord[],
  t: number,
  segStart: number,
  segEnd: number,
): number {
  // Centered window, clipped to segment boundaries so edges don't read as
  // fake slowdowns from the window extending past available data.
  const halfWindow = TIMELINE_WINDOW_SEC / 2;
  const windowStart = Math.max(t - halfWindow, segStart);
  const windowEnd = Math.min(t + halfWindow, segEnd);
  const windowDuration = windowEnd - windowStart;
  if (windowDuration <= 0) return 0;

  let count = 0;
  for (const w of segWords) {
    if (w.start >= windowStart && w.start < windowEnd) count++;
  }
  return (count / windowDuration) * 60;
}


// ============================================================
// Display helpers
// ============================================================

export const formatTimestamp = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export const paceVerdictLabel = (v: PaceVerdict): string =>
  v === 'ideal' ? 'Ideal pace' : v === 'fast' ? 'A bit fast' : 'A bit slow';

export const paceConsistencyLabel = (v: PaceConsistencyVerdict): string =>
  v === 'steady' ? 'Steady pace' : 'Slightly uneven';

// ============================================================
// Serialization across nav params
//
// SessionMetrics contains Sets, which JSON.stringify silently drops. These
// helpers convert to/from a JSON-safe form so metrics computed in one screen
// can be passed to another without losing data.
// ============================================================

type NonShortMetrics = Extract<SessionMetrics, { tooShort: false }>;

/** JSON-safe form of SessionMetrics with Sets converted to arrays. */
export type SerializableSessionMetrics =
  | { tooShort: true; reason: string }
  | (Omit<NonShortMetrics, 'fillerIndices' | 'misreadIndices'> & {
      fillerIndices: number[];
      misreadIndices: number[];
    });

export function serializeMetrics(m: SessionMetrics): SerializableSessionMetrics {
  if (m.tooShort) return m;
  return {
    ...m,
    fillerIndices: Array.from(m.fillerIndices),
    misreadIndices: Array.from(m.misreadIndices),
  };
}

export function deserializeMetrics(raw: SerializableSessionMetrics): SessionMetrics {
  if (raw.tooShort) return raw;
  return {
    ...raw,
    // Sessions saved before the pace-target column default to the built-in band
    // (which is what they were actually scored against).
    paceTargetLow: raw.paceTargetLow ?? DEFAULT_PACE_TARGET.low,
    paceTargetHigh: raw.paceTargetHigh ?? DEFAULT_PACE_TARGET.high,
    fillerIndices: new Set(raw.fillerIndices),
    misreadIndices: new Set(raw.misreadIndices),
  };
}



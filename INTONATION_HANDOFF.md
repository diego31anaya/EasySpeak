# Intonation Feature — Handoff

Status as of this writing: **the intonation feature is built end-to-end but the
most recent detector rewrite (YIN) is UNVERIFIED on device.** Everything below
the "Current state" line either works on device or is validated-but-unbuilt;
read carefully which is which.

---

## What the feature is

A delivery metric that judges whether the speaker was **monotone** (flat pitch)
or **dynamic** (varied pitch), plus a pitch-over-time contour graph. It sits
alongside the existing pace / filler / pause metrics in the results screens.

The pipeline:
1. Recording is a WAV file.
2. `lib/pitch.ts` `extractPitchFrames(uri)` reads the WAV, decimates 16k→8k, and
   calls the native Swift `detectPitch`, which returns `{t, f0Hz}` frames (~one
   per 25ms).
3. `lib/metrics.ts` `computePitchMetrics(frames)` converts to semitones, trims
   outliers, computes std-dev of pitch, and returns an `IntonationResult`
   (verdict, varianceSemitones, meanF0Hz, contour).
4. The verdict threshold: `std-dev < 1.5 semitones` → monotone, else dynamic.
5. The contour is downsampled to ~80 points (`downsampleContour`) for the graph.

The metric is **in semitones, not Hz**, on purpose — semitones are perceptually
even across voices, so one threshold works for a deep voice and a high voice.

---

## Current state — what works vs what's unverified

### Works on device (confirmed via screenshots)
- The full pipeline runs: audio → native frames → metrics → populated `intonation`.
- Bullet results shows an Intonation `MetricRow` with verdict label + the contour graph.
- The dev-cache replay path (`index.tsx` handleBulletReview) re-extracts pitch so
  intonation appears on replayed sessions (runs ~700ms native pass per tap, dev-only).

### Validated in Node but NOT built/run on device
- **The YIN detector rewrite** (see "The octave-error saga" below). The algorithm
  passed synthetic tests in Node; it has not been compiled. **This is the #1 thing
  to verify next session.**
- **TTO intonation wiring** — per-round `extractPitchFrames` in `tto-practice.tsx`
  and an Intonation row in `tto-results.tsx` RoundCard. Written this session, unbuilt.
  (NOTE: confirm whether the dev actually applied these — they were given as diffs
  and may or may not be in the editor. Verify before assuming.)

### Not done
- Real user-facing copy (description + stat line in `IntonationExpansion` are placeholders).
- Verdict label consolidation (two sources, see below).
- Bullet→TTO visual restyle (flat one-card look) was proposed but the dev chose not to apply it.

---

## The octave-error saga (the core struggle)

This is the central difficulty of the feature and the reason the detector was
rewritten. Understand this before touching pitch code.

**The problem.** A voice at, say, 220 Hz physically contains harmonics at 440,
660, 880 Hz (this is just what a non-smooth repeating waveform is — Fourier).
The original detector used plain autocorrelation: it found the lag where the
signal best matched a shifted copy of itself, and picked the *single strongest*
match. But a 220 Hz signal also matches strongly at the half-period (440 Hz)
because the 2nd harmonic is sitting right there. On frames where the harmonic was
momentarily strong, the detector picked 440 instead of 220 — an **octave error**.

**Why it broke the verdict.** Octave errors only push pitch *up* (×2), which only
*inflates* the measured pitch variation, which can only flip monotone→dynamic
(never the reverse). On device, a genuinely monotone take sometimes read as
dynamic because enough octave-error frames survived the outlier trim and pushed
std-dev over 1.5. Screenshots confirmed: same monotone delivery, inconsistent
verdict. The graph showed tall narrow spikes (the doubled frames).

**What was tried, in order, and why each was insufficient:**
1. *Percentile trim* (keep central 10–90% before std-dev) — already in
   `computePitchMetrics`. Helps when errors are rare; fails when >10% of frames
   are doubled.
2. *Double-lag check* (a first-pass native patch): after picking the best lag,
   check the lag at 2× (octave below); if nearly as strong, switch down. Reduced
   but did not eliminate errors — spikes survived on device.
3. *Band clamp / asymmetric trim / median smoothing* (discussed, mostly not built):
   downstream patches over a detector that selects wrong. Asymmetric trim was
   explicitly rejected — it risks the opposite error (flattening genuinely dynamic
   speakers toward monotone).

**The decision: stop patching, fix the detector.** Research (Praat, YIN, McLeod
MPM, a monotone-detection patent) was unanimous that production tools don't
hand-roll autocorrelation — they use a proven algorithm with three stages
(pre-process, candidate-finding, cross-frame tracking). The original detector did
~1.5 of those stages.

---

## The YIN rewrite (current detector — UNVERIFIED on device)

`modules/expo-pitch` `detectPitch` was rewritten from custom autocorrelation to
the **YIN algorithm** (de Cheveigné & Kawahara 2002), the most-cited monophonic
F0 estimator. Four steps:
1. **Difference function** — subtract a shifted copy and square (look for the
   *smallest* difference, not the biggest correlation).
2. **Cumulative mean normalization** — divide each value by the running average.
   *This is the octave-error fix*: it biases toward the lower-frequency (true
   fundamental) dip and suppresses the harmonic dip.
3. **Absolute threshold** — take the first dip below 0.15 (the lowest-frequency
   strong candidate = the fundamental), then descend to its local minimum.
4. **Parabolic interpolation** — sub-sample precision on the chosen dip.

**Node validation (done):** the exact algorithm was ported to JS and tested
against synthetic signals at sampleRate 8000:
- All in-range speaking pitches (90–390 Hz) with harmonics → correct within 3%.
- Octave-error stress cases (220 + a *louder* 440 harmonic, etc.) → correctly
  returned ~220, not 440. This is the case that broke the old detector.
- Noise / silence → null (unvoiced).
- One "failure" — a pure 440 Hz sine read as 220 — was traced to 444 Hz being
  *above* maxF0=400, i.e. out of speaking range by design, not a bug.

Two real bugs were caught *during* Node validation before any rebuild (a loose
Step-3 dip walk; an `minTau`/`maxTau` boundary issue). The current ported logic
passes all in-range cases.

**What Node validation does NOT prove:** real-voice behavior (noise, breathiness,
formants, the actual mic) and that the Swift compiles. **First action next
session: `npx expo run:ios` (simulator is fine for compile check; device needed
for real-voice verdict accuracy), then re-run the monotone/dynamic/monotone test.**

**Cross-frame median smoothing — NOW BUILT (2026-06-26).** `computePitchMetrics`
now median-smooths the frame sequence (`medianSmoothFrames`, window 5 ≈ 125ms) in
Hz BEFORE measuring spread + drawing the contour. A lone frame jumping an octave
(up OR down) gets pulled to its neighbours' median, so a few residual YIN errors
can't flip the verdict. Verified in Node (an octave-DOWN error that the one-sided
`OCTAVE_SPIKE_CAP` can't catch — it's below the median — inflated unsmoothed
std to 2.61 st = wrong "dynamic"; smoothed = 0.28 st = correct "monotone"), and
that it does NOT over-flatten genuinely dynamic speech. The spike cap is kept as a
cheap guard for sustained high outliers. Do NOT add the asymmetric trim (false
monotones). The graph + verdict now derive from the SAME smoothed data (fixes the
old split-cleaning disagreement). Still: verify YIN itself on device first.

**Honest expectation:** YIN reduces octave errors to *rare*, not *zero*. No
single-frame algorithm is perfect; that's why production tools add tracking.
Goal is "verdict is reliable," not "flawless contour."

---

## The graph

`IntonationContourGraph` in `MetricRow.tsx`. Time on X, Hz on Y, one line, broken
at silences.

- **Y axis auto-scales per recording** (`computeContourRange` in `metrics.ts`)
  because pitch range is voice-dependent — a fixed axis squashes any one voice
  into a sliver. It uses a **minimum window** (`CONTOUR_MIN_WINDOW_SEMITONES = 4`)
  so a monotone take stays visibly flat instead of being zoomed up to look varied.
- **Line breaks at silence**: `downsampleContour` skips silent bins (leaves gaps);
  the graph splits points into runs at time-jumps > 1.5× the median spacing and
  draws one path per run. A lone point between silences renders as a dot.
- **No background zones** (unlike PaceGraph) — pitch has no "ideal" band; the
  metric is about spread, not absolute height.
- The graph and the verdict were computed from differently-cleaned data at one
  point (graph from raw frames, verdict from trimmed) — they could disagree. YIN
  reducing spikes should calm both; revisit if the graph still looks wild after build.
- The dev's stance: if the graph can't accurately represent speech, it's
  droppable — the verdict is the actual product. The detector quality (not the
  graph) is the priority.

---

## Pending work (next session)

1. **Build and verify YIN on device** — the blocking item. `npx expo run:ios`,
   run monotone/dynamic/monotone. Tune `threshold` (0.15) if needed.
2. **Verify TTO intonation wiring** built correctly (3 rounds, per-round frames).
3. ~~Remove `console.log(intonation)` in `metrics.ts`~~ — DONE 2026-06-26 (the
   whole TEMP diagnostic block + its rawStd computation removed).
4. **Consolidate verdict labels** — `intonationVerdictLabel` in `metrics.ts`
   ("Varied pitch"/"A bit flat") vs the "Monotone"/"Dynamic" used in the row. Two
   sources saying different things. Pick one; the dev wants the row to say
   "Monotone"/"Dynamic".
5. **Real copy** — `IntonationExpansion` description + stat line are rough
   placeholders. The dev writes their own copy and wants critique, not rewrites.
6. **Rename `varianceSemitones`** → it holds standard deviation, not variance.
   Value and verdict are correct; only the name lies. ~2 call sites.

## Future direction (dev's stated intent)

- The binary monotone/dynamic verdict is a simplification. The dev wants a graded
  verdict later ("sometimes monotone" middle ground). That depends on *clean pitch
  data*, which is why fixing the detector properly (YIN) matters now rather than
  patching the binary verdict.
- YIN computes a `clarity` value (confidence) that isn't currently returned across
  the bridge. Adding it would help both the graded verdict and unvoiced gating.
  Clean follow-up when needed (touches the PitchFrame type + serialization).

## Constants to calibrate (all provisional)

- `threshold = 0.15` (YIN CMND dip threshold) in `ExpoPitchModule.swift`
- `CONTOUR_MIN_WINDOW_SEMITONES = 4` (graph Y-axis floor) in `metrics.ts`
- `CONTOUR_GAP_FACTOR = 1.5` (silence-break detection) in `MetricRow.tsx`
- `MONOTONE_MAX_SEMITONES = 1.5` (verdict threshold) in `metrics.ts`

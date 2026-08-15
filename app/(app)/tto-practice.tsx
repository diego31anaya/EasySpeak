// app/(app)/tto-practice.tsx
//
// 3-2-1 Framework practice flow. Single screen, internal phase state machine.
// Three rounds in fixed order (easy → hard): 1 Thing → 2 Types → 3 Steps.
//
// This file is being built incrementally. Right now ONLY the `prep` phase is
// implemented. The other phases render empty placeholders. They'll be filled
// in step by step.
 
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { advanceFlow, exitFlow } from '../../lib/navigation';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';
import { extractPitchFrames } from '../../lib/pitch';
import { colors, spacing, fontSize, fonts, radius, GRADIENT_ACTIVE, BOX_SHADOW_ELEVATED } from '../../lib/theme';
import { useTTS } from '../../lib/tts';
import { AiOrb, AiOrbLoading, AiOrbError } from '../../components/AiOrb';
import { ConfirmationSheet } from '../../components/ConfirmationSheet';
import { useRecording } from '../../lib/use-recording';
import { ensureMicPermission, promptEnableMic } from '../../lib/mic-permission';
import { transcribeAudio, type DeepgramWord } from '../../lib/deepgram';
import { generateTTOPrompt } from '../../lib/tto-framework-prompt';
import { computeMetrics, detectFillers, serializeMetrics, DEFAULT_PACE_TARGET, type PaceTarget, type SessionMetrics } from '../../lib/metrics';
import { buildFillerLexicon } from '../../lib/filler-word';
import { focusGuidance, focusPreset, FOCUS_PRESETS, type FocusId } from '../../lib/focus';
import { TIMES, type TimeId } from '../../lib/impromptu-config';
import { validateFillers } from '../../lib/filler-validate';
import { useAuth } from '../../lib/auth';
import {
  generateTTOFeedback,
  buildTTORoundInput,
  type TTOFeedback,
} from '../../lib/tto-feedback';
import {
  saveTtoSession as saveTtoHistory,
  setPendingSaveId,
  setPendingStreakEvent,
} from '../../lib/sessions';
import { deviceLocalDate, type StreakEvent } from '../../lib/streak';
import { refreshReminder } from '../../lib/notifications';
import { File, Paths } from 'expo-file-system';
import { useStreak } from '../../hooks/use-streak';
import { useLocalDay } from '../../hooks/use-local-day';
import { useQueryClient } from '@tanstack/react-query';


import { saveTTOSession, updateTTOSessionFeedback } from '../../lib/dev-cache-tto';


const WAVE_BARS = 40;

const normalizeMetering = (db: number): number => {
  const clamped = Math.max(-50, Math.min(0, db));
  return (clamped + 50) / 50
}

const MIN_RECORDING_SEC = 2;


type Shape = 'one-thing' | 'two-types' | 'three-steps';

const ROUND_ORDER: Shape[] = ['one-thing', 'two-types', 'three-steps'];

// Matches the impromptu focus/topic chips (inactive gradient).
const GRADIENT_INACTIVE = ['#1E3A4C', '#142A38'] as const;

// M:SS for the recording countdown (mirrors impromptu).
const formatDuration = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};
 
const SHAPE_META: Record<Shape, { label: string; intro: string; reminder: string; example: string }> = {
  'one-thing': {
    label: '1 Thing',
    intro: "Let's start with",
    reminder: 'Pick one point and stay with it.',
    example: '"One thing about X is..."',
  },
  'two-types': {
    label: '2 Types',
    intro: 'Now,',
    reminder: 'Split the topic in two and explain both.',
    example: '"There are two ways to..."',
  },
  'three-steps': {
    label: '3 Steps',
    intro: 'Finally,',
    reminder: 'Walk through it in order.',
    example: '"First A, then B, then C."',
  },
};

type RoundResult = {
  shape: Shape;
  prompt: string;
  transcript: string;
  words: DeepgramWord[];
  durationSec: number;
  audioUri: string;
};

// ============================================================
// Phase state machine
//
// All phases declared up front even though only `prep` is implemented today.
// The skeleton stays the same as we fill phases in, which means each
// follow-up step is an additive change to one branch of the render switch.
// ============================================================
 
type Phase =
  | 'prep'         // reminder card + Begin button (THIS STEP)
  | 'generating'   // fetching the prompt for the current round
  | 'speaking'     // TTS reading the prompt
  | 'recording'    // user answering
  | 'finalizing'   // round 3 done, awaiting transcriptions
  | 'error';

// The per-session focus selection: a concrete preset, or "default" (no focus — the
// general experience: un-weighted feedback + default prompt pool).
type FocusChoice = FocusId | 'default';

// The per-session recording time cap: a TIMES id, or "none" (no cap — manual Stop
// only, today's behavior). Picked on round 1, applied to every round.
type TimeChoice = TimeId | 'none';

  export default function TTOPractice() {
    const { profile, session } = useAuth();
    const userId = session?.user.id ?? '';
    const queryClient = useQueryClient();
    const { isStreakDone, updateStreak } = useStreak();
    const localDay = useLocalDay();
    // Finalization runs inside a phase-driven effect. Refs keep these values
    // current without making a streak update or midnight change rerun the effect.
    const isStreakDoneRef = useRef(isStreakDone);
    isStreakDoneRef.current = isStreakDone;
    const localDayRef = useRef(localDay);
    localDayRef.current = localDay;
    const updateStreakRef = useRef(updateStreak);
    updateStreakRef.current = updateStreak;
    const userIdRef = useRef(userId);
    userIdRef.current = userId;
    const queryClientRef = useRef(queryClient);
    queryClientRef.current = queryClient;
    // Latest custom filler list, read inside the finalize effect without adding
    // `profile` to its deps (which would needlessly re-run finalize).
    const customFillersRef = useRef<string[]>([]);
    customFillersRef.current = profile?.custom_fillers ?? [];
    // Same pattern for the pace band — read inside the finalize effect, kept fresh.
    const paceTargetRef = useRef<PaceTarget>(DEFAULT_PACE_TARGET);
    paceTargetRef.current = {
      low: profile?.pace_target_low ?? DEFAULT_PACE_TARGET.low,
      high: profile?.pace_target_high ?? DEFAULT_PACE_TARGET.high,
    };
    // Per-session focus: picked on the FIRST round's prep screen (default = saved
    // focus, or "surprise"). Resolved + locked at round 1's Begin into
    // sessionFocusRef, which then drives every round's prompt AND the feedback.
    const [focusChoice, setFocusChoice] = useState<FocusChoice>(
      () => focusPreset(profile?.focus)?.id ?? 'default',
    );
    const focusDirtyRef = useRef(false);
    const sessionFocusRef = useRef<string | null>(null);

    // The NEXT round's prompt, pre-fetched during the current round's recording so
    // its "generating" wait is gone by the time the user taps Begin (rounds 2 & 3).
    // generateTTOPrompt never rejects (it falls back), so this is safe to await.
    const nextPromptRef = useRef<Promise<string> | null>(null);

    // Per-session recording time cap (default "None" = no cap). No profile-backed
    // default, so no dirty-ref/sync — simpler than focus. Locked into sessionTimeRef
    // (seconds, or null = no cap) at round 1, mirroring the focus lock.
    const [timeChoice, setTimeChoice] = useState<TimeChoice>('none');
    const sessionTimeRef = useRef<number | null>(null);
    // Recording-cap timeout handle + the frozen countdown value held during stop
    // teardown (prevents the cap→full-time flash when the recorder zeroes durationSec).
    const hardCapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [frozenRemaining, setFrozenRemaining] = useState<number | null>(null);

    const [phase, setPhase] = useState<Phase>('prep');
    const [roundIdx, setRoundIdx] = useState(0);
    const [errorMsg, setErrorMsg] = useState<string>('');

    const [exitConfirmVisible, setExitConfirmVisible] = useState(false);
    const hasProgressRef = useRef(false)
    const roundsRef = useRef<Partial<RoundResult>[]>([{}, {}, {}])
    const transcribePromisesRef = useRef<Array<Promise<void> | null>>([null, null, null])
    // Gate that the finalize useEffect awaits before its final advanceFlow.
    // When the user opens the exit-confirmation sheet mid-finalize, we set this
    // so finalize pauses instead of racing past the sheet into results.
    const exitDecisionPromiseRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);

    const promptRef = useRef<string>('')
    const exitingRef = useRef(false);

    const currentShape = ROUND_ORDER[roundIdx];

    const progressSV = useSharedValue(0);

    const r = useRecording();
    const [waveBuffer, setWaveBuffer] = useState<number[]>(
      () => new Array(WAVE_BARS).fill(0)
    )
    const tts = useTTS();
    const [prompt, setPrompt] = useState<string>('');

    useEffect(() => {
      return () => {
        tts.stopSpeaking()
        if (hardCapTimeoutRef.current) clearTimeout(hardCapTimeoutRef.current);
      }
    }, []);

    useEffect(() => {
      promptRef.current = prompt;
    }, [prompt])

    // Adopt the saved focus once the profile loads, until the user picks one.
    useEffect(() => {
      if (!focusDirtyRef.current) setFocusChoice(focusPreset(profile?.focus)?.id ?? 'default');
    }, [profile?.focus]);

    useEffect(() => {
      if (phase !== 'recording') return;
      if (exitingRef.current) return;
      if (r.status !== 'recorded' || !r.uri) return;

      const completedIdx = roundIdx;
      const sourceUri = r.uri
      // Read the source bytes synchronously BEFORE r.reset() runs below.
      // r.reset() + the next round's startRecording() reuse the recorder's
      // single internal file URI and overwrite sourceUri. With m4a (~180 KB)
      // the old in-IIFE read usually won the race; WAV (~2 MB) is slow enough
      // that the source got truncated mid-read, producing a corrupt file that
      // Deepgram rejects. Capturing bytes here closes the window entirely.
      let sourceBytes: Uint8Array | null = null;
      try {
        sourceBytes = new File(sourceUri).bytesSync();
      } catch (e) {
        console.log(`TTO round ${completedIdx} source read failed:`, e);
      }

      const promise = (async () => {
        try {
            if (!sourceBytes) throw new Error('source bytes unavailable');

            const dest = new File(Paths.cache, `tto-round-${completedIdx}.wav`);

            if (dest.exists) dest.delete();
            dest.create();
            dest.write(sourceBytes);

            roundsRef.current[completedIdx] = {
              shape: ROUND_ORDER[completedIdx],
              prompt: promptRef.current,
              audioUri: dest.uri,
            };

            const result = await transcribeAudio(dest.uri);
            roundsRef.current[completedIdx] = {
              ...roundsRef.current[completedIdx],
              transcript: result.transcript,
              words: result.words,
              // Duration from Deepgram's metadata, not the recorder. expo-audio
              // zeroes recorderState.durationMillis after stop(), so r.durationSec
              // reads 0 here. Deepgram's audio duration is authoritative and
              // timing-independent.
              durationSec: result.durationSec,
            };
          } catch (e){
            console.log(`TTO round ${completedIdx} transcription failed:`, e);
            roundsRef.current[completedIdx] = {
            ...roundsRef.current[completedIdx],
            transcript: '',
            words: [],
          };
          }
      })();

      transcribePromisesRef.current[completedIdx] = promise;

      hasProgressRef.current = true;
      r.reset();

      if (completedIdx < ROUND_ORDER.length - 1) {
        const nextIdx = completedIdx + 1;
        setRoundIdx(nextIdx);
        setPhase('prep');
        // Pre-fetch the next round's prompt now — during transcription + the prep
        // screen — so its "generating" wait is gone when the user taps Begin.
        nextPromptRef.current = generateTTOPrompt(ROUND_ORDER[nextIdx], sessionFocusRef.current);
      } else {
        setPhase('finalizing')
      }
    }, [r.status, r.uri, phase])

    useEffect(() => {
      if (phase !== 'finalizing') return;
      if (exitingRef.current) return;

      (async () => {
        const promises = transcribePromisesRef.current.filter(
          (p): p is Promise<void> => p !== null,
        );

        await Promise.all(promises)

        const rounds = roundsRef.current as RoundResult[];

        if (__DEV__) {
      try {
        await saveTTOSession({
          rounds: rounds.map((round) => ({
            shape: round.shape,
            prompt: round.prompt,
            transcript: round.transcript,
            words: JSON.stringify(round.words),
            durationSec: String(round.durationSec),
            recordingSourceUri: round.audioUri,
          })),
        });
      } catch (err) {
        console.warn('TTO dev cache save failed:', err);
      }
    }
    rounds.forEach((r, i) =>
      console.log(`TTO round ${i}: durationSec=${r.durationSec}, words=${r.words?.length ?? 'undefined'}`),
    );

    const pitchFramesPerRound = await Promise.all(
      rounds.map((r) => extractPitchFrames(r.audioUri)),
    );

    // The user's custom filler words are merged into detection + pause classification
    // for every round; falls back to the built-in set when empty.
    const fillerLexicon = buildFillerLexicon(customFillersRef.current);

    // Context-check ambiguous fillers ("like", "you know") per round before counting,
    // so a meaningful "like" isn't marked or scored as a filler. Excludes false positives.
    const excludeFillersPerRound = await Promise.all(
      rounds.map((r) => validateFillers(r.words, detectFillers(r.words, fillerLexicon).instances)),
    );

    const metrics = rounds.map((r, i) =>
      computeMetrics(r.words, null, r.durationSec, pitchFramesPerRound[i], excludeFillersPerRound[i], fillerLexicon, paceTargetRef.current),
    )

    const allOk = metrics.every((m) => !m.tooShort);

    let feedback: TTOFeedback | null = null;
    let feedbackError: string | null = null;

    if (!allOk) {
      feedbackError = 'One or more rounds were too short to analyze';
    } else {
      try {
        const inputs = rounds.map((r, i) => {
          const m = metrics[i] as Extract<SessionMetrics, { tooShort: false }>;
          return buildTTORoundInput(r.shape, r.prompt, r.transcript, m)
        })
        feedback = await generateTTOFeedback(inputs, { focusGuidance: focusGuidance(sessionFocusRef.current) })
        
        if (__DEV__) {
          updateTTOSessionFeedback(feedback).catch(() => {});
        }
      } catch (err) {
        console.warn('TTO feedback failed:', err)
        feedbackError = err instanceof Error ? err.message : 'Feedback failed';
      }
    }

    // Persist to history (fire-and-forget). Only when every round analyzed —
    // a too-short round means no metrics/feedback worth reviewing.
    if (allOk) {
      const runP = (async (): Promise<{ id: string | null; event: StreakEvent }> => {
        try {
          const sessionDay = deviceLocalDate();
          const saveResult = await saveTtoHistory({
            data: {
              rounds: rounds.map((rd, i) => ({
                shape: rd.shape,
                prompt: rd.prompt,
                transcript: rd.transcript,
                words: rd.words,
                durationSec: rd.durationSec,
                metrics: serializeMetrics(metrics[i]),
              })),
              feedback,
              feedbackError: feedbackError ?? '',
            },
            roundAudioUris: rounds.map((rd) => rd.audioUri),
            localDay: sessionDay,
            shouldUpdateStreak:
              !isStreakDoneRef.current || sessionDay !== localDayRef.current,
          });

          if (saveResult.streak) {
            updateStreakRef.current(saveResult.streak);
          }

          const savedUserId = userIdRef.current;
          if (savedUserId) {
            void queryClientRef.current.invalidateQueries({
              queryKey: ['history', 'sessions', savedUserId],
            });
          }

          console.log('[streak] event:', saveResult.streakEvent);
          return { id: saveResult.id, event: saveResult.streakEvent };
        } catch (error) {
          console.warn('[sessions] save tto failed:', error);
          return { id: null, event: { kind: 'none' } };
        }
      })();

      setPendingSaveId(runP.then((r) => r.id));
      setPendingStreakEvent(runP.then((r) => r.event));
      runP
        .then((save) => {
          if (save.id) return refreshReminder();
        })
        .catch(() => {});
    }

         // If the user opened the exit-confirmation sheet during finalize,
         // wait here until they decide. Cancel resolves and we proceed to
         // results; Confirm sets exitingRef.current and the next check bails.
         if (exitDecisionPromiseRef.current) {
           await exitDecisionPromiseRef.current.promise;
         }
         if (exitingRef.current) return;

         advanceFlow({
          pathname: '/tto-results',
          params: {
            rounds: JSON.stringify(rounds),
            metrics: JSON.stringify(metrics.map(serializeMetrics)),
            feedback: feedback ? JSON.stringify(feedback) : '',
            feedbackError: feedbackError ?? '',
          },
          });
      })();
    }, [phase])

    useEffect(() => {
      if (phase !== 'recording') return;
      const normalized = normalizeMetering(r.metering);
      setWaveBuffer((prev) => [...prev.slice(1), normalized]);
    }, [r.metering, phase])

    useEffect(() => {
      if (phase === 'recording') {
        setWaveBuffer(new Array(WAVE_BARS).fill(0));
      }
    }, [phase])

    useEffect(() => {
      const completedRounds = phase === 'finalizing' ? ROUND_ORDER.length : roundIdx;

      const target = completedRounds / ROUND_ORDER.length;
      progressSV.value = withTiming(target, {
        duration: 400,
        easing: Easing.out(Easing.ease),
      })
    }, [roundIdx, phase, progressSV])

    const progressFillStyle = useAnimatedStyle(() => ({
      width: `${progressSV.value * 100}%`,
    }))

    const performExit = async () => {
      exitingRef.current = true;
      tts.stopSpeaking();
      if (hardCapTimeoutRef.current) {
        clearTimeout(hardCapTimeoutRef.current);
        hardCapTimeoutRef.current = null;
      }
      if (phase === 'recording') {
        await r.stopRecording().catch(() => {})
      }
      exitFlow();
    }

    const handleClose = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

        const needsConfirmation = hasProgressRef.current || (phase !== 'prep' && phase !== 'error');
        if (!needsConfirmation) {
          performExit();
          return;
        }

        // Set the decision promise synchronously so the finalize useEffect
        // sees it the moment it reaches the gate, even before React commits
        // the state update.
        let resolve!: () => void;
        const promise = new Promise<void>((r) => { resolve = r; });
        exitDecisionPromiseRef.current = { promise, resolve };

        setExitConfirmVisible(true);
    }

    const handleStart = async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setErrorMsg('');
        setFrozenRemaining(null); // fresh countdown each round

        // Check mic access before generating/speaking; on denial stay on the prep screen
        // (never lock the session refs or enter 'generating') so Begin stays usable.
        if (!(await ensureMicPermission()).granted) {
          promptEnableMic();
          return;
        }

        // Lock the session focus + time cap on the first round (both picked on round
        // 1's prep screen). "Default"/"None" → null; otherwise the chosen value.
        // Every round reads these.
        if (roundIdx === 0) {
          sessionFocusRef.current = focusChoice === 'default' ? null : focusChoice;
          sessionTimeRef.current =
            timeChoice === 'none' ? null : TIMES.find((t) => t.id === timeChoice)!.seconds;
        }

        setPhase('generating');

        try {
          // Use the prompt pre-fetched during the previous round's recording when
          // available (rounds 2 & 3); otherwise fetch fresh (round 1 / a miss).
          const newPrompt = await (nextPromptRef.current ??
            generateTTOPrompt(currentShape, sessionFocusRef.current));
          nextPromptRef.current = null;
          if (exitingRef.current) return;
          setPrompt(newPrompt)

          await tts.speak(newPrompt, {
            onReady: () => {
              setPhase('speaking');
              // Prime the recorder DURING playback so the speaking→recording
              // handoff is just recorder.record() — no silent gap after the prompt.
              // (Errors surface when startRecording awaits the same prepare below.)
              r.prepareRecording();
            },
          })
          if (exitingRef.current) return;

          await r.startRecording();
          if (exitingRef.current) return;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
          setPhase('recording');

          // Arm this round's recording cap (only when a time was set). Clear any
          // stale handle first. The auto-stop freezes the countdown at 0 and stops
          // the recorder; the advance effect then handles the round exactly like a
          // manual Stop. "None" → no cap armed, no countdown shown.
          if (hardCapTimeoutRef.current) {
            clearTimeout(hardCapTimeoutRef.current);
            hardCapTimeoutRef.current = null;
          }
          if (sessionTimeRef.current != null) {
            const cap = sessionTimeRef.current;
            hardCapTimeoutRef.current = setTimeout(() => {
              setFrozenRemaining(0);
              r.stopRecording().catch(() => {});
            }, cap * 1000);
          }
        } catch(e: any) {
          setErrorMsg(e?.message ?? 'Something went wrong.');
          setPhase('error')
        }
    }; 

    const handleStop = async () => {
      if (r.durationSec < MIN_RECORDING_SEC) return;

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      // Clear this round's cap so a pending timeout can't fire into the next round,
      // and freeze the countdown at the tap (the recorder zeroes durationSec during
      // teardown, which would otherwise flash the timer back to the full cap).
      if (hardCapTimeoutRef.current) {
        clearTimeout(hardCapTimeoutRef.current);
        hardCapTimeoutRef.current = null;
      }
      if (sessionTimeRef.current != null) {
        setFrozenRemaining(Math.max(0, sessionTimeRef.current - r.durationSec));
      }
      try {
        await r.stopRecording();

      } catch (e: any) {
        Alert.alert('Stop failed', e?.message ?? 'Unknown error')
      }
    }

    const handleRetry = () => {
      setErrorMsg('');
      setRoundIdx(0);
      // Drop any pre-fetched next-round prompt — it's for the wrong shape now.
      nextPromptRef.current = null;
      setPhase('prep')
    }


    return (
        <LinearGradient
          colors={[colors.surfaceElevated, colors.bg]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.gradientBg}
        >
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
            <View style={styles.header}>
                <View style={styles.headerRow}>
                  <View style={styles.iconSpacer}/>
                  <View style={styles.progressBar}>
                    <Animated.View style={[styles.progressFill, progressFillStyle]}/>
                  </View>
                  <Pressable
                    onPress={handleClose}
                    hitSlop={12}
                    style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
                  >
                    <XIcon color={colors.text}/>
                  </Pressable>
                </View>
            </View>

            {phase === 'prep' && (
                <PrepView
                    shape={currentShape}
                    onStart={handleStart}
                    showFocus={roundIdx === 0}
                    focusChoice={focusChoice}
                    onPickFocus={(f) => {
                      focusDirtyRef.current = true;
                      setFocusChoice(f);
                    }}
                    showTime={roundIdx === 0}
                    timeChoice={timeChoice}
                    onPickTime={setTimeChoice}
                />
            )}

            {phase === 'generating' && (
              <View style={styles.stage}>
                <View style={styles.promptBoxPlaceholder} />
                <View style={styles.stageStatus}>
                  <AiOrbLoading />
                  <Text style={[styles.statusText, styles.loadingStatusText]}>Coming up with a question</Text>
                </View>
              </View>
            )}
            {phase === 'speaking' && (
              <View style={styles.stage}>
                <View style={styles.promptBox}>
                  <Text style={styles.promptText}>{prompt}</Text>
                </View>
                <View style={styles.stageStatus}>
                  <AiOrb amplitude={tts.amplitude} />
                </View>
              </View>
            )}
            {phase === 'recording' && (
              <>
              <View style={styles.stage}>
                <View style={styles.promptBox}>
                  <Text style={styles.promptText}>{prompt}</Text>
                </View>
          
                <View style={styles.stageStatus}>
                {sessionTimeRef.current != null && (
                  <Text style={styles.timer}>
                    {formatDuration(frozenRemaining ?? Math.max(0, sessionTimeRef.current - r.durationSec))}
                  </Text>
                )}
                <View style={styles.waveBox}>
                  {waveBuffer.map((value, i) => (
                    <View
                      key={i}
                      style={[styles.waveBar, { height: Math.max(2, value * 80 )}]}
                    />
                  ))}
                </View>
                </View>
              </View>

              <View style={styles.footer}>
                <Pressable onPress={handleStop} style={({ pressed }) => [styles.btnStop, pressed && styles.btnStopPressed]}>
                  <Text style={styles.btnStopText}>Stop</Text>
                </Pressable>
              </View>
              </>
            )}
            {phase === 'finalizing' && (
              <View style={styles.stage}>
                <View style={styles.promptBoxPlaceholder} />
                <View style={styles.stageStatus}>
                  <AiOrbLoading />
                  <Text style={[styles.statusText, styles.loadingStatusText]}>Analyzing your responses</Text>
                </View>
              </View>
            )}
            {phase === 'error' && (
              <View style={styles.stage}>
                <View style={styles.errorMessageSlot}>
                  <Text style={styles.errorMessage}>{errorMsg || 'Something went wrong.'}</Text>
                </View>
                <View style={styles.stageStatus}>
                  <AiOrbError />
                  <Text style={[styles.statusText, styles.loadingStatusText]} aria-hidden> </Text>
                </View>
              </View>
            )}
        <ConfirmationSheet
          visible={exitConfirmVisible}
          title="Exit practice?"
          body="You'll lose your progress."
          confirmLabel="Exit"
          destructive
          onCancel={() => {
            exitDecisionPromiseRef.current?.resolve();
            exitDecisionPromiseRef.current = null;
            setExitConfirmVisible(false);
          }}
          onConfirm={() => {
            exitDecisionPromiseRef.current?.resolve();
            exitDecisionPromiseRef.current = null;
            setExitConfirmVisible(false);
            performExit();
          }}
        />

        </SafeAreaView>
        </LinearGradient>
    )
  }

  type PrepViewProps = {
    shape: Shape;
    onStart: () => void;
    // Shown only on round 1 (focus + time are session-level choices, not per-round).
    showFocus: boolean;
    focusChoice: FocusChoice;
    onPickFocus: (f: FocusChoice) => void;
    showTime: boolean;
    timeChoice: TimeChoice;
    onPickTime: (t: TimeChoice) => void;
  }

  function PrepView({ shape, onStart, showFocus, focusChoice, onPickFocus, showTime, timeChoice, onPickTime }: PrepViewProps) {
    const meta = SHAPE_META[shape];

    return (
        <View style={styles.prepContainer}>
            <View style={styles.prepContent}>
              <View style={styles.headingGroup}>
                <Text style={styles.shapeName}>{meta.label}</Text>
                <Text style={styles.reminder}>{meta.reminder}</Text>
              </View>

                <View style={styles.exampleCard}>
                  <Text style={styles.exampleLabel}>Try starting with</Text>
                  <Text style={styles.exampleText}>{meta.example}</Text>
                </View>

              {showFocus && (
                <View style={styles.focusSection}>
                  <Text style={styles.focusEyebrow}>Focus</Text>
                  <View style={styles.focusPills}>
                    <FocusPill
                      label="Default"
                      active={focusChoice === 'default'}
                      onPress={() => onPickFocus('default')}
                    />
                    {FOCUS_PRESETS.map((f) => (
                      <FocusPill
                        key={f.id}
                        label={f.label}
                        active={focusChoice === f.id}
                        onPress={() => onPickFocus(f.id)}
                      />
                    ))}
                  </View>
                </View>
              )}

              {showTime && (
                <View style={styles.focusSection}>
                  <Text style={styles.focusEyebrow}>Time</Text>
                  <View style={styles.focusPills}>
                    <FocusPill
                      label="None"
                      active={timeChoice === 'none'}
                      onPress={() => onPickTime('none')}
                    />
                    {TIMES.map((t) => (
                      <FocusPill
                        key={t.id}
                        label={t.label}
                        active={timeChoice === t.id}
                        onPress={() => onPickTime(t.id)}
                      />
                    ))}
                  </View>
                </View>
              )}
            </View>

            <View style={styles.prepFooter}>
                <Pressable onPress={onStart} style={({ pressed }) => [pressed && styles.btnPressed]}>
                <LinearGradient
                    colors={GRADIENT_ACTIVE}
                    start={{ x: 0.5, y: 0 }}
                    end={{ x: 0.5, y: 1 }}
                    style={styles.btn}
                >
                    <Text style={styles.btnText}>Begin</Text>
                </LinearGradient>
                </Pressable>
            </View>
        </View>
    )
  }

  // Selectable focus pill — mirrors the impromptu topic/focus chips.
  function FocusPill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
    const handlePress = () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPress();
    };
    return (
      <Pressable onPress={handlePress} style={({ pressed }) => [pressed && styles.focusChipPressed]}>
        <LinearGradient
          colors={active ? GRADIENT_ACTIVE : GRADIENT_INACTIVE}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={[styles.focusChip, active && styles.focusChipActive]}
        >
          <Text style={[styles.focusChipText, active && styles.focusChipTextActive]}>{label}</Text>
        </LinearGradient>
      </Pressable>
    );
  }

  // ============================================================
// Icons
// ============================================================
 
function XIcon({ size = 24, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 6l12 12M18 6L6 18"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  gradientBg: { flex: 1 },
  safe: {
    flex: 1,
  },

  // Header — matches explainer's padding so title lands at the same Y.
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },

  // Progress bar — sits inline between the left spacer and the close button.
  // flex:1 lets it fill the space the title used to occupy.
  progressBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginHorizontal: spacing.md,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 2,
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    flex: 1,
    fontSize: fontSize.xxl,
    fontFamily: fonts.regular,
    color: colors.text,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnPressed: { opacity: 0.6 },
  iconSpacer: {
    width: 36,
    height: 36,
  },

  // Prep
  prepContainer: {
    flex: 1,
    paddingHorizontal: spacing.xl,
  },
  focusSection: { alignSelf: 'stretch', alignItems: 'flex-start' },
  focusEyebrow: {
    fontSize: fontSize.xs,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: spacing.md,
  },
  focusPills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  focusChip: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(168, 213, 255, 0.15)',
    overflow: 'hidden',
  },
  focusChipActive: { borderColor: 'rgba(168, 213, 255, 0.35)' },
  focusChipPressed: { opacity: 0.7 },
  focusChipText: { fontSize: fontSize.sm, fontFamily: fonts.semibold, color: colors.textMuted },
  focusChipTextActive: { color: colors.bg },
  // Recording countdown — tabular-nums so digits don't jitter (mirrors impromptu).
  timer: {
    fontSize: fontSize.display,
    fontFamily: fonts.regular,
    color: colors.text,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  prepContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: spacing.xl,
  },
  headingGroup: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  shapeName: {
    fontSize: fontSize.xxxl,
    fontFamily: fonts.regular,
    color: colors.text,
    letterSpacing: -0.5,
    textAlign: 'center',

  },
  reminder: {
    fontSize: fontSize.lg,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 320,
  },
  exampleCard: {
  marginTop: spacing.xxl,
  paddingVertical: spacing.lg,
  paddingHorizontal: spacing.xl,
  backgroundColor: colors.surfaceElevated,
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: colors.border,
  alignItems: 'center',
  gap: spacing.xs,
  alignSelf: 'stretch',
  maxWidth: 360,
  boxShadow: BOX_SHADOW_ELEVATED,
},
exampleLabel: {
  fontSize: fontSize.xs,
  fontFamily: fonts.medium,
  color: colors.textMuted,
  textTransform: 'uppercase',
  letterSpacing: 1.5,
},
exampleText: {
  fontSize: fontSize.lg,
  fontFamily: fonts.regular,
  fontStyle: 'italic',
  color: colors.text,
  textAlign: 'center',
  lineHeight: 26,
},

intro: {
  fontSize: fontSize.md,
  fontFamily: fonts.regular,
  color: colors.textMuted,
  textAlign: 'center',
  letterSpacing: 0.2,
},

  // Footer
  prepFooter: {
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  btn: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  btnPressed: { opacity: 0.85 },
  btnText: {
    fontFamily: fonts.semibold,
    color: colors.bg,
    fontSize: fontSize.lg,
    letterSpacing: 0.2,
  },
  stage: {
  flex: 1,
  paddingHorizontal: spacing.xl,
  paddingTop: spacing.md,
},
stageStatus: {
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
  gap: spacing.md,
},
statusText: {
  fontSize: fontSize.sm,
  color: colors.textMuted,
  textTransform: 'uppercase',
  letterSpacing: 1.5,
  fontWeight: '500',
},
promptBox: {
  backgroundColor: colors.surfaceElevated,
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: colors.border,
  padding: spacing.xl,
  width: '100%',
  minHeight: 140,
  justifyContent: 'center',
  // Two stacked shadows: a soft white highlight above (lit-from-above
  // hint) and a deeper black shadow below (the card "lifts" off the
  // background). Requires RN 0.76+ — confirmed by package.json.
  boxShadow: BOX_SHADOW_ELEVATED,
},
promptText: {
  fontSize: fontSize.xl,
  fontFamily: fonts.medium,
  lineHeight: 32,
  color: colors.text,
  textAlign: 'center',
},
promptBoxPlaceholder: {
  width: '100%',
  minHeight: 140,
},
loadingStatusText: {
  position: 'absolute',
  bottom: spacing.xl,
  left: 0,
  right: 0,
  textAlign: 'center',
},

// RECORDING PHASE
waveBox: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '80%',
  height: 100,
  marginTop: spacing.lg,
},
waveBar: {
  flex: 1,
  marginHorizontal: 1,
  backgroundColor: colors.text,
  borderRadius: 1,
  minHeight: 2,
},
footer: {
  paddingHorizontal: spacing.xl,
  paddingTop: spacing.md,
  paddingBottom: spacing.sm,
},
btnStop: {
  backgroundColor: colors.danger,
  paddingVertical: spacing.lg,
  borderRadius: radius.lg,
  alignItems: 'center',
  justifyContent: 'center',
},
btnStopPressed: { opacity: 0.85 },
btnStopText: {
  color: colors.text,
  fontSize: fontSize.lg,
  fontWeight: '600',
  letterSpacing: 0.2,
},
errorMessageSlot: {
  width: '100%',
  minHeight: 140,
  justifyContent: 'center',
  paddingHorizontal: spacing.md,
},
errorMessage: {
  fontSize: fontSize.lg,
  fontFamily: fonts.regular,
  lineHeight: 26,
  color: colors.text,
  textAlign: 'center',
},

});

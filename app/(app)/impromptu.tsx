// impromptu.tsx
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, ScrollView, } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { advanceFlow, backFlow, exitFlow } from '../../lib/navigation';
import { useRecording } from '../../lib/use-recording';
import { ensureMicPermission, promptEnableMic } from '../../lib/mic-permission';
import { generateImpromptuPrompt } from '../../lib/prompt-generator';
import { transcribeAudio } from '../../lib/deepgram';
import { useTTS } from '../../lib/tts';
import {
  TIMES,
  getTime,
  type TopicId,
  type TypeId,
  type TimeId,
} from '../../lib/impromptu-config';
import { colors, spacing, radius, fontSize, fonts, GRADIENT_ACTIVE, BOX_SHADOW_ELEVATED } from '../../lib/theme';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';

import { File, Paths } from 'expo-file-system';
import { saveImpromptuSession } from '../../lib/dev-cache-impromptu';
import { TTS_AUDIO_FILENAME } from '../../lib/tts';
import { AiOrb, AiOrbLoading } from '../../components/AiOrb';
import { ConfirmationSheet } from '../../components/ConfirmationSheet';
import { buildFeedbackInput, generateImpromptuFeedback } from '../../lib/ai-feedback';
import { focusGuidance, focusPreset, FOCUS_PRESETS, type FocusId } from '../../lib/focus';
import { computeMetrics, detectFillers, serializeMetrics, DEFAULT_PACE_TARGET, SessionMetrics } from '../../lib/metrics';
import { buildFillerLexicon } from '../../lib/filler-word';
import { extractPitchFrames } from '../../lib/pitch';
import { validateFillers } from '../../lib/filler-validate';
import { useAuth } from '../../lib/auth';
import {
  saveImpromptuSession as saveImpromptuHistory,
  setPendingSaveId,
  setPendingStreakEvent,
} from '../../lib/sessions';
import { refreshReminder } from '../../lib/notifications';
import {
  deviceLocalDate,
  type StreakEvent,
} from '../../lib/streak';
import { useStreak } from '../../hooks/use-streak';
import { useLocalDay } from '../../hooks/use-local-day';
import { useQueryClient } from '@tanstack/react-query';


const GRADIENT_INACTIVE = ['#1E3A4C', '#142A38'] as const;

type Phase = 'idle' | 'generating' | 'speaking' | 'recording' | 'analyzing' | 'error';

const DEFAULT_TIME: TimeId = '90';
const RANDOM = 'random' as const;

const WAVE_BARS = 40;

type TopicChoice = TopicId | typeof RANDOM;
type TypeChoice = TypeId | typeof RANDOM;
// The per-session focus selection: a concrete preset, or "default" (no focus — the
// general experience: un-weighted feedback + default prompt pool).
type FocusChoice = FocusId | 'default';

const normalizeMetering = (db: number): number => {
  const clamped = Math.max(-50, Math.min(0, db));
  return (clamped + 50) / 50
}

const formatDuration = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

export default function Impromptu() {
  const r = useRecording();
  const tts = useTTS();
  const { profile, session } = useAuth();
  const userId = session?.user.id ?? '';
  const queryClient = useQueryClient();

  const { isStreakDone, updateStreak } = useStreak();

  const localDay = useLocalDay();

  const [phase, setPhase] = useState<Phase>('idle');
  const [prompt, setPrompt] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  // Topic is no longer user-selectable — pinned at RANDOM so the generator seeds a
  // random subject each call (the variety seed; an unseeded LLM collapses to its
  // most-common prompts). The dev-cache still reads this. No UI.
  const [topicChoice] = useState<TopicChoice>(RANDOM);
  // typeChoice (opinion/story/pitch) is no longer user-selectable — focus owns the
  // mode now. Kept at RANDOM so non-steering focuses (conversation) still get prompt
  // variety, and so the dev-cache replay keeps working.
  const [typeChoice] = useState<TypeChoice>(RANDOM);
  // Per-session focus: defaults to the saved profile focus (or "surprise"). Drives
  // THIS session's prompt mode AND its feedback. "surprise" resolves to a concrete
  // preset at Start (sessionFocusRef) so prompt + feedback agree.
  const [focusChoice, setFocusChoice] = useState<FocusChoice>(
    () => focusPreset(profile?.focus)?.id ?? 'default',
  );
  const focusDirtyRef = useRef(false);
  const [waveBuffer, setWaveBuffer] = useState<number[]>(() => new Array(WAVE_BARS).fill(0))
  const [timeChoice, setTimeChoice] = useState<TimeId>(DEFAULT_TIME);
  const [exitConfirmVisible, setExitConfirmVisible] = useState(false);
  // Held remaining-seconds value used by the recording timer once we've
  // committed to stopping. Prevents the 1:00 flicker that happens when the
  // native recorder briefly resets durationSec to 0 during teardown.
  const [frozenRemaining, setFrozenRemaining] = useState<number | null>(null);

  const hardCapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedTimeRef = useRef(getTime(DEFAULT_TIME).seconds)

  /* Guards against in-flight async work
  */
 const exitingRef = useRef(false);

  // The concrete focus this session started with (surprise resolved), read by both
  // the prompt generation and the feedback so they stay in sync.
  const sessionFocusRef = useRef<string | null>(null);

  // Gate that analyze() awaits before its final advanceFlow. When the user
  // opens the exit-confirmation modal mid-analyze, we set this so analyze
  // pauses instead of racing past the modal into results. Cancel resolves
  // (analyze proceeds); Confirm sets exitingRef so analyze bails post-resolve.
  const exitDecisionPromiseRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);

  useEffect(() => {
    if (phase !== 'recording') return;
    const normalized = normalizeMetering(r.metering);
    setWaveBuffer((prev) => [...prev.slice(1), normalized])
  }, [r.metering, phase])

  useEffect(() => {
    return () => {
      tts.stopSpeaking();
      if (hardCapTimeoutRef.current) clearTimeout(hardCapTimeoutRef.current);
    };
  }, []);

  // Adopt the saved focus once the profile loads, until the user picks one.
  useEffect(() => {
    if (!focusDirtyRef.current) setFocusChoice(focusPreset(profile?.focus)?.id ?? 'default');
  }, [profile?.focus]);

  useEffect(() => {
    if (phase === 'recording' && r.status === 'recorded' && r.uri && !exitingRef.current) {
      analyze();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.status, r.uri, phase]);

  const handleStart = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setErrorMsg('');
    setFrozenRemaining(null);
    // Check mic access BEFORE generating or speaking anything, so a denial routes to
    // Settings instead of producing (and speaking) a prompt the user can't record against.
    if (!(await ensureMicPermission()).granted) {
      promptEnableMic();
      return;
    }
    setPhase('generating');

    // "Default" → no focus (null); a preset → that focus. Locked for the session so
    // the prompt and the feedback agree.
    const effectiveFocus = focusChoice === 'default' ? null : focusChoice;
    sessionFocusRef.current = effectiveFocus;

    try {
      const newPrompt = await generateImpromptuPrompt({
        topic: topicChoice === RANDOM ? undefined : topicChoice,
        type: typeChoice === RANDOM ? undefined : typeChoice,
        focus: effectiveFocus,
      });

      // User may have exited while the prompt was generating
      if (exitingRef.current) return;

      setPrompt(newPrompt);

      // Stay on the loading screen until TTS is ready to play.
      // The onReady callback fires at the exat moment audio begins,
      // eliminating the silent-prompt gap.
      await tts.speak(newPrompt, {
        onReady: () => {
          setPhase('speaking');
          // Prime the recorder DURING playback so the speaking→recording
          // handoff is just recorder.record() — no silent gap after the prompt.
          // (Errors surface when startRecording awaits the same prepare below.)
          r.prepareRecording();
        },
      });

      // User may have exited while TTS was playing.
      if (exitingRef.current) return;

      await r.startRecording();
      setPhase('recording');

      const seconds = TIMES.find((t) => t.id === timeChoice)!.seconds
      selectedTimeRef.current = seconds;
      hardCapTimeoutRef.current = setTimeout(() => {
        // Natural timeout — remaining is 0 by definition. Freeze it so the
        // post-stop teardown doesn't briefly flash the timer back to the
        // original time.
        setFrozenRemaining(0);
        r.stopRecording().catch(() => {});
      }, seconds * 1000);
    } catch (e: any) {
      setErrorMsg(e.message ?? 'Something went wrong.');
      setPhase('error');
    }
  };

  const handleStop = async () => {
    if (r.durationSec < 2) return;

    if (hardCapTimeoutRef.current) {
      clearTimeout(hardCapTimeoutRef.current);
      hardCapTimeoutRef.current = null;
    }
    // Snapshot the remaining time before the native recorder tears down,
    // otherwise durationSec resets to 0 mid-teardown and the timer flashes
    // back to the configured time.
    setFrozenRemaining(Math.max(0, selectedTimeRef.current - r.durationSec));
    try {
      await r.stopRecording();
    } catch (e: any) {
      Alert.alert('Stop failed', e.message ?? 'Unknown error');
    }
  };

  const analyze = async () => {
  if (!r.uri) return;
  setPhase('analyzing');
  if (hardCapTimeoutRef.current) {
    clearTimeout(hardCapTimeoutRef.current);
    hardCapTimeoutRef.current = null;
  }

  try {
    const result = await transcribeAudio(r.uri);

    const pitchFrames = await extractPitchFrames(r.uri);

    if (exitingRef.current) return;

    const finalDuration = result.durationSec || r.durationSec;

    // The user's custom filler words are merged into detection (and pause
    // classification) for this pass; falls back to the built-in set when empty.
    const fillerLexicon = buildFillerLexicon(profile?.custom_fillers);

    // Context-check ambiguous fillers ("like", "you know") before counting — the
    // lexical detector can't tell "tastes like a dessert" from a real filler.
    // Excludes false positives so the count, highlight, and score reflect reality.
    const excludeFillers = await validateFillers(result.words, detectFillers(result.words, fillerLexicon).instances);
    if (exitingRef.current) return;

    // The user's custom pace band (defaults to 130–160) is snapshotted into the
    // metrics so the results screen scores/colors against the band active now.
    const paceTarget = {
      low: profile?.pace_target_low ?? DEFAULT_PACE_TARGET.low,
      high: profile?.pace_target_high ?? DEFAULT_PACE_TARGET.high,
    };

    const metrics = computeMetrics(result.words, null, finalDuration, pitchFrames, excludeFillers, fillerLexicon, paceTarget);

    let aiFeedback = '';
    let aiFeedbackError = false;
    let aiScore: number | null = null;
    try {
      if (!metrics.tooShort) {
        const fb = await generateImpromptuFeedback(
          buildFeedbackInput(prompt, result.transcript, metrics, finalDuration, focusGuidance(sessionFocusRef.current)),
        );
        console.log('[AI Feedback]', fb.feedback);
        console.log('[AI Feedback] score:', fb.score);
        aiFeedback = fb.feedback;
        aiScore = fb.score;
      }
    } catch (err) {
      console.warn('[AI Feedback] Failed:', err);
      aiFeedbackError = true;
      // Swallow — proceed without AI feedback rather than blocking results.
    }

    if (__DEV__) {
      try {
        await saveImpromptuSession({
          transcript: result.transcript,
          words: JSON.stringify(result.words),
          durationSec: String(result.durationSec || r.durationSec),
          impromptuPrompt: prompt,
          impromptuTopic: topicChoice === RANDOM ? '' : topicChoice,
          impromptuType: typeChoice === RANDOM ? '' : typeChoice,
          aiFeedback,
          aiFeedbackError,
          aiScore,
          ttsSourceUri: new File(Paths.cache, TTS_AUDIO_FILENAME).uri,
          recordingSourceUri: r.uri,
        });
      } catch (err) {
        console.warn('Dev cache save failed:', err);
      }
    }

    // Persist to history (fire-and-forget — must never block results on the
    // network). Skip too-short attempts: no analyzable content to review.
    if (!metrics.tooShort) {
      const audioUri = r.uri;

      const runP = (async (): Promise<{ id: string | null; event: StreakEvent }> => {
        try {
          const sessionDay = deviceLocalDate();

          const saveResult = await saveImpromptuHistory({
            data: {
              transcript: result.transcript,
              words: result.words,
              durationSec: finalDuration,
              impromptuPrompt: prompt,
              impromptuTopic:
                topicChoice === RANDOM
                  ? ''
                  : topicChoice,
              impromptuType:
                typeChoice === RANDOM
                  ? ''
                  : typeChoice,
              aiFeedback,
              aiFeedbackError,
              aiScore,
              metrics: serializeMetrics(metrics),
            },
            audioUri,
            localDay: sessionDay,
            shouldUpdateStreak:
              !isStreakDone ||
              sessionDay !== localDay,
          });

          // Only an RPC save brings back a streak.
          if (saveResult.streak) {
            updateStreak(saveResult.streak);
          }

          if (userId) {
            void queryClient.invalidateQueries({
              queryKey: ['history', 'sessions', userId],
            });
          }

          console.log('[streak] event:', saveResult.streakEvent);

          return {
            id: saveResult.id,
            event: saveResult.streakEvent,
          };
        } catch (error) {
          console.warn('[sessions] save impromptu failed:', error);

          return {
            id: null,
            event: { kind: 'none' },
          };
        }
      })();

      setPendingSaveId(runP.then((save) => save.id));
      setPendingStreakEvent(runP.then((save) => save.event));

      // Rebuild the scheduled reminder only after a successful session save.
      runP
        .then((save) => {
          if (save.id) {
            return refreshReminder();
          }
        })
        .catch(() => {});
    }

    // If the user opened the exit-confirmation modal during analyze, wait
    // here until they decide. Cancel resolves and we proceed to results;
    // Confirm sets exitingRef.current and the next check bails.
    if (exitDecisionPromiseRef.current) {
      await exitDecisionPromiseRef.current.promise;
    }

    if (exitingRef.current) return;

    advanceFlow({
      pathname: '/impromptu-results',
      params: {
        transcript: result.transcript,
        words: JSON.stringify(result.words),
        durationSec: String(finalDuration),
        impromptuPrompt: prompt,
        impromptuTopic: topicChoice === RANDOM ? '' : topicChoice,
        impromptuType: typeChoice === RANDOM ? '' : typeChoice,
        audioUri: r.uri ?? '',
        aiFeedback,
        aiFeedbackError: aiFeedbackError ? 'true' : '',
        aiScore: aiScore !== null ? String(aiScore) : '',
        metrics: JSON.stringify(serializeMetrics(metrics)),
      },
    });
  } catch (e: any) {
    setErrorMsg(e.message ?? 'Transcription failed.');
    setPhase('error');
  }
};

  const handleReset = () => {
    setErrorMsg('');
    setFrozenRemaining(null);
    setPhase('idle');
    setPrompt('');
    r.reset();
  };

  const performExit = async () => {
    // Set the exiting flag FIRST so any in-flight async work bails out
    // instead of continuing.
    exitingRef.current = true;

    // Phase-specific cleanup
    tts.stopSpeaking();

    if (hardCapTimeoutRef.current) {
      clearTimeout(hardCapTimeoutRef.current);
      hardCapTimeoutRef.current = null;
    }

    // If recording is live, stop the recorder so the mic is released.
    if (phase === 'recording') {
      await r.stopRecording().catch(() => {});
    }

    exitFlow();
  };

  // Back arrow on the first (setup) screen. The screen was pushed onto the Practice
  // tab, so Back just pops one step back to it. Nothing is in progress yet, so —
  // unlike handleExit — there's no discard confirmation.
  const handleBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    backFlow();
  };

  const handleExit = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const needsConfirmation = phase !== 'idle' && phase !== 'error';

    if (!needsConfirmation) {
      exitFlow();
      return;
    }

    // Create the decision promise synchronously so analyze() — which may be
    // mid-await right now — sees a non-null ref the moment it reaches the
    // gate, even before React commits the state update.
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    exitDecisionPromiseRef.current = { promise, resolve };

    setExitConfirmVisible(true);
  };

  // ====================================================
  // Render
  // ====================================================

  return (
    <LinearGradient
      colors={[colors.surfaceElevated, colors.bg]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.gradientBg}
    >
    {/* Re-enable iOS swipe-back only during idle (the setup screen has no
        in-progress state to protect). The layout-level option disables it
        by default for every other phase. */}
    <Stack.Screen options={{ gestureEnabled: phase === 'idle' }} />
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          {phase === 'idle' ? (
            // First (setup) screen: back chevron (left) + centered title + a matching
            // right spacer so the title stays centered — the tto-explainer header.
            // Pushed in from the Practice tab, so Back pops there (nothing started).
            <>
              <Pressable
                onPress={handleBack}
                hitSlop={12}
                style={({ pressed }) => [styles.backBtn, pressed && styles.closeBtnPressed]}
              >
                <ChevronLeftIcon color={colors.text} />
              </Pressable>
              <Text style={styles.title}>Impromptu Practice</Text>
              <View style={styles.iconSpacer} />
            </>
          ) : (
            // Underway: exit X, top-right, with the discard confirmation (handleExit).
            <>
              <View style={styles.iconSpacer} />
              <Pressable
                onPress={handleExit}
                hitSlop={12}
                style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
              >
                <XIcon color={colors.text} />
              </Pressable>
            </>
          )}
        </View>
        {phase === 'idle' && (
          <Text style={styles.subtitle}>You'll hear a question. Answer in {getTime(timeChoice).label}.</Text>
        )}
      </View>

      {phase === 'idle' && (
        <>
        <ScrollView 
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        >
          <View style={styles.section}>
            <Text style={styles.eyebrow}>Focus</Text>
            <View style={styles.chipGrid}>
              <Chip
                label="Default"
                active={focusChoice === 'default'}
                onPress={() => {
                  focusDirtyRef.current = true;
                  setFocusChoice('default');
                }}
              />
              {FOCUS_PRESETS.map((f) => (
                <Chip
                  key={f.id}
                  label={f.label}
                  active={focusChoice === f.id}
                  onPress={() => {
                    focusDirtyRef.current = true;
                    setFocusChoice(f.id);
                  }}
                />
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.eyebrow}>Time</Text>
            <View style={styles.chipGrid}>
              {TIMES.map((time) => (
                <Chip 
                  key={time.id}
                  label={time.label}
                  active={timeChoice === time.id}
                  onPress={() => setTimeChoice(time.id)}
                />
              ))}
            </View>
          </View>
        </ScrollView>

        <View style={styles.footer}>
            <Pressable
              onPress={handleStart}
              style={({ pressed }) => [
                pressed && styles.btnPrimaryPressed
              ]}
            >
              <LinearGradient
              colors={GRADIENT_ACTIVE}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={styles.btnPrimary}
              >
                <Text style={styles.btnPrimaryText}>Start</Text>
              </LinearGradient>
            </Pressable>
        </View>
        </>
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

      {phase === "speaking" && (
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
            <Text style={styles.timer}>{formatDuration(frozenRemaining ?? Math.max(0, selectedTimeRef.current - r.durationSec))}
            </Text>
          
            <View style={styles.waveBox}>
              {waveBuffer.map((value, i) => (
                <View
                  key={i}
                  style={[styles.waveBar, { height: Math.max(2, value * 80)}]}
                />
              ))}
            </View>
          </View>
        </View>

        <View style={styles.footer}>
          <Pressable
            onPress={handleStop}
            style={({ pressed }) => [
              styles.btnStop, pressed && styles.btnStopPressed
            ]}
          >
            <Text style={styles.btnStopText}>Stop</Text>
          </Pressable>
        </View>
        </>
      )}

      {phase === 'analyzing' && (
        <View style={styles.stage}>
          <View style={styles.promptBoxPlaceholder} />
          <View style={styles.stageStatus}>
            <AiOrbLoading />
            <Text style={[styles.statusText, styles.loadingStatusText]}>Analyzing your response</Text>
          </View>
        </View>
      )}

      {phase === 'error' && (
        <View style={styles.center}>
          <Text style={styles.errorText}>{errorMsg}</Text>
          <Pressable
            onPress={handleReset}
            style={({ pressed }) => [
              styles.btnPrimary, pressed && styles.btnPrimaryPressed,
            ]}
          >
            <Text>Try Again</Text>
          </Pressable>
        </View>
      )}

    <ConfirmationSheet
      visible={exitConfirmVisible}
      title="Exit practice?"
      body="Your current session will be lost"
      confirmLabel="Exit"
      destructive
      onCancel={() => {
        // Unblock analyze() if it's parked at the decision gate.
        exitDecisionPromiseRef.current?.resolve();
        exitDecisionPromiseRef.current = null;
        setExitConfirmVisible(false);
      }}
      onConfirm={() => {
        // Resolve so analyze() proceeds past the gate; performExit sets
        // exitingRef.current so the post-gate check bails before navigation.
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

// ====================================================
// Local Chip component — kept inline; will extract to a component later.
// ====================================================

type ChipProps = { label: string; active: boolean; onPress: () => void };

function Chip({ label, active, onPress }: ChipProps) {
  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }
  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        pressed && styles.chipPressed
      ]}
    >
      <LinearGradient
        colors={active ? GRADIENT_ACTIVE : GRADIENT_INACTIVE}
        start={{ x: 0.5, y: 0}}
        end={{ x: 0.5, y: 1}}
        style={[styles.chip, active && styles.chipActive]}
      >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}



// Heroicons
// Canonical back chevron (matches the *-review screens / ScreenHeader).
function ChevronLeftIcon({ size = 24, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="m15.75 4.5-7.5 7.5 7.5 7.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function XIcon({ size = 24, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
       <Path
        d="M6 18L18 6M6 6l12 12"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

const styles = StyleSheet.create({
  gradientBg: { flex: 1 },
  safe: {
    flex: 1,
  },

  // Header (shared across phases)
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    flex: 1, // fills the space between the back button + right spacer so it centers
    fontSize: fontSize.xxl,
    fontFamily: fonts.regular,
    color: colors.text,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: spacing.xs,
    lineHeight: 22,
  },

  // Close / exit button - top-right of header
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Invisible left-side placeholder used in non-idle phases so the close
  // button stays anchored at the right via the row's space-between.
  iconSpacer: {
    width: 36,
    height: 36,
  },
  closeBtnPressed: { opacity: 0.6 },
  // Back chevron on the idle screen (left slot; 36px to balance the right iconSpacer
  // so the flex:1 title centers) — matches tto-explainer's backBtn.
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    lineHeight: fontSize.sm + 1,
  },

  // Idle scroll body
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  section: { marginTop: spacing.xl },

  // Tracked-out small-caps eyebrow used for section/status labels
  eyebrow: {
    fontSize: fontSize.xs,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: spacing.md,
  },
  eyebrowCenter: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.textSubtle,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    textAlign: 'center',
  },

  // Wrapped chip grid (no horizontal scroll)
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(168, 213, 255, 0.15)',
    overflow: 'hidden',
  },
  chipActive: {
    borderColor: 'rgba(168, 213, 255, 0.35)',
  },
  chipPressed: { opacity: 0.7 },
  chipText: {
    fontSize: fontSize.sm,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
  },
  chipTextActive: {
    color: colors.bg,
  },

  // Pinned footer container (Start / Stop)
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },

  // Centered phase container (generating, speaking, analyzing, error)
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  statusText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    fontWeight: '500',
  },

  // Prompt card
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

  // Recording layout
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
  timer: {
    fontSize: fontSize.display,
    fontFamily: fonts.regular,
    color: colors.text,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },

  // Buttons
  btnPrimary: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    
  },
  btnPrimaryPressed: { opacity: 0.85 },
  btnPrimaryText: {
    fontFamily: fonts.semibold,
    color: colors.bg,
    fontSize: fontSize.lg,
    letterSpacing: 0.2,
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

  errorText: {
    fontSize: fontSize.md,
    color: colors.danger,
    textAlign: 'center',
    lineHeight: 22,
  },

  // Recording waves
  waveBox: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '80%',
  height: 100,
  marginTop: spacing.lg
},
waveBar: {
  flex: 1,
  marginHorizontal: 1,
  backgroundColor: colors.text,
  borderRadius: 1,
  minHeight: 2,
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
  textAlign: 'center'
}
});

// explain.tsx
//
// The "Explain" practice flow — a batch record → done → feedback loop. A simpler
// cousin of impromptu.tsx: NO prompt generation and NO TTS "speaking" phase. The
// user optionally types WHAT they're explaining, records themselves explaining it,
// hits Stop, and gets AI feedback on how well they explained it plus the usual
// delivery metrics. Forked from impromptu.tsx (do not parametrize that screen).
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, ScrollView, TextInput, Keyboard } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { advanceFlow, backFlow, exitFlow } from '../../lib/navigation';
import { useRecording } from '../../lib/use-recording';
import { ensureMicPermission, promptEnableMic } from '../../lib/mic-permission';
import { transcribeAudio } from '../../lib/deepgram';
import { colors, spacing, radius, fontSize, fonts, GRADIENT_ACTIVE, BOX_SHADOW_ELEVATED } from '../../lib/theme';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';

import { AiOrbLoading } from '../../components/AiOrb';
import { ConfirmationSheet } from '../../components/ConfirmationSheet';
import { buildExplainFeedbackInput, generateExplainFeedback } from '../../lib/explain-feedback';
import { generateExplainTopic } from '../../lib/explain-prompt';
import { focusGuidance } from '../../lib/focus';
import { computeMetrics, detectFillers, serializeMetrics, DEFAULT_PACE_TARGET } from '../../lib/metrics';
import { buildFillerLexicon } from '../../lib/filler-word';
import { extractPitchFrames } from '../../lib/pitch';
import { validateFillers } from '../../lib/filler-validate';
import { useAuth } from '../../lib/auth';
import {
  saveExplainSession as saveExplainHistory,
  setPendingSaveId,
  setPendingStreakEvent,
} from '../../lib/sessions';
import { classifyStreakEvent, getStreak, type Streak, type StreakEvent } from '../../lib/streak';
import { refreshReminder } from '../../lib/notifications';

type Phase = 'idle' | 'recording' | 'analyzing' | 'error';

const WAVE_BARS = 40;
// Cap the typed override — it's a short subject line, not an essay.
const TOPIC_MAX = 80;

const normalizeMetering = (db: number): number => {
  const clamped = Math.max(-50, Math.min(0, db));
  return (clamped + 50) / 50;
};

const formatDuration = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

export default function Explain() {
  const r = useRecording();
  const { profile } = useAuth();
  const [phase, setPhase] = useState<Phase>('idle');
  // The generated topic + its inline loading state; `customTopic` (if non-empty) overrides
  // it. Active topic = customTopic.trim() || topic. Mirrors debate/prep: the app hands the
  // user a topic to explain, and they can override it with their own.
  const [topic, setTopic] = useState<string>('');
  const [topicLoading, setTopicLoading] = useState(true);
  const [customTopic, setCustomTopic] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [waveBuffer, setWaveBuffer] = useState<number[]>(() => new Array(WAVE_BARS).fill(0));
  const [exitConfirmVisible, setExitConfirmVisible] = useState(false);
  // Elapsed seconds held at Stop, so the count-up timer doesn't flash back to 0:00
  // while the native recorder resets durationSec during teardown.
  const [frozenElapsed, setFrozenElapsed] = useState<number | null>(null);

  // Guards against in-flight async work after the user exits.
  const exitingRef = useRef(false);

  // Gate that analyze() awaits before its final advanceFlow. When the user opens the
  // exit-confirmation modal mid-analyze, we set this so analyze pauses instead of
  // racing past the modal into results. Cancel resolves (analyze proceeds); Confirm
  // sets exitingRef so analyze bails post-resolve.
  const exitDecisionPromiseRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);

  const activeTopic = (customTopic.trim() || topic).trim();
  const canRecord = activeTopic.length > 0;

  // Generate a topic inline on mount (no separate phase), mirroring debate/prep.
  // generateExplainTopic never rejects (it falls back to a static pool).
  const loadTopic = useCallback(async () => {
    setTopicLoading(true);
    const t = await generateExplainTopic();
    if (!exitingRef.current) {
      setTopic(t);
      setTopicLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTopic();
  }, [loadTopic]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const normalized = normalizeMetering(r.metering);
    setWaveBuffer((prev) => [...prev.slice(1), normalized]);
  }, [r.metering, phase]);

  useEffect(() => {
    if (phase === 'recording' && r.status === 'recorded' && r.uri && !exitingRef.current) {
      analyze();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.status, r.uri, phase]);

  const handleShuffle = () => {
    if (topicLoading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Clear any typed override (and drop the keyboard) so the newly generated topic shows.
    setCustomTopic('');
    Keyboard.dismiss();
    loadTopic();
  };

  const handleStart = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Keyboard.dismiss();
    setErrorMsg('');
    setFrozenElapsed(null);
    // Check mic access up front; a denial routes to Settings instead of a dead-end error.
    if (!(await ensureMicPermission()).granted) {
      promptEnableMic();
      return;
    }

    try {
      // No TTS playback to front-load prepareRecording during, so startRecording
      // runs the permission check + audio-mode switch itself, adjacent to record().
      await r.startRecording();
      if (exitingRef.current) return;
      setPhase('recording');
    } catch (e: any) {
      setErrorMsg(e.message ?? 'Something went wrong.');
      setPhase('error');
    }
  };

  const handleStop = async () => {
    if (r.durationSec < 2) return;
    // Snapshot elapsed before teardown resets durationSec to 0 (would flash 0:00).
    setFrozenElapsed(Math.floor(r.durationSec));
    try {
      await r.stopRecording();
    } catch (e: any) {
      Alert.alert('Stop failed', e.message ?? 'Unknown error');
    }
  };

  const analyze = async () => {
    if (!r.uri) return;
    setPhase('analyzing');

    try {
      const result = await transcribeAudio(r.uri);

      const pitchFrames = await extractPitchFrames(r.uri);

      if (exitingRef.current) return;

      const finalDuration = result.durationSec || r.durationSec;

      // The user's custom filler words are merged into detection (and pause
      // classification) for this pass; falls back to the built-in set when empty.
      const fillerLexicon = buildFillerLexicon(profile?.custom_fillers);

      // Context-check ambiguous fillers ("like", "you know") before counting.
      const excludeFillers = await validateFillers(
        result.words,
        detectFillers(result.words, fillerLexicon).instances,
      );
      if (exitingRef.current) return;

      // The user's custom pace band (defaults 130–160) is snapshotted into the
      // metrics so the results screen scores/colors against the band active now.
      const paceTarget = {
        low: profile?.pace_target_low ?? DEFAULT_PACE_TARGET.low,
        high: profile?.pace_target_high ?? DEFAULT_PACE_TARGET.high,
      };

      const metrics = computeMetrics(
        result.words,
        null,
        finalDuration,
        pitchFrames,
        excludeFillers,
        fillerLexicon,
        paceTarget,
      );

      const explainTopic = activeTopic;

      let aiFeedback = '';
      let aiFeedbackError = false;
      let aiScore: number | null = null;
      try {
        if (!metrics.tooShort) {
          const fb = await generateExplainFeedback(
            // Feedback uses the user's PROFILE focus (there's no per-session picker
            // on the minimal Explain setup); focusGuidance is null-safe.
            buildExplainFeedbackInput(
              explainTopic,
              result.transcript,
              metrics,
              finalDuration,
              focusGuidance(profile?.focus ?? null),
            ),
          );
          console.log('[Explain Feedback]', fb.feedback);
          console.log('[Explain Feedback] score:', fb.score);
          aiFeedback = fb.feedback;
          aiScore = fb.score;
        }
      } catch (err) {
        console.warn('[Explain Feedback] Failed:', err);
        aiFeedbackError = true;
        // Swallow — proceed without AI feedback rather than blocking results.
      }

      // Persist to history (fire-and-forget). Skip too-short attempts: no
      // analyzable content to review.
      if (!metrics.tooShort) {
        // One background chain: (1) snapshot the streak BEFORE the insert (the
        // AFTER INSERT trigger bumps the counter, so the read must precede the
        // save), (2) save, (3) classify what the save did to the streak. Feeds the
        // two results-screen hand-offs (row id → favorite star; streak event →
        // banner). Never awaited here, so navigation to results isn't blocked.
        const audioUri = r.uri;
        const runP = (async (): Promise<{ id: string | null; event: StreakEvent }> => {
          let before: Streak | null = null;
          try {
            before = await getStreak();
          } catch (e) {
            console.warn('[streak] pre-save read failed:', e);
          }
          let id: string | null = null;
          try {
            id = await saveExplainHistory({
              data: {
                transcript: result.transcript,
                words: result.words,
                durationSec: finalDuration,
                topic: explainTopic,
                aiFeedback,
                aiFeedbackError,
                aiScore,
                metrics: serializeMetrics(metrics),
              },
              audioUri,
            });
          } catch (e) {
            console.warn('[sessions] save explain failed:', e);
          }
          const event: StreakEvent = id && before ? classifyStreakEvent(before) : { kind: 'none' };
          console.log('[streak] event:', event);
          return { id, event };
        })();

        setPendingSaveId(runP.then((res) => res.id));
        setPendingStreakEvent(runP.then((res) => res.event));
        // Refresh the streak-aware reminder now a session was saved. Chained after
        // runP so getStreak reads the trigger-updated streak. Fire-and-forget.
        runP.then(() => refreshReminder()).catch(() => {});
      }

      // If the user opened the exit-confirmation modal during analyze, wait here
      // until they decide. Cancel resolves and we proceed to results; Confirm sets
      // exitingRef.current and the next check bails.
      if (exitDecisionPromiseRef.current) {
        await exitDecisionPromiseRef.current.promise;
      }

      if (exitingRef.current) return;

      advanceFlow({
        pathname: '/explain-results',
        params: {
          transcript: result.transcript,
          words: JSON.stringify(result.words),
          durationSec: String(finalDuration),
          explainTopic,
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
    setFrozenElapsed(null);
    setPhase('idle');
    // Keep the generated topic + any typed override so a retry doesn't lose them.
    r.reset();
  };

  const performExit = async () => {
    // Set the exiting flag FIRST so any in-flight async work bails out.
    exitingRef.current = true;

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
    // mid-await right now — sees a non-null ref the moment it reaches the gate,
    // even before React commits the state update.
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
      resolve = res;
    });
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
          in-progress state to protect). The layout-level option disables it by
          default for every other phase. */}
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
                <Text style={styles.title}>Explain</Text>
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
            // PLACEHOLDER copy.
            <Text style={styles.subtitle}>Record yourself explaining a concept, then get feedback.</Text>
          )}
        </View>

        {phase === 'idle' && (
          <>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Generated topic card + shuffle (mirrors debate/prep). */}
              <View style={styles.section}>
                <Text style={styles.eyebrow}>Explain this</Text>
                <View style={styles.promptBox}>
                  {topicLoading && !customTopic.trim() ? (
                    <View style={styles.promptLoadingWrap}>
                      <AiOrbLoading />
                    </View>
                  ) : (
                    <Text style={styles.promptText}>{activeTopic}</Text>
                  )}
                </View>
                <Pressable
                  onPress={handleShuffle}
                  disabled={topicLoading}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.shuffleBtn,
                    pressed && styles.pressed,
                    topicLoading && styles.shuffleDisabled,
                  ]}
                >
                  <Text style={styles.shuffleText}>New topic</Text>
                </Pressable>
              </View>

              {/* Or type your own concept to explain. */}
              <View style={styles.section}>
                <Text style={styles.eyebrow}>Or explain your own</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    style={styles.input}
                    value={customTopic}
                    onChangeText={setCustomTopic}
                    // PLACEHOLDER copy.
                    placeholder="Type something to explain (optional)"
                    placeholderTextColor={colors.textSubtle}
                    selectionColor={colors.accent}
                    keyboardAppearance="dark"
                    returnKeyType="done"
                    onSubmitEditing={() => Keyboard.dismiss()}
                    maxLength={TOPIC_MAX}
                  />
                </View>
              </View>
            </ScrollView>

            <View style={styles.footer}>
              <Pressable
                onPress={handleStart}
                disabled={!canRecord}
                style={({ pressed }) => [
                  !canRecord && styles.btnDisabled,
                  pressed && canRecord && styles.btnPrimaryPressed,
                ]}
              >
                <LinearGradient
                  colors={GRADIENT_ACTIVE}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={styles.btnPrimary}
                >
                  <Text style={styles.btnPrimaryText}>Record</Text>
                </LinearGradient>
              </Pressable>
            </View>
          </>
        )}

        {phase === 'recording' && (
          <>
            <View style={styles.stage}>
              {/* Keep the topic up so the user doesn't drift off it. */}
              <View style={styles.promptBox}>
                <Text style={styles.promptText}>{activeTopic}</Text>
              </View>

              <View style={styles.stageStatus}>
                <Text style={styles.timer}>
                  {formatDuration(frozenElapsed ?? Math.floor(r.durationSec))}
                </Text>

                <View style={styles.waveBox}>
                  {waveBuffer.map((value, i) => (
                    <View key={i} style={[styles.waveBar, { height: Math.max(2, value * 80) }]} />
                  ))}
                </View>
              </View>
            </View>

            <View style={styles.footer}>
              <Pressable
                onPress={handleStop}
                style={({ pressed }) => [styles.btnStop, pressed && styles.btnStopPressed]}
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
              <Text style={[styles.statusText, styles.loadingStatusText]}>Analyzing your explanation</Text>
            </View>
          </View>
        )}

        {phase === 'error' && (
          <View style={styles.center}>
            <Text style={styles.errorText}>{errorMsg}</Text>
            <Pressable
              onPress={handleReset}
              style={({ pressed }) => [styles.btnPrimary, pressed && styles.btnPrimaryPressed]}
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
  );
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

  // Close / exit button — top-right of header
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Invisible left-side placeholder used in non-idle phases so the close button
  // stays anchored at the right via the row's space-between.
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

  // Idle scroll body
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  section: { marginTop: spacing.xl },

  // Generated-topic card + shuffle (ported from prep-practice).
  promptBox: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    width: '100%',
    minHeight: 140,
    justifyContent: 'center',
    boxShadow: BOX_SHADOW_ELEVATED,
  },
  promptText: {
    fontSize: fontSize.xl,
    fontFamily: fonts.medium,
    lineHeight: 32,
    color: colors.text,
    textAlign: 'center',
  },
  promptLoadingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  shuffleBtn: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  shuffleDisabled: { opacity: 0.4 },
  shuffleText: {
    fontSize: fontSize.sm,
    fontFamily: fonts.semibold,
    color: colors.accent,
  },
  pressed: { opacity: 0.6 },

  // Tracked-out small-caps eyebrow used for section labels
  eyebrow: {
    fontSize: fontSize.xs,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: spacing.md,
  },

  // Recessed topic field — darker than the surface so it reads as input (matches
  // settings/edit-info.tsx + the RenameSheet field).
  inputWrap: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  input: {
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.text,
  },

  // Pinned footer container (Record / Stop)
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },

  // Centered phase container (analyzing status text lives here; error uses this too)
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

  // Recording / analyzing layout
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
  btnDisabled: { opacity: 0.4 },
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
    marginTop: spacing.lg,
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
    textAlign: 'center',
  },
});
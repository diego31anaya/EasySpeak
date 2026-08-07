// prep-practice.tsx
//
// The PREP framework practice flow. Reached from prep-explainer's "I'm Ready". Forked from
// debate.tsx MINUS the stance: the app gives a "make a case" prompt (AI-generated, with a
// shuffle + optional custom point), the user records ONE spoken response applying Point →
// Reason → Example → Point, and gets feedback on their structure adherence + delivery.
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, ScrollView, TextInput, Keyboard } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { advanceFlow, exitFlow } from '../../lib/navigation';
import { useRecording } from '../../lib/use-recording';
import { ensureMicPermission, promptEnableMic } from '../../lib/mic-permission';
import { transcribeAudio } from '../../lib/deepgram';
import { colors, spacing, radius, fontSize, fonts, GRADIENT_ACTIVE, BOX_SHADOW_ELEVATED } from '../../lib/theme';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';

import { AiOrbLoading } from '../../components/AiOrb';
import { ConfirmationSheet } from '../../components/ConfirmationSheet';
import { generatePrepPrompt } from '../../lib/prep-prompt';
import { buildPrepFeedbackInput, generatePrepFeedback } from '../../lib/prep-feedback';
import { focusGuidance } from '../../lib/focus';
import { computeMetrics, detectFillers, serializeMetrics, DEFAULT_PACE_TARGET } from '../../lib/metrics';
import { buildFillerLexicon } from '../../lib/filler-word';
import { extractPitchFrames } from '../../lib/pitch';
import { validateFillers } from '../../lib/filler-validate';
import { useAuth } from '../../lib/auth';
import {
  savePrepSession as savePrepHistory,
  setPendingSaveId,
  setPendingStreakEvent,
} from '../../lib/sessions';
import { classifyStreakEvent, getStreak, type Streak, type StreakEvent } from '../../lib/streak';
import { refreshReminder } from '../../lib/notifications';

type Phase = 'idle' | 'recording' | 'analyzing' | 'error';

const WAVE_BARS = 40;
const TOPIC_MAX = 120;

const normalizeMetering = (db: number): number => {
  const clamped = Math.max(-50, Math.min(0, db));
  return (clamped + 50) / 50;
};

const formatDuration = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

export default function PrepPractice() {
  const r = useRecording();
  const { profile } = useAuth();
  const [phase, setPhase] = useState<Phase>('idle');
  // The generated prompt + its inline loading state. `customTopic` (if non-empty) overrides
  // it. Active prompt = customTopic.trim() || prompt.
  const [prompt, setPrompt] = useState<string>('');
  const [promptLoading, setPromptLoading] = useState(true);
  const [customTopic, setCustomTopic] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [waveBuffer, setWaveBuffer] = useState<number[]>(() => new Array(WAVE_BARS).fill(0));
  const [exitConfirmVisible, setExitConfirmVisible] = useState(false);
  const [frozenElapsed, setFrozenElapsed] = useState<number | null>(null);

  const exitingRef = useRef(false);
  const exitDecisionPromiseRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);

  const activePrompt = (customTopic.trim() || prompt).trim();
  const canRecord = activePrompt.length > 0;

  const loadPrompt = useCallback(async () => {
    setPromptLoading(true);
    const p = await generatePrepPrompt();
    if (!exitingRef.current) {
      setPrompt(p);
      setPromptLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPrompt();
  }, [loadPrompt]);

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
    if (promptLoading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Clear any typed point (and drop the keyboard) so the newly generated prompt shows.
    setCustomTopic('');
    Keyboard.dismiss();
    loadPrompt();
  };

  const handleStart = async () => {
    if (!canRecord) return;
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
    setFrozenElapsed(Math.floor(r.durationSec));
    try {
      await r.stopRecording();
    } catch (e: any) {
      Alert.alert('Stop failed', e.message ?? 'Unknown error');
    }
  };

  const analyze = async () => {
    if (!r.uri) return;
    const prepPrompt = activePrompt;
    setPhase('analyzing');

    try {
      const result = await transcribeAudio(r.uri);
      const pitchFrames = await extractPitchFrames(r.uri);
      if (exitingRef.current) return;

      const finalDuration = result.durationSec || r.durationSec;
      const fillerLexicon = buildFillerLexicon(profile?.custom_fillers);
      const excludeFillers = await validateFillers(
        result.words,
        detectFillers(result.words, fillerLexicon).instances,
      );
      if (exitingRef.current) return;

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

      let aiFeedback = '';
      let aiFeedbackError = false;
      let aiScore: number | null = null;
      try {
        if (!metrics.tooShort) {
          const fb = await generatePrepFeedback(
            buildPrepFeedbackInput(
              prepPrompt,
              result.transcript,
              metrics,
              finalDuration,
              focusGuidance(profile?.focus ?? null),
            ),
          );
          console.log('[PREP Feedback]', fb.feedback);
          console.log('[PREP Feedback] score:', fb.score);
          aiFeedback = fb.feedback;
          aiScore = fb.score;
        }
      } catch (err) {
        console.warn('[PREP Feedback] Failed:', err);
        aiFeedbackError = true;
      }

      if (!metrics.tooShort) {
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
            id = await savePrepHistory({
              data: {
                prompt: prepPrompt,
                transcript: result.transcript,
                words: result.words,
                durationSec: finalDuration,
                aiFeedback,
                aiFeedbackError,
                aiScore,
                metrics: serializeMetrics(metrics),
              },
              audioUri,
            });
          } catch (e) {
            console.warn('[sessions] save prep failed:', e);
          }
          const event: StreakEvent = id && before ? classifyStreakEvent(before) : { kind: 'none' };
          console.log('[streak] event:', event);
          return { id, event };
        })();

        setPendingSaveId(runP.then((res) => res.id));
        setPendingStreakEvent(runP.then((res) => res.event));
        runP.then(() => refreshReminder()).catch(() => {});
      }

      if (exitDecisionPromiseRef.current) {
        await exitDecisionPromiseRef.current.promise;
      }
      if (exitingRef.current) return;

      advanceFlow({
        pathname: '/prep-results',
        params: {
          prompt: prepPrompt,
          transcript: result.transcript,
          words: JSON.stringify(result.words),
          durationSec: String(finalDuration),
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
    r.reset();
  };

  const performExit = async () => {
    exitingRef.current = true;
    if (phase === 'recording') {
      await r.stopRecording().catch(() => {});
    }
    exitFlow();
  };

  const handleExit = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const needsConfirmation = phase !== 'idle' && phase !== 'error';
    if (!needsConfirmation) {
      exitFlow();
      return;
    }
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
      <Stack.Screen options={{ gestureEnabled: phase === 'idle' }} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            {phase === 'idle' ? (
              <Text style={styles.title}>PREP</Text>
            ) : (
              <View style={styles.iconSpacer} />
            )}
            <Pressable
              onPress={handleExit}
              hitSlop={12}
              style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
            >
              <XIcon color={colors.text} />
            </Pressable>
          </View>
          {phase === 'idle' && (
            // PLACEHOLDER copy.
            <Text style={styles.subtitle}>Make your case: Point, Reason, Example, Point.</Text>
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
              {/* Prompt card */}
              <View style={styles.section}>
                <Text style={styles.eyebrow}>Make your case for</Text>
                <View style={styles.promptBox}>
                  {promptLoading && !customTopic.trim() ? (
                    <View style={styles.promptLoadingWrap}>
                      <AiOrbLoading />
                    </View>
                  ) : (
                    <Text style={styles.promptText}>{activePrompt}</Text>
                  )}
                </View>
                <Pressable
                  onPress={handleShuffle}
                  disabled={promptLoading}
                  hitSlop={8}
                  style={({ pressed }) => [styles.shuffleBtn, pressed && styles.pressed, promptLoading && styles.shuffleDisabled]}
                >
                  <Text style={styles.shuffleText}>New prompt</Text>
                </Pressable>
              </View>

              {/* Custom point */}
              <View style={styles.section}>
                <Text style={styles.eyebrow}>Or make your own point</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    style={styles.input}
                    value={customTopic}
                    onChangeText={setCustomTopic}
                    // PLACEHOLDER copy.
                    placeholder="A point you want to practice (optional)"
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
                style={({ pressed }) => [!canRecord && styles.btnDisabled, pressed && canRecord && styles.btnPrimaryPressed]}
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
              {/* Keep the prompt up so the user doesn't drift off it. */}
              <View style={styles.promptBox}>
                <Text style={styles.promptText}>{activePrompt}</Text>
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
              <Text style={[styles.statusText, styles.loadingStatusText]}>Analyzing your response</Text>
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
  );
}

// Heroicons
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
  safe: { flex: 1 },

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
    fontSize: fontSize.xxl,
    fontFamily: fonts.regular,
    color: colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: spacing.xs,
    lineHeight: 22,
  },

  closeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSpacer: {
    width: 36,
    height: 36,
  },
  closeBtnPressed: { opacity: 0.6 },
  pressed: { opacity: 0.6 },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  section: { marginTop: spacing.xl },

  eyebrow: {
    fontSize: fontSize.xs,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: spacing.md,
  },

  // Prompt card (impromptu's promptBox pattern)
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

  // Recessed topic field
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

  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },

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
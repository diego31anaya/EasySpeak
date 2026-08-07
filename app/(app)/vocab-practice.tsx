// vocab-practice.tsx
//
// "Describe this word in your own words" — the Vocabulary speaking practice. A trimmed
// fork of explain.tsx: same record → transcribe → AI-score → results loop, but MEANING-
// ONLY (no pitch / fillers / delivery metrics). The definition is HIDDEN by default (a
// genuine recall test) with a "Show definition" peek. Scoring compares the transcript to
// the cached definition (lib/vocab-feedback); the save is a real 'vocab' session (streak +
// History); the word's ring derives from these sessions rows (its latest scored one).

import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { advanceFlow, backFlow, exitFlow } from '../../lib/navigation';
import { useRecording } from '../../lib/use-recording';
import { ensureMicPermission, promptEnableMic } from '../../lib/mic-permission';
import { transcribeAudio } from '../../lib/deepgram';
import { colors, spacing, radius, fontSize, fonts, GRADIENT_ACTIVE } from '../../lib/theme';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';

import { AiOrbLoading } from '../../components/AiOrb';
import { ConfirmationSheet } from '../../components/ConfirmationSheet';
import { buildVocabFeedbackInput, generateVocabFeedback } from '../../lib/vocab-feedback';
import type { DefinitionSource } from '../../lib/vocab';
import { pronounceWord } from '../../lib/pronounce';
import {
  saveVocabSession,
  setPendingSaveId,
  setPendingStreakEvent,
} from '../../lib/sessions';
import { classifyStreakEvent, getStreak, type Streak, type StreakEvent } from '../../lib/streak';
import { refreshReminder } from '../../lib/notifications';
import { useAuth } from '@/lib/auth';
import { useQueryClient } from '@tanstack/react-query';

type Phase = 'idle' | 'recording' | 'analyzing' | 'error';

const WAVE_BARS = 40;
// A real description needs at least a couple words; below this we treat it as too short
// (retry) rather than scoring / saving an empty attempt.
const MIN_WORDS = 2;

const normalizeMetering = (db: number): number => {
  const clamped = Math.max(-50, Math.min(0, db));
  return (clamped + 50) / 50;
};

const formatDuration = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

export default function VocabPractice() {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const queryClient = useQueryClient();

  const params = useLocalSearchParams<{
    wordId: string;
    word: string;
    definition?: string;
    definitionSource?: string;
  }>();
  const wordId = params.wordId;
  const word = params.word ?? '';
  const definition = params.definition || null;
  // Re-derive rather than trust the param: no definition means nothing to check against,
  // whatever the param says. Anything other than 'user' is treated as the dictionary.
  const definitionSource: DefinitionSource = !definition
    ? 'none'
    : params.definitionSource === 'user'
      ? 'user'
      : 'dictionary';

  const r = useRecording();
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [showDef, setShowDef] = useState(false); // definition hidden by default (recall test)
  const [waveBuffer, setWaveBuffer] = useState<number[]>(() => new Array(WAVE_BARS).fill(0));
  const [exitConfirmVisible, setExitConfirmVisible] = useState(false);
  const [frozenElapsed, setFrozenElapsed] = useState<number | null>(null);

  const exitingRef = useRef(false);
  const exitDecisionPromiseRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);

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

  const handleStart = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
    setPhase('analyzing');

    try {
      const result = await transcribeAudio(r.uri);
      if (exitingRef.current) return;

      const finalDuration = result.durationSec || r.durationSec;
      const transcript = result.transcript.trim();
      const wordCount = transcript ? transcript.split(/\s+/).length : 0;

      // Too little to score / save — send them back to try again.
      if (wordCount < MIN_WORDS) {
        setErrorMsg("That was too short. Describe what the word means for a few seconds.");
        setPhase('error');
        return;
      }

      let aiFeedback = '';
      let aiFeedbackError = false;
      let aiScore: number | null = null;
      try {
        const fb = await generateVocabFeedback(
          buildVocabFeedbackInput(word, definition, definitionSource, transcript),
        );
        console.log('[Vocab Feedback]', fb.feedback);
        console.log('[Vocab Feedback] score:', fb.score);
        aiFeedback = fb.feedback;
        aiScore = fb.score;
      } catch (err) {
        console.warn('[Vocab Feedback] Failed:', err);
        aiFeedbackError = true;
      }

      // Save (fire-and-forget) — a real 'vocab' session (streak + History), and the save
      // the word's ring derives from this session. Snapshot the streak BEFORE the insert (the trigger
      // bumps after), then classify. Feeds the results hand-offs.
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
          id = await saveVocabSession({
            data: {
              wordId,
              word,
              definition,
              transcript,
              words: result.words,
              durationSec: finalDuration,
              aiFeedback,
              aiFeedbackError,
              aiScore,
            },
            audioUri,
          });

          if (id && userId && aiScore !== null) {
            void queryClient.invalidateQueries({ queryKey: ['vocab', 'words', userId] })
            void queryClient.invalidateQueries({ queryKey: ['vocab', 'latest-session', userId, wordId]})
          }


        } catch (e) {
          console.warn('[sessions] save vocab failed:', e);
        }
        const event: StreakEvent = id && before ? classifyStreakEvent(before) : { kind: 'none' };
        console.log('[streak] event:', event);
        return { id, event };
      })();

      setPendingSaveId(runP.then((res) => res.id));
      setPendingStreakEvent(runP.then((res) => res.event));
      runP.then(() => refreshReminder()).catch(() => {});

      if (exitDecisionPromiseRef.current) {
        await exitDecisionPromiseRef.current.promise;
      }
      if (exitingRef.current) return;

      advanceFlow({
        pathname: '/vocab-results',
        params: {
          wordId,
          word,
          definition: definition ?? '',
          transcript,
          words: JSON.stringify(result.words),
          durationSec: String(finalDuration),
          audioUri: r.uri ?? '',
          aiFeedback,
          aiFeedbackError: aiFeedbackError ? 'true' : '',
          aiScore: aiScore !== null ? String(aiScore) : '',
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
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
      resolve = res;
    });
    exitDecisionPromiseRef.current = { promise, resolve };
    setExitConfirmVisible(true);
  };

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
              <>
                <Pressable
                  onPress={handleBack}
                  hitSlop={12}
                  style={({ pressed }) => [styles.backBtn, pressed && styles.closeBtnPressed]}
                >
                  <ChevronLeftIcon color={colors.text} />
                </Pressable>
                <Text style={styles.title}>Describe</Text>
                <View style={styles.iconSpacer} />
              </>
            ) : (
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
        </View>

        {phase === 'idle' && (
          <>
            <View style={styles.idleBody}>
              <View style={styles.wordRow}>
                <Text style={styles.word}>{word}</Text>
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    pronounceWord(word);
                  }}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`Pronounce ${word}`}
                  style={({ pressed }) => [styles.speakerBtn, pressed && styles.closeBtnPressed]}
                >
                  <SpeakerIcon color={colors.accent} />
                </Pressable>
              </View>
              <Text style={styles.prompt}>
                Say what this word means in your own words. Try using it in a sentence.
              </Text>

              {/* Definition hidden by default — a recall test; peek if you want. */}
              {definition ? (
                showDef ? (
                  <View style={styles.defCard}>
                    <Text style={styles.defText}>{definition}</Text>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => setShowDef(true)}
                    style={({ pressed }) => [styles.peekBtn, pressed && styles.closeBtnPressed]}
                  >
                    <Text style={styles.peekText}>Show definition</Text>
                  </Pressable>
                )
              ) : null}
            </View>

            <View style={styles.footer}>
              <Pressable onPress={handleStart} style={({ pressed }) => [pressed && styles.btnPrimaryPressed]}>
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
              <View style={styles.stageStatus}>
                <Text style={styles.recordingWord}>{word}</Text>
                <Text style={styles.timer}>{formatDuration(frozenElapsed ?? Math.floor(r.durationSec))}</Text>
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
              <Text style={[styles.statusText, styles.loadingStatusText]}>Checking your description</Text>
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
              <Text style={styles.btnPrimaryText}>Try Again</Text>
            </Pressable>
          </View>
        )}

        <ConfirmationSheet
          visible={exitConfirmVisible}
          title="Exit practice?"
          body="Your current attempt will be lost"
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

function ChevronLeftIcon({ size = 24, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="m15.75 4.5-7.5 7.5 7.5 7.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function XIcon({ size = 24, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 18L18 6M6 6l12 12" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function SpeakerIcon({ color, size = 24 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z"
        stroke={color}
        strokeWidth={1.8}
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
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: {
    flex: 1,
    fontSize: fontSize.xxl,
    fontFamily: fonts.regular,
    color: colors.text,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  iconSpacer: { width: 36, height: 36 },
  closeBtnPressed: { opacity: 0.6 },
  backBtn: { width: 36, height: 36, alignItems: 'flex-start', justifyContent: 'center' },

  idleBody: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
  },
  wordRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  word: {
    fontSize: fontSize.xxxl,
    fontFamily: fonts.regular,
    color: colors.text,
    letterSpacing: -0.5,
  },
  speakerBtn: { padding: 2 },
  prompt: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: spacing.md,
  },
  peekBtn: { marginTop: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  peekText: { fontSize: fontSize.sm, fontFamily: fonts.medium, color: colors.accent },
  defCard: {
    marginTop: spacing.sm,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  defText: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 24,
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
  stage: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  stageStatus: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  recordingWord: {
    fontSize: fontSize.xl,
    fontFamily: fonts.regular,
    color: colors.textMuted,
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
  btnPrimaryText: { fontFamily: fonts.semibold, color: colors.bg, fontSize: fontSize.lg, letterSpacing: 0.2 },
  btnStop: {
    backgroundColor: colors.danger,
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnStopPressed: { opacity: 0.85 },
  btnStopText: { color: colors.text, fontSize: fontSize.lg, fontWeight: '600', letterSpacing: 0.2 },
  errorText: { fontSize: fontSize.md, color: colors.danger, textAlign: 'center', lineHeight: 22 },
  waveBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '80%',
    height: 100,
    marginTop: spacing.lg,
  },
  waveBar: { flex: 1, marginHorizontal: 1, backgroundColor: colors.text, borderRadius: 1, minHeight: 2 },
  promptBoxPlaceholder: { width: '100%', minHeight: 140 },
  loadingStatusText: { position: 'absolute', bottom: spacing.xl, left: 0, right: 0, textAlign: 'center' },
});

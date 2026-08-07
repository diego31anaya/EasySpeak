// app/(app)/vocab-results.tsx
//
// Results for a freshly finished Vocab describe-attempt. A trimmed fork of
// explain-results.tsx: MEANING-ONLY, so there's NO metrics block / MetricRowGroup and NO
// rename (the word IS the title — non-tappable). Shows the AI feedback + score, reveals
// the definition (hidden during the attempt), the transcript, and audio playback. "Describe
// again" restarts the same word. The favorite star + streak banner ride the background-save
// hand-offs, same as the other results screens.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { exitFlow, restartFlow } from '../../lib/navigation';
import { takePendingSaveId, takePendingStreakEvent } from '../../lib/sessions';
import type { StreakEvent } from '../../lib/streak';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, spacing, fontSize, fonts, radius, GRADIENT_ACTIVE, BOX_SHADOW_ELEVATED } from '../../lib/theme';
import type { DeepgramWord } from '../../lib/deepgram';

import { AiFeedbackCard } from '../../components/AiOrb';
import { FavoriteStarButton } from '../../components/FavoriteStarButton';
import { StreakBanner } from '../../components/StreakBanner';
import { TranscriptCard } from '../../components/TranscriptCard';
import { AudioPlayback, type AudioPlaybackHandle } from '../../components/AudioPlayback';

// Vocab has no filler/pause detection, so the transcript renders with empty marker sets.
const EMPTY_INDEX_SET = new Set<number>();
const EMPTY_INDICES: number[] = [];

export default function VocabResults() {
  const params = useLocalSearchParams<{
    wordId: string;
    word: string;
    definition?: string;
    transcript: string;
    words: string;
    durationSec: string;
    audioUri?: string;
    aiFeedback?: string;
    aiFeedbackError?: string;
    aiScore?: string;
  }>();

  const word = params.word ?? '';
  const definition = params.definition || null;
  const aiScore = params.aiScore ? Number(params.aiScore) : null;
  const words: DeepgramWord[] = params.words ? JSON.parse(params.words) : [];

  const audioRef = useRef<AudioPlaybackHandle | null>(null);
  const handleSeek = useCallback((timeSec: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    audioRef.current?.seekTo(timeSec);
  }, []);

  const handleDone = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    exitFlow();
  };

  const handleTryAgain = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    restartFlow({
      pathname: '/vocab-practice',
      params: { wordId: params.wordId, word, definition: definition ?? '' },
    });
  };

  // Background-save id → enables the favorite star once the save lands.
  const savePromiseRef = useRef<Promise<string | null> | null | undefined>(undefined);
  const [sessionId, setSessionId] = useState<string | null>(null);
  useEffect(() => {
    if (savePromiseRef.current === undefined) savePromiseRef.current = takePendingSaveId();
    const p = savePromiseRef.current;
    if (!p) return;
    let cancelled = false;
    p.then((id) => {
      if (!cancelled) setSessionId(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Streak event → the drop-down banner.
  const streakEventRef = useRef<Promise<StreakEvent> | null | undefined>(undefined);
  const [streakEvent, setStreakEvent] = useState<StreakEvent | null>(null);
  useEffect(() => {
    if (streakEventRef.current === undefined) streakEventRef.current = takePendingStreakEvent();
    const p = streakEventRef.current;
    if (!p) return;
    let cancelled = false;
    p.then((ev) => {
      if (!cancelled) setStreakEvent(ev);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
            <FavoriteStarButton sessionId={sessionId ?? ''} favorite={false} ready={sessionId != null} />
            <Text style={styles.title} numberOfLines={1}>
              {word}
            </Text>
            <Pressable
              onPress={handleDone}
              hitSlop={12}
              style={({ pressed }) => [styles.doneBtn, pressed && styles.doneBtnPressed]}
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.contentCard}>
            <AiFeedbackCard
              feedback={params.aiFeedback ?? ''}
              error={params.aiFeedbackError === 'true' || !params.aiFeedback}
              aiScore={aiScore}
              variant="flat"
            />

            {definition ? (
              <View style={styles.defCard}>
                <Text style={styles.defLabel}>Definition</Text>
                <Text style={styles.defText}>{definition}</Text>
              </View>
            ) : null}

            <TranscriptCard
              words={words}
              fillerIndices={EMPTY_INDEX_SET}
              hesitationPauseBeforeIndices={EMPTY_INDICES}
              intentionalPauseBeforeIndices={EMPTY_INDICES}
              onSeek={handleSeek}
              variant="flat"
            />

            {params.audioUri ? <AudioPlayback uri={params.audioUri} ref={audioRef} variant="flat" /> : null}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable onPress={handleTryAgain} style={({ pressed }) => [pressed && styles.btnTryAgainPressed]}>
            <LinearGradient
              colors={GRADIENT_ACTIVE}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={styles.btnTryAgain}
            >
              <Text style={styles.btnTryAgainText}>Describe again</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </SafeAreaView>

      {streakEvent && streakEvent.kind !== 'none' ? <StreakBanner event={streakEvent} /> : null}
    </LinearGradient>
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
    textAlign: 'center',
    fontSize: fontSize.xxl,
    fontFamily: fonts.regular,
    color: colors.text,
    letterSpacing: -0.5,
  },
  doneBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
  doneBtnPressed: { opacity: 0.6 },
  doneBtnText: { fontFamily: fonts.regular, fontSize: fontSize.lg, color: colors.accent },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  contentCard: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    boxShadow: BOX_SHADOW_ELEVATED,
  },
  // Definition context card — revealed after the attempt (hidden during recording).
  defCard: { gap: spacing.xs },
  defLabel: {
    fontSize: fontSize.lg,
    fontFamily: fonts.regular,
    color: colors.text,
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
  btnTryAgain: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  btnTryAgainPressed: { opacity: 0.85 },
  btnTryAgainText: {
    fontFamily: fonts.semibold,
    color: colors.bg,
    fontSize: fontSize.lg,
    letterSpacing: 0.2,
  },
});
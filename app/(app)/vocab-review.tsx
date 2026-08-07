// app/(app)/vocab-review.tsx
//
// Review screen for a saved Vocab describe-session, opened from /history. Trimmed fork of
// explain-review.tsx: MEANING-ONLY, so no MetricRowGroup / deserializeMetrics, and the word
// is a non-tappable title (no rename). Body = AI feedback + score, the definition, the
// transcript, and audio, plus the delete button. A light inline skeleton stands in while
// loading (the metric-shaped review skeletons don't fit).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';

import { colors, spacing, fontSize, fonts, radius, BOX_SHADOW_ELEVATED } from '../../lib/theme';
import { backFlow } from '../../lib/navigation';
import { getSession, type LoadedSession } from '../../lib/sessions';
import { DEFAULT_TITLE } from '../../components/SessionCard';
import { AiFeedbackCard } from '../../components/AiOrb';
import { TranscriptCard } from '../../components/TranscriptCard';
import { AudioPlayback, type AudioPlaybackHandle } from '../../components/AudioPlayback';
import { ReviewDeleteButton } from '../../components/ReviewDeleteButton';
import { FavoriteStarButton } from '../../components/FavoriteStarButton';
import { Skeleton } from '../../components/Skeleton';
import { useDelayedFlag } from '../../hooks/use-delayed-flag';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';

type VocabSession = Extract<LoadedSession, { mode: 'vocab' }>;

const EMPTY_INDEX_SET = new Set<number>();
const EMPTY_INDICES: number[] = [];

export default function VocabReview() {


  const { sessionId, title } = useLocalSearchParams<{ sessionId: string; title?: string }>();

  const [session, setSession] = useState<VocabSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const loaded = await getSession(sessionId);
        if (cancelled) return;
        if (!loaded || loaded.mode !== 'vocab') {
          setSession(null);
          setError('This session could not be opened.');
        } else {
          setSession(loaded);
        }
      } catch (e: any) {
        if (cancelled) return;
        console.warn('[vocab-review] load failed:', e);
        setError(e?.message ?? 'Could not load this session.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, reloadKey]);

  const showSkeleton = useDelayedFlag(loading, 150);
  const goBack = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    backFlow();
  }, []);
  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  const displayTitle = (session ? session.customTitle : title) ?? DEFAULT_TITLE.vocab;

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
            <Pressable
              onPress={goBack}
              hitSlop={12}
              style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
            >
              <ChevronLeftIcon color={colors.text} />
            </Pressable>
            <Text style={styles.title} numberOfLines={1}>
              {displayTitle}
            </Text>
            <FavoriteStarButton
              sessionId={sessionId}
              favorite={session?.favorite ?? false}
              ready={session != null}
            />
          </View>
        </View>

        {loading ? (
          showSkeleton ? (
            <VocabReviewSkeleton />
          ) : (
            <View style={styles.center} />
          )
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={retry} style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : session ? (
          <VocabReviewBody session={session} />
        ) : null}
      </SafeAreaView>
    </LinearGradient>
  );
}

function VocabReviewBody({ session }: { session: VocabSession }) {

  const queryClient = useQueryClient();
  const { session: authSession } = useAuth();
  const userId = authSession?.user.id ?? '';



  const { data } = session;
  const audioRef = useRef<AudioPlaybackHandle | null>(null);
  const handleSeek = useCallback((timeSec: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    audioRef.current?.seekTo(timeSec);
  }, []);
  const audioUri = session.audioUrl ?? '';

  const handleDelete = useCallback(() => {
    if (!userId || data.aiScore === null) return;

    void queryClient.invalidateQueries({ queryKey: ['vocab', 'words', userId] })
    void queryClient.invalidateQueries({ queryKey: ['vocab', 'latest-session', userId, data.wordId]})
  }, [queryClient, userId, data.aiScore, data.wordId]);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.contentCard}>
        <AiFeedbackCard
          feedback={data.aiFeedback ?? ''}
          error={data.aiFeedbackError || !data.aiFeedback}
          aiScore={data.aiScore}
          variant="flat"
        />

        {data.definition ? (
          <View style={styles.defCard}>
            <Text style={styles.defLabel}>Definition</Text>
            <Text style={styles.defText}>{data.definition}</Text>
          </View>
        ) : null}

        <TranscriptCard
          words={data.words}
          fillerIndices={EMPTY_INDEX_SET}
          hesitationPauseBeforeIndices={EMPTY_INDICES}
          intentionalPauseBeforeIndices={EMPTY_INDICES}
          onSeek={handleSeek}
          variant="flat"
        />

        {audioUri ? <AudioPlayback uri={audioUri} ref={audioRef} variant="flat" /> : null}
      </View>

      <ReviewDeleteButton sessionId={session.id} onDeleted={handleDelete}/>
    </ScrollView>
  );
}

// Light skeleton — the review body is just feedback + a definition + transcript, so a
// feedback-orb block + a few prose lines is enough (the metric-row skeletons don't fit).
function VocabReviewSkeleton() {
  return (
    <View style={styles.scrollContent}>
      <View style={styles.contentCard}>
        <View style={styles.skFeedbackHeader}>
          <Skeleton width={44} height={44} borderRadius={22} />
          <Skeleton width="45%" height={18} />
        </View>
        <View style={styles.skProse}>
          <Skeleton width="100%" height={14} />
          <Skeleton width="100%" height={14} />
          <Skeleton width="70%" height={14} />
        </View>
        <Skeleton width="100%" height={120} borderRadius={radius.md} style={styles.skTranscript} />
      </View>
    </View>
  );
}

function ChevronLeftIcon({ size = 24, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="m15.75 4.5-7.5 7.5 7.5 7.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  gradientBg: { flex: 1 },
  safe: { flex: 1 },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  backBtn: { width: 36, height: 36, alignItems: 'flex-start', justifyContent: 'center' },
  title: {
    flex: 1,
    fontSize: fontSize.xxl,
    fontFamily: fonts.regular,
    color: colors.text,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
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
  defCard: { gap: spacing.xs },
  defLabel: { fontSize: fontSize.lg, fontFamily: fonts.regular, color: colors.text },
  defText: { fontSize: fontSize.md, fontFamily: fonts.regular, color: colors.text, lineHeight: 24 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  errorText: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.danger,
    textAlign: 'center',
    lineHeight: 22,
  },
  retryBtn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  retryText: { fontSize: fontSize.md, fontFamily: fonts.medium, color: colors.accent },
  pressed: { opacity: 0.6 },
  // Skeleton bits
  skFeedbackHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  skProse: { marginTop: spacing.sm, gap: spacing.sm },
  skTranscript: { marginTop: spacing.sm },
});

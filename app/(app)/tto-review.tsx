// app/(app)/tto-review.tsx
//
// Review screen for a saved 3-2-1 session, opened from /history. Takes a
// `sessionId`, fetches the session itself (getSession), shows a skeleton while
// loading, then renders the same Overall card + round cards as tto-results.
// Header is a back chevron + centered title (same shape as /history), which
// pops back to the list. A quiet "Delete Session" sits at the bottom of the
// scroll, below the rounds (review-only — see ReviewDeleteButton); no "Try
// again" footer; no defer dance (the push lands on this light screen, content
// mounts against the skeleton).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';

import { colors, spacing, fontSize, fonts, radius } from '../../lib/theme';
import { backFlow } from '../../lib/navigation';
import { getSession, setCustomTitle, type LoadedSession } from '../../lib/sessions';
import { deserializeMetrics, type SessionMetrics } from '../../lib/metrics';
import { OverallCard } from '../../components/OverallCard';
import { RoundCard, type RoundData } from '../../components/RoundCard';
import { type AudioPlaybackHandle } from '../../components/AudioPlayback';
import { TtoReviewSkeleton } from '../../components/ReviewSkeleton';
import { ReviewDeleteButton } from '../../components/ReviewDeleteButton';
import { FavoriteStarButton } from '../../components/FavoriteStarButton';
import { RenameSheet } from '../../components/RenameSheet';
import { DEFAULT_TITLE } from '../../components/SessionCard';
import { useDelayedFlag } from '../../hooks/use-delayed-flag';

type TtoSession = Extract<LoadedSession, { mode: 'tto' }>;

export default function TtoReview() {
  const { sessionId, title } = useLocalSearchParams<{ sessionId: string; title?: string }>();

  const [session, setSession] = useState<TtoSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [renameOpen, setRenameOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const loaded = await getSession(sessionId);
        if (cancelled) return;
        if (!loaded || loaded.mode !== 'tto') {
          setSession(null);
          setError('This session could not be opened.');
        } else {
          setSession(loaded);
        }
      } catch (e: any) {
        if (cancelled) return;
        console.warn('[tto-review] load failed:', e);
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

  const openRename = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRenameOpen(true);
  }, []);

  // Persist a rename: close, update the header optimistically, then write. On
  // failure, revert the title IN PLACE (a failed write shouldn't tear the review
  // down to a skeleton/error). If the write committed but the response dropped,
  // the next open re-syncs the real value from getSession. `name` is already
  // trimmed + non-empty (the sheet's dirty gate guarantees it).
  const handleRename = useCallback(
    async (name: string | null) => {
      if (!session) return;
      const prev = session.customTitle;
      setRenameOpen(false);
      setSession((s) => (s ? { ...s, customTitle: name } : s));
      try {
        await setCustomTitle(session.id, name);
      } catch (e) {
        console.warn('[rename] save failed:', e);
        // Revert only if no newer rename superseded this one (a failed older
        // write must not clobber a later optimistic title).
        setSession((s) => (s && s.customTitle === name ? { ...s, customTitle: prev } : s));
      }
    },
    [session],
  );

  // Header title: while loading, use the title passed from the card (avoids the
  // pop from the default to the real custom title); once the session loads it's
  // the source — so clearing a title falls back to the default, not the stale param.
  const displayTitle = (session ? session.customTitle : title) ?? DEFAULT_TITLE.tto;

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
            <Pressable
              onPress={openRename}
              disabled={!session}
              hitSlop={8}
              style={({ pressed }) => [styles.titlePress, pressed && styles.pressed]}
            >
              <Text style={styles.title} numberOfLines={1}>
                {displayTitle}
              </Text>
            </Pressable>
            {/* Always rendered (keeps the title centered + no pop): dim/inert
                while loading, then brightens + fills on ready. */}
            <FavoriteStarButton
              sessionId={sessionId}
              favorite={session?.favorite ?? false}
              ready={session != null}
            />
          </View>
        </View>

        {loading ? (
          showSkeleton ? (
            <TtoReviewSkeleton />
          ) : (
            <View style={styles.center} />
          )
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              onPress={retry}
              style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : session ? (
          <TtoReviewBody session={session} />
        ) : null}
      </SafeAreaView>

      {/* In-tree overlay (not a Modal) so it can ride up with the keyboard.
          Rendered as a sibling of SafeAreaView so its backdrop fills the screen. */}
      <RenameSheet
        visible={renameOpen}
        currentTitle={session?.customTitle ?? null}
        placeholder={DEFAULT_TITLE.tto}
        onCancel={() => setRenameOpen(false)}
        onSave={handleRename}
      />
    </LinearGradient>
  );
}

function TtoReviewBody({ session }: { session: TtoSession }) {
  const { data, roundAudioUrls } = session;

  const rounds = useMemo<RoundData[]>(
    () =>
      data.rounds.map((r, i) => ({
        shape: r.shape,
        prompt: r.prompt,
        transcript: r.transcript,
        words: r.words,
        durationSec: r.durationSec,
        audioUri: roundAudioUrls[i] ?? '',
      })),
    [data.rounds, roundAudioUrls],
  );

  const roundMetrics = useMemo<SessionMetrics[]>(
    () => data.rounds.map((r) => deserializeMetrics(r.metrics)),
    [data.rounds],
  );

  const feedback = data.feedback;
  const hasFeedbackError = !feedback || Boolean(data.feedbackError);

  const totalFillers = useMemo(
    () => roundMetrics.reduce((sum, m) => sum + (m.tooShort ? 0 : m.fillerCount), 0),
    [roundMetrics],
  );

  const averageScore = feedback
    ? feedback.rounds.reduce((acc, r) => acc + r.score, 0) / feedback.rounds.length
    : null;

  const audioRefs = useRef<(AudioPlaybackHandle | null)[]>([]);

  const handlePlay = useCallback((playingIdx: number) => {
    audioRefs.current.forEach((ref, i) => {
      if (i !== playingIdx) ref?.pause();
    });
  }, []);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <OverallCard
        totalFillers={totalFillers}
        averageScore={averageScore}
        hasError={hasFeedbackError}
      />

      {rounds.map((round, i) => (
        <RoundCard
          key={i}
          shape={round.shape}
          prompt={round.prompt}
          score={feedback?.rounds[i]?.score ?? null}
          feedback={feedback?.rounds[i]?.feedback ?? null}
          metrics={roundMetrics[i]}
          words={round.words}
          durationSec={round.durationSec}
          audioUri={round.audioUri}
          onAudioRef={(handle) => {
            audioRefs.current[i] = handle;
          }}
          onAudioPlay={() => handlePlay(i)}
          defaultExpanded={i === 0}
        />
      ))}

      <ReviewDeleteButton sessionId={session.id} />
    </ScrollView>
  );
}

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

const styles = StyleSheet.create({
  gradientBg: { flex: 1 },
  safe: { flex: 1 },

  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  titlePress: { flex: 1 },
  title: {
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
  retryText: {
    fontSize: fontSize.md,
    fontFamily: fonts.medium,
    color: colors.accent,
  },
  pressed: { opacity: 0.6 },
});
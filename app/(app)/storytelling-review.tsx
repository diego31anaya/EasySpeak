// app/(app)/storytelling-review.tsx
//
// Review screen for a saved Storytelling session, opened from /history. Forked from
// explain-review.tsx — the body is byte-for-byte identical (AI feedback, the four
// metric rows, transcript, audio), so it reuses ImpromptuReviewSkeleton too. Only the
// mode it loads/guards on and the default title differ.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';

import { colors, spacing, fontSize, fonts, radius, BOX_SHADOW_ELEVATED } from '../../lib/theme';
import { backFlow } from '../../lib/navigation';
import { getSession, setCustomTitle, type LoadedSession } from '../../lib/sessions';
import { deserializeMetrics } from '../../lib/metrics';
import { AiFeedbackCard } from '../../components/AiOrb';
import { MetricRowGroup } from '../../components/MetricRowGroup';
import { PromptContextCard } from '../../components/PromptContextCard';
import { TranscriptCard } from '../../components/TranscriptCard';
import {
  AudioPlayback,
  type AudioPlaybackHandle,
} from '../../components/AudioPlayback';
// The Storytelling review body has the same shape as impromptu's (feedback + 4 rows +
// transcript + audio), so the impromptu skeleton fits exactly — no separate one.
import { ImpromptuReviewSkeleton } from '../../components/ReviewSkeleton';
import { ReviewDeleteButton } from '../../components/ReviewDeleteButton';
import { FavoriteStarButton } from '../../components/FavoriteStarButton';
import { RenameSheet } from '../../components/RenameSheet';
import { DEFAULT_TITLE } from '../../components/SessionCard';
import { useDelayedFlag } from '../../hooks/use-delayed-flag';

type StorytellingSession = Extract<LoadedSession, { mode: 'storytelling' }>;

export default function StorytellingReview() {
  const { sessionId, title } = useLocalSearchParams<{ sessionId: string; title?: string }>();

  const [session, setSession] = useState<StorytellingSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [renameOpen, setRenameOpen] = useState(false);

  // Load on mount (and on retry). `cancelled` guards against setState after the
  // user swipes back before the fetch resolves.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const loaded = await getSession(sessionId);
        if (cancelled) return;
        if (!loaded || loaded.mode !== 'storytelling') {
          setSession(null);
          setError('This session could not be opened.');
        } else {
          setSession(loaded);
        }
      } catch (e: any) {
        if (cancelled) return;
        console.warn('[storytelling-review] load failed:', e);
        setError(e?.message ?? 'Could not load this session.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, reloadKey]);

  // Skeleton only if the fetch is slow enough to be perceptible.
  const showSkeleton = useDelayedFlag(loading, 150);

  const goBack = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    backFlow();
  }, []);

  const openRename = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRenameOpen(true);
  }, []);

  // Persist a rename: close, update the header optimistically, then write. On
  // failure, revert the title IN PLACE. If the write committed but the response
  // dropped, the next open re-syncs from getSession.
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
        setSession((s) => (s && s.customTitle === name ? { ...s, customTitle: prev } : s));
      }
    },
    [session],
  );

  // Header title: while loading, use the title passed from the card (avoids the pop
  // from the default to the real custom title); once the session loads it's the
  // source — so clearing a title falls back to the default, not the stale param.
  const displayTitle = (session ? session.customTitle : title) ?? DEFAULT_TITLE.storytelling;

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

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
            <ImpromptuReviewSkeleton />
          ) : (
            // <150ms window: stay blank rather than flash a skeleton.
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
          <StorytellingReviewBody session={session} />
        ) : null}
      </SafeAreaView>

      {/* In-tree overlay (not a Modal) so it can ride up with the keyboard.
          Rendered as a sibling of SafeAreaView so its backdrop fills the screen. */}
      <RenameSheet
        visible={renameOpen}
        currentTitle={session?.customTitle ?? null}
        placeholder={DEFAULT_TITLE.storytelling}
        onCancel={() => setRenameOpen(false)}
        onSave={handleRename}
      />
    </LinearGradient>
  );
}

function StorytellingReviewBody({ session }: { session: StorytellingSession }) {
  const { data } = session;
  const audioRef = useRef<AudioPlaybackHandle | null>(null);

  // data.metrics is the serialized form (Sets → arrays); rehydrate it here.
  const metrics = useMemo(() => deserializeMetrics(data.metrics), [data.metrics]);

  const handleSeek = useCallback((timeSec: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    audioRef.current?.seekTo(timeSec);
  }, []);

  const audioUri = session.audioUrl ?? '';

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {metrics.tooShort ? (
        <View style={styles.warningCard}>
          <Text style={styles.warningText}>{metrics.reason}</Text>
        </View>
      ) : (
        <View style={styles.contentCard}>
          <AiFeedbackCard
            feedback={data.aiFeedback ?? ''}
            error={data.aiFeedbackError || !data.aiFeedback}
            aiScore={data.aiScore}
            variant="flat"
          />

          <MetricRowGroup metrics={metrics} words={data.words} durationSec={data.durationSec} />

          {data.topic ? (
            <PromptContextCard label="Topic" text={data.topic} />
          ) : null}

          <TranscriptCard
            words={data.words}
            fillerIndices={metrics.fillerIndices}
            hesitationPauseBeforeIndices={metrics.hesitationPauseBeforeIndices}
            intentionalPauseBeforeIndices={metrics.intentionalPauseBeforeIndices}
            onSeek={handleSeek}
            variant="flat"
          />

          {audioUri ? <AudioPlayback uri={audioUri} ref={audioRef} variant="flat" /> : null}
        </View>
      )}

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
    // paddingTop gives the first card's top shadow highlight room to render.
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

  warningCard: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  warningText: {
    fontSize: fontSize.md,
    color: colors.warning,
    lineHeight: 22,
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

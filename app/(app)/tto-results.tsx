// app/(app)/tto-results.tsx
//
// Results screen for a 3-2-1 Framework practice session. The user has just
// completed three rounds (one per shape) and arrives here with a transient
// `params.rounds` payload containing the deterministic data — transcripts,
// words, durations, audio URIs — plus `params.feedback` carrying the AI
// scores and prose. The feedback fetch happens upstream in tto-practice
// during the finalizing phase so this screen has no async work; it's all
// settled by the time we mount.
//
// The Overall card and each round card are shared components (components/
// OverallCard, components/RoundCard); the review screen renders the same ones.

import { useEffect, useMemo, useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { exitFlow, restartFlow } from '../../lib/navigation';
import { takePendingSaveId, takePendingStreakEvent, setCustomTitle as persistCustomTitle } from '../../lib/sessions';
import type { StreakEvent } from '../../lib/streak';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, spacing, fontSize, fonts, radius, GRADIENT_ACTIVE } from '../../lib/theme';
import {
  deserializeMetrics,
  type SessionMetrics,
  type SerializableSessionMetrics,
} from '../../lib/metrics';
import type { TTOFeedback } from '../../lib/tto-feedback';
import { FavoriteStarButton } from '../../components/FavoriteStarButton';
import { StreakBanner } from '../../components/StreakBanner';
import { RenameSheet } from '../../components/RenameSheet';
import { DEFAULT_TITLE } from '../../components/SessionCard';
import { OverallCard } from '../../components/OverallCard';
import { RoundCard, type RoundData } from '../../components/RoundCard';
import { type AudioPlaybackHandle } from '../../components/AudioPlayback';

export default function TTOResults() {
  const params = useLocalSearchParams<{
    rounds: string;
    metrics: string;
    feedback: string;
    feedbackError: string;
  }>()

  // Parse rounds once. params.rounds is a JSON-stringified RoundData[] from
  // tto-practice; parsing it on every render would waste cycles for identical
  // input.
  const rounds = useMemo<RoundData[]>(() => {
    if (!params.rounds) return [];

    try {
      return JSON.parse(params.rounds) as RoundData[];
    } catch (e) {
      console.warn('TTOResults: failed to parse rounds param', e);
      return [];
    }
  }, [params.rounds])

  // Metrics were computed once in tto-practice and serialized through nav
// params — we just rehydrate them here. Falls back to an empty array if
// the param is missing or malformed.
  const roundMetrics = useMemo<SessionMetrics[]>(() => {
    if (!params.metrics) return [];
    try {
      const raw = JSON.parse(params.metrics) as SerializableSessionMetrics[];
      return raw.map(deserializeMetrics);
    } catch (e) {
      console.warn('TTOResults: failed to parse metrics param', e);
      return [];
    }
  }, [params.metrics]);

    // Parse feedback from nav params. tto-practice ran the API call during the
    // finalizing screen so this screen has no async work — feedback is either
    // present or it failed upstream, settled before we mount.
    const feedback = useMemo<TTOFeedback | null>(() => {
      if (!params.feedback) return null;
      try {
        return JSON.parse(params.feedback) as TTOFeedback;
      } catch (e) {
        console.warn('TTOResults: failed to parse feedback param', e);
        return null;
      }
    }, [params.feedback])

    const hasFeedbackError = !feedback || Boolean(params.feedbackError);

    // Total fillers across all three rounds. Deterministic - derived from the
    // transcripts directly via metrics.ts; doesn't depend on the AI feedback
    // call
    const totalFillers = useMemo(
  () =>
    roundMetrics.reduce(
      (sum, m) => sum + (m.tooShort ? 0 : m.fillerCount),
      0,
    ),
  [roundMetrics],
);

    // Average score across rounds. Null on error so the UI renders a
    // placeholder rather than a fake number.
    // Cheap enough to compute inline. useMemo's overhead exceeds a 3-element
// reduce + division; the cache machinery costs more than the calculation.
    const averageScore = feedback
      ? feedback.rounds.reduce((acc, r) => acc + r.score, 0) / feedback.rounds.length
      : null;

    const handleDone = () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      exitFlow();
    }

    const handleTryAgain = () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      restartFlow('/tto-practice');
    };

    // The practice screen saved this session in the background and stashed its id
    // promise; pick it up ONCE (ref-guarded against a StrictMode remount re-taking
    // a cleared slot) so the favorite star can enable when the save lands. Stays
    // dim until then; null = the save failed, so it stays disabled.
    const savePromiseRef = useRef<Promise<string | null> | null | undefined>(undefined);
    const [sessionId, setSessionId] = useState<string | null>(null);
    useEffect(() => {
      if (savePromiseRef.current === undefined) {
        savePromiseRef.current = takePendingSaveId();
      }
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

    // The practice screen classified what this session did to the streak (started /
    // continued / none) and stashed it; pick it up ONCE so the drop-down banner can
    // fire. null until it resolves; kind 'none' renders nothing.
    const streakEventRef = useRef<Promise<StreakEvent> | null | undefined>(undefined);
    const [streakEvent, setStreakEvent] = useState<StreakEvent | null>(null);
    useEffect(() => {
      if (streakEventRef.current === undefined) {
        streakEventRef.current = takePendingStreakEvent();
      }
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

    // Rename: a fresh result starts with no custom title (null) until the user
    // sets one. The title press is gated on sessionId — the background save must
    // land (same as the favorite star) before we can persist a rename.
    const [customTitle, setCustomTitle] = useState<string | null>(null);
    const [renameOpen, setRenameOpen] = useState(false);
    const displayTitle = customTitle ?? DEFAULT_TITLE.tto;

    const openRename = useCallback(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setRenameOpen(true);
    }, []);

    // Optimistically set the local title, then persist; revert in place on
    // failure. sessionId is guaranteed non-null here (the press is id-gated).
    const handleRename = useCallback(
      async (name: string | null) => {
        if (!sessionId) return;
        const prev = customTitle;
        setRenameOpen(false);
        setCustomTitle(name);
        try {
          await persistCustomTitle(sessionId, name);
        } catch (e) {
          console.warn('[rename] save failed:', e);
          // Revert only if no newer rename superseded this one (a failed older
          // write must not clobber a later optimistic title).
          setCustomTitle((cur) => (cur === name ? prev : cur));
        }
      },
      [sessionId, customTitle],
    );

    const audioRefs = useRef<(AudioPlaybackHandle | null)[]>([])

    const handlePlay = useCallback((playingIdx: number) => {
      audioRefs.current.forEach((ref, i) => {
        if (i !== playingIdx) ref?.pause();
      });
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
          {/* Dim/disabled until the background save lands and hands us the
              session id; then it brightens and becomes tappable. */}
          <FavoriteStarButton
            sessionId={sessionId ?? ''}
            favorite={false}
            ready={sessionId != null}
          />
          <Pressable
            onPress={openRename}
            disabled={sessionId == null}
            hitSlop={8}
            style={({ pressed }) => [styles.titlePress, pressed && styles.pressed]}
          >
            <Text style={styles.title} numberOfLines={1}>
              {displayTitle}
            </Text>
          </Pressable>
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

      </ScrollView>

      <View style={styles.footer}>
         <Pressable
          onPress={handleTryAgain}
          style={({ pressed }) => [pressed && styles.btnTryAgainPressed]}
        >
          <LinearGradient
            colors={GRADIENT_ACTIVE}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.btnTryAgain}
          >
            <Text style={styles.btnTryAgainText}>Try again</Text>
          </LinearGradient>
        </Pressable>
      </View>

      </SafeAreaView>

      {/* Drops down over the header for a beat after a streak-changing practice.
          Sibling of SafeAreaView + absolute so it overlays from the top edge. */}
      {streakEvent && streakEvent.kind !== 'none' ? (
        <StreakBanner event={streakEvent} />
      ) : null}

      {/* In-tree overlay (not a Modal) so it rides up with the keyboard;
          sibling of SafeAreaView so its backdrop fills the screen. */}
      <RenameSheet
        visible={renameOpen}
        currentTitle={customTitle}
        placeholder={DEFAULT_TITLE.tto}
        onCancel={() => setRenameOpen(false)}
        onSave={handleRename}
      />
      </LinearGradient>
    )


}

const styles = StyleSheet.create({
  gradientBg: { flex: 1 },
  safe: { flex: 1 },

  // HEADER — identical to impromptu-results so the two screens read as siblings.
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
  titlePress: { flex: 1 },
  pressed: { opacity: 0.6 },
  title: {
    textAlign: 'center',
    fontSize: fontSize.xxl,
    fontFamily: fonts.regular,
    color: colors.text,
    letterSpacing: -0.5,
  },
  doneBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  doneBtnPressed: { opacity: 0.6 },
  doneBtnText: {
    fontFamily: fonts.regular, // explicitly regular, not semibold
    fontSize: fontSize.lg,
    color: colors.accent,
  },

  // SCROLL CONTAINER
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    // paddingTop gives the first card's top shadow highlight room to render —
    // without it the highlight (offset y=-3) gets clipped at the ScrollView's
    // top edge and the shadow effect reads as a flat, broken line.
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },

  // FOOTER
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
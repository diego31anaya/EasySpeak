// app/(app)/debate-results.tsx
//
// Results screen for a freshly finished Debate practice run. Forked from
// explain-results.tsx, with two divergences: the title stays generic ("Debate Result",
// NOT the statement — the statement is a prompt, shown as a context card), and a
// statement + stance context card sits above the AI feedback. Reviewing a saved session
// lives on debate-review.tsx.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { exitFlow, restartFlow } from '../../lib/navigation';
import { takePendingSaveId, takePendingStreakEvent, setCustomTitle as persistCustomTitle } from '../../lib/sessions';
import type { StreakEvent } from '../../lib/streak';
import type { DebateStance } from '../../lib/debate-feedback';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, spacing, fontSize, fonts, radius, GRADIENT_ACTIVE, BOX_SHADOW_ELEVATED } from '../../lib/theme';
import {
  deserializeMetrics,
  type SerializableSessionMetrics,
} from '../../lib/metrics';
import type { DeepgramWord } from '../../lib/deepgram';

import { AiFeedbackCard } from '../../components/AiOrb';
import { FavoriteStarButton } from '../../components/FavoriteStarButton';
import { StreakBanner } from '../../components/StreakBanner';
import { RenameSheet } from '../../components/RenameSheet';
import { DEFAULT_TITLE } from '../../components/SessionCard';
import { DebateContextCard } from '../../components/DebateContextCard';
import { MetricRowGroup } from '../../components/MetricRowGroup';
import { TranscriptCard } from '../../components/TranscriptCard';
import {
  AudioPlayback,
  type AudioPlaybackHandle,
} from '../../components/AudioPlayback';

export default function DebateResults() {
    const params = useLocalSearchParams<{transcript: string; words: string; durationSec: string; statement?: string; stance?: string; audioUri?: string; aiFeedback?: string; aiFeedbackError?: string; aiScore?: string; metrics?: string; }>();

    const aiScore = params.aiScore ? Number(params.aiScore) : null;
    const statement = params.statement ?? '';
    const stance: DebateStance = params.stance === 'disagree' ? 'disagree' : 'agree';

    const { metrics, words, durationSec } = useMemo(() => {
      const ws: DeepgramWord[] = params.words ? JSON.parse(params.words) : [];
      const dur = parseFloat(params.durationSec ?? '0');
      const m = params.metrics ? deserializeMetrics(JSON.parse(params.metrics) as SerializableSessionMetrics) : null
      return {
        metrics: m,
        words: ws,
        durationSec: dur,
      }
    }, [params.words, params.durationSec, params.metrics])

    const audioRef = useRef<AudioPlaybackHandle | null>(null);

    const handleSeek = useCallback((timeSec: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      audioRef.current?.seekTo(timeSec)
    }, [])

    const handleDone = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        exitFlow();
    };

    const handleTryAgain = () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      restartFlow('/debate')
    }

    // The practice screen saved this session in the background and stashed its id
    // promise; pick it up ONCE so the favorite star can enable when the save lands.
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

    // Rename: like Impromptu (NOT Explain) — the statement is a prompt, not the title, so
    // the title starts as the generic default and the user can rename. The press is gated
    // on sessionId (the background save must land first).
    const [customTitle, setCustomTitle] = useState<string | null>(null);
    const [renameOpen, setRenameOpen] = useState(false);
    const displayTitle = customTitle ?? DEFAULT_TITLE.debate;

    const openRename = useCallback(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setRenameOpen(true);
    }, []);

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
          setCustomTitle((cur) => (cur === name ? prev : cur));
        }
      },
      [sessionId, customTitle],
    );

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
                    style={({ pressed }) => [
                        styles.doneBtn, pressed && styles.doneBtnPressed
                    ]}
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
            {!metrics || metrics.tooShort ? (
                <View style={styles.warningCard}>
                    <Text style={styles.warningText}>{metrics?.reason ?? 'No analysis available.'}</Text>
                </View>
            ) : (
                <View style={styles.contentCard}>
                  <AiFeedbackCard
                    feedback={params.aiFeedback ?? ''}
                    error={params.aiFeedbackError === 'true' || !params.aiFeedback}
                    aiScore={aiScore}
                    variant="flat"
                  />

                  <MetricRowGroup metrics={metrics} words={words} durationSec={durationSec} />

                  {statement ? <DebateContextCard statement={statement} stance={stance} /> : null}

                  <TranscriptCard
                    words={words}
                    fillerIndices={metrics.fillerIndices}
                    hesitationPauseBeforeIndices={metrics.hesitationPauseBeforeIndices}
                    intentionalPauseBeforeIndices={metrics.intentionalPauseBeforeIndices}
                    onSeek={handleSeek}
                    variant="flat"
                  />

                  {params.audioUri ? <AudioPlayback uri={params.audioUri} ref={audioRef} variant="flat" /> : null}
                </View>
            )}
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

        {streakEvent && streakEvent.kind !== 'none' ? (
          <StreakBanner event={streakEvent} />
        ) : null}

        <RenameSheet
            visible={renameOpen}
            currentTitle={customTitle}
            placeholder={DEFAULT_TITLE.debate}
            onCancel={() => setRenameOpen(false)}
            onSave={handleRename}
        />
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
    fontFamily: fonts.regular,
    fontSize: fontSize.lg,
    color: colors.accent,
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
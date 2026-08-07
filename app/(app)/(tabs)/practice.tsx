// Practice tab. Hub of category cards, each containing lesson rows.
// Only the 3-2-1 Framework row navigates to a real screen today; every other
// lesson logs to console when pressed.

import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, type Href } from 'expo-router';
import { enterFlow } from '../../../lib/navigation';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, Path } from 'react-native-svg';

import { colors, spacing, fontSize, fonts, radius, BOX_SHADOW_ELEVATED } from '../../../lib/theme';
import {
  CATEGORIES,
  LESSONS,
  LESSON_MODES,
  computeHeroState,
  withRealScore,
  type Lesson,
} from '../../../lib/practice-config';
import { getLessonScores, type SessionMode } from '../../../lib/sessions';
import { scoreColor, scoreStatus } from '../../../components/metric-scoring';
import { StreakBadge } from '../../../components/StreakBadge';
import { PracticeHeroCard } from '../../../components/PracticeHeroCard';
import { useStreak } from '../../../hooks/use-streak';

export default function Practice() {
  const { count: streak } = useStreak();

  // Real per-mode scores driving every lesson ring + the hero card. Fetched on
  // focus (mirrors the Home Recent feed) and kept across refetches — only set on
  // success — so returning to the tab never flashes empty rings. null ⇒ the first
  // focus hasn't resolved yet.
  const [scores, setScores] = useState<Partial<Record<SessionMode, number>> | null>(null);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getLessonScores(LESSON_MODES)
        .then((s) => {
          if (!cancelled) setScores(s);
        })
        .catch((e) => console.warn('[practice] lesson scores load failed:', e));
      return () => {
        cancelled = true;
      };
    }, []),
  );

  // Overlay real scores onto the lessons; both the rings and the hero read from
  // this one array so they can't disagree.
  const scoredLessons = LESSONS.map((l) => withRealScore(l, scores ?? {}));
  // Gate the hero on loaded data: an all-null first render would flash "START
  // HERE" (or pop the card out for a fully-mastered user). `scores` is null only
  // on the first cold-launch focus, so this suppresses exactly that window.
  const heroState = scores === null ? ({ kind: 'hidden' } as const) : computeHeroState(scoredLessons);

  const openSettings = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    enterFlow('/settings');
  };
  return (
    <View style={styles.safe}>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <PracticeHeroCard state={heroState} />

          {CATEGORIES.map((cat) => (
            <CategorySection
              key={cat.id}
              label={cat.label}
              description={cat.description}
              lessons={scoredLessons.filter((l) => l.categoryId === cat.id)}
            />
          ))}
        </ScrollView>
    </View>
  );
}

type CategorySectionProps = {
  label: string;
  description: string;
  lessons: Lesson[];
};

function CategorySection({ label, description, lessons }: CategorySectionProps) {
  return (
    <View style={styles.categoryCard}>
      <Text style={styles.categoryLabel}>{label}</Text>
      <Text style={styles.categoryDescription}>{description}</Text>
      <View>
        {lessons.map((l, i) => (
          <LessonRow key={l.id} lesson={l} showDivider={i > 0} />
        ))}
      </View>
    </View>
  );
}

type LessonRowProps = {
  lesson: Lesson;
  showDivider: boolean;
};

function LessonRow({ lesson, showDivider }: LessonRowProps) {
  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (lesson.href) {
      enterFlow(lesson.href as Href);
    } else {
      console.log('Pressed:', lesson.id);
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.lessonRow,
        showDivider && styles.lessonDivider,
        pressed && styles.lessonPressed,
      ]}
    >
      <ProgressRing score={lesson.score ?? null} />
      <View style={styles.lessonText}>
        <Text style={styles.lessonLabel}>{lesson.label}</Text>
        <Text style={styles.lessonDescription}>{lesson.description}</Text>
      </View>
      <ChevronRightIcon color={colors.textMuted} />
    </Pressable>
  );
}

// Ring sized to sit beside two lines of text without dominating the row.
// Stroke is on the heavier side so the colored arc reads at a glance.
const RING_SIZE = 32;
const RING_STROKE = 3;

function ProgressRing({ score }: { score: number | null }) {
  const radius = (RING_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = score === null ? 0 : Math.max(0, Math.min(10, score));
  const fillRatio = clamped / 10;
  const dashOffset = circumference * (1 - fillRatio);
  const fillColor = score === null ? colors.border : scoreColor(scoreStatus(score));
  const cx = RING_SIZE / 2;
  const cy = RING_SIZE / 2;

  return (
    <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
      <Circle
        cx={cx}
        cy={cy}
        r={radius}
        stroke={colors.border}
        strokeWidth={RING_STROKE}
        fill="none"
      />
      {score !== null && (
        <Circle
          cx={cx}
          cy={cy}
          r={radius}
          stroke={fillColor}
          strokeWidth={RING_STROKE}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      )}
    </Svg>
  );
}

function ChevronRightIcon({ size = 18, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="m8.25 4.5 7.5 7.5-7.5 7.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// Heroicons "cog-6-tooth" (outline) — opens Settings (moved here from the Profile tab).
function SettingsIcon({ size = 24, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
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
  // Equal-flex sides keep the title visually centered regardless of streak
  // badge width (1-digit vs 3-digit count).
  headerSide: { flex: 1 },
  headerSideRight: { alignItems: 'flex-end' },
  headerPressed: { opacity: 0.6 },
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
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },

  categoryCard: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
    boxShadow: BOX_SHADOW_ELEVATED,
  },
  categoryLabel: {
    fontSize: fontSize.xl,
    fontFamily: fonts.regular,
    color: colors.text,
    letterSpacing: -0.5,
  },
  categoryDescription: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },

  lessonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  lessonDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  lessonPressed: { opacity: 0.6 },
  lessonText: {
    flex: 1,
    gap: 2,
  },
  lessonLabel: {
    fontSize: fontSize.md,
    fontFamily: fonts.medium,
    color: colors.text,
  },
  lessonDescription: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
});

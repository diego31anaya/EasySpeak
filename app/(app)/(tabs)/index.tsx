// Home screen — an editorial "daily edition" layout.
//
// Sections, top to bottom:
//   1. Masthead   — streak badge (top-left) + a centered "Home" title.
//   2. Greeting   — a time-of-day line (Good morning / afternoon / evening), no name.
//   3. Week strip — a rolling 5-day view of practice activity.
//   4. Featured   — one tall card = today's featured practice mode (rotates daily).
//   5. Or try     — the next mode in the rotation, as a compact row.
//   6. Recent     — a feed of the most recent sessions, each with a ScoreRing.
//
// Data: separate TanStack Query reads power the week strip and Recent feed.
// Taglines / the "FEATURED" kicker / greeting are PLACEHOLDER copy.

import { useCallback, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, type Href } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';

import {
  colors,
  fontSize,
  fonts,
  radius,
  spacing,
  GRADIENT_ACTIVE,
  HERO_FILL,
  BOX_SHADOW_ELEVATED,
} from '../../../lib/theme';
import { enterFlow } from '../../../lib/navigation';
import { fetchWeekStrip, listSessions, type SessionListItem, type SessionMode } from '../../../lib/sessions';
import { deviceLocalDate } from '../../../lib/streak';
import { sessionTitle, formatWhen, FavoriteStar } from '../../../components/SessionCard';
import { ScoreRing, ScoreRingError, SCORE_RING_SIZE } from '../../../components/ScoreRing';
import { Skeleton } from '../../../components/Skeleton';
import { formatTimestamp } from '../../../lib/metrics';
import { useAuth } from '@/lib/auth';
import { useQuery } from '@tanstack/react-query';
import { useLocalDay } from '../../../hooks/use-local-day';

const RECENT_LIMIT = 4; // feed rows shown on Home; full list lives at /history

// ============================================================
// Practice modes shown on Home, in daily-rotation order. Each LOCAL day one mode is
// Featured and the NEXT one fills the "Or try" row; the pick advances by one every day and
// wraps, so over ROTATION.length days every mode is featured once, then the cycle repeats.
// Deterministic from the date (see featuredIndexForDate) — no storage, stable across
// relaunches within a day. Vocabulary is excluded (its own tab, not a prompt-answer mode).
// All taglines are PLACEHOLDER. (Read Aloud was removed 2026-06-21.)
// ============================================================

type Mode = { name: string; tagline: string; short: string; route: Href };

const ROTATION: Mode[] = [
  {
    name: 'Impromptu',
    tagline: 'Answer a fresh question on the spot.',
    short: 'Answer a fresh question.',
    route: '/impromptu',
  },
  {
    name: '3-2-1 Framework',
    tagline: 'Answer in three short rounds.',
    short: 'Three short rounds.',
    route: '/tto-explainer',
  },
  {
    name: 'PREP',
    tagline: 'Make a point people can follow.',
    short: 'Point, Reason, Example, Point.',
    route: '/prep-explainer',
  },
  {
    name: 'Debate',
    tagline: 'Argue a side and back it up.',
    short: 'Argue a side of a statement.',
    route: '/debate',
  },
  {
    name: 'Explain',
    tagline: 'Explain a concept out loud.',
    short: 'Explain a concept clearly.',
    route: '/explain',
  },
  {
    name: 'Storytelling',
    tagline: 'Tell a story that lands.',
    short: 'Tell a short story.',
    route: '/storytelling',
  },
];

// Today's Featured index. Advances by one each LOCAL day and wraps. Date.UTC on the LOCAL
// Y/M/D gives a whole-day counter that ticks +1 at the user's midnight with no DST drift
// (UTC has none); the double-mod keeps it in range for any date.
function featuredIndexForDate(date: Date): number {
  const dayNumber = Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000,
  );
  return ((dayNumber % ROTATION.length) + ROTATION.length) % ROTATION.length;
}

// Which review screen a tapped Recent-feed row opens, by session mode. A per-mode
// map (not a binary ternary) so a new mode routes correctly instead of falling
// through to tto. Distinct from ROTATION above — that's the Home practice launcher
// cards; this is history-row routing keyed by the saved session's mode.
const REVIEW_ROUTES: Record<SessionMode, '/impromptu-review' | '/tto-review' | '/explain-review' | '/storytelling-review' | '/debate-review' | '/prep-review' | '/vocab-review'> = {
  impromptu: '/impromptu-review',
  tto: '/tto-review',
  explain: '/explain-review',
  storytelling: '/storytelling-review',
  debate: '/debate-review',
  prep: '/prep-review',
  vocab: '/vocab-review',
};

function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// ============================================================
// Screen
// ============================================================

export default function Home() {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  const localDay = useLocalDay();
  const todayDate = dateFromLocalDay(localDay);
  // The greeting depends on the current hour, while the shared local day keeps all
  // calendar-day features synchronized across midnight and foreground resumes.
  const now = new Date();

  // Daily-rotating practice picks: `featured` = today's mode (the tall card), `secondary`
  // = the next mode in the rotation (the "Or try" row). Both advance one step each local
  // day (see featuredIndexForDate) and are always distinct (rotation length > 1).
  const featuredIdx = featuredIndexForDate(todayDate);
  const featured = ROTATION[featuredIdx];
  const secondary = ROTATION[(featuredIdx + 1) % ROTATION.length];

  // Synchronous double-tap guard so a fast double tap can't push two reviews.
  const openingRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      openingRef.current = false;
    }, []),
  );

  const openSession = useCallback((item: SessionListItem) => {
    if (openingRef.current) return;
    openingRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const pathname = REVIEW_ROUTES[item.mode];
    enterFlow({ pathname, params: { sessionId: item.id, title: sessionTitle(item) } });
  }, []);

  const go = useCallback((href: Href, weight: Haptics.ImpactFeedbackStyle) => {
    Haptics.impactAsync(weight);
    enterFlow(href);
  }, []);

  return (
    <View style={styles.safe}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* 2 — Greeting */}
          <Text style={styles.greeting}>{greetingFor(now)}</Text>

          {/* 3 — Week strip */}
          <WeekStrip
            userId={userId}
            localDay={localDay}
            onPress={() => go('/streaks', Haptics.ImpactFeedbackStyle.Light)}
          />

          {/* 4 — Featured practice (today's rotating pick) */}
          <FeaturedCard
            name={featured.name}
            tagline={featured.tagline}
            onPress={() => go(featured.route, Haptics.ImpactFeedbackStyle.Medium)}
          />

          {/* 5 — Or try (the next mode in the rotation) */}
          <View style={styles.orTry}>
            <Text style={styles.sectionLabel}>OR TRY</Text>
            <View style={styles.modeList}>
              <ModeRow
                label={secondary.name}
                description={secondary.short}
                showDivider={false}
                onPress={() => go(secondary.route, Haptics.ImpactFeedbackStyle.Light)}
              />
            </View>
          </View>

          {/* 6 — Recent activity */}
          <RecentHistory
            userId={userId}
            go={go}
            openSession={openSession}
          />
        </ScrollView>
    </View>
  );
}

// ============================================================
// Week strip — a rolling 5-day view; today gets an accent ring.
// ============================================================

const DAY_INITIALS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

type WeekDay = {
  date: string;
  initial: string;
  practiced: boolean;
  isToday: boolean;
  isFuture: boolean;
};

function buildWeek(
  practicedDates: string[],
  now: Date,
): { days: WeekDay[] } {
  const practiced = new Set(practicedDates);
  const today = deviceLocalDate(now);

  // Creates an array with all of the recent dates
  const recentDates = Array.from({ length: 5 }, (_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - 4 + index);

    return {
      date,
      dateString: deviceLocalDate(date)
    }
  })

  // Finds the first date that has a practiced session
  const firstPracticedDate = recentDates.find(({ dateString }) => practiced.has(dateString))

  const stripStart = firstPracticedDate ? firstPracticedDate.date : now

  const days = Array.from({ length: 5 }, (_, index) => {
    const date = new Date(stripStart)
    date.setDate(stripStart.getDate() + index);

    const dateString = deviceLocalDate(date)

    return {
      date: dateString,
      initial: DAY_INITIALS[date.getDay()],
      practiced: practiced.has(dateString),
      isToday: dateString === today,
      isFuture: dateString > today,
    }
  })

  return { days }
}

// Dot fill, ordered by salience so a missed past day reads stronger than a future
// one: practiced (accent) > missed (danger) > today-not-yet (hollow, the ring
// carries it) > future (grey).
function dotVariant(d: WeekDay) {
  if (d.practiced) return styles.dotFilled;
  if (d.isToday) return styles.dotTodayOpen;
  if (d.isFuture) return styles.dotFuture;
  return styles.dotMissed;
}

function dateFromLocalDay(localDay: string): Date {
  const [year, month, day] = localDay
    .split('-')
    .map(Number);

  // Local noon avoids UTC parsing and DST boundary ambiguity.
  return new Date(year, month - 1, day, 12);
}

function WeekStrip({
  userId,
  localDay,
  onPress,
}: {
  userId: string;
  localDay: string;
  onPress: () => void;
}) {
  const todayDate = dateFromLocalDay(localDay);


  const throughDate = localDay;
  const fourDaysAgo = new Date(todayDate);
  fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);

  const fromDate = deviceLocalDate(fourDaysAgo);

  const weekStripQueryKey = ['history', 'sessions', userId, 'week-strip', fromDate, throughDate,] as const;

  const {
    data: practicedDates,
    isPending: isWeekStripPending,
    isError: isWeekStripError,
    refetch: refetchWeekStrip,
  } = useQuery({
    queryKey: weekStripQueryKey,
    queryFn: () => fetchWeekStrip({fromDate, throughDate}),
    enabled: Boolean(userId)
  })

  if (practicedDates === undefined && isWeekStripPending) {
    return <Skeleton width="100%" height={WEEK_STRIP_HEIGHT} borderRadius={radius.lg} />;
  }

  if (practicedDates === undefined && isWeekStripError) {
    return (
      <Pressable
        onPress={() => void refetchWeekStrip()}
        accessibilityRole="button"
        accessibilityLabel="Couldn't load activity. Tap to retry."
        style={({ pressed }) => [
          styles.weekCard,
          styles.weekErrorCard,
          pressed && styles.pressedCard,
        ]}
      >
        <ScoreRingError />
        <View style={styles.weekErrorText}>
          <Text style={styles.weekErrorTitle}>Error while loading</Text>
          <Text style={styles.weekErrorHint}>Tap to try again</Text>
        </View>
      </Pressable>
    );
  }

  const { days } = buildWeek(practicedDates ?? [], todayDate);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="View your streak"
      style={({ pressed }) => [styles.weekCard, pressed && styles.pressedCard]}
    >
      <View style={styles.dotsRow}>
        {days.map((day) => (
          <View key={day.date} style={styles.dotCell}>
            <View
              style={[
                styles.dotRing,
                day.isToday && styles.dotRingToday,
              ]}
            >
              <View style={[styles.dot, dotVariant(day)]}>
                {day.practiced ? (
                  <WeekCheckIcon />
                ) : !day.isToday && !day.isFuture ? (
                  <WeekMissedIcon />
                ) : null}
              </View>
            </View>
            <Text style={[styles.dayInitial, day.isToday && styles.dayInitialToday]}>{day.initial}</Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

// ============================================================
// Featured practice card — the single primary action
// ============================================================

function FeaturedCard({
  name,
  tagline,
  onPress,
}: {
  name: string;
  tagline: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Start ${name} practice`}
      style={({ pressed }) => pressed && styles.pressedCard}
    >
      <LinearGradient
        colors={HERO_FILL}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.featured}
      >
        <Text style={styles.featuredKicker}>FEATURED</Text>
        <Text style={styles.featuredTitle}>{name}</Text>
        <Text style={styles.featuredTagline}>{tagline}</Text>

        <View style={styles.startRow}>
          <LinearGradient
            colors={GRADIENT_ACTIVE}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.startButton}
          >
            <Text style={styles.startButtonText}>Start</Text>
          </LinearGradient>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

// ============================================================
// "Or try" mode row
// ============================================================

function ModeRow({
  label,
  description,
  showDivider,
  onPress,
}: {
  label: string;
  description: string;
  showDivider: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${description}`}
      style={({ pressed }) => [styles.modeRow, showDivider && styles.rowDivider, pressed && styles.pressedDim]}
    >
      <View style={styles.modeText}>
        <Text style={styles.modeLabel}>{label}</Text>
        <Text style={styles.modeDescription}>{description}</Text>
      </View>
      <ChevronRight color={colors.textMuted} />
    </Pressable>
  );
}

// ============================================================
// Recent feed row — leading ScoreRing + title + meta
// ============================================================

function FeedRow({
  item,
  showDivider,
  onPress,
}: {
  item: SessionListItem;
  showDivider: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${sessionTitle(item)}, ${formatWhen(item.createdAt)}`}
      style={({ pressed }) => [styles.feedRow, showDivider && styles.rowDivider, pressed && styles.pressedDim]}
    >
      <ScoreRing score={item.score} />

      <View style={styles.feedText}>
        <View style={styles.feedTitleRow}>
          <Text style={styles.feedTitle} numberOfLines={1}>
            {sessionTitle(item)}
          </Text>
          {item.favorite && <FavoriteStar size={13} />}
        </View>
        <Text style={styles.feedMeta}>
          {formatWhen(item.createdAt)} · {formatTimestamp(item.durationSec)}
        </Text>
      </View>

      <ChevronRight color={colors.textSubtle} />
    </Pressable>
  );
}

// Loading placeholder shaped like FeedRow (ring + two text lines) so the swap to
// loaded rows doesn't shift.
function FeedRowSkeleton({ showDivider }: { showDivider: boolean }) {
  return (
    <View style={[styles.feedRow, showDivider && styles.rowDivider]}>
      <Skeleton width={SCORE_RING_SIZE} height={SCORE_RING_SIZE} borderRadius={SCORE_RING_SIZE / 2} />
      <View style={styles.feedText}>
        <Skeleton width={130} height={15} />
        <Skeleton width={92} height={11} style={styles.feedMetaSkeleton} />
      </View>
    </View>
  );
}

// ============================================================
// Icons
// ============================================================

function RecentHistory({
  userId,
  go,
  openSession,
}: {
  userId: string;
  go: (href: Href, weight: Haptics.ImpactFeedbackStyle) => void;
  openSession: (item: SessionListItem) => void;
}) {
  const recentQueryKey = ['history', 'sessions', userId, 'recent', RECENT_LIMIT] as const;
  const { data: recentSessions, isPending, isError, refetch } = useQuery({
    queryKey: recentQueryKey,
    queryFn: () => listSessions({ limit: RECENT_LIMIT }),
    enabled: Boolean(userId),
  });

  if (isPending && recentSessions === undefined) {
    return (
      <View style={styles.recent}>
        <View style={styles.recentHeader}>
          <Text style={styles.sectionLabel}>RECENT</Text>
          <Text style={styles.seeAllMuted}>See all</Text>
        </View>

        <View>
          {[0, 1, 2].map((i) => (
            <FeedRowSkeleton key={i} showDivider={i > 0} />
          ))}
        </View>
      </View>
    );
  }

  if (isError && recentSessions === undefined) {
    return (
      <View style={styles.recent}>
        <View style={styles.recentHeader}>
          <Text style={styles.sectionLabel}>RECENT</Text>
          <Text style={styles.seeAllMuted}>See all</Text>
        </View>

        <Pressable
          onPress={() => void refetch()}
          accessibilityRole="button"
          accessibilityLabel="Couldn't load sessions. Tap to retry."
          style={({ pressed }) => [styles.retryBlock, pressed && styles.pressedDim]}
        >
          <Text style={styles.retryTitle}>Couldn&apos;t load sessions</Text>
          <Text style={styles.retryHint}>Tap to retry</Text>
        </Pressable>
      </View>
    );
  }

  if (recentSessions.length === 0) {
    return (
      <View style={styles.recent}>
        <View style={styles.recentHeader}>
          <Text style={styles.sectionLabel}>RECENT</Text>
          <Text style={styles.seeAllMuted}>See all</Text>
        </View>

        <Text style={styles.emptyLine}>Finish a practice and it&apos;ll show up here.</Text>
      </View>
    );
  }

  return (
    <View style={styles.recent}>
      <View style={styles.recentHeader}>
        <Text style={styles.sectionLabel}>RECENT</Text>
        <Pressable
          onPress={() => go('/history', Haptics.ImpactFeedbackStyle.Light)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="See all sessions"
          style={({ pressed }) => pressed && styles.pressedDim}
        >
          <Text style={styles.seeAll}>See all</Text>
        </Pressable>
      </View>

      <View>
        {recentSessions.map((item, i) => (
          <FeedRow
            key={item.id}
            item={item}
            showDivider={i > 0}
            onPress={() => openSession(item)}
          />
        ))}
      </View>
    </View>
  );
}



function WeekCheckIcon() {
  return (
    <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 12.5l4.5 4.5L19 7.5"
        stroke={colors.bg}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function WeekMissedIcon() {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 7l10 10M17 7 7 17"
        stroke={colors.bg}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function ChevronRight({ size = 18, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="m8.25 4.5 7.5 7.5-7.5 7.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// ============================================================
// Styles
// ============================================================

const DOT = 24;
const RING = 34;
const WEEK_STRIP_HEIGHT = 86;

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    // md (not lg) between sections so the featured card's Start affordance stays
    // above the fold on the smallest device (iPhone XS). Matches index.tsx rhythm.
    gap: spacing.md,
  },

  pressedDim: { opacity: 0.6 },
  pressedCard: { opacity: 0.92 },

  // 1 — Masthead: streak (left) · centered "Home" title · empty right spacer.
  // Pinned masthead wrapper (outside the ScrollView) — padding mirrors the other tabs'
  // header so the streak/title/gear row stays fixed and aligned across Home/Practice/Profile.
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  masthead: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Equal-flex sides keep the title optically centered (streak badge left, gear right).
  headerSide: { flex: 1 },
  headerSideRight: { alignItems: 'flex-end' },
  headerTitle: {
    fontSize: fontSize.xxl,
    fontFamily: fonts.regular,
    color: colors.text,
    letterSpacing: -0.5,
    textAlign: 'center',
  },

  // 2 — Greeting
  greeting: {
    fontSize: fontSize.xl,
    lineHeight: 28,
    fontFamily: fonts.regular,
    color: colors.text,
    letterSpacing: -0.3,
  },

  // shared section label
  sectionLabel: {
    fontSize: fontSize.xs,
    fontFamily: fonts.semibold,
    color: colors.textSubtle,
    letterSpacing: 1.2,
  },

  // 3 — Week strip
  weekCard: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    boxShadow: BOX_SHADOW_ELEVATED,
  },
  weekErrorCard: {
    minHeight: WEEK_STRIP_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  weekErrorText: {
    flex: 1,
    gap: 2,
  },
  weekErrorTitle: {
    fontSize: fontSize.md,
    fontFamily: fonts.medium,
    color: colors.text,
  },
  weekErrorHint: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  dotsRow: {
    flexDirection: 'row',
  },
  dotCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  dotRing: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  dotRingToday: {
    borderColor: colors.accent,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotFilled: {
    backgroundColor: colors.accent, // practiced
  },
  dotMissed: {
    backgroundColor: colors.danger, // past day with no practice
  },
  dotTodayOpen: {
    backgroundColor: 'transparent', // today, not yet practiced — ring carries it
  },
  dotFuture: {
    backgroundColor: colors.textSubtle, // upcoming — same grey previously used for missed days
  },
  dayInitial: {
    fontSize: fontSize.sm,
    fontFamily: fonts.medium,
    color: colors.textSubtle,
  },
  dayInitialToday: {
    color: colors.text,
  },

  // 4 — Featured card
  featured: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.xs,
    boxShadow: BOX_SHADOW_ELEVATED,
  },
  featuredKicker: {
    fontSize: fontSize.xs,
    fontFamily: fonts.semibold,
    color: colors.accent,
    letterSpacing: 1.2,
  },
  featuredTitle: {
    fontSize: fontSize.xxl,
    fontFamily: fonts.semibold,
    color: colors.text,
    letterSpacing: -0.5,
    marginTop: spacing.xs,
  },
  featuredTagline: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  startRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  startButton: {
    // flex:1 fills startRow so the button spans the card, matching the Practice
    // hero's full-width CTA (PracticeHeroCard `cta`). paddingVertical lg + no
    // horizontal padding mirror that button's proportions.
    flex: 1,
    paddingVertical: spacing.lg,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  startButtonText: {
    fontSize: fontSize.lg,
    fontFamily: fonts.semibold,
    color: colors.bg,
    letterSpacing: 0.2,
  },

  // 5 — Or try
  orTry: {
    gap: spacing.sm,
  },
  modeList: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    boxShadow: BOX_SHADOW_ELEVATED,
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  modeText: { flex: 1, gap: 2 },
  modeLabel: {
    fontSize: fontSize.md,
    fontFamily: fonts.medium,
    color: colors.text,
  },
  modeDescription: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },

  // 6 — Recent
  recent: {
    gap: spacing.sm,
  },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  seeAll: {
    fontSize: fontSize.sm,
    fontFamily: fonts.medium,
    color: colors.accent,
  },
  seeAllMuted: {
    fontSize: fontSize.sm,
    fontFamily: fonts.medium,
    color: colors.textSubtle,
    opacity: 0.6,
  },
  emptyLine: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    paddingVertical: spacing.sm,
  },
  retryBlock: {
    paddingVertical: spacing.sm,
    gap: 2,
  },
  retryTitle: {
    fontSize: fontSize.md,
    fontFamily: fonts.medium,
    color: colors.text,
  },
  retryHint: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  feedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  feedText: {
    flex: 1,
    gap: 2,
  },
  feedTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  feedTitle: {
    flexShrink: 1,
    fontSize: fontSize.md,
    fontFamily: fonts.medium,
    color: colors.text,
  },
  feedMeta: {
    fontSize: fontSize.xs,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  feedMetaSkeleton: { marginTop: 4 },
});

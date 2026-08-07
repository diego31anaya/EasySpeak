// Home screen — an editorial "daily edition" layout.
//
// Sections, top to bottom:
//   1. Masthead   — streak badge (top-left) + a centered "Home" title.
//   2. Greeting   — a time-of-day line (Good morning / afternoon / evening), no name.
//   3. Week strip — the current local week as 7 dots; a connector between two days is
//                   blue only when BOTH have a session (a run reads as one blue line).
//   4. Featured   — one tall card = today's featured practice mode (rotates daily).
//   5. Or try     — the next mode in the rotation, as a compact row.
//   6. Recent     — a feed of the most recent sessions, each with a ScoreRing.
//
// Data: one listSessions window + the streak, fetched on focus and SEEDED from the
// launch prefetch (lib/launch) so a cold start paints real data with no skeleton/grey
// flash. Taglines / the "FEATURED" kicker / greeting are PLACEHOLDER copy.

import { useCallback, useRef, useState } from 'react';
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
import { listSessions, type SessionListItem, type SessionMode } from '../../../lib/sessions';
import { consumeLaunchSessions } from '../../../lib/launch';
import { deviceLocalDate } from '../../../lib/streak';
import { sessionTitle, formatWhen, FavoriteStar } from '../../../components/SessionCard';
import { ScoreRing, SCORE_RING_SIZE } from '../../../components/ScoreRing';
import { Skeleton } from '../../../components/Skeleton';
import { useDelayedFlag } from '../../../hooks/use-delayed-flag';
import { formatTimestamp } from '../../../lib/metrics';

const RECENT_LIMIT = 4; // feed rows shown on Home; full list lives at /history
const FETCH_LIMIT = 20; // one window: powers the week strip + the feed

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
  // One date for the whole render so the greeting, week strip, and daily mode rotation
  // agree even across a midnight tick mid-session.
  const now = new Date();

  // Daily-rotating practice picks: `featured` = today's mode (the tall card), `secondary`
  // = the next mode in the rotation (the "Or try" row). Both advance one step each local
  // day (see featuredIndexForDate) and are always distinct (rotation length > 1).
  const featuredIdx = featuredIndexForDate(now);
  const featured = ROTATION[featuredIdx];
  const secondary = ROTATION[(featuredIdx + 1) % ROTATION.length];

  // Seed from the launch prefetch (consume-once) so a cold start paints the streak,
  // greeting, featured card, and the first sessions instantly — no skeleton/grey
  // flash. null ⇒ first fetch still in flight. The focus-fetch below upgrades sessions
  // to the full FETCH_LIMIT window (the prefetch only holds a few rows).
  const [sessions, setSessions] = useState<SessionListItem[] | null>(() => consumeLaunchSessions());
  // Surfaced only when there's no data to show (sessions === null); a refetch failure
  // over already-loaded rows stays silent and keeps the stale rows.
  const [error, setError] = useState<string | null>(null);
  // Live streak count shared by every tab through the tabs-scoped provider.
  // Synchronous double-tap guard so a fast double tap can't push two reviews.
  const openingRef = useRef(false);

  const loadSessions = useCallback(async () => {
    try {
      setError(null);
      setSessions(await listSessions({ limit: FETCH_LIMIT }));
    } catch (e: any) {
      console.warn('[home] sessions load failed:', e);
      setError(e?.message ?? 'Could not load your sessions.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      openingRef.current = false;
      loadSessions();
    }, [loadSessions]),
  );

  const recent = (sessions ?? []).slice(0, RECENT_LIMIT);
  // Skeleton in the Recent feed only while the first fetch is genuinely in flight
  // (no data yet, no error) and slow enough to perceive.
  const showSkeleton = useDelayedFlag(sessions === null && !error, 150);

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
            sessions={sessions}
            now={now}
            loading={sessions === null}
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
          <View style={styles.recent}>
            <View style={styles.recentHeader}>
              <Text style={styles.sectionLabel}>RECENT</Text>
              {recent.length > 0 && (
                <Pressable
                  onPress={() => go('/history', Haptics.ImpactFeedbackStyle.Light)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="See all sessions"
                  style={({ pressed }) => pressed && styles.pressedDim}
                >
                  <Text style={styles.seeAll}>See all</Text>
                </Pressable>
              )}
            </View>

            {sessions === null ? (
              error ? (
                // Fetch failed with nothing to show — tappable retry (stale rows, if
                // any, would have kept `sessions` non-null and never reach here).
                <Pressable
                  onPress={loadSessions}
                  accessibilityRole="button"
                  accessibilityLabel="Couldn't load sessions. Tap to retry."
                  style={({ pressed }) => [styles.retryBlock, pressed && styles.pressedDim]}
                >
                  <Text style={styles.retryTitle}>Couldn&apos;t load sessions</Text>
                  <Text style={styles.retryHint}>Tap to retry</Text>
                </Pressable>
              ) : showSkeleton ? (
                <View>
                  {[0, 1, 2].map((i) => (
                    <FeedRowSkeleton key={i} showDivider={i > 0} />
                  ))}
                </View>
              ) : null
            ) : recent.length === 0 ? (
              <Text style={styles.emptyLine}>Finish a practice and it&apos;ll show up here.</Text>
            ) : (
              <View>
                {recent.map((item, i) => (
                  <FeedRow
                    key={item.id}
                    item={item}
                    showDivider={i > 0}
                    onPress={() => openSession(item)}
                  />
                ))}
              </View>
            )}
          </View>
        </ScrollView>
    </View>
  );
}

// ============================================================
// Week strip — the current local week as 7 dots; today gets an accent ring; a
// connector between two days is blue only when both have a session.
// ============================================================

const WEEK_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

type WeekDay = { initial: string; practiced: boolean; isToday: boolean; isFuture: boolean };

function buildWeek(
  sessions: SessionListItem[] | null,
  now: Date,
): { days: WeekDay[] } {
  // Gets all of the dates of the sessions array and puts them in a set
  const practiced = new Set((sessions ?? []).map((s) => deviceLocalDate(new Date(s.createdAt))));
  const todayStr = deviceLocalDate(now);

  const mondayOffset = (now.getDay() + 6) % 7; // days since Monday (Mon-start week)
  const monday = new Date(now);
  monday.setDate(now.getDate() - mondayOffset);

  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const ds = deviceLocalDate(d); // ISO YYYY-MM-DD → lexicographic = chronological
    days.push({
      initial: WEEK_INITIALS[i],
      practiced: practiced.has(ds),
      isToday: ds === todayStr,
      isFuture: ds > todayStr,
    });
  }
  // brings back an array, one index represents each day respectively with its inital,
  // if the day was practiced on, if its today, or if its in the future
  return { days };
}

// Dot fill, ordered by salience so a missed past day reads stronger than a future
// one: practiced (accent) > missed (visible grey) > today-not-yet (hollow, the ring
// carries it) > future (faint). While `loading` (no data yet) every dot is faint so
// the strip never paints a confident "you missed this week" before data lands.
function dotVariant(d: WeekDay, loading: boolean) {
  if (loading) return styles.dotFuture;
  if (d.practiced) return styles.dotFilled;
  if (d.isToday) return styles.dotTodayOpen;
  if (d.isFuture) return styles.dotFuture;
  return styles.dotMissed;
}

function WeekStrip({
  sessions,
  now,
  loading,
  onPress,
}: {
  sessions: SessionListItem[] | null;
  now: Date;
  loading: boolean;
  onPress: () => void;
}) {
  const { days } = buildWeek(sessions, now);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="View your streak"
      style={({ pressed }) => [styles.weekCard, pressed && styles.pressedCard]}
    >
      <Text style={styles.sectionLabel}>THIS WEEK</Text>

      <View style={styles.dotsArea}>
        {/* Connector segments behind the dots: each spans one cell (dot-center to
            dot-center) and is blue only when BOTH days it joins have a session, grey
            otherwise — so a run of practiced days reads as one connected blue line. */}
        {days.slice(0, 6).map((d, i) => (
          <View
            key={i}
            style={[
              styles.segment,
              { left: `${((i + 0.5) / 7) * 100}%`, width: `${100 / 7}%` },
              d.practiced && days[i + 1].practiced ? styles.segmentOn : styles.segmentOff,
            ]}
          />
        ))}
        <View style={styles.dotsRow}>
          {days.map((d, i) => (
            <View key={i} style={styles.dotCell}>
              <View
                style={[
                  styles.dotRing,
                  !loading && d.isToday && styles.dotRingToday,
                  // Matte-fill the hollow today ring so the grey connector segment
                  // doesn't run through its center (the line stops at the ring edge).
                  // Skipped when today is practiced, so a blue segment still connects
                  // to the blue dot.
                  !loading && d.isToday && !d.practiced && styles.dotRingTodayFill,
                ]}
              >
                <View style={[styles.dot, dotVariant(d, loading)]} />
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.dotsRow}>
        {days.map((d, i) => (
          <View key={i} style={styles.dotCell}>
            <Text style={[styles.dayInitial, d.isToday && styles.dayInitialToday]}>{d.initial}</Text>
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

const DOT = 9;
const RING = 18;

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
    gap: spacing.md,
    boxShadow: BOX_SHADOW_ELEVATED,
  },
  dotsArea: {
    // Explicit height = the dot row, so the absolutely-positioned connector
    // segments (top: (RING-2)/2) stay anchored to a known box.
    height: RING,
    justifyContent: 'center',
  },
  segment: {
    position: 'absolute',
    top: (RING - 2) / 2, // vertically centered on the dot row (height = RING)
    height: 2,
    borderRadius: 1,
  },
  segmentOn: { backgroundColor: colors.accent }, // both adjacent days practiced
  segmentOff: { backgroundColor: colors.textSubtle }, // grey, same as a no-session dot
  dotsRow: {
    flexDirection: 'row',
  },
  dotCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  // Card-colored fill so a connector segment behind the hollow today ring is masked
  // (matches weekCard's surfaceElevated bg → invisible fill, just hides the line).
  dotRingTodayFill: {
    backgroundColor: colors.surfaceElevated,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: colors.border,
  },
  dotFilled: {
    backgroundColor: colors.accent, // practiced
  },
  dotMissed: {
    backgroundColor: colors.textSubtle, // past day with no practice — visible
  },
  dotTodayOpen: {
    backgroundColor: 'transparent', // today, not yet practiced — ring carries it
  },
  dotFuture: {
    backgroundColor: colors.border, // upcoming — faintest
  },
  dayInitial: {
    fontSize: fontSize.xs,
    fontFamily: fonts.medium,
    color: colors.textSubtle,
    marginTop: spacing.xs,
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

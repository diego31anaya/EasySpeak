// Profile tab — the user's progress home. Masthead mirrors Home/Practice (streak badge
// → /streaks, centered title, settings gear → /settings). Body: the per-metric progress
// chart (score/pace/fillers/pauses over the last N sessions) + a metric selector;
// tapping a dot slides that session's card down below the graph, and tapping the card
// opens the session's review.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, type Href } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { colors, spacing, fontSize, fonts, radius, BOX_SHADOW_ELEVATED, GRADIENT_ACTIVE, HERO_FILL } from '../../../lib/theme';
import { ANIM_DURATION, ANIM_EASING } from '../../../lib/animation';
import { enterFlow } from '../../../lib/navigation';
import { useAuth } from '../../../lib/auth';
import { focusLabel } from '../../../lib/focus';
import { formatTimestamp, DEFAULT_PACE_TARGET } from '../../../lib/metrics';
import { paceWpmStatus, fillerStatus, hesitationStatus } from '../../../lib/metric-status';
import { statusForeground, type ScorePart } from '../../../components/MetricRow';
import { BoltIcon, ChatDotsIcon, PauseOutlineIcon } from '../../../components/metric-scoring';
import {
  getMetricTrends,
  getSessionStats,
  getMetricHistory,
  type MetricTrendRow,
  type SessionMode,
  type SessionStats,
  type MetricHistory,
  type MetricBucketUnit,
} from '../../../lib/sessions';
import { METRIC_CONFIGS, METRIC_IDS, toChartPoints, type MetricId } from '../../../lib/metric-trends';
import { StreakBadge } from '../../../components/StreakBadge';
import { FavoriteStar, formatWhen, sessionTitle } from '../../../components/SessionCard';
import { ScoreRing } from '../../../components/ScoreRing';
import {
  MetricTrendChart,
  CHART_HEIGHT,
  PLOT_INSET,
  PLOT_VINSET,
  PLOT_RADIUS,
} from '../../../components/MetricTrendChart';
import { ChartOptionsSheet } from '../../../components/ChartOptionsSheet';
import { Skeleton } from '../../../components/Skeleton';
import { useStreak } from '../../../hooks/use-streak';
import { useDelayedFlag } from '../../../hooks/use-delayed-flag';

// The unselected chip fill for the chip row above the graph. Same pair impromptu/debate use
// for their Focus/Time/stance chips — kept local, like those copies.
// Unselected chip fill — a barely-there wash rather than the blue slate the other screens
// use, so the chip row sits quietly beside the chart's hairline plot. This is the one place
// the chips diverge from impromptu/debate/tto-practice (they still carry the slate copies).
const GRADIENT_INACTIVE = ['rgba(255, 255, 255, 0.055)', 'rgba(255, 255, 255, 0.02)'] as const;

// The two chart modes: the paged per-session view vs. the all-time bucket-averaged line.
type ChartMode = 'recent' | 'allTime';

// Footer label for the all-time bucket granularity (copy PLACEHOLDER).
const UNIT_LABEL: Record<MetricBucketUnit, string> = {
  day: 'Daily average',
  week: 'Weekly average',
  month: 'Monthly average',
};

// How many sessions one chart page plots. Kept small so the dots are spaced
// enough to tap one without hitting its neighbor; older sessions are reached by
// paging (the footer arrows), one TREND_LIMIT window per fetch.
const TREND_LIMIT = 10;

// Fixed height of the pager footer (date labels + arrows) under the chart, so the
// loading skeleton/spacer can reserve the whole chart+footer block exactly and the
// selector doesn't get pushed down when data lands. Tall enough to hold a ~44pt
// arrow tap target (the buttons size themselves via their own padding, so the target
// isn't clipped by the row bounds the way hitSlop would be).
const PAGER_HEIGHT = 44;

// Space below the slid-in session card (between it and the View All card beneath it),
// folded into the animated card height so it opens/closes WITH the card — no separate
// gap that could jump.
const CARD_GAP = spacing.md;

// Loading-skeleton geometry. The chart-shaped skeleton (ChartSkeleton) mirrors the
// real layout — the header, a scatter of dots over the plot, the pager footer — so
// loading→loaded doesn't jump and it reads as a chart, not a grey square.
const SKELETON_HEADER_HEIGHT = 38; // ≈ the real chart header's height
// The chart + footer block WITHOUT the header row (all-time: the real header renders
// above, so its skeleton/spacer omits it). Recent's first-load block adds the header
// (the real header is hidden while rows === null, so the skeleton stands in for it).
const CHART_FOOTER_HEIGHT = CHART_HEIGHT + spacing.sm + PAGER_HEIGHT;
const LOADING_BLOCK_HEIGHT = SKELETON_HEADER_HEIGHT + spacing.sm + CHART_FOOTER_HEIGHT;

// Per-mode review route for tapping a session card (mirrors the Home feed's map).
const REVIEW_ROUTES: Record<
  SessionMode,
  '/impromptu-review' | '/tto-review' | '/explain-review' | '/storytelling-review' | '/debate-review' | '/prep-review' | '/vocab-review'
> = {
  impromptu: '/impromptu-review',
  tto: '/tto-review',
  explain: '/explain-review',
  storytelling: '/storytelling-review',
  debate: '/debate-review',
  prep: '/prep-review',
  vocab: '/vocab-review',
};

export default function Profile() {
  const { count: streak } = useStreak();

  // Per-session metric values for the chart, fetched on focus (mirrors Home's Recent
  // feed): only set on success so returning to the tab never flashes empty. null ⇒
  // first fetch still in flight.
  const [rows, setRows] = useState<MetricTrendRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<MetricId>('score');
  // Chart mode: 'recent' = the paged per-session view (clickable dots); 'allTime' = the
  // non-interactive line of bucket-averaged progress across ALL sessions. `chartModeRef`
  // mirrors it so the focus effect reads the mode without re-subscribing on every toggle.
  const [chartMode, setChartMode] = useState<ChartMode>('recent');
  const chartModeRef = useRef<ChartMode>('recent');
  useEffect(() => {
    chartModeRef.current = chartMode;
  }, [chartMode]);
  // All-time buckets, fetched LAZILY (first All-time open), then kept-last + refetched on
  // focus only while in All-time. null ⇒ not fetched yet; `historyError` stops the skeleton.
  const [history, setHistory] = useState<MetricHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyReqIdRef = useRef(0);
  // The chart-options bottom sheet (metric + range picker) — opened by the header's
  // options icon; its selections drive selectMetric / selectMode (the graph updates live).
  const [optionsVisible, setOptionsVisible] = useState(false);
  // All-time totals for the "View All Sessions" card (independent of the chart page).
  // null ⇒ first fetch in flight; keep-last on refetch. `statsError` stops the skeleton
  // if the first fetch fails (the card just doesn't appear; the graph is the main view).
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [statsError, setStatsError] = useState(false);
  // Chart page (0 = the newest TREND_LIMIT sessions; Back pages older) + whether an
  // older page exists (the RPC's limit+1 peek row — drives the Back arrow's grey-out;
  // has-newer is just page > 0). Committed TOGETHER with `rows` on fetch success only,
  // so a silently-failed page fetch (keep-last) can't desync the arrows/labels from
  // the rows still on screen.
  const [page, setPage] = useState(0);
  const [hasOlder, setHasOlder] = useState(false);
  // The committed page, for the focus refetch — a review round-trip reloads the page
  // the user was on, not page 0.
  const pageRef = useRef(0);
  // Generation token (the /history reqIdRef pattern): a stale response — e.g. a slow
  // focus refetch racing an arrow tap — is discarded instead of clobbering newer rows.
  const reqIdRef = useRef(0);
  // One page fetch at a time: arrow taps are IGNORED (not greyed — no flicker) while
  // one is in flight, so a double-tap can't overshoot past the oldest page before
  // `hasOlder` updates.
  const inFlightRef = useRef(false);
  // Selected session. `selectedId` drives the dot's white ring; `cardRow` is the session
  // shown in the card below (kept through the slide-up so it animates out with its own
  // content); `progress` (0 hidden ↔ 1 shown) drives the card container's HEIGHT — so the
  // selector + anything else below the graph reflows in sync — and `cardHeight` is the
  // card's measured natural height.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cardRow, setCardRow] = useState<MetricTrendRow | null>(null);
  // Measured natural card height as a SHARED VALUE (like /history's search bar), so
  // measuring it in onLayout writes it on the UI thread WITHOUT re-rendering the screen
  // (a React re-render mid-animation re-renders the chart too → a real hitch).
  const cardHeight = useSharedValue(0);
  const progress = useSharedValue(0);

  const loadPage = useCallback(async (target: number) => {
    const reqId = ++reqIdRef.current;
    inFlightRef.current = true;
    try {
      setError(null);
      const res = await getMetricTrends(TREND_LIMIT, target * TREND_LIMIT);
      if (reqId !== reqIdRef.current) return; // superseded by a newer fetch
      if (res.rows.length === 0 && target > 0) {
        // The page vanished (sessions deleted since it was fetched) — step BACK one
        // page so the user lands on the new oldest page, not teleported to newest.
        loadPage(target - 1);
        return;
      }
      setRows(res.rows);
      setHasOlder(res.hasOlder);
      setPage(target);
      pageRef.current = target;
    } catch (e: any) {
      if (reqId !== reqIdRef.current) return;
      console.warn('[profile] metric trends load failed:', e);
      setError(e?.message ?? 'Could not load your progress.');
    } finally {
      // The recursive clamp call bumps the token and owns the flag from there.
      if (reqId === reqIdRef.current) inFlightRef.current = false;
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      setStatsError(false);
      setStats(await getSessionStats());
    } catch (e) {
      // Best-effort: keep any prior stats; flag the error so the skeleton stops.
      console.warn('[profile] session stats load failed:', e);
      setStatsError(true);
    }
  }, []);

  // All-time buckets (mirrors loadPage's keep-last + generation-token guard; no in-flight
  // ref — all-time has no arrow/dot taps to guard, and the reqId token discards stale
  // responses so a rapid re-toggle can't commit an out-of-order result).
  const loadHistory = useCallback(async () => {
    const reqId = ++historyReqIdRef.current;
    try {
      setHistoryError(null);
      const res = await getMetricHistory();
      if (reqId !== historyReqIdRef.current) return; // superseded
      setHistory(res); // keep-last: commit only on success
    } catch (e: any) {
      if (reqId !== historyReqIdRef.current) return;
      console.warn('[profile] metric history load failed:', e);
      setHistoryError(e?.message ?? 'Could not load your progress.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadPage(pageRef.current);
      loadStats();
      // Refetch the all-time set on focus only while it's the active view (keep-last).
      if (chartModeRef.current === 'allTime') loadHistory();
    }, [loadPage, loadStats, loadHistory]),
  );

  const showSkeleton = useDelayedFlag(rows === null && !error, 150);
  const showStatsSkeleton = useDelayedFlag(stats === null && !statsError, 150);
  const showHistorySkeleton = useDelayedFlag(history === null && !historyError, 150);
  const sessionCount = rows?.length ?? 0;

  const openAllSessions = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    enterFlow('/history');
  }, []);

  // Slide the card in (grow the container height) / out (shrink, then drop the row so it
  // animates out still showing its own content).
  const showCard = useCallback(
    (row: MetricTrendRow) => {
      setSelectedId(row.id);
      setCardRow(row);
      progress.value = withTiming(1, { duration: ANIM_DURATION, easing: ANIM_EASING });
    },
    [progress],
  );

  const hideCard = useCallback(() => {
    // Collapse the card container's height to 0; leave `cardRow` set — when hidden it's
    // clipped to 0 (invisible, not tappable), so no post-animation JS callback is needed.
    setSelectedId(null); // ring off immediately
    progress.value = withTiming(0, { duration: ANIM_DURATION, easing: ANIM_EASING });
  }, [progress]);

  // If the shown session leaves the on-screen rows — a page committed under an open
  // card (a dot tapped in the fetch window before its page swaps), or the selected
  // session deleted from its review then returned to — collapse the stale card so it
  // can't outlive its page. hideCard leaves cardRow set (clipped to 0), which is fine.
  useEffect(() => {
    if (selectedId !== null && rows !== null && !rows.some((r) => r.id === selectedId)) {
      hideCard();
    }
  }, [rows, selectedId, hideCard]);

  // Tap a dot: none → show, same → hide, other → swap the content (progress stays 1 → no
  // animation, just a new session in the same card). Ignored while a page fetch is in
  // flight — the old page is still rendered, so a tap would open a card for a session
  // about to leave when the new page commits.
  const onSelectPoint = useCallback(
    (id: string) => {
      if (inFlightRef.current) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const row = rows?.find((r) => r.id === id);
      if (!row) return;
      if (selectedId === id) hideCard();
      else if (selectedId === null) showCard(row);
      else {
        setSelectedId(id);
        setCardRow(row);
      }
    },
    [rows, selectedId, showCard, hideCard],
  );

  // Tapping the shown card opens that session's review (same as Home/History rows).
  const openReview = useCallback((row: MetricTrendRow) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    enterFlow({
      pathname: REVIEW_ROUTES[row.mode],
      params: { sessionId: row.id, title: sessionTitle(row) },
    });
  }, []);

  // Called from the metric chip row (Chip fires the press haptic itself, so no haptic
  // here). The page/mode is kept: rows AND buckets carry all four metrics, so a metric
  // switch is local (no refetch) in either mode. No-ops on re-selecting the current metric
  // (like selectMode) so re-tapping the active chip doesn't collapse an open card.
  const selectMetric = (id: MetricId) => {
    if (id === selectedMetric) return;
    if (selectedId !== null) hideCard(); // switching metric slides the open card up
    setSelectedMetric(id);
  };

  // Swap between the paged Recent view and the all-time line. The open session card is a
  // Recent-only affordance, so close it on switch. All-time is fetched LAZILY (only when
  // opened — never on a Recent-only session), and refetched on EVERY switch into it so a
  // session added/deleted while in Recent is reflected (keep-last → no skeleton flash if
  // buckets are already loaded). No haptic here — the sheet's option row fires it.
  const selectMode = (mode: ChartMode) => {
    if (mode === chartMode) return;
    if (selectedId !== null) hideCard();
    setChartMode(mode);
    if (mode === 'allTime') loadHistory();
  };

  // Page the chart window: Back = older sessions, Forward = newer. The selected
  // session won't be on the new page, so an open card slides up (like a metric
  // switch). Taps are ignored while a fetch is in flight (see inFlightRef) — the
  // grey-out styling comes only from hasOlder/page, so nothing flickers.
  const goOlder = useCallback(() => {
    if (inFlightRef.current || !hasOlder) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (selectedId !== null) hideCard();
    loadPage(pageRef.current + 1);
  }, [hasOlder, selectedId, hideCard, loadPage]);

  const goNewer = useCallback(() => {
    if (inFlightRef.current || pageRef.current === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (selectedId !== null) hideCard();
    loadPage(pageRef.current - 1);
  }, [selectedId, hideCard, loadPage]);

  // The clip container's height animates 0 ↔ (card height + the gap to the selector), so
  // the selector — and any future content below — reflows in sync with the reveal. The
  // inner view translates by its FULL height in lockstep (at 0 it sits entirely above the
  // clip window; at 1 it's in place), so the content genuinely RIDES DOWN with the reveal
  // — a transform, GPU-smooth — instead of being wiped in place by the clip edge (the old
  // 8px drift read as the content "teleporting"). Both styles share one `progress`, so
  // the container edge and the content move on exactly the same frame.
  const cardContainerStyle = useAnimatedStyle(() => ({
    height: progress.value * (cardHeight.value + CARD_GAP),
  }));
  const cardInnerStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (progress.value - 1) * cardHeight.value }],
  }));

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
          <View style={styles.chartSection}>
            {/* Chart controls: a horizontally-scrolling chip row. The options chip (left)
                opens the range picker; the four metric chips are single-select and drive
                the graph. Scrolls past the page padding so chips reach the screen edges. */}
            {rows !== null && sessionCount > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipScroll}
                contentContainerStyle={styles.chipRow}
              >
                <Chip
                  compact
                  filled
                  onPress={() => setOptionsVisible(true)}
                  accessibilityLabel="Chart options"
                >
                  {/* Off-white glyph — HERO_FILL is a dark surface, so the normal text
                      color reads on it (unlike the light-blue active fill). */}
                  <OptionsIcon color={colors.text} />
                </Chip>
                {/* Separates the action chip from the single-select metric group. */}
                <View style={styles.chipDivider} />
                {METRIC_IDS.map((id) => (
                  <Chip
                    key={id}
                    label={METRIC_CONFIGS[id].label}
                    active={id === selectedMetric}
                    onPress={() => selectMetric(id)}
                  />
                ))}
              </ScrollView>
            )}

            {chartMode === 'recent' ? (
              rows === null ? (
              error ? (
                // First load failed with nothing to show — tappable retry (a refetch
                // over already-loaded rows stays silent and keeps them).
                <Pressable
                  onPress={() => loadPage(pageRef.current)}
                  accessibilityRole="button"
                  accessibilityLabel="Couldn't load your progress. Tap to retry."
                  style={({ pressed }) => [styles.retryBlock, pressed && styles.pressedDim]}
                >
                  <Text style={styles.retryTitle}>Couldn&apos;t load your progress</Text>
                  <Text style={styles.retryHint}>Tap to retry</Text>
                </Pressable>
              ) : showSkeleton ? (
                // Chart-shaped skeleton (selector pills + dot scatter + pager footer)
                // instead of one grey box, so it reads as the chart loading and the
                // loading→loaded swap doesn't jump.
                <ChartSkeleton />
              ) : (
                <View style={styles.chartSpacer} />
              )
            ) : sessionCount === 0 ? (
              <Text style={styles.emptyLine}>Finish a practice and your progress will show up here.</Text>
            ) : (
              <>
                <MetricTrendChart
                  points={toChartPoints(rows, selectedMetric)}
                  config={METRIC_CONFIGS[selectedMetric]}
                  selectedId={selectedId}
                  onSelectPoint={onSelectPoint}
                />
                {/* Pager footer: oldest-shown date · Back/Forward arrows · newest-shown
                    date. Equal-flex side labels keep the arrow pair truly centered
                    regardless of label widths (same trick as the masthead sides). */}
                <View style={styles.pagerRow}>
                  <Text style={[styles.pagerDate, styles.pagerDateLeft]} numberOfLines={1}>
                    {formatTrendDate(rows[0].createdAt)}
                  </Text>
                  <View style={styles.pagerArrows}>
                    <Pressable
                      onPress={goOlder}
                      disabled={!hasOlder}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel="Older sessions"
                      accessibilityState={{ disabled: !hasOlder }}
                      style={({ pressed }) => [
                        styles.pagerBtn,
                        !hasOlder && styles.pagerBtnDisabled,
                        pressed && styles.pressedDim,
                      ]}
                    >
                      <ChevronLeftIcon size={18} color={colors.text} />
                    </Pressable>
                    <Pressable
                      onPress={goNewer}
                      disabled={page === 0}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel="Newer sessions"
                      accessibilityState={{ disabled: page === 0 }}
                      style={({ pressed }) => [
                        styles.pagerBtn,
                        page === 0 && styles.pagerBtnDisabled,
                        pressed && styles.pressedDim,
                      ]}
                    >
                      <ChevronRightIcon size={18} color={colors.text} />
                    </Pressable>
                  </View>
                  <Text style={[styles.pagerDate, styles.pagerDateRight]} numberOfLines={1}>
                    {formatTrendDate(rows[rows.length - 1].createdAt)}
                  </Text>
                </View>
                {/* Only when there's genuinely ONE session total — not just a
                    one-dot oldest page (e.g. an 11-session user's page 1). */}
                {sessionCount === 1 && page === 0 && !hasOlder && (
                  <Text style={styles.hint}>Practice again to see a trend.</Text>
                )}
              </>
              )
            ) : (
              /* ---- All-time: a non-interactive line of bucket-averaged progress ---- */
              history === null ? (
                historyError ? (
                  <Pressable
                    onPress={loadHistory}
                    accessibilityRole="button"
                    accessibilityLabel="Couldn't load your progress. Tap to retry."
                    style={({ pressed }) => [styles.retryBlock, pressed && styles.pressedDim]}
                  >
                    <Text style={styles.retryTitle}>Couldn&apos;t load your progress</Text>
                    <Text style={styles.retryHint}>Tap to retry</Text>
                  </Pressable>
                ) : showHistorySkeleton ? (
                  // No header placeholder — the real chart header is already visible
                  // above (all-time is reached only with sessions loaded).
                  <ChartSkeleton header={false} />
                ) : (
                  <View style={styles.chartSpacerNoChips} />
                )
              ) : history.buckets.length === 0 ? (
                <Text style={styles.emptyLine}>Finish a practice and your progress will show up here.</Text>
              ) : (
                <>
                  <MetricTrendChart
                    points={toChartPoints(history.buckets, selectedMetric)}
                    config={METRIC_CONFIGS[selectedMetric]}
                    showDots={false}
                  />
                  {/* Range/granularity footer (replaces the pager — no paging here):
                      earliest bucket date · granularity label · latest bucket date.
                      Reuses the pager shell so the side dates align to the plot edges. */}
                  <View style={styles.pagerRow}>
                    <Text style={[styles.pagerDate, styles.pagerDateLeft]} numberOfLines={1}>
                      {formatTrendDate(history.buckets[0].bucketStart)}
                    </Text>
                    <Text style={styles.rangeLabel} numberOfLines={1}>
                      {history.unit ? UNIT_LABEL[history.unit] : ''}
                    </Text>
                    <Text style={[styles.pagerDate, styles.pagerDateRight]} numberOfLines={1}>
                      {formatTrendDate(history.buckets[history.buckets.length - 1].bucketStart)}
                    </Text>
                  </View>
                  {history.buckets.length === 1 && (
                    <Text style={styles.hint}>Keep practicing to see your all-time trend.</Text>
                  )}
                </>
              )
            )}
          </View>

          {/* Everything below the graph. Outer wrapper has NO gap: the selected-session
              card clip stays mounted (collapsed to height 0) once a dot's been tapped,
              and a flex gap would add stray space on both sides of that 0-height child.
              The clip provides its OWN bottom space (CARD_GAP folded into its height) when
              expanded and collapses to nothing; the cards below sit directly beneath it. */}
          <View>
            {/* Selected session card: the clip's height animates (cardContainerStyle),
                sliding it down on show / up on hide (a swap keeps progress at 1 → no
                animation), pushing the cards below it. Tapping it opens the review. */}
            {cardRow && (
              <Animated.View style={[styles.cardClip, cardContainerStyle]}>
                <Animated.View
                  style={cardInnerStyle}
                  // Cache the card (incl. the SVG ScoreRing) as a bitmap so the reveal
                  // clips/translates a flat texture each frame instead of re-compositing
                  // the SVG — the content then moves as smoothly as the container edge.
                  // Safe here: the content is static during the animation (height is a
                  // shared value → no re-renders), so it rasterizes once and is reused.
                  shouldRasterizeIOS
                  onLayout={(e) => {
                    cardHeight.value = e.nativeEvent.layout.height;
                  }}
                >
                  <SelectedSessionCard
                    row={cardRow}
                    metric={selectedMetric}
                    onPress={() => openReview(cardRow)}
                  />
                </Animated.View>
              </Animated.View>
            )}

            {/* The stacked info cards, gapped between them (a null card renders nothing,
                so the gap doesn't leave a hole). */}
            <View style={styles.belowCards}>
              {/* "View All Sessions" — all-time totals + a tap through to /history. Shown
                  once stats load and there's ≥1 session; a shaped skeleton covers the load.
                  (Independent of the chart page — these are all-time numbers.) */}
              {stats !== null && stats.totalSessions > 0 ? (
                <ViewAllSessionsCard stats={stats} onPress={openAllSessions} />
              ) : stats === null && showStatsSkeleton ? (
                <ViewAllSkeleton />
              ) : null}

              {/* Custom Settings — the three practice-personalization pages (pace target,
                  custom filler words, focus). Each row opens its bottom-sheet modal. */}
              <CustomSettingsCard />
            </View>
          </View>
        </ScrollView>

        {/* Range picker. Metric selection moved to the chip row, so this sheet only holds
            Range. Stays open on select (the checkmark + graph update live behind it);
            dismiss by tapping outside or dragging down. */}
        <ChartOptionsSheet
          visible={optionsVisible}
          range={chartMode}
          onSelectRange={selectMode}
          onClose={() => setOptionsVisible(false)}
        />
    </View>
  );
}

// Pager footer date label: "May 24", with the year appended ("Dec 30, 2025") when it
// isn't the current year — paging can reach back into past years. Same short-month
// toLocaleDateString path as SessionCard's formatWhen (Hermes-safe).
function formatTrendDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(
    undefined,
    d.getFullYear() === new Date().getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' },
  );
}

// Total practice time from summed seconds → "3h 12m" / "12m" / "45s". Human, compact
// (the mm:ss formatTimestamp is for a single clip, not a running total).
function formatPracticeTime(totalSec: number): string {
  const total = Math.max(0, Math.round(totalSec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${total}s`;
}

// "View All Sessions" card below the graph: all-time totals (count + practice time) +
// a chevron; the whole card taps through to /history (the full session list).
function ViewAllSessionsCard({
  stats,
  onPress,
}: {
  stats: SessionStats;
  onPress: () => void;
}) {
  const countUnit = stats.totalSessions === 1 ? 'session' : 'sessions';
  const practiceTime = formatPracticeTime(stats.totalDurationSec);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // Include the totals in the label — a Pressable becomes one a11y element, so
      // VoiceOver would otherwise skip the inner numbers.
      accessibilityLabel={`View all sessions. ${stats.totalSessions} ${countUnit}, ${practiceTime} practiced.`}
      style={({ pressed }) => [styles.viewAllCard, pressed && styles.viewAllPressed]}
    >
      <View style={styles.viewAllHeader}>
        <Text style={styles.viewAllTitle}>View All Sessions</Text>
        <ChevronRightIcon size={20} color={colors.textMuted} />
      </View>
      <View style={styles.statsGrid}>
        <View style={styles.statCell}>
          <Text style={styles.statValue}>{stats.totalSessions}</Text>
          <Text style={styles.statLabel}>{countUnit}</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statValue}>{practiceTime}</Text>
          <Text style={styles.statLabel}>practiced</Text>
        </View>
      </View>
    </Pressable>
  );
}

// Skeleton for the View-All card — same card shell + title/chevron row + two stat
// cells, so it doesn't jump when the real numbers land.
function ViewAllSkeleton() {
  return (
    <View style={styles.viewAllCard}>
      <View style={styles.viewAllHeader}>
        <Skeleton width={140} height={18} />
        <Skeleton width={20} height={20} borderRadius={10} />
      </View>
      <View style={styles.statsGrid}>
        {[0, 1].map((i) => (
          <View key={i} style={styles.statCell}>
            <Skeleton width={56} height={26} />
            <Skeleton width={64} height={12} style={styles.statLabelSkeleton} />
          </View>
        ))}
      </View>
    </View>
  );
}

// "Custom Settings" card — the three practice-personalization pages, each row showing
// its current value (off the live auth profile) and opening its BOTTOM-SHEET modal
// (the top-level /pace-target · /custom-fillers · /practice-focus routes, the
// non-Settings presentation of the shared ProfilePageShell). Mirrors the Settings
// screen's Profile rows.
function CustomSettingsCard() {
  const { profile } = useAuth();
  const paceSummary = `${profile?.pace_target_low ?? 130}-${profile?.pace_target_high ?? 160} wpm`;
  const fillerCount = profile?.custom_fillers?.length ?? 0;
  const fillerSummary =
    fillerCount === 0 ? 'None' : fillerCount === 1 ? '1 word' : `${fillerCount} words`;
  const focusSummary = focusLabel(profile?.focus ?? null);

  const open = (href: Href) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    enterFlow(href);
  };

  return (
    <View style={styles.settingsCard}>
      <Text style={styles.settingsTitle}>Custom Settings</Text>
      <SettingRow label="Pace target" value={paceSummary} onPress={() => open('/pace-target')} />
      <SettingRow
        label="Custom filler words"
        value={fillerSummary}
        onPress={() => open('/custom-fillers')}
      />
      <SettingRow
        label="What you're working on"
        value={focusSummary}
        onPress={() => open('/practice-focus')}
      />
    </View>
  );
}

// One Custom-Settings row: label · current value · chevron; the whole row is the tap
// target. A top hairline separates it from the row (or the title) above.
function SettingRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      style={({ pressed }) => [styles.settingRow, pressed && styles.pressedDim]}
    >
      <Text style={styles.settingRowLabel}>{label}</Text>
      <View style={styles.settingRowRight}>
        <Text style={styles.settingRowValue} numberOfLines={1}>
          {value}
        </Text>
        <ChevronRightIcon size={18} color={colors.textMuted} />
      </View>
    </Pressable>
  );
}

// ====================================================
// Selected-session card — slides out under the graph when a dot is tapped, and opens that
// session's review. Profile-LOCAL on purpose: the shared SessionCard is also the Home feed
// row and every /history row, so restyling this one there would have changed both.
// It reuses the shared ScoreRing / FavoriteStar / sessionTitle / formatWhen, so a session
// still reads the same wherever it appears.
//
// It also closes a real gap in the chart: the Y axis is banded, not proportional, so the
// graph can never show a number. The card spells the selected metric out ("142 wpm").
// Suppressed for Score, where the ring already IS the number.
// ====================================================

function SelectedSessionCard({
  row,
  metric,
  onPress,
}: {
  row: MetricTrendRow;
  metric: MetricId;
  onPress: () => void;
}) {
  const line = metricLineFor(metric, row);

  // Same rule as the shared SessionCard: impromptu / debate / prep store a prompt-like line
  // (the question, the argued statement, the scenario) and show it as the subtitle;
  // explain/storytelling put their topic in the TITLE instead, so they'd just repeat it.
  const showPrompt =
    (row.mode === 'impromptu' || row.mode === 'debate' || row.mode === 'prep') && !!row.prompt;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${sessionTitle(row)}`}
      style={({ pressed }) => [styles.selCard, pressed && styles.selCardPressed]}
    >
      <View style={styles.selTop}>
        <ScoreRing score={row.score} />

        <View style={styles.selBody}>
          <View style={styles.selTitleRow}>
            <Text style={styles.selTitle} numberOfLines={1}>
              {sessionTitle(row)}
            </Text>
            {row.favorite ? <FavoriteStar /> : null}
          </View>

          {showPrompt && (
            <Text style={styles.selPrompt} numberOfLines={2}>
              {row.prompt}
            </Text>
          )}

          <Text style={styles.selMeta} numberOfLines={1}>
            {formatWhen(row.createdAt)} · {formatTimestamp(row.durationSec)}
          </Text>
        </View>

        <ChevronRightIcon size={18} color={colors.textSubtle} />
      </View>

      {/* The selected metric, rendered like a results/review MetricRow header — same icon,
          same title/score typography, same status coloring. No chevron: there's nothing to
          expand here, and the real expandable row is one tap away on the review screen. */}
      {line && (
        <View style={styles.selMetricRow}>
          <View style={styles.selMetricIcon}>{line.icon}</View>
          <View style={styles.selMetricText}>
            <Text style={styles.selMetricTitle}>{line.title}</Text>
            <Text style={styles.selMetricScore}>
              {line.parts.map((part, i) => (
                <Text key={i}>
                  {i > 0 && <Text> · </Text>}
                  <Text style={{ color: statusForeground(part.status) }}>{part.text}</Text>
                </Text>
              ))}
            </Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

/**
 * The selected metric as a results-page-style row: icon + title + status-colored score
 * parts. Score returns null — the ScoreRing already IS the score.
 *
 * NOTE on parity with the real results rows: the chart's RPC only carries pace (wpm),
 * fillers (per-minute DENSITY) and pauses (HESITATION count). It has no
 * `paceConsistency`, no raw `fillerCount`, and no intentional-pause count — so this can't
 * call `paceScoreParts`/`fillerScoreParts`/`pauseScoreParts` directly. It reproduces the
 * pace verdict exactly (that's just wpm against the session's own band) and, for the other
 * two, names the quantity the dot actually encodes.
 */
function metricLineFor(
  metric: MetricId,
  row: MetricTrendRow,
): { title: string; icon: ReactNode; parts: ScorePart[] } | null {
  const cfg = METRIC_CONFIGS[metric];

  if (metric === 'pace' && row.pace != null) {
    const low = row.paceLow ?? DEFAULT_PACE_TARGET.low;
    const high = row.paceHigh ?? DEFAULT_PACE_TARGET.high;
    const status = paceWpmStatus(row.pace, low, high);
    // Same wording as the results row's paceWpmLabel(); the verdict is just this session's
    // wpm against the band it was scored with.
    const verdict = row.pace < low ? 'A bit slow' : row.pace > high ? 'A bit fast' : 'Ideal Pace';
    return {
      title: 'Pace',
      icon: <BoltIcon color={colors.text} />,
      parts: [
        { text: verdict, status },
        { text: cfg.format(row.pace), status },
      ],
    };
  }

  if (metric === 'fillers' && row.fillers != null) {
    return {
      title: 'Filler Words',
      icon: <ChatDotsIcon color={colors.text} />,
      parts: [{ text: cfg.format(row.fillers), status: fillerStatus(row.fillers) }],
    };
  }

  if (metric === 'pauses' && row.pauses != null) {
    return {
      title: 'Pauses',
      icon: <PauseOutlineIcon color={colors.text} />,
      parts: [{ text: cfg.format(row.pauses), status: hesitationStatus(row.pauses) }],
    };
  }

  return null;
}

// Chart-shaped loading skeleton — mirrors the real layout (header · a scatter of dots
// over the plot area · the pager footer) so the loading state reads as "the chart is
// loading" rather than one grey box, and the loading→loaded swap doesn't jump.
// `header` draws the placeholder header row (metric+range labels left, options icon
// right) — true for the RECENT first load (the real header is hidden while rows === null),
// false for the ALL-TIME skeleton (the real header is already visible above it).
function ChartSkeleton({ header = true }: { header?: boolean }) {
  return (
    <View style={styles.skeletonBlock}>
      {header && (
        /* Header placeholder — mirrors the chip row (options chip + four metric chips). */
        <View style={styles.skeletonHeader}>
          <Skeleton width={44} height={36} borderRadius={18} />
          <Skeleton width={62} height={36} borderRadius={18} />
          <Skeleton width={58} height={36} borderRadius={18} />
          <Skeleton width={66} height={36} borderRadius={18} />
          <Skeleton width={70} height={36} borderRadius={18} />
        </View>
      )}

      {/* Plot area: one graph-shaped block matching the real chart's rounded plot rect
          (same vertical inset + corner radius), so the whole graph reads as loading rather
          than a scatter of placeholder dots. */}
      <View style={styles.skeletonChart}>
        <Skeleton width="100%" height={CHART_HEIGHT - 2 * PLOT_VINSET} borderRadius={PLOT_RADIUS} />
      </View>

      {/* Pager footer: date · circular arrow buttons · date, matching the real one. */}
      <View style={styles.pagerRow}>
        <View style={styles.skeletonDateSlot}>
          <Skeleton width={44} height={11} />
        </View>
        <View style={styles.pagerArrows}>
          <Skeleton width={32} height={32} borderRadius={16} />
          <Skeleton width={32} height={32} borderRadius={16} />
        </View>
        <View style={[styles.skeletonDateSlot, styles.skeletonDateSlotRight]}>
          <Skeleton width={44} height={11} />
        </View>
      </View>
    </View>
  );
}

// Heroicons chevrons — the chart pager's Back (older) / Forward (newer) arrows.
// Copied per-screen like the back-chevron/X convention (see CLAUDE.md).
function ChevronLeftIcon({ size = 22, color }: { size?: number; color: string }) {
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

function ChevronRightIcon({ size = 22, color }: { size?: number; color: string }) {
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

// ====================================================
// Local Chip — the same blue pill impromptu uses for its Focus/Time selectors (copied
// per-screen, like debate's stance chips). Pass `label` for a text chip or `children` for
// an icon; `compact` tightens the padding for icon-only chips. Fires its own press haptic,
// so callers must not add one.
// ====================================================

type ChipProps = {
  label?: string;
  children?: ReactNode;
  /** Selected state — paints the chip AND marks it selected for screen readers. */
  active?: boolean;
  /** Give the chip the neutral HERO_FILL instead of the flat unselected fill, WITHOUT
   *  marking it selected. For action chips (the options chip) that are always filled but
   *  aren't part of the single-select group — so they can't be mistaken for the active
   *  metric, which owns the blue. */
  filled?: boolean;
  compact?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
};

function Chip({
  label,
  children,
  active = false,
  filled = false,
  compact = false,
  onPress,
  accessibilityLabel,
}: ChipProps) {
  // Selected chips take the blue CTA gradient (the accent owns "selected"). A `filled`
  // action chip takes HERO_FILL — the app's neutral lifted-surface fill from the hero /
  // overall cards — so it reads as a button, not as the active metric. Everything else
  // gets the flat unselected fill.
  const gradient = active ? GRADIENT_ACTIVE : filled ? HERO_FILL : GRADIENT_INACTIVE;
  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [pressed && styles.chipPressed]}
    >
      <LinearGradient
        colors={gradient}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[styles.chip, compact && styles.chipCompact, active && styles.chipActive]}
      >
        {children ?? (
          <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
        )}
      </LinearGradient>
    </Pressable>
  );
}

// Heroicons "adjustments-horizontal" (sliders) — opens the chart-options picker. Same
// glyph /history uses for its filters.
function OptionsIcon({ size = 22, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// Heroicons "cog-6-tooth" (outline) — opens Settings. Duplicated per masthead, same
// as Home/Practice (a shared Masthead component could dedupe the three copies).
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
  // Equal-flex sides keep the title optically centered regardless of the streak
  // badge width (1- vs 3-digit count).
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

  // No card — the chart sits directly on the tab gradient so it can run the full
  // content width. Groups the header + chart + pager with a small gap.
  chartSection: {
    gap: spacing.sm,
  },
  // Chip row above the graph. The negative margin lets chips scroll to the screen edges past
  // scrollContent's horizontal padding; the content padding re-insets the first/last chip so
  // they line up with the rest of the page.
  chipScroll: {
    marginHorizontal: -spacing.xl,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  // Outline chips: a hairline rim on a barely-there wash, so an unselected chip reads as
  // chrome and the selected one owns the accent. Matches the chart's hairline plot border.
  chip: {
    paddingVertical: spacing.sm + 1,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  chipCompact: { paddingHorizontal: spacing.sm + 5 },
  // The selected chip owns the accent, so it gets an accent-tinted rim too.
  chipActive: { borderColor: 'rgba(168, 213, 255, 0.45)' },
  chipPressed: { opacity: 0.7 },
  // Same weight in BOTH states — swapping fontFamily on select would resize the chip and
  // reflow the horizontal scroll under the user's finger.
  chipText: {
    fontSize: fontSize.sm,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
  },
  chipTextActive: { color: colors.bg },
  // Separates the options chip (an action) from the metric group (a selection). Uses
  // textSubtle, not the `border` hairline: the chips' own rims are already `border`, so a
  // border-colored divider disappeared into them.
  chipDivider: {
    width: 1,
    height: 20,
    backgroundColor: colors.textSubtle,
    marginHorizontal: spacing.xs,
  },

  // Selected-session card — the app's standard elevated card shell (same fill, hairline
  // border and shadow as SessionCard), so it sits in the same family as every other card.
  selCard: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    boxShadow: BOX_SHADOW_ELEVATED,
  },
  selCardPressed: { opacity: 0.85 },
  // Top row: ring · title/prompt/meta · chevron.
  selTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  selBody: { flex: 1, gap: 2 },
  selTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  selTitle: {
    flexShrink: 1,
    fontSize: fontSize.md,
    fontFamily: fonts.medium,
    color: colors.text,
  },
  // The session's prompt / debated statement, as the subtitle. Matches SessionCard's.
  selPrompt: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    lineHeight: 20,
  },
  selMeta: {
    fontSize: fontSize.xs,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  // The selected metric, laid out like a results/review MetricRow header (icon · title +
  // status-colored score). Separated from the session summary by a hairline, the way the
  // results screen separates its metric rows. Styles below mirror MetricRow's
  // iconWrap / center / title / score so the two surfaces read identically.
  selMetricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  selMetricIcon: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selMetricText: { flex: 1 },
  selMetricTitle: {
    fontSize: fontSize.lg,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  selMetricScore: {
    fontSize: fontSize.sm,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
    marginTop: 2,
  },
  // The selected session card's clip — its height is animated, so overflow must hide
  // the card as it collapses.
  cardClip: {
    overflow: 'hidden',
  },
  // Reserve the full selector + chart + pager block during the sub-150ms window
  // before the skeleton (matches the skeleton's height), so nothing jumps when the
  // skeleton or the real content lands.
  chartSpacer: { height: LOADING_BLOCK_HEIGHT },
  // All-time pre-skeleton spacer — chips-less (the real chips render above it), so it
  // matches the chips-less all-time skeleton + loaded chart, no jump at 150ms.
  chartSpacerNoChips: { height: CHART_FOOTER_HEIGHT },

  // Pager footer under the chart: [oldest date] [back/forward arrows] [newest date].
  // Fixed height so the loading skeleton/spacer can reserve it exactly. Content is
  // TOP-aligned so the dates + arrows sit right under the graph; the buttons still
  // fill the 44pt height (they pad downward — see pagerBtn), so the tap target is
  // unchanged while the visible glyphs ride up close to the chart.
  pagerRow: {
    height: PAGER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Equal-flex side labels center the arrow cluster regardless of label widths
  // (same trick as headerSide above). Inset by PLOT_INSET so the date text aligns
  // to the graph's PLOT edges (where the bands visibly start/end), not the container
  // edges — the left date's left edge and the right date's right edge sit flush with
  // the graph border.
  pagerDate: {
    flex: 1,
    fontSize: fontSize.xs,
    fontFamily: fonts.medium,
    color: colors.text,
    letterSpacing: 0.2,
  },
  pagerDateLeft: {
    paddingLeft: PLOT_INSET,
  },
  pagerDateRight: {
    textAlign: 'right',
    paddingRight: PLOT_INSET,
  },
  // All-time footer center label (granularity) — sits between the equal-flex date
  // labels (so it stays centered) and top-aligns like the pager chevrons.
  rangeLabel: {
    fontSize: fontSize.xs,
    fontFamily: fonts.medium,
    color: colors.textMuted,
    letterSpacing: 0.2,
  },
  pagerArrows: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  // A real button shell rather than a bare glyph, so the disabled state reads as "button
  // off" instead of "icon faded". 32pt circle + hitSlop 6 = a 44pt touch target that stays
  // INSIDE the 44pt row, so it can't be clipped the way a larger hitSlop overhang would be.
  pagerBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Grey-out at the ends. The in-flight tap ignore is behavior-only — no style — so
  // paging never flickers.
  pagerBtnDisabled: {
    opacity: 0.35,
  },
  emptyLine: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  hint: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
  },
  retryBlock: {
    paddingVertical: spacing.xl,
    gap: 2,
    alignItems: 'center',
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
  pressedDim: { opacity: 0.6 },

  // ChartSkeleton — mirrors the selector + chart + footer vertical layout with the
  // same section gap, so it occupies LOADING_BLOCK_HEIGHT and swaps to real content
  // without a jump.
  skeletonBlock: {
    gap: spacing.sm,
  },
  // Header placeholder (matches the real chart header: label stack left, icon right).
  skeletonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  // Holds the single plot-shaped block. Vertically centered so the block's top/bottom gap
  // equals the chart's PLOT_VINSET, and horizontally inset by PLOT_INSET, so the skeleton
  // rect lands exactly where the real plot rect draws.
  skeletonChart: {
    height: CHART_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: PLOT_INSET,
  },
  // Match the real pager's flex-1 date slots (right one right-aligned), top-padded to
  // sit at the top of the row and edge-inset by PLOT_INSET so the placeholder dates
  // align to the plot edges just like the real ones (no shift on load).
  skeletonDateSlot: {
    flex: 1,
    paddingTop: 4,
    paddingHorizontal: PLOT_INSET,
  },
  skeletonDateSlotRight: {
    alignItems: 'flex-end',
  },

  // "View All Sessions" card — elevated card matching SessionCard, tap → /history.
  viewAllCard: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    boxShadow: BOX_SHADOW_ELEVATED,
  },
  viewAllPressed: { opacity: 0.7 },
  viewAllHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  viewAllTitle: {
    fontSize: fontSize.md,
    fontFamily: fonts.medium,
    color: colors.text,
  },
  // Two stat cells split the width (value + label), matching OverallCard's stat look.
  statsGrid: {
    flexDirection: 'row',
  },
  statCell: {
    flex: 1,
  },
  statValue: {
    fontSize: fontSize.xxl,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: fontSize.xxl * 1.1,
  },
  statLabel: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 4,
  },
  statLabelSkeleton: { marginTop: 6 },

  // Gap between the stacked cards below the graph (View All + Custom Settings). A null
  // card renders nothing, so this leaves no hole when one is absent.
  belowCards: { gap: spacing.md },

  // "Custom Settings" card — frameless grouped list (title + hairline-divided rows),
  // matching the Settings screen's Profile card. overflow hidden clips the row press
  // highlights + hairlines to the card radius.
  settingsCard: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    boxShadow: BOX_SHADOW_ELEVATED,
    overflow: 'hidden',
  },
  settingsTitle: {
    fontSize: fontSize.md,
    fontFamily: fonts.medium,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  // Each row carries the `lg` inset + a top hairline (so the divider reaches the card
  // edges), separating it from the row — or the title — above.
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  settingRowLabel: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  // Right side shrinks + truncates so a long value (a focus label) can't shove the
  // label off the left edge.
  settingRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
    marginLeft: spacing.md,
  },
  settingRowValue: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    flexShrink: 1,
  },
});

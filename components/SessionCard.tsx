// Shared presentational card for one practice session, used by the History
// screen and the Home "Session History" card. Purely presentational: the parent
// owns press/long-press behavior. In `/history`'s multi-select edit mode it can
// show a leading selection circle (`selectable` + `selected`); the parent maps
// the row press to "toggle selection" in that mode.

import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { colors, fontSize, fonts, radius, spacing, BOX_SHADOW_ELEVATED } from '../lib/theme';
import { ANIM_EASING } from '../lib/animation';
import { ScoreRing, SCORE_RING_SIZE } from './ScoreRing';
import { Skeleton } from './Skeleton';
import { formatTimestamp } from '../lib/metrics';
import type { SessionListItem } from '../lib/sessions';

const CIRCLE_SIZE = 24;
// Circle + the gap before the content; the slot animates 0 → this on enter.
const CIRCLE_SLOT = CIRCLE_SIZE + spacing.md;
// A bit slower than the shared ANIM_DURATION (280) so the slot shift + the
// circle fade read clearly on both enter and exit.
const SELECT_ANIM_DURATION = 380;

export const MODE_LABEL: Record<SessionListItem['mode'], string> = {
  impromptu: 'Impromptu',
  tto: '3-2-1 Framework',
  explain: 'Explain',
  storytelling: 'Storytelling',
  debate: 'Debate',
  prep: 'PREP',
  vocab: 'Vocabulary',
};

// Per-mode default session TITLE when the user hasn't set a custom one. Computed
// at read time (never stored), so renaming a mode updates every past session's
// title everywhere — no data migration. Distinct from MODE_LABEL: that's the
// mode's NAME (used by the filter sheet); this is the session's display title.
export const DEFAULT_TITLE: Record<SessionListItem['mode'], string> = {
  impromptu: 'Impromptu Result',
  tto: '3-2-1 Result',
  explain: 'Explanation Result',
  storytelling: 'Story Result',
  debate: 'Debate Result',
  prep: 'PREP Result',
  vocab: 'Vocabulary', // fallback only — custom_title is always the word
};

// The title to show for a session: the user's custom title, else the per-mode
// default. One source for the card, the review header, etc.
export function sessionTitle(item: Pick<SessionListItem, 'mode' | 'customTitle'>): string {
  return item.customTitle ?? DEFAULT_TITLE[item.mode];
}

// Relative date: "Just now" / "12m ago" / "3h ago" / "Yesterday" /
// "Tuesday" (within a week) / "May 24" (older).
export function formatWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.max(0, (Date.now() - then) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const d = new Date(iso);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';

  if (diffHr < 24 * 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export type SessionCardVariant = 'card' | 'flat';

type SessionCardProps = {
  item: SessionListItem;
  onPress: () => void;
  // Optional: /history wires long-press → delete; the Home card is tap-only.
  onLongPress?: () => void;
  // 'card' (default): self-contained card. 'flat': no shell, for stacking
  // inside one parent card separated by hairline dividers.
  variant?: SessionCardVariant;
  showDivider?: boolean; // flat only: top hairline when this isn't the first row
  // Multi-select mode (/history): show a leading selection circle. The parent
  // maps onPress to "toggle selection" while selectable.
  selectable?: boolean;
  selected?: boolean;
  // Trailing right chevron — a "this row navigates" affordance. Opt-in (default
  // off) so it only shows where wanted (the Profile graph's selected-session card);
  // Home/History rows stay unchanged.
  trailingChevron?: boolean;
};

export function SessionCard({
  item,
  onPress,
  onLongPress,
  variant = 'card',
  showDivider = false,
  selectable = false,
  selected = false,
  trailingChevron = false,
}: SessionCardProps) {
  // Impromptu / Debate / PREP / Explain store a prompt-like line in `prompt` (the question,
  // the argued statement, the case scenario, the topic to explain) and show it as the
  // subtitle; storytelling puts its topic in the title instead, so it doesn't.
  const showPrompt =
    (item.mode === 'impromptu' ||
      item.mode === 'debate' ||
      item.mode === 'prep' ||
      item.mode === 'explain') &&
    !!item.prompt;
  const isFlat = variant === 'flat';

  // Animate the selection circle in/out: its slot widens 0 → CIRCLE_SLOT (which
  // reflows the row's content to the right) and the circle fades in; reverses
  // on exit. Always rendered (width 0 when not selectable) so it can animate.
  const p = useSharedValue(selectable ? 1 : 0);
  useEffect(() => {
    p.value = withTiming(selectable ? 1 : 0, {
      duration: SELECT_ANIM_DURATION,
      easing: ANIM_EASING,
    });
  }, [selectable, p]);
  const circleStyle = useAnimatedStyle(() => ({
    width: p.value * CIRCLE_SLOT,
    // Fade leads the slot a touch (full by ~70% open; gone by ~30% closed) so
    // the circle clearly fades in/out rather than just being clipped.
    opacity: Math.min(1, p.value / 0.7),
  }));

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      style={({ pressed }) => [
        isFlat ? styles.rowFlat : styles.card,
        isFlat && showDivider && styles.rowDivider,
        pressed && (isFlat ? styles.rowPressed : styles.cardPressed),
      ]}
    >
      <View style={styles.rowBody}>
        <Animated.View style={[styles.circleWrap, circleStyle]}>
          <SelectionCircle selected={selected} />
        </Animated.View>

        {/* Leading score ring (matches the Home Recent feed) — carries the score
            color + number, replacing the old right-aligned "x / 10". */}
        <View style={styles.ringWrap}>
          <ScoreRing score={item.score} />
        </View>

        <View style={styles.rowContent}>
          <View style={styles.titleRow}>
            <Text style={styles.titleText} numberOfLines={1}>
              {sessionTitle(item)}
            </Text>
            {/* Gold star after the title when favorited — indicator only. */}
            {item.favorite ? <FavoriteStar /> : null}
          </View>

          {showPrompt && (
            <Text style={styles.prompt} numberOfLines={2}>
              {item.prompt}
            </Text>
          )}

          <Text style={styles.meta}>
            {formatWhen(item.createdAt)} · {formatTimestamp(item.durationSec)}
          </Text>
        </View>

        {/* Trailing chevron (opt-in): rowContent is flex:1, so this pins to the
            right edge as a "tap opens this session" affordance. */}
        {trailingChevron && (
          <View style={styles.chevronWrap}>
            <ChevronRight />
          </View>
        )}
      </View>
    </Pressable>
  );
}

// Trailing "opens this row" chevron (Heroicons chevron-right, outline).
function ChevronRight({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="m8.25 4.5 7.5 7.5-7.5 7.5"
        stroke={colors.textSubtle}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// Small solid star after the mode label when the session is favorited. Indicator
// only — no glow/animation (that's the review-screen header star); shares the
// theme's favorite gold (Heroicons v2 star, solid).
export function FavoriteStar({ size = 14 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={colors.star}>
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z"
      />
    </Svg>
  );
}

// Leading selection indicator. Filled accent check (Heroicons solid) when
// selected; a hollow ring otherwise.
function SelectionCircle({ selected }: { selected: boolean }) {
  if (selected) {
    return (
      <Svg width={24} height={24} viewBox="0 0 24 24" fill={colors.accent}>
        <Path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z"
        />
      </Svg>
    );
  }
  return <View style={styles.circleEmpty} />;
}

// Placeholder row shown while the list loads. Reuses the SAME flat-row styles
// so the loading→loaded swap doesn't shift.
export function SessionCardSkeleton({ showDivider = false }: { showDivider?: boolean }) {
  return (
    <View style={[styles.rowFlat, showDivider && styles.rowDivider]}>
      {/* rowBody (a row) is required so rowContent's `flex: 1` fills WIDTH, not
          height — placing rowContent directly in the column rowFlat collapses
          the row to ~0 height. */}
      <View style={styles.rowBody}>
        <Skeleton
          width={SCORE_RING_SIZE}
          height={SCORE_RING_SIZE}
          borderRadius={SCORE_RING_SIZE / 2}
          style={styles.ringWrap}
        />
        <View style={styles.rowContent}>
          <Skeleton width={140} height={16} />
          <Skeleton width={120} height={12} style={styles.metaSkeleton} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    boxShadow: BOX_SHADOW_ELEVATED,
  },
  cardPressed: { opacity: 0.7 },
  // Flat variant: no shell — stacks inside a parent card, separated by a top
  // hairline divider (suppressed on the first row). Parent card owns the
  // horizontal padding; the row owns its vertical padding.
  rowFlat: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg, // text inset; row itself spans the full card
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowPressed: { opacity: 0.6 },
  // Row layout: optional leading selection circle + the content column.
  rowBody: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Animated selection-circle slot. overflow hidden so the circle reveals as the
  // slot widens; left-aligned so the trailing gap (CIRCLE_SLOT − circle) sits
  // before the content. width/opacity are animated inline.
  circleWrap: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Leading score ring + the gap before the content column (matches the Home
  // Recent feed's ring → text spacing).
  ringWrap: {
    marginRight: spacing.md,
  },
  rowContent: {
    flex: 1,
    gap: spacing.xs,
  },
  // Trailing chevron: sits after the flex:1 content, so it hugs the right edge; a
  // small left gap keeps it off the text.
  chevronWrap: {
    marginLeft: spacing.sm,
  },
  circleEmpty: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.textSubtle,
  },
  // Session title (custom or default) + the favorite star. flexShrink + titleText
  // numberOfLines=1 so a long custom title truncates rather than shoving the star.
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
  },
  titleText: {
    flexShrink: 1,
    fontSize: fontSize.md,
    fontFamily: fonts.medium,
    color: colors.text,
  },
  prompt: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    lineHeight: 20,
  },
  meta: {
    fontSize: fontSize.xs,
    fontFamily: fonts.regular,
    color: colors.textSubtle,
    marginTop: 2,
  },
  // Matches the real meta's marginTop so the skeleton's vertical rhythm lines up.
  metaSkeleton: { marginTop: 2 },
});
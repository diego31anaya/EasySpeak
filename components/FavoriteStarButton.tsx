// components/FavoriteStarButton.tsx
//
// Header "save to favorites" star for the review screens. Sits in the header's
// top-right slot (same 36px box as the back chevron on the left, so the title
// stays centered). Outline (yellow stroke) when not a favorite; solid yellow
// when it is — Heroicons v2 star (outline + solid).
//
// Polish (no LinearGradient — it muddies at icon size):
//   - a soft yellow GLOW when favorited (shadowColor, like AiOrb) so the active
//     state reads as "lit", not just filled. iOS-only, same as the orb's bloom.
//   - a SMALL bounce on toggle (gentle overshoot + damped spring) for feedback.
//
// Persisted: takes the session's id + its current favorite value, and writes
// changes back via setFavorite (lib/sessions, backed by the `favorite` column).
// The toggle is optimistic — it flips the star immediately and reverts if the
// write fails. Mount it only once the session is loaded (so initialFavorite is
// the real value); the review screens render a spacer in its place while loading.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';

import { colors } from '../lib/theme';
import { setFavorite } from '../lib/sessions';

// Favorite gold lives in the theme now (reused by the session-card star).
const STAR_YELLOW = colors.star;

// Collapse a tap-burst into one write: each tap (re)starts this timer; the write
// fires once taps settle. Short enough to persist promptly if you stay on screen,
// and the unmount flush below catches a faster exit.
const SAVE_DEBOUNCE_MS = 600;

type FavoriteStarButtonProps = {
  sessionId: string;
  // The session's favorite value — only read once `ready` flips true.
  favorite: boolean;
  // False while the session is still loading: the star renders as a dimmed,
  // non-interactive outline, then brightens (and fills if favorited) on ready.
  ready: boolean;
};

export function FavoriteStarButton({ sessionId, favorite, ready }: FavoriteStarButtonProps) {
  // Start unfavorited/dim; the real value is applied once `ready` (see effect).
  const [isFavorite, setIsFavorite] = useState(false);
  // desiredRef = latest tapped value; persistedRef = what we believe is in the DB.
  // We only write when they differ, so spamming the star is at most one call, and
  // ending where you started is zero. Seeded from `favorite` on ready.
  const desiredRef = useRef(false);
  const persistedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initedRef = useRef(false);
  const scale = useSharedValue(1);
  // 0 while loading (dim, inert) → 1 when ready (full opacity, interactive).
  const readyProgress = useSharedValue(0);

  const animStyle = useAnimatedStyle(() => ({
    opacity: 0.4 + readyProgress.value * 0.6,
    transform: [{ scale: scale.value }],
  }));

  // Write the latest value if it differs from what's persisted; called by the
  // debounce timer and on unmount.
  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const next = desiredRef.current;
    if (next === persistedRef.current) return; // no net change — no call
    setFavorite(sessionId, next)
      .then(() => {
        persistedRef.current = next;
      })
      .catch((e) => {
        // Leave persistedRef so a later flush retries; if the write never lands,
        // the star self-corrects from getSession next time the session opens.
        console.warn('[favorite] save failed:', e);
      });
  }, [sessionId]);

  const toggle = () => {
    const next = !isFavorite;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Small bounce: a gentle overshoot, then a well-damped settle (low overshoot
    // + high damping = a little life, not a big pop). Tune peak/damping to taste.
    scale.value = withSequence(
      withTiming(1.12, { duration: 90, easing: Easing.out(Easing.quad) }),
      withSpring(1, { damping: 12, stiffness: 220 }),
    );
    setIsFavorite(next); // optimistic — instant, regardless of the network
    desiredRef.current = next;
    // Debounce the write: restart the timer each tap so a burst becomes one call.
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  };

  // When the session resolves, seed the real value ONCE (state + the write refs)
  // and brighten the star in — filling to solid/glow if it's a favorite. Guarded
  // so it can't clobber a user's toggle on a later re-render.
  useEffect(() => {
    if (ready && !initedRef.current) {
      initedRef.current = true;
      setIsFavorite(favorite);
      desiredRef.current = favorite;
      persistedRef.current = favorite;
      readyProgress.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) });
    }
  }, [ready, favorite, readyProgress]);

  // Backstop: persist immediately on leave (unmount) so a quick exit still saves.
  useEffect(() => () => flush(), [flush]);

  return (
    <Pressable
      onPress={toggle}
      disabled={!ready}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityState={{ selected: isFavorite, disabled: !ready }}
      accessibilityLabel={isFavorite ? 'Remove from favorites' : 'Save to favorites'}
      style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
    >
      {/* Glow only when favorited — the inactive outline stays clean + inert. */}
      <Animated.View style={[isFavorite && styles.glow, animStyle]}>
        <StarIcon filled={isFavorite} color={STAR_YELLOW} />
      </Animated.View>
    </Pressable>
  );
}

function StarIcon({
  filled,
  color,
  size = 24,
}: {
  filled: boolean;
  color: string;
  size?: number;
}) {
  if (filled) {
    // Heroicons v2 — star (solid).
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <Path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z"
        />
      </Svg>
    );
  }
  // Heroicons v2 — star (outline).
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.563.563 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5z"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  // Mirrors the back button's 36px box, but right-aligned so the icon hugs the
  // screen edge and the centered title stays symmetric.
  btn: {
    width: 36,
    height: 36,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  // Soft yellow bloom around the filled star (mirrors AiOrb's glow). iOS shows
  // the halo; Android shows just the star.
  glow: {
    shadowColor: STAR_YELLOW,
    shadowOpacity: 0.8,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 0 },
  },
});
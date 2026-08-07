// components/AudioPlayback.tsx
//
// Audio scrubber with accent-blue track fill, accent-blue playhead dot, and
// a centered three-button transport (replay-5, play/pause, forward-5).
//
// Variants:
//   - 'card' (default): self-contained surface — surfaceElevated background,
//     border, rounded corners, internal padding. Used in impromptu-results.
//   - 'flat': no surface chrome. Sits inline within a parent card that owns
//     padding (e.g. TTO results round cards).
//
// Color note: the track fill, playhead dot, and play-button background all
// use colors.accent (#A8D5FF). The play/pause glyph stays colors.bg so the
// icon reads cleanly on the blue button.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import Svg, { Path, Text as SvgText } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, spacing, fontSize, fonts, radius, GRADIENT_ACTIVE } from '../lib/theme';
import { formatTimestamp } from '../lib/metrics';
import { ANIM_DURATION, ANIM_EASING } from '../lib/animation';

// Matches the Try again button gradient on results screens. Top-to-bottom on
// the play button; over 44px of height the effect is subtle by design.
// --- Constants ---------------------------------------------------------------

const DOT_SIZE = 18;
const TRACK_HEIGHT = 3;
const HIT_SLOP = 20; // vertical pad on the gesture surface for an easier grab
const SEEK_DELTA_SEC = 5;
// Drift tolerance — if the dot is within this many seconds of the player's
// reported time, we trust the animation and skip the correction. 0.4s is
// wider than the worst status-update jitter but tighter than anything
// perceptible as "out of sync".
const DRIFT_TOLERANCE_SEC = 0.4;

// --- Public types ------------------------------------------------------------

export type AudioPlaybackHandle = {
  seekTo: (timeSec: number) => void;
  pause: () => void;
};

export type AudioPlaybackVariant = 'card' | 'flat';

type AudioPlaybackProps = {
  uri: string;
  variant?: AudioPlaybackVariant;
  onPlay?: () => void;
  // When false, the chrome renders (constant height — no layout change) but the
  // native player isn't allocated yet. Flip true after the screen settles so
  // constructing the AVPlayer for the remote URL doesn't block the mount frame.
  active?: boolean;
};

// --- Component ---------------------------------------------------------------

export const AudioPlayback = forwardRef<AudioPlaybackHandle, AudioPlaybackProps>(
  ({ uri, variant = 'card', onPlay, active = true }, ref) => {
    // Null source defers AVPlayer construction until `active` (matches
    // use-recording's `useAudioPlayer(uri ? { uri } : null)` pattern). The
    // chrome below renders regardless, at constant height, so there's no shift.
    const player = useAudioPlayer(active ? { uri } : null);
    const status = useAudioPlayerStatus(player);

    const [trackWidth, setTrackWidth] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [dragTime, setDragTime] = useState(0);

    // Refs so the PanResponder closure (created once) reads the latest values.
    const pendingSeekRef = useRef<number | null>(null);
    const trackWidthRef = useRef(0);
    const durationRef = useRef(0);

    useImperativeHandle(
      ref,
      () => ({
        seekTo: (timeSec: number) => {
          const d = durationRef.current;
          const clamped = Math.max(0, Math.min(d, timeSec));
          player.seekTo(clamped);
        },
        pause: () => {
          player.pause();
        }
      }),
      [player],
    );

    useEffect(() => {
      trackWidthRef.current = trackWidth;
    }, [trackWidth]);

    useEffect(() => {
      durationRef.current = status.duration ?? 0;
    }, [status.duration]);

    // When playback finishes naturally, reset to the start so the next press
    // replays from 0 instead of being stuck at the end.
    useEffect(() => {
      if (status.didJustFinish) {
        player.pause();
        player.seekTo(0);
      }
    }, [status.didJustFinish, player]);

    // After a drag-release seek, hold isDragging=true (so dragTime drives the
    // dot) until the player's reported time catches up to the seek target.
    // Without this, there's a 1–2 frame window where the dot snaps back to
    // the pre-seek position before the player updates.
    useEffect(() => {
      const target = pendingSeekRef.current;
      if (target === null) return;
      const reported = status.currentTime ?? 0;
      if (Math.abs(reported - target) < 0.25) {
        pendingSeekRef.current = null;
        setIsDragging(false);
      }
    }, [status.currentTime]);

    const duration = status.duration ?? 0;
    const currentTime = isDragging ? dragTime : (status.currentTime ?? 0);

    // Shared value drives the dot/fill at 60fps. We push targets into it from
    // React effects below; the UI thread interpolates between them.
    const progressSV = useSharedValue(0);

    const fillStyle = useAnimatedStyle(() => ({
      width: progressSV.value * trackWidth,
    }));

    const dotStyle = useAnimatedStyle(() => ({
      left: progressSV.value * trackWidth - DOT_SIZE / 2,
    }));

    // While playing, run a single long animation from the current dot position
    // to the end of the track. Status updates only intervene if the dot has
    // drifted noticeably (after a seek, pause, or device hiccup). While
    // dragging or paused, snap.
    useEffect(() => {
      if (duration <= 0) {
        progressSV.value = 0;
        return;
      }

      if (isDragging) {
        progressSV.value = Math.min(1, dragTime / duration);
        return;
      }

      const reported = status.currentTime ?? 0;

      if (!status.playing) {
        progressSV.value = Math.min(1, reported / duration);
        return;
      }

      // Playing. Figure out where the dot currently thinks it is in seconds.
      const dotSeconds = progressSV.value * duration;
      const drift = Math.abs(dotSeconds - reported);

      if (drift > DRIFT_TOLERANCE_SEC) {
        // We're out of sync (just resumed, just seeked, just mounted). Snap
        // to the reported position, then sweep from there to the end at
        // real-time speed.
        progressSV.value = Math.min(1, reported / duration);
      }

      const remainingSec = duration - progressSV.value * duration;
      if (remainingSec > 0) {
        progressSV.value = withTiming(1, {
          duration: remainingSec * 1000,
          easing: Easing.linear,
        });
      }
      // Note: we deliberately don't depend on status.currentTime here.
      // Including it would re-trigger this effect on every status emit and
      // cancel/restart the long sweep — which is exactly the jump→smooth→jump
      // pattern we're trying to fix.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status.playing, isDragging, dragTime, duration]);

    // Lightweight drift correction. Runs on every status emit, but only takes
    // action when the dot has visibly diverged from reality.
    useEffect(() => {
      if (isDragging || duration <= 0) return;

      const reported = status.currentTime ?? 0;
      const dotSeconds = progressSV.value * duration;
      const drift = Math.abs(dotSeconds - reported);

      if (drift <= DRIFT_TOLERANCE_SEC) return;

      progressSV.value = Math.min(1, reported / duration);

      if (status.playing) {
        const remainingSec = duration - reported;
        if (remainingSec > 0) {
          progressSV.value = withTiming(1, {
            duration: remainingSec * 1000,
            easing: Easing.linear,
          });
        }
      }
    }, [status.currentTime, status.playing, isDragging, duration, progressSV]);

    const xToTime = (x: number): number => {
      const w = trackWidthRef.current;
      const d = durationRef.current;
      if (w <= 0 || d <= 0) return 0;
      const clampedX = Math.max(0, Math.min(w, x));
      return (clampedX / w) * d;
    };

    // Pan gesture. activeOffsetX([-5, 5]) claims horizontal movement >5px;
    // failOffsetY([-15, 15]) hands back to the parent ScrollView if vertical
    // wins first. .runOnJS(true) runs callbacks on the JS thread — fine for
    // a scrubber, and lets us call ref-reading helpers (xToTime) directly.
    const pan = Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-5, 5])
      .failOffsetY([-15, 15])
      .onStart(() => {
        setDragTime(status.currentTime ?? 0);
        setIsDragging(true);
      })
      .onUpdate((e) => {
        setDragTime(xToTime(e.x));
      })
      .onEnd((e) => {
        const t = xToTime(e.x);
        pendingSeekRef.current = t;
        setDragTime(t);
        player.seekTo(t);
      })
      .onFinalize(() => {
        if (pendingSeekRef.current === null) {
          setIsDragging(false);
        }
      });

    const togglePlay = () => {
      if (!active) return; // source is deferred; ignore taps until the player is live
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (status.playing) {
        player.pause();
      } else {
        player.play();
        onPlay?.();
      }
    };

    const skipBy = (delta: number) => {
      if (!active) return; // source is deferred; ignore taps until the player is live
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const d = durationRef.current;
      const next = Math.max(0, Math.min(d, (status.currentTime ?? 0) + delta));
      player.seekTo(next);
    };

    const onTrackLayout = (e: LayoutChangeEvent) => {
      setTrackWidth(e.nativeEvent.layout.width);
    };

    const totalLabel = formatTimestamp(duration);
    const containerStyle = variant === 'flat' ? null : styles.containerCard;

    return (
      <Animated.View
        style={containerStyle}
        layout={LinearTransition.duration(ANIM_DURATION).easing(ANIM_EASING)}
      >
        <GestureDetector gesture={pan}>
          <View style={styles.trackHit} onLayout={onTrackLayout}>
            <View style={styles.track}>
              {trackWidth > 0 && (
                <Animated.View style={[styles.trackFill, fillStyle]} />
              )}
            </View>
            {trackWidth > 0 && (
              <Animated.View style={[styles.dot, dotStyle]}>
                <LinearGradient
                  colors={GRADIENT_ACTIVE}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={styles.dotFill}
                />
              </Animated.View>
            )}
          </View>
        </GestureDetector>

        <View style={styles.durationRow}>
          <Text style={styles.durationText}>{formatTimestamp(currentTime)}</Text>
          <Text style={styles.durationText}>{totalLabel}</Text>
        </View>

        {/* Transport: replay / play-pause / forward, centered below the track. */}
        <View style={styles.transportRow}>
          <Pressable
            onPress={() => skipBy(-SEEK_DELTA_SEC)}
            hitSlop={12}
            style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
          >
            <Replay5Icon color={colors.text} />
          </Pressable>

          <Pressable
            onPress={togglePlay}
            hitSlop={12}
            style={({ pressed }) => [pressed && styles.btnPressed]}
          >
            <LinearGradient
              colors={GRADIENT_ACTIVE}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={styles.playBtn}
            >
              {status.playing ? (
                <PauseIcon color={colors.bg} />
              ) : (
                <PlayIcon color={colors.bg} />
              )}
            </LinearGradient>
          </Pressable>

          <Pressable
            onPress={() => skipBy(SEEK_DELTA_SEC)}
            hitSlop={12}
            style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
          >
            <Forward5Icon color={colors.text} />
          </Pressable>
        </View>
      </Animated.View>
    );
  },
);

AudioPlayback.displayName = 'AudioPlayback';

// --- Local icons -------------------------------------------------------------
//
// Play/Pause are Heroicons solid. Replay5/Forward5 follow Material's
// replay_5 / forward_5 — a partial circular arrow with a "5" inside.

type IconProps = { size?: number; color: string };

function PlayIcon({ size = 22, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      {/* Nudged 1.5 units right for optical centering — a rightward triangle's
          visual mass sits at its base, so geometric centering reads as left-shifted. */}
      <Path
        transform="translate(1.5, 0)"
        d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 0 1 0 1.971L6.917 19.336c-.75.412-1.667-.13-1.667-.986V5.653Z"
      />
    </Svg>
  );
}

function PauseIcon({ size = 22, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M6.75 5.25a.75.75 0 0 1 .75-.75H9a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H7.5a.75.75 0 0 1-.75-.75V5.25Zm7.5 0A.75.75 0 0 1 15 4.5h1.5a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H15a.75.75 0 0 1-.75-.75V5.25Z" />
    </Svg>
  );
}

function Replay5Icon({ size = 24, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 5V2L7 6l5 4V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"
        fill={color}
      />
      <SvgText
        x={12}
        y={16}
        fill={color === colors.text ? colors.bg : colors.text}
        fontSize={8}
        fontFamily={fonts.semibold}
        textAnchor="middle"
      >
        5
      </SvgText>
    </Svg>
  );
}

function Forward5Icon({ size = 24, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 5V2l5 4-5 4V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"
        fill={color}
      />
      <SvgText
        x={12}
        y={16}
        fill={color === colors.text ? colors.bg : colors.text}
        fontSize={8}
        fontFamily={fonts.semibold}
        textAnchor="middle"
      >
        5
      </SvgText>
    </Svg>
  );
}

// --- Styles ------------------------------------------------------------------

const styles = StyleSheet.create({
  containerCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  // (no containerFlat — flat variant has zero chrome; the parent owns padding)

  // Transport: replay / play-pause / forward, grouped + centered under the
  // track. marginLeft mirrors durationRow's so the group's visual center
  // lands on the track's center (the track is inset DOT_SIZE/2 from the
  // parent's left to make room for the dot's overhang at progress=0).
  transportRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
    marginLeft: DOT_SIZE / 2,
    marginTop: spacing.md,
  },

  // Gesture surface — extends above and below the visible track so the dot
  // is comfortable to grab without making the line look thick.
  trackHit: {
    height: TRACK_HEIGHT + HIT_SLOP * 2,
    justifyContent: 'center',
    // Compensates for the dot's left overhang at progress=0 (the dot is
    // centered on the track's left edge, so it extends DOT_SIZE/2 left of
    // the track itself).
    marginLeft: DOT_SIZE / 2,
    // Pulls the timestamp row up; the hit-slop padding below the visible
    // track makes the natural gap feel too large otherwise.
    marginBottom: -HIT_SLOP / 2,
  },
  track: {
    height: TRACK_HEIGHT,
    backgroundColor: colors.border,
    borderRadius: TRACK_HEIGHT / 2,
    overflow: 'hidden',
  },
  // BLUE: track fill uses accent so it reads as a "play" affordance.
  trackFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.accent,
  },
  // BLUE: playhead dot. Gradient fill matches the play button.
  dot: {
    position: 'absolute',
    top: '50%',
    marginTop: -DOT_SIZE / 2,
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    overflow: 'hidden',
  },
  dotFill: {
    width: '100%',
    height: '100%',
  },

  durationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    // Matches trackHit's marginLeft so the current-time label sits below
    // the track's left edge; no marginRight so the total-time label sits
    // flush with the track's right edge.
    marginLeft: DOT_SIZE / 2,
    marginTop: spacing.sm,
  },
  durationText: {
    fontSize: fontSize.xs,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },

  btn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  btnPressed: { opacity: 0.6 },
  // Play button background. Sits in the middle of the transport row.
  // Gradient is applied by the LinearGradient wrapper using this same style.
  playBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    overflow: 'hidden',
  },
});
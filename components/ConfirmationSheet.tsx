// components/ConfirmationSheet.tsx
//
// Reusable slide-up confirmation. Replaces iOS Alert.alert for in-app
// confirmations (e.g. "Exit practice?"). Small floating box anchored to the
// bottom of the screen, full-screen backdrop fades in, taps outside the box
// dismiss via onCancel.
//
// Parent controls `visible`; this component handles the animation lifecycle.

import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, spacing, fontSize, fonts, radius, GRADIENT_ACTIVE } from '../lib/theme';
import { ANIM_DURATION, ANIM_EASING } from '../lib/animation';

// Drag-to-dismiss (matches FilterSheet): releasing past this distance (px) OR flicking faster
// than this velocity (px/s) closes the sheet — this fires CANCEL, never confirm; else springs back.
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;

type ConfirmationSheetProps = {
  visible: boolean;
  title: string;
  body?: string;
  cancelLabel?: string;
  confirmLabel: string;
  // When true, the confirm button is red (destructive). Otherwise it uses
  // the GRADIENT_ACTIVE pill style.
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmationSheet({
  visible,
  title,
  body,
  cancelLabel = 'Cancel',
  confirmLabel,
  destructive = false,
  onCancel,
  onConfirm,
}: ConfirmationSheetProps) {
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);
  const [shouldRender, setShouldRender] = useState(visible);
  // Measured height of the positioner (sheet + bottom inset). Must be a
  // shared value, not a ref — useAnimatedStyle's worklet runs on the UI
  // thread and can't read mutable React refs reliably.
  const sheetHeight = useSharedValue(0);
  // Live downward-drag offset, added on top of the open/close translateY.
  const dragY = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      dragY.value = 0; // reset a prior drag-dismiss so a reopen starts clean
      progress.value = withTiming(1, {
        duration: ANIM_DURATION,
        easing: ANIM_EASING,
      });
    } else {
      progress.value = withTiming(
        0,
        { duration: ANIM_DURATION, easing: ANIM_EASING },
        (finished) => {
          if (finished) scheduleOnRN(setShouldRender, false);
        },
      );
    }
  }, [visible, progress, dragY]);

  // Scrim fades as the sheet is dragged down (and with the open/close progress).
  const backdropStyle = useAnimatedStyle(() => {
    const h = sheetHeight.value || 1;
    const dragProgress = Math.min(dragY.value / h, 1);
    return { opacity: progress.value * 0.5 * (1 - dragProgress) };
  });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * sheetHeight.value + dragY.value }],
  }));

  // Drag DOWN anywhere on the box to dismiss — this fires CANCEL (never the confirm action).
  // activeOffsetY(10) claims only downward drags past ~10px, so taps on the buttons pass through.
  const pan = Gesture.Pan()
    .activeOffsetY(10)
    .onUpdate((e) => {
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      const dismiss =
        e.translationY > 0 && (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY);
      if (dismiss) {
        dragY.value = withTiming(
          sheetHeight.value,
          { duration: ANIM_DURATION, easing: ANIM_EASING },
          (finished) => {
            if (finished) scheduleOnRN(onCancel);
          },
        );
      } else {
        dragY.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });

  const handleCancel = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onCancel();
  };

  const handleConfirm = () => {
    Haptics.impactAsync(
      destructive
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light,
    );
    onConfirm();
  };

  if (!shouldRender) return null;

  return (
    <Modal transparent animationType="none" onRequestClose={onCancel}>
      {/* Modals render outside the app-root GestureHandlerRootView, so the drag gesture
          needs its own root here. */}
      <GestureHandlerRootView style={styles.root}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleCancel} />
      </Animated.View>

      {/* Drag down anywhere on the box to dismiss (= Cancel). */}
      <GestureDetector gesture={pan}>
      <Animated.View
        style={[
          styles.positioner,
          { bottom: spacing.lg + insets.bottom },
          sheetStyle,
        ]}
        onLayout={(e) => {
          sheetHeight.value = e.nativeEvent.layout.height + spacing.lg + insets.bottom;
        }}
      >
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          {body ? <Text style={styles.body}>{body}</Text> : null}

          <View style={styles.btnRow}>
            <Pressable
              onPress={handleCancel}
              style={({ pressed }) => [
                styles.cancelBtn,
                pressed && styles.btnPressed,
              ]}
            >
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </Pressable>

            {destructive ? (
              <Pressable
                onPress={handleConfirm}
                style={({ pressed }) => [
                  styles.destructiveBtn,
                  pressed && styles.btnPressed,
                ]}
              >
                <Text style={styles.destructiveText}>{confirmLabel}</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={handleConfirm}
                style={({ pressed }) => [pressed && styles.confirmBtnPressed]}
              >
                <LinearGradient
                  colors={GRADIENT_ACTIVE}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={styles.confirmBtn}
                >
                  <Text style={styles.confirmText}>{confirmLabel}</Text>
                </LinearGradient>
              </Pressable>
            )}
          </View>
        </View>
      </Animated.View>
      </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Fills the Modal so the gesture root + absolute children lay out correctly.
  root: { flex: 1 },
  backdrop: {
    backgroundColor: '#000',
  },
  positioner: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    // `bottom` is applied inline so it can include the safe-area inset.
  },
  sheet: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  title: {
    fontSize: fontSize.lg,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  body: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    lineHeight: 22,
    marginTop: spacing.sm,
  },
  btnRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  btnPressed: { opacity: 0.7 },
  // The gradient confirm matches the app's primary-CTA pressed feel (0.85); the
  // ghost cancel + destructive stay at 0.7.
  confirmBtnPressed: { opacity: 0.85 },
  // Cancel: ghost button — transparent with border, sits on the sheet's
  // surfaceElevated background without competing for attention.
  cancelBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontSize: fontSize.md,
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  // Destructive: red pill, mirrors the existing btnStop style in impromptu.tsx.
  destructiveBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destructiveText: {
    fontSize: fontSize.md,
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  // Non-destructive confirm: gradient pill, mirrors btnTryAgain.
  confirmBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  confirmText: {
    fontSize: fontSize.md,
    fontFamily: fonts.semibold,
    color: colors.bg,
  },
});
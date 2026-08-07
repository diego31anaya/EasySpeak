// components/PaceTargetEditor.tsx
//
// The editable body for the "Pace target" Profile page, rendered as
// ProfilePageShell's children in BOTH route wrappers (settings right-slide +
// top-level bottom modal) so it's written once. Two clamped steppers set the ideal
// WPM band (profiles.pace_target_low/high); a custom band ripples into the pace
// verdict, the metric-row colors, and the AI score (snapshotted at finalize).
//
// Auto-persists (no Save button — the close-mode header has only an X), DEBOUNCED
// so a flurry of +/- taps collapses to one write and they can't land out of order;
// a pending change flushes on unmount. Optimistic local state reverts on failure.
//
// NOTE: user-facing copy here is PLACEHOLDER — to be finalized.

import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';

import { useAuth } from '../lib/auth';
import { DEFAULT_PACE_TARGET } from '../lib/metrics';
import { colors, fonts, fontSize, radius, spacing } from '../lib/theme';

const PACE_MIN = 70; // sane speaking-rate floor/ceiling for a target band
const PACE_MAX = 220;
const STEP = 5;
const MIN_GAP = 10; // the band must be at least this wide (also keeps low < high)
const SAVE_DEBOUNCE_MS = 500;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function PaceTargetEditor() {
  const { profile, updatePaceTarget } = useAuth();
  const persistedLow = profile?.pace_target_low ?? DEFAULT_PACE_TARGET.low;
  const persistedHigh = profile?.pace_target_high ?? DEFAULT_PACE_TARGET.high;

  const [low, setLow] = useState(persistedLow);
  const [high, setHigh] = useState(persistedHigh);
  // Once the user edits, stop mirroring the profile so a background refresh can't
  // stomp an in-progress edit. Until then, adopt the loaded band.
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (!dirtyRef.current) {
      setLow(persistedLow);
      setHigh(persistedHigh);
    }
  }, [persistedLow, persistedHigh]);

  // Debounced persist. The latest values live in a ref so the timer (and the
  // unmount flush) always write the current band, never a stale captured one.
  const latestRef = useRef({ low, high });
  latestRef.current = { low, high };
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const { low: l, high: h } = latestRef.current;
    void updatePaceTarget(l, h).then(({ error }) => {
      if (error) {
        // Revert to the last persisted band and surface the failure.
        setLow(persistedLow);
        setHigh(persistedHigh);
        Alert.alert("Couldn't save", error.message);
      }
    });
  };
  const scheduleFlush = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  };
  // Flush a pending change when leaving the page (runs once; reads the latest ref).
  useEffect(() => () => { if (timerRef.current) flush(); }, []);

  const commit = (nextLow: number, nextHigh: number) => {
    dirtyRef.current = true;
    setLow(nextLow);
    setHigh(nextHigh);
    Haptics.selectionAsync();
    scheduleFlush();
  };

  const lowCanDec = low - STEP >= PACE_MIN;
  const lowCanInc = low + STEP <= high - MIN_GAP;
  const highCanDec = high - STEP >= low + MIN_GAP;
  const highCanInc = high + STEP <= PACE_MAX;

  const adjustLow = (delta: number) => {
    const next = clamp(low + delta, PACE_MIN, high - MIN_GAP);
    if (next !== low) commit(next, high);
  };
  const adjustHigh = (delta: number) => {
    const next = clamp(high + delta, low + MIN_GAP, PACE_MAX);
    if (next !== high) commit(low, next);
  };

  const isDefault = low === DEFAULT_PACE_TARGET.low && high === DEFAULT_PACE_TARGET.high;
  const resetDefault = () => {
    if (isDefault) return;
    commit(DEFAULT_PACE_TARGET.low, DEFAULT_PACE_TARGET.high);
  };

  return (
    <View style={styles.container}>
      {/* PLACEHOLDER copy */}
      <Text style={styles.intro}>
        The words-per-minute range you're aiming for. Sessions are scored and
        colored against this band.
      </Text>

      <View style={styles.preview}>
        <Text style={styles.previewValue}>
          {low}–{high}
        </Text>
        <Text style={styles.previewUnit}>wpm</Text>
      </View>

      <StepperRow
        label="Lower bound"
        value={low}
        onDec={() => adjustLow(-STEP)}
        onInc={() => adjustLow(STEP)}
        canDec={lowCanDec}
        canInc={lowCanInc}
      />
      <StepperRow
        label="Upper bound"
        value={high}
        onDec={() => adjustHigh(-STEP)}
        onInc={() => adjustHigh(STEP)}
        canDec={highCanDec}
        canInc={highCanInc}
      />

      <Pressable
        onPress={resetDefault}
        disabled={isDefault}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Reset to default range"
        style={({ pressed }) => [styles.reset, pressed && !isDefault && styles.pressed]}
      >
        <Text style={[styles.resetText, isDefault && styles.resetTextDisabled]}>
          Reset to default (130–160)
        </Text>
      </Pressable>
    </View>
  );
}

function StepperRow({
  label,
  value,
  onDec,
  onInc,
  canDec,
  canInc,
}: {
  label: string;
  value: number;
  onDec: () => void;
  onInc: () => void;
  canDec: boolean;
  canInc: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.stepper}>
        <StepperButton kind="minus" onPress={onDec} disabled={!canDec} label={`Decrease ${label}`} />
        <Text style={styles.stepperValue}>{value}</Text>
        <StepperButton kind="plus" onPress={onInc} disabled={!canInc} label={`Increase ${label}`} />
      </View>
    </View>
  );
}

function StepperButton({
  kind,
  onPress,
  disabled,
  label,
}: {
  kind: 'minus' | 'plus';
  onPress: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.stepBtn, pressed && !disabled && styles.pressed]}
    >
      <PlusMinusIcon kind={kind} color={disabled ? colors.textSubtle : colors.accent} />
    </Pressable>
  );
}

function PlusMinusIcon({ kind, color }: { kind: 'minus' | 'plus'; color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12h14" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      {kind === 'plus' ? (
        <Path d="M12 5v14" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      ) : null}
    </Svg>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  intro: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    lineHeight: 19,
    marginBottom: spacing.xl,
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  previewValue: {
    fontSize: fontSize.display,
    fontFamily: fonts.semibold,
    color: colors.text,
    letterSpacing: -1,
  },
  previewUnit: {
    fontSize: fontSize.lg,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowLabel: { fontSize: fontSize.md, fontFamily: fonts.regular, color: colors.text },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  // Recessed stepper buttons — same fill/border idiom as the input fields.
  stepBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  stepperValue: {
    minWidth: 44,
    textAlign: 'center',
    fontSize: fontSize.lg,
    fontFamily: fonts.semibold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  reset: { alignSelf: 'center', marginTop: spacing.xl, padding: spacing.sm },
  resetText: { fontSize: fontSize.sm, fontFamily: fonts.medium, color: colors.accent },
  resetTextDisabled: { color: colors.textSubtle },
  pressed: { opacity: 0.6 },
});
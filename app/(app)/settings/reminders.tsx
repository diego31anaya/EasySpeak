// app/(app)/settings/reminders.tsx
//
// Practice reminders — pushed from the Settings "Practice reminders" row as a
// card that slides in from the right WITHIN the Settings modal (a screen in the
// nested stack — see ./_layout.tsx). Back chevron pops back to the list.
//
// Decided behavior: a SINGLE daily local notification at a user-set time, fired
// EVERY day regardless of whether the user practiced (simple daily). The OS fires
// it — see lib/notifications.ts (expo-notifications; the device schedules it and
// iOS/Android delivers it even when the app is closed; no server / push).
// Wired here: the toggle requests notification permission + schedules/cancels;
// the time (re)schedules; the pref persists to AsyncStorage (device source of
// truth) and mirrors to profiles.reminder_* in Supabase (restore on reinstall /
// a new device). ⚠️ expo-notifications is a native module — needs a native rebuild.
//
// Copy is PLACEHOLDER.

import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';

import { colors, fontSize, fonts, radius, spacing, BOX_SHADOW_ELEVATED } from '../../../lib/theme';
import { backFlow } from '../../../lib/navigation';
import { applyReminder, formatReminderTime, hasNotificationPermission, loadReminder, type ReminderPref } from '../../../lib/notifications';

// Reminder time-of-day, stored 24-hour.
type Time = { hour: number; minute: number };

// Default reminder time — 7:00 PM. Evening is when people realize they haven't
// practiced yet.
const DEFAULT_TIME: Time = { hour: 19, minute: 0 };

// The native picker speaks Date; the app stores { hour, minute }. Convert both ways.
const timeToDate = (t: Time): Date => {
  const d = new Date();
  d.setHours(t.hour, t.minute, 0, 0);
  return d;
};
const dateToTime = (d: Date): Time => ({ hour: d.getHours(), minute: d.getMinutes() });

export default function Reminders() {
  const [enabled, setEnabled] = useState(false);
  const [time, setTime] = useState<Time>(DEFAULT_TIME);
  const [pickerOpen, setPickerOpen] = useState(false);
  // True while an apply (permission request + schedule/cancel + persist) is in
  // flight — disables the toggle + time row so a second tap can't interleave with
  // the (async, permission-dialog-blocked) first apply and let a stale write win.
  const [busy, setBusy] = useState(false);

  // Debounced apply so a flurry of iOS-spinner ticks collapses to ONE reschedule;
  // a pending change flushes on unmount so leaving mid-edit still persists.
  const applyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<ReminderPref | null>(null);

  // Seed from the stored preference (device-local, else the account's mirror),
  // GATED on the live OS permission: if the user turned notifications off in the
  // system Settings, show the toggle OFF even though the stored intent is on —
  // otherwise the UI claims reminders are on while nothing fires. The stored
  // intent is left untouched, so re-granting + relaunch auto-resumes it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pref = await loadReminder();
      const granted = pref.enabled ? await hasNotificationPermission() : false;
      if (cancelled) return;
      setEnabled(pref.enabled && granted);
      setTime({ hour: pref.hour, minute: pref.minute });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Flush a pending debounced apply when leaving the screen (fire-and-forget —
  // the component is gone, so don't touch state).
  useEffect(
    () => () => {
      if (applyTimer.current) {
        clearTimeout(applyTimer.current);
        if (pending.current) applyReminder(pending.current).catch(() => {});
      }
    },
    [],
  );

  // Apply a preference (schedule/cancel + persist local + Supabase mirror), then
  // reflect the real result — a permission denial forces the toggle back off and
  // prompts for Settings. `busy` gates the controls while this is in flight; a
  // native/scheduling error re-syncs the UI from storage so the toggle can't get
  // stuck optimistic-on with nothing scheduled. Never rejects, so the
  // fire-and-forget callers can't emit an unhandled rejection.
  const applyPref = async (next: ReminderPref) => {
    setBusy(true);
    try {
      const { pref, permissionBlocked } = await applyReminder(next);
      setEnabled(pref.enabled);
      setTime({ hour: pref.hour, minute: pref.minute });
      if (permissionBlocked) {
        setPickerOpen(false);
        Alert.alert(
          'Notifications are off',
          'Turn on notifications for EasySpeak in Settings to get practice reminders.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
      }
    } catch {
      // A native scheduling error must not leave the toggle stuck optimistic-on
      // with nothing scheduled — re-sync the UI from the stored source of truth.
      const pref = await loadReminder().catch(() => null);
      if (pref) {
        setEnabled(pref.enabled);
        setTime({ hour: pref.hour, minute: pref.minute });
      }
      Alert.alert("Couldn't update reminder", 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // Toggle applies immediately (the permission prompt should feel instant); time
  // changes debounce (the iOS spinner fires continuously as it scrolls).
  const queueApply = (next: ReminderPref, immediate: boolean) => {
    if (applyTimer.current) {
      clearTimeout(applyTimer.current);
      applyTimer.current = null;
    }
    if (immediate) {
      pending.current = null;
      applyPref(next);
    } else {
      pending.current = next;
      applyTimer.current = setTimeout(() => {
        applyTimer.current = null;
        const p = pending.current;
        pending.current = null;
        if (p) applyPref(p);
      }, 600);
    }
  };

  const back = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    backFlow();
  };

  const handleToggle = (next: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEnabled(next); // optimistic; corrected by applyPref if permission is denied
    if (!next) setPickerOpen(false);
    queueApply({ enabled: next, hour: time.hour, minute: time.minute }, true);
  };

  const handleTimePress = () => {
    if (!enabled || busy) return; // inert while off, or while an apply is in flight
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPickerOpen((o) => !o);
  };

  const handleTimeChange = (next: Time) => {
    setTime(next); // keep the picker responsive
    queueApply({ enabled: true, hour: next.hour, minute: next.minute }, false);
  };

  // Native picker → our { hour, minute }. iOS fires live (inline spinner);
  // Android fires once from its modal dialog, so we close on any result and
  // only apply the value when the user confirmed ("set", not "dismissed").
  const onNativeChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      setPickerOpen(false);
      if (event.type === 'set' && selected) handleTimeChange(dateToTime(selected));
    } else if (selected) {
      handleTimeChange(dateToTime(selected));
    }
  };

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
            <Pressable
              onPress={back}
              hitSlop={12}
              accessibilityLabel="Back"
              style={({ pressed }) => [styles.side, pressed && styles.pressed]}
            >
              <BackIcon color={colors.text} />
            </Pressable>
            <Text style={styles.title} numberOfLines={1}>
              Reminders
            </Text>
            {/* Right spacer keeps the title optically centered (no right action —
                changes apply immediately, like the other Profile editors). */}
            <View style={styles.side} />
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* PLACEHOLDER copy. */}
          <Text style={styles.intro}>
            Get a daily nudge to practice so you keep your streak going.
          </Text>

          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Practice reminders</Text>
              <Switch
                value={enabled}
                onValueChange={handleToggle}
                disabled={busy}
                trackColor={{ false: colors.border, true: colors.accent }}
                thumbColor={colors.text}
                ios_backgroundColor={colors.border}
              />
            </View>

            {/* Reminder time — always shown. Greyed + inert when the toggle is
                off; normal + opens the picker when on. */}
            <Pressable
              onPress={handleTimePress}
              disabled={!enabled}
              style={({ pressed }) => [
                styles.row,
                styles.rowDivider,
                !enabled && styles.rowDisabled,
                pressed && enabled && styles.rowPressed,
              ]}
            >
              <Text style={styles.rowLabel}>Reminder time</Text>
              <View style={styles.rowRight}>
                <Text style={[styles.rowValue, enabled && pickerOpen && styles.rowValueOpen]}>
                  {formatReminderTime(time.hour, time.minute)}
                </Text>
                <Chevron color={colors.textMuted} open={enabled && pickerOpen} />
              </View>
            </Pressable>

            {/* Native OS time picker. iOS = an inline spinner that expands below
                the row; Android = a modal dialog (renders nothing inline). */}
            {enabled &&
              pickerOpen &&
              (Platform.OS === 'ios' ? (
                <View style={[styles.pickerWrap, styles.rowDivider]}>
                  <DateTimePicker
                    value={timeToDate(time)}
                    mode="time"
                    display="spinner"
                    themeVariant="dark"
                    onChange={onNativeChange}
                  />
                </View>
              ) : (
                <DateTimePicker
                  value={timeToDate(time)}
                  mode="time"
                  display="default"
                  onChange={onNativeChange}
                />
              ))}
          </View>

          {/* Behavior line — always shown, greyed when off. We remind every day
              regardless of whether the user practiced. PLACEHOLDER copy. */}
          <Text style={[styles.footnote, !enabled && styles.footnoteDisabled]}>
            You'll get a reminder every day at this time.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

// Chevron-left — sized to match the other back chevrons (24).
function BackIcon({ size = 24, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="m15.75 19.5-7.5-7.5 7.5-7.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// Small chevron that points right when closed, down when open (the expand cue).
function Chevron({ size = 18, color, open }: { size?: number; color: string; open: boolean }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}
    >
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

const styles = StyleSheet.create({
  gradientBg: { flex: 1 },
  safe: { flex: 1 },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  side: { width: 36, height: 36, justifyContent: 'center' },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.xxl,
    fontFamily: fonts.regular,
    color: colors.text,
    letterSpacing: -0.5,
  },
  pressed: { opacity: 0.6 },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  intro: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    lineHeight: 20,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.lg,
  },

  card: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    boxShadow: BOX_SHADOW_ELEVATED,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 52,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  rowPressed: { opacity: 0.6 },
  // Greyed/disabled state — the time row stays visible but clearly reads as off.
  rowDisabled: { opacity: 0.4 },
  rowLabel: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowValue: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  // Time turns accent while the picker is open (it's the thing being edited).
  rowValueOpen: { color: colors.accent },

  pickerWrap: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },

  footnote: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textSubtle,
    lineHeight: 20,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.md,
  },
  // Matches the time row's greyed state when reminders are off.
  footnoteDisabled: { opacity: 0.4 },
});
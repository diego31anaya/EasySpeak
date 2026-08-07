// lib/notifications.ts
//
// Practice reminders — a SINGLE daily LOCAL notification fired by the OS at the
// user's chosen time. There is no server and no push: the device hands the OS a
// repeating daily trigger once, and iOS/Android delivers it even when the app is
// closed/killed. expo-notifications is just the JS wrapper around that scheduler.
//
// Storage: AsyncStorage is the device source of truth (it drives scheduling).
// The pref is also mirrored to profiles.reminder_* in Supabase (best-effort) so
// it restores on reinstall / a new device — adopted by loadReminder() when this
// device has no local value yet.
//
// ⚠️ expo-notifications is a NATIVE module — needs a native rebuild to work.

import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { getStreak, reminderCopy, streakState } from './streak';

export type ReminderPref = { enabled: boolean; hour: number; minute: number };

export const DEFAULT_REMINDER: ReminderPref = { enabled: false, hour: 19, minute: 0 };

// 12-hour display of a reminder time (e.g. "7:00 PM"). Hardcoded 12h, no Intl
// (Hermes-safe). Shared by the reminders screen + the Settings row.
export function formatReminderTime(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${period}`;
}

const STORAGE_KEY = 'easyspeak.reminder';
const ANDROID_CHANNEL_ID = 'practice-reminders';

// Notification copy — PLACEHOLDER (dev to finalize).
const REMINDER_TITLE = 'Time to practice';
const REMINDER_BODY = 'Take a minute to practice your speaking.';

// Show the reminder as a banner even if the app happens to be foregrounded when
// it fires. (Set once on import.)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ---------- device-local store (source of truth) ----------
async function loadLocal(): Promise<ReminderPref | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ReminderPref) : null;
  } catch {
    return null;
  }
}
async function saveLocal(pref: ReminderPref): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pref));
  } catch {
    // Non-fatal — the OS schedule is already applied regardless.
  }
}

// ---------- Supabase mirror (best-effort backup) ----------
// No-ops cleanly when signed out or before the migration is pushed (the update
// just errors and we ignore it); the local schedule never depends on this.
async function saveRemote(pref: ReminderPref): Promise<void> {
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) return;
  await supabase
    .from('profiles')
    .update({
      reminder_enabled: pref.enabled,
      reminder_hour: pref.hour,
      reminder_minute: pref.minute,
    })
    .eq('id', userId);
}
async function loadRemote(): Promise<ReminderPref | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('reminder_enabled, reminder_hour, reminder_minute')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    enabled: !!data.reminder_enabled,
    hour: data.reminder_hour ?? DEFAULT_REMINDER.hour,
    minute: data.reminder_minute ?? DEFAULT_REMINDER.minute,
  };
}

async function persist(pref: ReminderPref): Promise<void> {
  await saveLocal(pref);
  saveRemote(pref).catch(() => {});
}

// ---------- permission ----------
export async function hasNotificationPermission(): Promise<boolean> {
  const { granted } = await Notifications.getPermissionsAsync();
  return granted;
}
// true if we already had, or just obtained, permission. false = denied (and on a
// hard denial canAskAgain is false → the caller should deep-link to Settings).
async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

// ---------- OS scheduling ----------
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Practice reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

// Build the daily reminder's content from the user's CURRENT streak state. The OS
// fires PRE-BAKED content (our JS doesn't run at fire time), so this is recomputed
// on every schedule — the reschedule triggers (launch / foreground / after a
// session) keep it fresh. Falls back to the streak-agnostic constants when signed
// out / offline / the read throws, so scheduling always succeeds.
async function buildReminderContent(): Promise<{ title: string; body: string }> {
  try {
    return reminderCopy(streakState(await getStreak()));
  } catch {
    return { title: REMINDER_TITLE, body: REMINDER_BODY };
  }
}

// We own exactly one scheduled notification, so cancel-all then (re)schedule is
// the simplest correct apply. If other scheduled notifications are ever added,
// switch to tracking + cancelling this one by id.
async function scheduleDaily(hour: number, minute: number): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
  await ensureAndroidChannel();
  const content = await buildReminderContent();
  await Notifications.scheduleNotificationAsync({
    content,
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : null),
    },
  });
}
async function cancelAll(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

// ---------- public API ----------
export type ApplyResult = { pref: ReminderPref; permissionBlocked: boolean };

// Apply a preference: (re)schedule or cancel the OS notification, then persist
// (local + Supabase mirror). If the user enabled but permission is denied, the
// returned pref is forced back to disabled + permissionBlocked=true so the UI can
// reflect reality and prompt for Settings.
export async function applyReminder(next: ReminderPref): Promise<ApplyResult> {
  if (next.enabled) {
    const ok = await ensurePermission();
    if (!ok) {
      await cancelAll();
      const off: ReminderPref = { ...next, enabled: false };
      await persist(off);
      return { pref: off, permissionBlocked: true };
    }
    await scheduleDaily(next.hour, next.minute);
  } else {
    await cancelAll();
  }
  await persist(next);
  return { pref: next, permissionBlocked: false };
}

// Seed the reminders screen: device-local pref if present, else adopt the
// account's Supabase mirror (first run on this device), else defaults.
export async function loadReminder(): Promise<ReminderPref> {
  const local = await loadLocal();
  if (local) return local;
  const remote = await loadRemote();
  if (remote) {
    await saveLocal(remote); // adopt onto this device
    return remote;
  }
  return DEFAULT_REMINDER;
}

// Run once on launch (signed in): make the OS schedule match the stored/synced
// pref. Re-asserts the daily notification and schedules it on a fresh device that
// just adopted the account's mirror. Fire-and-forget.
export async function syncReminderOnLaunch(): Promise<void> {
  const pref = await loadReminder();
  if (pref.enabled && (await hasNotificationPermission())) {
    await scheduleDaily(pref.hour, pref.minute);
  } else {
    // Disabled, OR enabled-but-permission-revoked → make sure nothing is scheduled.
    // The reminders screen + Settings row gate their display on the live permission,
    // so the UI won't claim reminders are on while nothing fires.
    await cancelAll();
  }
}

// Convenience alias: re-run the schedule (which re-bakes the streak-aware content)
// after a session finishes or when the app returns to the foreground.
export const refreshReminder = syncReminderOnLaunch;

// On sign-out / account deletion / session loss: stop the OS notification and
// drop the DEVICE-local pref, so a logged-out user isn't nagged (the schedule is
// OS-level and otherwise survives logout) and the next user on this device
// doesn't inherit it. The Supabase MIRROR is deliberately left intact, so signing
// back in restores the reminder (loadReminder adopts it → syncReminderOnLaunch
// reschedules). (Account deletion wipes the profile row, so nothing restores —
// correct.)
export async function clearReminderOnSignOut(): Promise<void> {
  await cancelAll();
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // non-fatal
  }
}
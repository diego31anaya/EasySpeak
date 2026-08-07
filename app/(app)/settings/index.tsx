// app/(app)/settings/index.tsx
//
// The Settings list — the root screen of the Settings modal's nested stack (see
// ./_layout.tsx). The parent (app) layout presents this group as a modal; here we
// show the header (centered "Settings" + X) and the "Edit Information" card. Tapping
// a row pushes ./edit-info as a card WITHIN this modal. The X (and backing off this
// root) dismisses the whole modal.
//
// A DESTINATION (it will hold Terms of Service, Delete Account, etc.) — that's why
// it's a route modal, not an inline <Modal> sheet like FilterSheet.

import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';

import { colors, fontSize, fonts, radius, spacing, BOX_SHADOW_ELEVATED } from '../../../lib/theme';
import { useFocusEffect, type Href } from 'expo-router';
import { backFlow, enterFlow } from '../../../lib/navigation';
import { useAuth } from '../../../lib/auth';
import { focusLabel } from '../../../lib/focus';
import { formatReminderTime, hasNotificationPermission, loadReminder } from '../../../lib/notifications';
import type { EditField } from './edit-info';

// The password is NEVER fetched — it's hashed server-side (unretrievable), and a
// real-length mask would leak it. A FIXED-length mask, not the actual char count.
const HIDDEN_PASSWORD = '••••••••';

export default function Settings() {
  const { session, profile, signOut, deleteAccount } = useAuth();
  // First name = profiles.display_name (null until the user sets one, or while the
  // profile is still loading in the background); email comes off the auth session.
  const firstName = profile?.display_name ?? 'Not set';
  const email = session?.user.email ?? '';
  // Custom filler words row value: a count summary off the live profile.
  const fillerCount = profile?.custom_fillers?.length ?? 0;
  const fillerSummary = fillerCount === 0 ? 'None' : fillerCount === 1 ? '1 word' : `${fillerCount} words`;
  // Pace target row value: the live band off the profile (defaults 130–160).
  const paceSummary = `${profile?.pace_target_low ?? 130}-${profile?.pace_target_high ?? 160} wpm`;
  // Focus row value: the live preset label (or "Not set").
  const focusSummary = focusLabel(profile?.focus);

  // Practice-reminder row value — read from the stored pref (device-local, async)
  // on focus so it reflects a change made on the reminders sub-page after backing
  // out. Shows the formatted time when on, else "Off".
  const [reminderSummary, setReminderSummary] = useState('Off');
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const pref = await loadReminder();
        // Gate on the live OS permission (revoked in Settings → "Off"), matching the
        // reminders screen, so the row can't claim a time while nothing fires.
        const granted = pref.enabled ? await hasNotificationPermission() : false;
        if (!cancelled) {
          setReminderSummary(
            pref.enabled && granted ? formatReminderTime(pref.hour, pref.minute) : 'Off',
          );
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  // Pressing a row pushes the edit page (slides in from the right within this
  // modal's nested stack); the page's back chevron pops back here.
  const openEdit = (field: EditField) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    enterFlow({ pathname: '/settings/edit-info', params: { field } });
  };

  // From Settings we push the NESTED settings/* copies so they slide in from the
  // right within this modal (like the Edit Information rows). The SAME pages also
  // exist as top-level (app) routes (/pace-target, etc.) that present as bottom
  // sheets for entry points outside Settings; both render ProfilePageShell.
  const openPage = (href: Href) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    enterFlow(href);
  };

  const close = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    backFlow();
  };

  // Confirm, then sign out. The auth gate ((app)/_layout) sees the null session and
  // redirects to /sign-in, which tears down this modal — no manual navigation needed.
  const handleLogOut = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert('Log out?', 'You can sign back in anytime.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  // Irreversible — confirm hard, then call the delete-account Edge Function (which
  // wipes recordings + the auth user; the FK cascade clears profiles + sessions),
  // which signs out → the auth gate drops to /sign-in. `deleting` swaps the label so
  // the (couple-second) round-trip has feedback and can't be double-fired.
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    setDeleting(true);
    const { error } = await deleteAccount();
    if (error) {
      setDeleting(false);
      Alert.alert("Couldn't delete account", error.message);
    }
    // On success the session is gone and the auth gate navigates away — nothing else
    // to do (leaving `deleting` true keeps the row locked during the transition).
  };

  const handleDeleteAccount = () => {
    if (deleting) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account, all your practice sessions, and your recordings. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void confirmDelete() },
      ],
    );
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
            {/* Left spacer keeps the title optically centered against the X. */}
            <View style={styles.side} />
            <Text style={styles.title}>Settings</Text>
            <Pressable
              onPress={close}
              hitSlop={12}
              accessibilityLabel="Close"
              style={({ pressed }) => [styles.side, styles.sideRight, pressed && styles.pressed]}
            >
              <CloseIcon color={colors.text} />
            </Pressable>
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sectionLabel}>Edit Information</Text>
          {/* Frameless card with hairline-divided rows (same look as the Home
              Session History card). Name + email are real (auth/profile); password
              is a fixed mask. Tapping a row pushes the edit page. */}
          <View style={styles.card}>
            <InfoRow label="First name" value={firstName} onPress={() => openEdit('firstName')} />
            <InfoRow label="Email" value={email} showDivider onPress={() => openEdit('email')} />
            <InfoRow
              label="Password"
              value={HIDDEN_PASSWORD}
              showDivider
              onPress={() => openEdit('password')}
            />
          </View>

          {/* Profile — practice personalization (pace target, custom filler words,
              what you're working on). UI ONLY for now: each row is a no-op pending
              its config page, and the VALUES are PLACEHOLDER. Wire each to a settings
              sub-page (like edit-info) next. */}
          <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>Profile</Text>
          <View style={styles.card}>
            <InfoRow label="Pace target" value={paceSummary} onPress={() => openPage('/settings/pace-target')} />
            <InfoRow label="Custom filler words" value={fillerSummary} showDivider onPress={() => openPage('/settings/custom-fillers')} />
            <InfoRow label="What you're working on" value={focusSummary} showDivider onPress={() => openPage('/settings/practice-focus')} />
          </View>

          {/* Notifications — practice reminders (keep the streak alive, etc.).
              The row now pushes the reminders sub-page (./reminders). The "Off"
              value is still PLACEHOLDER — it'll reflect the real { enabled, time }
              once the reminder preference is persisted (see reminders.tsx). */}
          <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>Notifications</Text>
          <View style={styles.card}>
            <InfoRow label="Practice reminders" value={reminderSummary} onPress={() => openPage('/settings/reminders')} />
          </View>

          {/* Legal — Terms of Service + Privacy Policy, between Edit Information
              and Account. Same grouped-card shell. UI ONLY (no-op on press); when
              wired these open the hosted pages (or in-app screens). */}
          <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>Legal</Text>
          <View style={styles.card}>
            <ActionRow label="Terms of Service" onPress={() => {}} />
            <ActionRow label="Privacy Policy" showDivider onPress={() => {}} />
          </View>

          {/* Account actions — a second grouped-list card in the same shell as
              the Edit Information card above. Log Out (neutral) sits above the
              hairline; Delete Account (danger) is last — the most destructive
              action, per iOS convention. Press is a NO-OP for now; when wired,
              Delete Account should fire Haptics.impactAsync(Medium) + a
              destructive confirm Alert (like ReviewDeleteButton) and Log Out
              should call useAuth().signOut. "Account" copy is PLACEHOLDER.
              (Terms / Privacy links land here too.) */}
          <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>Account</Text>
          <View style={styles.card}>
            <ActionRow label="Log Out" onPress={handleLogOut} />
            <ActionRow
              label={deleting ? 'Deleting…' : 'Delete Account'}
              danger
              showDivider
              onPress={handleDeleteAccount}
            />
          </View>

          {/* Third-party credit — the Datamuse API's terms ask apps to acknowledge it
              (Vocabulary word definitions). Keep this while Datamuse is the source. */}
          <Text style={styles.credit}>Word definitions provided by the Datamuse API.</Text>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

// One editable-info row: label on the left, value + a chevron on the right. The
// whole row is the tap target (the chevron is the affordance). `showDivider` draws
// the hairline above it (rows after the first), full-width like the history card.
function InfoRow({
  label,
  value,
  showDivider,
  onPress,
}: {
  label: string;
  value: string;
  showDivider?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        showDivider && styles.rowDivider,
        pressed && styles.rowPressed,
      ]}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
        <ChevronRightIcon color={colors.textMuted} />
      </View>
    </Pressable>
  );
}

// One account-action row: a centered, full-width tap target. Same shape and press
// feedback as InfoRow but no value/chevron — these are terminal actions (sign out /
// fire a destructive Alert), not navigations, so a trailing chevron would mislead.
// `danger` tints the label colors.danger (the screen's only red); `showDivider`
// draws the hairline above it (the second row).
function ActionRow({
  label,
  danger,
  showDivider,
  onPress,
}: {
  label: string;
  danger?: boolean;
  showDivider?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.actionRow,
        showDivider && styles.rowDivider,
        pressed && styles.rowPressed,
      ]}
    >
      <Text style={[styles.actionText, danger && styles.actionTextDanger]}>{label}</Text>
    </Pressable>
  );
}

function ChevronRightIcon({ size = 18, color }: { size?: number; color: string }) {
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

// X / close — sized to match the back-chevron icons (24) for header consistency.
function CloseIcon({ size = 24, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 18L18 6M6 6l12 12"
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
  // Equal side widths (match the review/streaks headers) so the title centers.
  side: { width: 36, height: 36, justifyContent: 'center' },
  sideRight: { alignItems: 'flex-end' },
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
    gap: spacing.sm,
  },

  // Small, subtle section header above the card.
  sectionLabel: {
    fontSize: fontSize.sm,
    fontFamily: fonts.medium,
    color: colors.textMuted,
    paddingHorizontal: spacing.xs,
    letterSpacing: 0.2,
  },
  // Extra top gap on the 2nd+ section labels so each label groups with the card
  // BELOW it, not the card above (the scrollContent's `sm` gap alone read too tight).
  sectionLabelSpaced: { marginTop: spacing.lg },

  // Frameless card; rows carry the `lg` inset so the hairline dividers reach the
  // card edges (same as the Home Session History card).
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
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  rowPressed: { opacity: 0.6 },
  rowLabel: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  // Right side shrinks (and the value truncates) so a long email can't shove the
  // label off the left edge.
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
    marginLeft: spacing.md,
  },
  rowValue: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    flexShrink: 1,
  },

  // Centered action row inside the Account card. Same horizontal inset and vertical
  // padding as the InfoRows (so dividers line up), but the text is centered — these
  // are actions, not label/value pairs, so there's no value or chevron to anchor right.
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionText: {
    fontSize: fontSize.md,
    fontFamily: fonts.medium,
    color: colors.text,
  },
  // The most destructive action — danger red carries the hierarchy; weight and size
  // stay identical to Log Out (matches ReviewDeleteButton's danger idiom).
  actionTextDanger: {
    color: colors.danger,
  },
  // Subtle third-party credit footer (Datamuse API acknowledgment).
  credit: {
    marginTop: spacing.lg,
    textAlign: 'center',
    fontSize: fontSize.xs,
    fontFamily: fonts.regular,
    color: colors.textSubtle,
    paddingHorizontal: spacing.lg,
  },
});
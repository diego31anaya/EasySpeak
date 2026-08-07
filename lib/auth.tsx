import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { clearReminderOnSignOut } from './notifications';

// Persisted so a recovery session that survives an app kill mid-reset is still
// treated as "must finish the password reset", not a full login.
const RECOVERY_KEY = 'easyspeak.recovery_pending';

export type Profile = {
  id: string;
  display_name: string | null;
  // User-defined filler words/phrases (normalized, 1–2 tokens each). Merged into
  // detection at finalize. Empty array = none. Backed by profiles.custom_fillers.
  custom_fillers: string[];
  // The user's ideal WPM band (defaults 130/160). Read at finalize + snapshotted
  // into the session metrics. Backed by profiles.pace_target_low/high.
  pace_target_low: number;
  pace_target_high: number;
  // The user's practice focus — a preset key from lib/focus.ts (null = not set).
  // Read at finalize to tune the AI feedback. Backed by profiles.focus.
  focus: string | null;
};

type AuthContextType = {
  session: Session | null;
  // Loaded asynchronously from public.profiles after the session resolves.
  // Null while loading, or if the row is missing / fetch failed. Consumers
  // should fall back gracefully.
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  // `needsConfirmation` is true when signup succeeded but email confirmation is on
  // (no session yet) → the screen routes to the code-entry page.
  signUp: (
    email: string,
    password: string,
    displayName: string,
  ) => Promise<{ error: Error | null; needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  // Update the signed-in user's display name (profiles.display_name) and refresh
  // the local profile so consumers re-render with the new name.
  updateDisplayName: (name: string) => Promise<{ error: Error | null }>;
  // Replace the signed-in user's custom filler words (profiles.custom_fillers) and
  // refresh the local profile so the next finalize merges them into detection.
  updateCustomFillers: (fillers: string[]) => Promise<{ error: Error | null }>;
  // Replace the signed-in user's pace target band (profiles.pace_target_low/high).
  // Caller validates low < high; the DB CHECK is the backstop.
  updatePaceTarget: (low: number, high: number) => Promise<{ error: Error | null }>;
  // Set the signed-in user's practice focus (a preset key from lib/focus.ts, or
  // null to clear). Read at finalize to tune the AI feedback toward the goal.
  updateFocus: (focus: string | null) => Promise<{ error: Error | null }>;
  // Update the signed-in user's password (Supabase auth; the active session
  // authorizes it — no current password needed unless secure-change is enabled).
  updatePassword: (password: string) => Promise<{ error: Error | null }>;
  // Permanently delete the account: calls the `delete-account` Edge Function (which
  // removes the user's recordings + the auth user; the FK cascade clears profiles +
  // sessions), then signs out locally. Irreversible.
  deleteAccount: () => Promise<{ error: Error | null }>;

  // ---- Email-OTP flows (typed 6-digit codes; see CLAUDE.md "Auth email flows") ----
  // Confirm a new signup with the emailed code. On success Supabase mints a session
  // and the (auth) layout redirects into the app. (verifyOtp type 'email' — 'signup'
  // is deprecated.)
  confirmSignup: (email: string, token: string) => Promise<{ error: Error | null }>;
  // Re-send the signup confirmation code.
  resendSignupCode: (email: string) => Promise<{ error: Error | null }>;
  // Start a password reset (logged out): emails a recovery code to `email`.
  requestPasswordReset: (email: string) => Promise<{ error: Error | null }>;
  // Confirm a recovery code → mints a (recovery) session. Sets `recoveryMode` so the
  // (auth) layout keeps the user on the new-password step instead of bouncing home.
  confirmRecoveryCode: (email: string, token: string) => Promise<{ error: Error | null }>;
  // True between a verified recovery code and the new password being set — the (auth)
  // layout reads this so a recovery session doesn't drop the user straight into the app.
  recoveryMode: boolean;
  // Clear recoveryMode (after the new password is saved → the layout then redirects home).
  finishRecovery: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  // See confirmRecoveryCode / the (auth) layout.
  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
    // Read whatever session AsyncStorage has cached
    supabase.auth.getSession().then(async ({ data }) => {
      // Rehydrate the recovery flag — if the app was killed mid-reset, the gates
      // must force /new-password rather than letting the recovery session in.
      if (data.session && (await AsyncStorage.getItem(RECOVERY_KEY))) setRecoveryMode(true);
      setSession(data.session);
      setLoading(false);
    });

    // Subscribe to all future changes (sign in, sign out, token refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      // A vanished session can't be mid password-reset. Clear the persisted recovery
      // lock so a stale RECOVERY_KEY can't rehydrate onto — and trap — the next login.
      // Covers signOut, deleteAccount, and a revoked/expired recovery token alike.
      if (!newSession) {
        setRecoveryMode(false);
        AsyncStorage.removeItem(RECOVERY_KEY);
        // Cancel the OS-scheduled practice reminder + drop the device-local pref so
        // a logged-out (or deleted) user isn't nagged. The Supabase mirror persists,
        // so signing back in restores it (see lib/notifications.ts).
        clearReminderOnSignOut().catch(() => {});
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch the profile row whenever the signed-in user changes. Runs in the
  // background — screens render immediately with profile=null and re-render
  // once the row arrives. Auth gate intentionally only waits on the session.
  useEffect(() => {
    if (!session?.user.id) {
      setProfile(null);
      return;
    }

    let cancelled = false;
    (async () => {
      // maybeSingle returns null instead of erroring when the row doesn't
      // exist — common during the gap before a `handle_new_user` trigger
      // backfills profiles, or if RLS is hiding the row.
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, custom_fillers, pace_target_low, pace_target_high, focus')
        .eq('id', session.user.id)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.warn('Failed to load profile:', error.message);
        setProfile(null);
        return;
      }
      setProfile(
        data
          ? {
              id: data.id,
              display_name: data.display_name,
              custom_fillers: data.custom_fillers ?? [],
              pace_target_low: data.pace_target_low ?? 130,
              pace_target_high: data.pace_target_high ?? 160,
              focus: data.focus ?? null,
            }
          : null,
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);

  const signIn: AuthContextType['signIn'] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signUp: AuthContextType['signUp'] = async (email, password, displayName) => {
    // raw_user_meta_data.display_name is what the trigger reads
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    // No error + no session ⇒ "Confirm email" is on and a code was emailed.
    return { error, needsConfirmation: !error && !data.session };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const updateDisplayName: AuthContextType['updateDisplayName'] = async (name) => {
    const userId = session?.user.id;
    if (!userId) return { error: new Error('Not signed in') };
    // .select() so a missing/RLS-hidden row surfaces as an error instead of a
    // silent no-op that leaves the local state out of sync with the DB.
    const { data, error } = await supabase
      .from('profiles')
      .update({ display_name: name })
      .eq('id', userId)
      .select('id');
    if (error) return { error: new Error(error.message) };
    if (!data || data.length === 0) return { error: new Error('Profile not found') };
    setProfile((p) =>
      p
        ? { ...p, display_name: name }
        : { id: userId, display_name: name, custom_fillers: [], pace_target_low: 130, pace_target_high: 160, focus: null },
    );
    return { error: null };
  };

  // Replace the signed-in user's custom filler list (profiles.custom_fillers) and
  // refresh local profile so the next finalize picks it up. Same shape as
  // updateDisplayName: .select() turns a missing/RLS-hidden row into an error.
  const updateCustomFillers: AuthContextType['updateCustomFillers'] = async (fillers) => {
    const userId = session?.user.id;
    if (!userId) return { error: new Error('Not signed in') };
    const { data, error } = await supabase
      .from('profiles')
      .update({ custom_fillers: fillers })
      .eq('id', userId)
      .select('id');
    if (error) return { error: new Error(error.message) };
    if (!data || data.length === 0) return { error: new Error('Profile not found') };
    setProfile((p) =>
      p
        ? { ...p, custom_fillers: fillers }
        : { id: userId, display_name: null, custom_fillers: fillers, pace_target_low: 130, pace_target_high: 160, focus: null },
    );
    return { error: null };
  };

  // Replace the signed-in user's pace target band (profiles.pace_target_low/high)
  // and refresh local profile so the next finalize snapshots it. The DB CHECK also
  // enforces low < high; we validate client-side before calling so it never trips.
  const updatePaceTarget: AuthContextType['updatePaceTarget'] = async (low, high) => {
    const userId = session?.user.id;
    if (!userId) return { error: new Error('Not signed in') };
    const { data, error } = await supabase
      .from('profiles')
      .update({ pace_target_low: low, pace_target_high: high })
      .eq('id', userId)
      .select('id');
    if (error) return { error: new Error(error.message) };
    if (!data || data.length === 0) return { error: new Error('Profile not found') };
    setProfile((p) =>
      p
        ? { ...p, pace_target_low: low, pace_target_high: high }
        : { id: userId, display_name: null, custom_fillers: [], pace_target_low: low, pace_target_high: high, focus: null },
    );
    return { error: null };
  };

  // Set the signed-in user's practice focus (a preset key from lib/focus.ts, or
  // null to clear) and refresh local profile so the next finalize tunes feedback.
  const updateFocus: AuthContextType['updateFocus'] = async (focus) => {
    const userId = session?.user.id;
    if (!userId) return { error: new Error('Not signed in') };
    const { data, error } = await supabase
      .from('profiles')
      .update({ focus })
      .eq('id', userId)
      .select('id');
    if (error) return { error: new Error(error.message) };
    if (!data || data.length === 0) return { error: new Error('Profile not found') };
    setProfile((p) =>
      p
        ? { ...p, focus }
        : { id: userId, display_name: null, custom_fillers: [], pace_target_low: 130, pace_target_high: 160, focus },
    );
    return { error: null };
  };

  const updatePassword: AuthContextType['updatePassword'] = async (password) => {
    const { error } = await supabase.auth.updateUser({ password });
    return { error };
  };

  const deleteAccount: AuthContextType['deleteAccount'] = async () => {
    // The Edge Function does the actual deletion (service-role only); supabase-js
    // attaches the user's JWT so it knows whose account to remove.
    const { error } = await supabase.functions.invoke('delete-account');
    if (error) return { error: new Error(error.message) };
    // The account is gone — clear the local session (also drops us to /sign-in).
    await supabase.auth.signOut();
    return { error: null };
  };

  const confirmSignup: AuthContextType['confirmSignup'] = async (email, token) => {
    // type 'email' (not the deprecated 'signup') confirms the address; on success the
    // returned session flows through onAuthStateChange → the (auth) layout redirects.
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    return { error };
  };

  const resendSignupCode: AuthContextType['resendSignupCode'] = async (email) => {
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    return { error };
  };

  const requestPasswordReset: AuthContextType['requestPasswordReset'] = async (email) => {
    // With the "Reset Password" email template set to {{ .Token }}, this emails a code.
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    return { error };
  };

  const confirmRecoveryCode: AuthContextType['confirmRecoveryCode'] = async (email, token) => {
    // Set + persist recoveryMode BEFORE verifyOtp so the session that appears can't
    // trigger a redirect-home before the new password is set (and survives a kill).
    setRecoveryMode(true);
    await AsyncStorage.setItem(RECOVERY_KEY, '1');
    const clear = async () => {
      setRecoveryMode(false);
      await AsyncStorage.removeItem(RECOVERY_KEY);
    };
    try {
      const { error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
      if (error) await clear(); // failed — no session, free the gate
      return { error };
    } catch (e: any) {
      await clear(); // network throw etc. — never leave the gate stuck
      return { error: e instanceof Error ? e : new Error('Verification failed') };
    }
  };

  const finishRecovery: AuthContextType['finishRecovery'] = () => {
    setRecoveryMode(false);
    AsyncStorage.removeItem(RECOVERY_KEY);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        signIn,
        signUp,
        signOut,
        updateDisplayName,
        updateCustomFillers,
        updatePaceTarget,
        updateFocus,
        updatePassword,
        deleteAccount,
        confirmSignup,
        resendSignupCode,
        requestPasswordReset,
        confirmRecoveryCode,
        recoveryMode,
        finishRecovery,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
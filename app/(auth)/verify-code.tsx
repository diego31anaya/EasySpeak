// app/(auth)/verify-code.tsx — the shared code-entry route, parameterized by purpose.
//   purpose=signup   → confirmSignup; on success a session appears → (auth) redirects in.
//   purpose=recovery → confirmRecoveryCode (sets recoveryMode); on success → /new-password.
// Reuses <CodeEntryForm/>, the same component the Settings email-change flow can use.

import { Redirect, router, useLocalSearchParams } from 'expo-router';

import { useAuth } from '../../lib/auth';
import { CodeEntryForm } from '../../components/CodeEntryForm';

export default function VerifyCode() {
  const params = useLocalSearchParams<{ email?: string; purpose?: string }>();
  const email = params.email ?? '';
  const isRecovery = params.purpose === 'recovery';
  const { confirmSignup, resendSignupCode, confirmRecoveryCode, requestPasswordReset } = useAuth();

  // No email param (deep link / nav restore) — nowhere to verify/resend a code.
  if (!email) return <Redirect href="/sign-in" />;

  const onVerify = async (code: string) => {
    if (isRecovery) {
      const { error } = await confirmRecoveryCode(email, code);
      // Verified → we hold a recovery session; collect the new password next. The
      // (auth) layout won't bounce home because recoveryMode is set.
      if (!error) router.replace('/new-password');
      return { error };
    }
    // Signup: a successful verify mints the session and the (auth) layout redirects.
    return confirmSignup(email, code);
  };

  const onResend = () => (isRecovery ? requestPasswordReset(email) : resendSignupCode(email));

  return (
    <CodeEntryForm
      email={email}
      title={isRecovery ? 'Reset your password' : 'Verify your email'}
      subtitle="Enter the 6-digit code we sent to"
      onVerify={onVerify}
      onResend={onResend}
      onBack={() => router.back()}
    />
  );
}
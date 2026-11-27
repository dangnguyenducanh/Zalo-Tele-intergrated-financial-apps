import { Alert, Button, Link, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Link as RouterLink } from 'react-router';
import { AuthError, postAuth } from '@/auth/session';
import { useAuth } from '@/auth/useAuth';
import { errorMessage } from '@/i18n/errors';
import type { ResendAnswer } from '@/types/api';
import { numberIn } from './apiDetails';
import AuthLayout from './AuthLayout';
import CodeInput, { CODE_LENGTH } from './CodeInput';
import { clearPendingSignup, readPendingSignup, savePendingSignup, type PendingSignup } from './pendingSignup';

// "Check your email" (docs/05 §5.11.2): the 6-digit code that finishes a sign-up Register started with a 202.
export default function VerifyEmailPage() {
  const { t } = useTranslation('auth');
  const { status } = useAuth();
  // Read once: removing the entry after a successful sign-up must not send this page to /register.
  const [pending] = useState(readPendingSignup);

  if (status === 'authenticated') return <Navigate to="/" replace />;
  if (!pending) return <Navigate to="/register" replace />; // opened bare or in another tab: nothing to confirm here
  return (
    <AuthLayout title={t('verify.title')}>
      <VerifyForm pending={pending} />
    </AuthLayout>
  );
}

function VerifyForm({ pending }: { pending: PendingSignup }) {
  const { t } = useTranslation('auth');
  const { verifySignup } = useAuth();
  const [code, setCode] = useState('');
  // What is wrong with the code box, translated when shown (so a language switch mid-flow still reads right).
  const [codeProblem, setCodeProblem] = useState<{ kind: 'short' } | { kind: 'wrong'; attemptsLeft?: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null); // an API error code shown as an alert
  const [notice, setNotice] = useState<'sent' | 'wait' | null>(null);
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendAt, setResendAt] = useState(pending.resendAt);
  const [now, setNow] = useState(Date.now);
  const checkingRef = useRef(false); // one verify request at a time: auto-submit followed by Enter sends one
  const inputRef = useRef<HTMLInputElement>(null);

  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const counting = secondsLeft > 0;
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [counting]);

  function startCountdown(seconds: number) {
    const at = Date.now() + seconds * 1000;
    setResendAt(at);
    setNow(Date.now());
    savePendingSignup({ ...pending, resendAt: at }); // a reload keeps the countdown
  }

  async function submit(value: string) {
    if (checkingRef.current) return;
    if (value.length !== CODE_LENGTH) {
      setCodeProblem({ kind: 'short' });
      inputRef.current?.focus();
      return;
    }
    checkingRef.current = true;
    setChecking(true);
    setCodeProblem(null);
    setProblem(null);
    setNotice(null);
    try {
      await verifySignup({ email: pending.email, code: value, signupToken: pending.signupToken });
      clearPendingSignup(); // the session is set: the page now redirects to /
    } catch (error) {
      const failure = error instanceof AuthError ? error : new AuthError('GENERIC');
      if (failure.code === 'CODE_INVALID') {
        setCodeProblem({ kind: 'wrong', attemptsLeft: numberIn(failure.details, 'attemptsLeft') });
        setCode('');
      } else {
        if (failure.code === 'EMAIL_TAKEN') clearPendingSignup(); // nothing left to confirm
        if (failure.code === 'CODE_EXPIRED') setCode('');
        setProblem(failure.code); // other errors keep the code, so Confirm retries it
      }
      inputRef.current?.focus();
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }

  async function resend() {
    setResending(true);
    setCodeProblem(null);
    setProblem(null);
    setNotice(null);
    try {
      const { resendAfter } = await postAuth<ResendAnswer>('register/resend', { email: pending.email });
      startCountdown(resendAfter);
      setCode('');
      setNotice('sent');
      inputRef.current?.focus();
    } catch (error) {
      const failure = error instanceof AuthError ? error : new AuthError('GENERIC');
      const retryAfter = numberIn(failure.details, 'retryAfter');
      if (failure.code === 'RATE_LIMITED' && retryAfter !== undefined) {
        startCountdown(retryAfter);
        setNotice('wait');
      } else {
        setProblem(failure.code);
      }
    } finally {
      setResending(false);
    }
  }

  const prefill = { name: pending.name, email: pending.email }; // "Change it" and "register again" fill the form again
  const codeProblemText =
    codeProblem?.kind === 'short'
      ? t('verify.codeLength')
      : codeProblem?.attemptsLeft === undefined
        ? codeProblem && errorMessage('CODE_INVALID')
        : t('verify.wrongCode', { count: codeProblem.attemptsLeft });
  const offerRegister = problem === 'CODE_EXPIRED' || problem === 'FEATURE_NOT_CONFIGURED';
  const statusLine = checking ? t('verify.checking') : notice === 'sent' ? t('verify.newCodeSent') : notice === 'wait' ? t('verify.tooSoon') : null;

  return (
    <>
      <Typography sx={{ overflowWrap: 'anywhere' }}>{t('verify.intro', { email: pending.maskedEmail })}</Typography>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit(code);
        }}
      >
        {problem && <Alert severity="error" sx={{ mt: 2 }}>{errorMessage(problem)}</Alert>}
        <CodeInput
          label={t('verify.codeLabel')}
          value={code}
          onChange={(next) => {
            setCode(next);
            setCodeProblem(null);
          }}
          onComplete={(done) => void submit(done)}
          error={Boolean(codeProblem)}
          helperText={codeProblemText ?? t('verify.spamHint')}
          inputRef={inputRef}
          autoFocus
        />
        {statusLine && (
          <Typography role="status" variant="body2" sx={{ color: 'text.secondary' }}>
            {statusLine}
          </Typography>
        )}
        <Button type="submit" variant="contained" size="large" fullWidth loading={checking} sx={{ mt: 2 }}>
          {t('verify.confirm')}
        </Button>
      </form>
      <Stack direction="row" sx={{ mt: 2, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 2 }}>
        <Button variant="text" onClick={() => void resend()} disabled={counting} loading={resending}>
          {counting ? t('verify.resendIn', { seconds: secondsLeft }) : t('verify.resend')}
        </Button>
        <Link component={RouterLink} to="/register" state={prefill} onClick={clearPendingSignup}>
          {t('verify.changeEmail')}
        </Link>
      </Stack>
      {offerRegister && (
        <Typography sx={{ mt: 1 }}>
          <Link component={RouterLink} to="/register" state={prefill} onClick={clearPendingSignup}>
            {t('verify.registerAgain')}
          </Link>
        </Typography>
      )}
      {problem === 'EMAIL_TAKEN' && (
        <Typography sx={{ mt: 1 }}>
          <Link component={RouterLink} to="/login">
            {t('verify.toLogin')}
          </Link>
        </Typography>
      )}
    </>
  );
}

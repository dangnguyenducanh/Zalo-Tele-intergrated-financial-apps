import { Alert, Button, Link, TextField, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Link as RouterLink, useNavigate } from 'react-router';
import { AuthError, postAuth } from '@/auth/session';
import { useAuth } from '@/auth/useAuth';
import { errorMessage } from '@/i18n/errors';
import type { ResendAnswer, ResetPasswordInput } from '@/types/api';
import { numberIn } from './apiDetails';
import AuthLayout from './AuthLayout';
import CodeInput from './CodeInput';
import PasswordField from './PasswordField';
import { clearPendingReset, readPendingReset, savePendingReset } from './pendingReset';
import { useAuthForm } from './useAuthForm';
import { useCountdown } from './useCountdown';
import { validateForgot, validateReset } from './validation';

type Countdown = ReturnType<typeof useCountdown>;
// Remembers the address and the wait (for a reload) and shows the step: sent = the 202 came (step 2).
type Remember = (email: string, waitSeconds: number, sent: boolean) => void;

// Forgot password (docs/05 §5.11.4): step 1 asks for the address, step 2 takes the emailed code and the new password.
export default function ForgotPasswordPage() {
  const { t } = useTranslation('auth');
  const { status } = useAuth();
  const [pending, setPending] = useState(readPendingReset);
  const timer = useCountdown(pending?.resendAt);
  const heading = useRef<HTMLHeadingElement>(null);
  const onStep2 = pending?.sent === true;

  // Moving to step 2 (or opening it again after a reload) puts the screen reader on the new heading.
  useEffect(() => {
    if (onStep2) heading.current?.focus();
  }, [onStep2]);

  const remember: Remember = (email, waitSeconds, sent) => {
    const next = { email, resendAt: timer.start(waitSeconds), sent };
    savePendingReset(next);
    setPending(next);
  };
  const changeEmail = () => {
    clearPendingReset();
    timer.start(0);
    setPending(null);
  };

  if (status === 'authenticated') return <Navigate to="/" replace />;
  return (
    <AuthLayout title={onStep2 ? t('forgot.codeTitle') : t('forgot.title')} headingRef={heading}>
      {onStep2 ? (
        <ResetStep email={pending.email} timer={timer} remember={remember} changeEmail={changeEmail} />
      ) : (
        <EmailStep initialEmail={pending?.email ?? ''} timer={timer} remember={remember} />
      )}
    </AuthLayout>
  );
}

// What the screen says for an API error code; the one code this screen words itself is FEATURE_NOT_CONFIGURED.
function problemText(code: string, t: (key: string) => string) {
  return code === 'FEATURE_NOT_CONFIGURED' ? t('forgot.notConfigured') : errorMessage(code);
}

function EmailStep({ initialEmail, timer, remember }: { initialEmail: string; timer: Countdown; remember: Remember }) {
  const { t } = useTranslation('auth');
  const { field, onSubmit, serverError, busy } = useAuthForm({ email: initialEmail }, validateForgot, async (values) => {
    const email = values.email.trim();
    try {
      const { resendAfter } = await postAuth<ResendAnswer>('password/forgot', { email });
      remember(email, resendAfter, true); // 202 whether or not the account exists: always step 2
    } catch (error) {
      // A 429 means "wait": keep the address and the countdown, so a reload does not lose them.
      const wait = error instanceof AuthError && error.code === 'RATE_LIMITED' ? numberIn(error.details, 'retryAfter') : undefined;
      if (wait !== undefined) remember(email, wait, false);
      throw error;
    }
  });

  return (
    <>
      <Typography>{t('forgot.intro')}</Typography>
      <form noValidate onSubmit={onSubmit}>
        {serverError && <Alert severity="error" sx={{ mt: 2 }}>{problemText(serverError, t)}</Alert>}
        <TextField label={t('fields.email')} type="email" autoComplete="email" autoFocus {...field('email')} />
        <Button type="submit" variant="contained" size="large" fullWidth loading={busy} disabled={timer.counting} sx={{ mt: 2 }}>
          {timer.counting ? t('forgot.sendIn', { seconds: timer.seconds }) : t('forgot.send')}
        </Button>
      </form>
      <Typography sx={{ mt: 2, textAlign: 'center' }}>
        <Link component={RouterLink} to="/login">
          {t('forgot.toLogin')}
        </Link>
      </Typography>
    </>
  );
}

type ResetStepProps = { email: string; timer: Countdown; remember: Remember; changeEmail: () => void };

function ResetStep({ email, timer, remember, changeEmail }: ResetStepProps) {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const codeRef = useRef<HTMLInputElement>(null);
  const [wrongCode, setWrongCode] = useState<{ attemptsLeft?: number } | null>(null); // translated when shown, so a language switch re-reads right
  const [notice, setNotice] = useState<'sent' | 'wait' | null>(null);
  const [resendProblem, setResendProblem] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  const { field, set, onSubmit, serverError, busy } = useAuthForm(
    { code: '', newPassword: '', confirm: '' },
    validateReset,
    async (values) => {
      setWrongCode(null);
      setNotice(null);
      setResendProblem(null);
      const body: ResetPasswordInput = { email, code: values.code, newPassword: values.newPassword };
      await postAuth('password/reset', body);
      clearPendingReset();
      void navigate('/login', { replace: true, state: { passwordChanged: true } }); // no automatic login
    },
    (error, setValue) => {
      if (error.code === 'CODE_INVALID') {
        setWrongCode({ attemptsLeft: numberIn(error.details, 'attemptsLeft') }); // shown at the box, not as an alert
        setValue('code', '');
        codeRef.current?.focus();
        return true;
      }
      if (error.code === 'CODE_EXPIRED' || error.code === 'ACCOUNT_LOCKED') {
        setValue('code', ''); // the code is spent
        codeRef.current?.focus();
      }
      return false; // the alert says the rest
    },
  );

  // Resend calls forgot again (decision D7: there is no reset-resend endpoint).
  async function resend() {
    setResending(true);
    setWrongCode(null);
    setNotice(null);
    setResendProblem(null);
    try {
      const { resendAfter } = await postAuth<ResendAnswer>('password/forgot', { email });
      remember(email, resendAfter, true);
      set('code', '');
      setNotice('sent');
      codeRef.current?.focus();
    } catch (error) {
      const failure = error instanceof AuthError ? error : new AuthError('GENERIC');
      const wait = failure.code === 'RATE_LIMITED' ? numberIn(failure.details, 'retryAfter') : undefined;
      if (wait !== undefined) {
        remember(email, wait, true);
        setNotice('wait');
      } else {
        setResendProblem(failure.code);
      }
    } finally {
      setResending(false);
    }
  }

  const code = field('code');
  const codeText = wrongCode
    ? wrongCode.attemptsLeft === undefined
      ? errorMessage('CODE_INVALID')
      : t('verify.wrongCode', { count: wrongCode.attemptsLeft })
    : code.helperText;
  const problem = resendProblem ?? serverError;
  const statusLine = notice === 'sent' ? t('verify.newCodeSent') : notice === 'wait' ? t('verify.tooSoon') : null;

  return (
    <>
      <Typography sx={{ overflowWrap: 'anywhere' }}>{t('forgot.sentTo', { email })}</Typography>
      <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
        {t('forgot.signOutNote')}
      </Typography>
      <form noValidate onSubmit={onSubmit}>
        {problem && <Alert severity="error" sx={{ mt: 2 }}>{problemText(problem, t)}</Alert>}
        <CodeInput
          name="code"
          label={t('verify.codeLabel')}
          value={code.value}
          onChange={(next) => {
            set('code', next);
            setWrongCode(null);
          }}
          autoSubmit={false} // there is a new password to fill in before anything is sent
          error={code.error || Boolean(wrongCode)}
          helperText={codeText ?? t('verify.spamHint')}
          inputRef={codeRef}
        />
        <PasswordField label={t('forgot.newPassword')} autoComplete="new-password" {...field('newPassword')} helperText={field('newPassword').helperText ?? t('fields.passwordHint')} />
        <PasswordField label={t('forgot.confirm')} autoComplete="new-password" {...field('confirm')} />
        {statusLine && (
          <Typography role="status" variant="body2" sx={{ color: 'text.secondary' }}>
            {statusLine}
          </Typography>
        )}
        <Button type="submit" variant="contained" size="large" fullWidth loading={busy} sx={{ mt: 2 }}>
          {t('forgot.save')}
        </Button>
      </form>
      <Button variant="text" onClick={() => void resend()} disabled={timer.counting} loading={resending} sx={{ mt: 2 }}>
        {timer.counting ? t('verify.resendIn', { seconds: timer.seconds }) : t('verify.resend')}
      </Button>
      <Button variant="text" onClick={changeEmail} sx={{ mt: 2, ml: 1 }}>
        {t('verify.changeEmail')}
      </Button>
    </>
  );
}

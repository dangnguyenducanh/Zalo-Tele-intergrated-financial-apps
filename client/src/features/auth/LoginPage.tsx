import { Alert, Button, Link, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Link as RouterLink, useLocation, useNavigate } from 'react-router';
import { getRefreshFailure } from '@/auth/session';
import { useAuth } from '@/auth/useAuth';
import { errorMessage } from '@/i18n/errors';
import AuthLayout from './AuthLayout';
import PasswordField from './PasswordField';
import { clearPendingReset } from './pendingReset';
import { useAuthForm } from './useAuthForm';
import { validateLogin } from './validation';

export default function LoginPage() {
  const { t } = useTranslation('auth');
  const { status, login } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { field, onSubmit, serverError, busy } = useAuthForm({ email: '', password: '' }, validateLogin, async (v) => {
    await login(v.email.trim(), v.password);
    clearPendingReset(); // a password reset begun in this tab must not outlive this login
  });

  // Arriving from a reset (docs/05 §5.11.3): the message is read once, then dropped from the history entry, so a
  // reload does not show it again.
  const [changed] = useState(() => (location.state as { passwordChanged?: boolean } | null)?.passwordChanged === true);
  useEffect(() => {
    if (changed) void navigate(location.pathname, { replace: true, state: null });
  }, [changed, navigate, location.pathname]);

  // A failed submit, or else why the session ended (an admin lock, BUG-011).
  const message = serverError ?? getRefreshFailure();

  // Already logged in (or just logged in): go to the page the user first asked for.
  if (status === 'authenticated') return <Navigate to={(location.state as { from?: string } | null)?.from ?? '/'} replace />;

  return (
    <AuthLayout title={t('login.title')}>
      <form noValidate onSubmit={onSubmit}>
        {changed && <Alert severity="success" role="status">{t('login.passwordChanged')}</Alert>}
        {message && <Alert severity="error">{errorMessage(message)}</Alert>}
        <TextField label={t('fields.email')} type="email" autoComplete="email" autoFocus {...field('email')} />
        <PasswordField label={t('fields.password')} autoComplete="current-password" {...field('password')} />
        <Link component={RouterLink} to="/forgot-password" sx={{ display: 'inline-block', py: 0.5 }}>
          {t('login.forgot')}
        </Link>
        <Button type="submit" variant="contained" size="large" fullWidth loading={busy} sx={{ mt: 2 }}>
          {t('login.submit')}
        </Button>
      </form>
      <Typography sx={{ mt: 2, textAlign: 'center' }}>
        {t('login.noAccount')}{' '}
        <Link component={RouterLink} to="/register">
          {t('login.toRegister')}
        </Link>
      </Typography>
    </AuthLayout>
  );
}

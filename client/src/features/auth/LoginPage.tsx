import { Alert, Button, Link, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Navigate, Link as RouterLink, useLocation } from 'react-router';
import { getRefreshFailure } from '@/auth/session';
import { useAuth } from '@/auth/useAuth';
import { errorMessage } from '@/i18n/errors';
import AuthLayout from './AuthLayout';
import PasswordField from './PasswordField';
import { useAuthForm } from './useAuthForm';
import { validateLogin } from './validation';

export default function LoginPage() {
  const { t } = useTranslation('auth');
  const { status, login } = useAuth();
  const location = useLocation();
  const { field, onSubmit, serverError, busy } = useAuthForm({ email: '', password: '' }, validateLogin, (v) =>
    login(v.email.trim(), v.password),
  );

  // A failed submit, or else why the session ended (an admin lock, BUG-011).
  const message = serverError ?? getRefreshFailure();

  // Already logged in (or just logged in): go to the page the user first asked for.
  if (status === 'authenticated') return <Navigate to={(location.state as { from?: string } | null)?.from ?? '/'} replace />;

  return (
    <AuthLayout title={t('login.title')}>
      <form noValidate onSubmit={onSubmit}>
        {message && <Alert severity="error">{errorMessage(message)}</Alert>}
        <TextField label={t('fields.email')} type="email" autoComplete="email" autoFocus {...field('email')} />
        <PasswordField label={t('fields.password')} autoComplete="current-password" {...field('password')} />
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

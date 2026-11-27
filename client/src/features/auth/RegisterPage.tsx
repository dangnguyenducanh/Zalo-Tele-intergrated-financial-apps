import { Alert, Button, Link, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Navigate, Link as RouterLink, useLocation, useNavigate } from 'react-router';
import { useAppSelector } from '@/app/hooks';
import { useAuth } from '@/auth/useAuth';
import { errorMessage } from '@/i18n/errors';
import AuthLayout from './AuthLayout';
import PasswordField from './PasswordField';
import { savePendingSignup } from './pendingSignup';
import { useAuthForm } from './useAuthForm';
import { validateRegister } from './validation';

export default function RegisterPage() {
  const { t } = useTranslation('auth');
  const { status, register } = useAuth();
  const language = useAppSelector((s) => s.ui.language); // the language picked in the corner becomes the profile language
  const navigate = useNavigate();
  const prefill = useLocation().state as { name?: unknown; email?: unknown } | null; // from "Wrong email? Change it"
  const { field, onSubmit, serverError, busy } = useAuthForm(
    { name: typeof prefill?.name === 'string' ? prefill.name : '', email: typeof prefill?.email === 'string' ? prefill.email : '', password: '', confirm: '' },
    validateRegister,
    async (v) => {
      const name = v.name.trim();
      const email = v.email.trim();
      const pending = await register({ name, email, password: v.password, language });
      if (!pending) return; // 201: logged in, this page redirects
      // 202: a code was emailed. Keep what /verify-email needs (never the password) and go there.
      savePendingSignup({ email, maskedEmail: pending.email, name, signupToken: pending.signupToken, resendAt: Date.now() + pending.resendAfter * 1000 });
      void navigate('/verify-email');
    },
  );

  if (status === 'authenticated') return <Navigate to="/" replace />;

  return (
    <AuthLayout title={t('register.title')}>
      <form noValidate onSubmit={onSubmit}>
        {serverError && <Alert severity="error">{errorMessage(serverError)}</Alert>}
        <TextField label={t('fields.name')} autoComplete="name" autoFocus {...field('name')} />
        <TextField label={t('fields.email')} type="email" autoComplete="email" {...field('email')} />
        <PasswordField
          label={t('fields.password')}
          autoComplete="new-password"
          {...field('password')}
          helperText={field('password').helperText ?? t('fields.passwordHint')}
        />
        <PasswordField label={t('fields.confirm')} autoComplete="new-password" {...field('confirm')} />
        <Button type="submit" variant="contained" size="large" fullWidth loading={busy} sx={{ mt: 2 }}>
          {t('register.submit')}
        </Button>
      </form>
      <Typography sx={{ mt: 2, textAlign: 'center' }}>
        {t('register.hasAccount')}{' '}
        <Link component={RouterLink} to="/login">
          {t('register.toLogin')}
        </Link>
      </Typography>
    </AuthLayout>
  );
}

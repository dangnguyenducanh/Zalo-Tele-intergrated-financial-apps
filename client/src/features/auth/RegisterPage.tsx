import { Alert, Button, Link, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Navigate, Link as RouterLink } from 'react-router';
import { useAppSelector } from '@/app/hooks';
import { useAuth } from '@/auth/useAuth';
import { errorMessage } from '@/i18n/errors';
import AuthLayout from './AuthLayout';
import PasswordField from './PasswordField';
import { useAuthForm } from './useAuthForm';
import { validateRegister } from './validation';

export default function RegisterPage() {
  const { t } = useTranslation('auth');
  const { status, register } = useAuth();
  const language = useAppSelector((s) => s.ui.language); // the language picked in the corner becomes the profile language
  const { field, onSubmit, serverError, busy } = useAuthForm(
    { name: '', email: '', password: '', confirm: '' },
    validateRegister,
    (v) => register({ name: v.name.trim(), email: v.email.trim(), password: v.password, language }),
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

import { Alert, Button, Paper, Typography } from '@mui/material';
import { useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '@/app/hooks';
import { showSnackbar } from '@/app/uiSlice';
import { useAuth } from '@/auth/useAuth';
import PasswordField from '@/features/auth/PasswordField';
import { passwordTooLong } from '@/features/auth/validation';
import { apiErrorMessage } from '@/features/categories/helpers';
import { isApiError } from '@/types/api';
import { useChangePasswordMutation } from './settingsApi';

type Field = 'currentPassword' | 'newPassword' | 'confirm';
const EMPTY: Record<Field, string> = { currentPassword: '', newPassword: '', confirm: '' };

// Same rules as the API (at least 8 characters, at most 72 bytes) and the register page. Values are i18n keys.
function validate(values: Record<Field, string>): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  if (!values.currentPassword) errors.currentPassword = 'auth:validation.required';
  if (values.newPassword.length < 8) errors.newPassword = 'password.length';
  else if (passwordTooLong(values.newPassword)) errors.newPassword = 'auth:validation.passwordTooLong';
  if (values.confirm !== values.newPassword) errors.confirm = 'auth:validation.confirmMismatch';
  return errors;
}

// PATCH /users/me/password. The server checks the current password and logs out every other device.
export default function PasswordForm() {
  const { t } = useTranslation('settings');
  const titleId = useId();
  const dispatch = useAppDispatch();
  const { user } = useAuth();
  const [changePassword, { isLoading }] = useChangePasswordMutation();
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  // Moves focus to the first wrong field, so keyboard and screen reader users land on the problem.
  const focusField = (form: HTMLFormElement, name: string) => (form.elements.namedItem(name) as HTMLElement | null)?.focus();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const found = validate(values);
    setErrors(found);
    setServerError(null);
    const firstInvalid = Object.keys(found)[0];
    if (firstInvalid) return focusField(form, firstInvalid);
    try {
      await changePassword({ currentPassword: values.currentPassword, newPassword: values.newPassword }).unwrap();
      setValues(EMPTY);
      dispatch(showSnackbar({ message: t('password.changed'), severity: 'success' }));
    } catch (error) {
      const data = (error as { data?: unknown }).data;
      if (isApiError(data) && data.error.code === 'INVALID_CREDENTIALS') {
        setErrors({ currentPassword: 'password.wrongCurrent' });
        focusField(form, 'currentPassword');
      } else {
        setServerError(apiErrorMessage(error));
      }
    }
  }

  const field = (name: Field, autoComplete: string, hint?: string) => ({
    name,
    label: t(`password.${name}`),
    autoComplete,
    value: values[name],
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      setValues({ ...values, [name]: event.target.value });
      setErrors({ ...errors, [name]: undefined }); // clear on input, check again on submit
    },
    error: Boolean(errors[name]),
    helperText: errors[name] ? t(errors[name]) : hint,
    required: true,
    fullWidth: true,
    margin: 'normal' as const,
  });

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography id={titleId} variant="h6" component="h2">
        {t('password.title')}
      </Typography>
      <form noValidate aria-labelledby={titleId} onSubmit={(event) => void submit(event)}>
        {/* Lets password managers know which account the new password belongs to. */}
        <input type="text" name="username" autoComplete="username" value={user?.email ?? ''} readOnly hidden />
        {serverError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {serverError}
          </Alert>
        )}
        <PasswordField {...field('currentPassword', 'current-password')} />
        <PasswordField {...field('newPassword', 'new-password', t('password.hint'))} />
        <PasswordField {...field('confirm', 'new-password')} />
        <Button type="submit" variant="contained" loading={isLoading} sx={{ mt: 1 }}>
          {t('password.submit')}
        </Button>
      </form>
    </Paper>
  );
}

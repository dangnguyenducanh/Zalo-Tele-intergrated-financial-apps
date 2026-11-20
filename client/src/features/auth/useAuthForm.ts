import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthError } from '@/auth/session';
import type { FieldErrors } from './validation';

// Form state shared by the login and register pages: values, field errors, the server error code.
export function useAuthForm<T extends Record<string, string>>(
  initial: T,
  validate: (values: T) => FieldErrors<T>,
  send: (values: T) => Promise<void>,
) {
  const { t } = useTranslation('auth');
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors<T>>({});
  const [serverError, setServerError] = useState<string | null>(null); // an API error code, translated when shown
  const [busy, setBusy] = useState(false);

  // Props for one TextField: value, change handler and its translated error.
  const field = (name: keyof T & string) => {
    const errorKey: string | undefined = errors[name];
    return {
      name,
      value: values[name],
      onChange: (event: ChangeEvent<HTMLInputElement>) => setValues({ ...values, [name]: event.target.value }),
      error: Boolean(errorKey),
      helperText: errorKey ? t(errorKey) : undefined,
      required: true,
      fullWidth: true,
      margin: 'normal' as const,
    };
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validate(values);
    setErrors(found);
    const firstInvalid = Object.keys(found)[0];
    if (firstInvalid) {
      // Move focus to the first wrong field so keyboard and screen reader users land on the problem.
      (event.currentTarget.elements.namedItem(firstInvalid) as HTMLElement | null)?.focus();
      return;
    }
    setBusy(true);
    setServerError(null);
    try {
      await send(values); // on success AuthContext turns "authenticated" and the page redirects
    } catch (error) {
      setServerError(error instanceof AuthError ? error.code : 'GENERIC');
      setBusy(false);
    }
  }

  return { field, onSubmit, serverError, busy };
}

// Client-side checks that mirror the API rules (docs/04 §4.3: password ≥ 8, name 1–60).
// Each error is an i18n key in auth.json; the API still validates everything again.

export type LoginValues = { email: string; password: string };
export type RegisterValues = LoginValues & { name: string; confirm: string };
export type FieldErrors<T> = Partial<Record<keyof T, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLogin({ email, password }: LoginValues): FieldErrors<LoginValues> {
  const errors: FieldErrors<LoginValues> = {};
  if (!email.trim()) errors.email = 'validation.required';
  else if (!EMAIL.test(email.trim())) errors.email = 'validation.email';
  if (!password) errors.password = 'validation.required';
  return errors;
}

export function validateRegister(values: RegisterValues): FieldErrors<RegisterValues> {
  const errors: FieldErrors<RegisterValues> = {};
  const name = values.name.trim();
  if (name.length < 1 || name.length > 60) errors.name = 'validation.nameLength';
  const { email } = validateLogin(values);
  if (email) errors.email = email;
  if (values.password.length < 8) errors.password = 'validation.passwordLength';
  if (values.confirm !== values.password) errors.confirm = 'validation.confirmMismatch';
  return errors;
}

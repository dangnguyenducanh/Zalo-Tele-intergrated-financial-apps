import { CODE_LENGTH } from './CodeInput';

// Client-side checks that mirror the API rules (docs/04 §4.3: password ≥ 8 characters and ≤ 72 bytes, name 1–60).
// Each error is an i18n key in auth.json; the API still validates everything again.

export type LoginValues = { email: string; password: string };
export type RegisterValues = LoginValues & { name: string; confirm: string };
export type ForgotValues = { email: string };
export type ResetValues = { code: string; newPassword: string; confirm: string };
export type FieldErrors<T> = Partial<Record<keyof T, string>>;

// The same pattern as the server's z.email() (zod 4 `z.regexes.email`), so the browser rejects what the API rejects (BUG-012).
const EMAIL = /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

// bcrypt on the server reads only the first 72 bytes, and a Vietnamese letter takes 2–3 of them (BUG-009).
export const passwordTooLong = (password: string) => new TextEncoder().encode(password).length > 72;

export function validateLogin({ email, password }: LoginValues): FieldErrors<LoginValues> {
  const errors: FieldErrors<LoginValues> = {};
  if (!email.trim()) errors.email = 'validation.required';
  else if (!EMAIL.test(email.trim())) errors.email = 'validation.email';
  if (!password) errors.password = 'validation.required';
  return errors;
}

// The rule for a new password, shared by Register and the reset form.
const newPasswordError = (password: string) =>
  password.length < 8 ? 'validation.passwordLength' : passwordTooLong(password) ? 'validation.passwordTooLong' : undefined;

export function validateRegister(values: RegisterValues): FieldErrors<RegisterValues> {
  const errors: FieldErrors<RegisterValues> = {};
  const name = values.name.trim();
  if (name.length < 1 || name.length > 60) errors.name = 'validation.nameLength';
  const { email } = validateLogin(values);
  if (email) errors.email = email;
  const password = newPasswordError(values.password);
  if (password) errors.password = password;
  if (values.confirm !== values.password) errors.confirm = 'validation.confirmMismatch';
  return errors;
}

export function validateForgot({ email }: ForgotValues): FieldErrors<ForgotValues> {
  const { email: problem } = validateLogin({ email, password: 'x' });
  return problem ? { email: problem } : {};
}

// The code comes first, so a wrong form moves focus to the code box before the password.
export function validateReset(values: ResetValues): FieldErrors<ResetValues> {
  const errors: FieldErrors<ResetValues> = {};
  if (values.code.length !== CODE_LENGTH) errors.code = 'verify.codeLength';
  const newPassword = newPasswordError(values.newPassword);
  if (newPassword) errors.newPassword = newPassword;
  if (values.confirm !== values.newPassword) errors.confirm = 'validation.confirmMismatch';
  return errors;
}

// What each field's rule says, for a field the API still rejects (VALIDATION_ERROR names it in details[].path).
const RULE_OF_FIELD = new Map([
  ['name', 'validation.nameLength'],
  ['email', 'validation.email'],
  ['password', 'fields.passwordHint'],
  ['newPassword', 'fields.passwordHint'], // /auth/password/reset names it newPassword
]);

// Turns the API's details into field errors of this form (BUG-012), so the wrong field is marked, not only the alert.
export function fieldErrorsFromApi<T extends object>(details: unknown, values: T): FieldErrors<T> {
  const errors: Record<string, string> = {};
  for (const detail of Array.isArray(details) ? (details as { path?: unknown }[]) : []) {
    const path = String(detail?.path);
    const rule = RULE_OF_FIELD.get(path);
    if (rule && path in values) errors[path] = rule;
  }
  return errors as FieldErrors<T>;
}

// Client-side checks that mirror the API rules (docs/04 §4.3: password ≥ 8 characters and ≤ 72 bytes, name 1–60).
// Each error is an i18n key in auth.json; the API still validates everything again.

export type LoginValues = { email: string; password: string };
export type RegisterValues = LoginValues & { name: string; confirm: string };
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

export function validateRegister(values: RegisterValues): FieldErrors<RegisterValues> {
  const errors: FieldErrors<RegisterValues> = {};
  const name = values.name.trim();
  if (name.length < 1 || name.length > 60) errors.name = 'validation.nameLength';
  const { email } = validateLogin(values);
  if (email) errors.email = email;
  if (values.password.length < 8) errors.password = 'validation.passwordLength';
  else if (passwordTooLong(values.password)) errors.password = 'validation.passwordTooLong';
  if (values.confirm !== values.password) errors.confirm = 'validation.confirmMismatch';
  return errors;
}

// What each field's rule says, for a field the API still rejects (VALIDATION_ERROR names it in details[].path).
const RULE_OF_FIELD = new Map([
  ['name', 'validation.nameLength'],
  ['email', 'validation.email'],
  ['password', 'fields.passwordHint'],
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

import i18n from './index';

// API errors carry a stable code (docs/04 §4.5); the message shown to the user is errors:<CODE>.
export function errorMessage(code: string): string {
  return i18n.t(code, { ns: 'errors', defaultValue: i18n.t('GENERIC', { ns: 'errors' }) });
}

// Small helpers shared by the categories and wallets screens.
import { isApiError } from '@/types/api';
import { errorMessage } from '@/i18n/errors';

// The same rule as server/src/utils/normalize.js, which the bot parser matches with:
// lower-case, no Vietnamese diacritics, single spaces. "Phở Bò" → "pho bo".
export function normalizeKeyword(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD') // "ở" → "o" + combining marks
    .replace(/[̀-ͯ]/g, '') // drop the combining marks
    .replace(/đ/g, 'd') // "đ" is its own letter, not "d" + a mark
    .replace(/\s+/g, ' ')
    .trim();
}

// Chip values → keywords: a comma separates several, each is normalised, empties and duplicates dropped.
export function normalizeKeywords(values: string[]): string[] {
  return [
    ...new Set(
      values
        .flatMap((value) => value.split(','))
        .map(normalizeKeyword)
        .filter(Boolean),
    ),
  ];
}

// The translated message for a failed RTK Query call (unwrap() rejects with { status, data }).
export function apiErrorMessage(error: unknown): string {
  const { status, data } = (error ?? {}) as { status?: unknown; data?: unknown };
  if (isApiError(data)) return errorMessage(data.error.code);
  return errorMessage(status === 'FETCH_ERROR' ? 'NETWORK_ERROR' : 'GENERIC');
}

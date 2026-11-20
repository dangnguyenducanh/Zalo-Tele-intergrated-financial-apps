import { formatMoney } from '@/i18n/format';
import type { Language } from '@/types/api';

// Amount field → whole VND, with the bot's shortcuts (docs/02 §2.5): "45k" → 45000, "1.5tr" / "1tr5" → 1500000,
// "150.000" / "150,000" / "150000" → 150000. null when it is not a positive whole amount.
export function parseAmount(text: string): number | null {
  const key = text.toLowerCase().replace(/\s+/g, '').replace(/(đ|vnd)$/, '');
  let m = key.match(/^(\d+)(?:[.,](\d+))?k$/);
  if (m) return whole(Number(`${m[1]}.${m[2] ?? 0}`) * 1e3);
  m = key.match(/^(\d+)(?:[.,](\d+))?(?:tr|m)(\d{1,3})?$/);
  if (m && !(m[2] && m[3])) return whole(Number(`${m[1]}.${m[2] ?? m[3] ?? 0}`) * 1e6);
  if (/^(\d{1,3}([.,]\d{3})+|\d+)$/.test(key)) return whole(Number(key.replace(/[.,]/g, '')));
  return null;
}

function whole(value: number): number | null {
  const amount = Math.round(value);
  return amount > 0 && Number.isSafeInteger(amount) ? amount : null;
}

// 45000 → "45.000" (vi) or "45,000" (en): the amount field shows thousand separators.
export const formatNumber = (amount: number, lang: Language) => amount.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US');

// Expense "−45.000 ₫", income "+45.000 ₫": the sign tells the type, not the colour alone.
export const signedMoney = (type: 'expense' | 'income', amount: number, lang: Language) =>
  `${type === 'income' ? '+' : '−'}${formatMoney(amount, lang)}`;

// A <input type="datetime-local"> holds "YYYY-MM-DDTHH:mm" with no time zone; ours is always Vietnam time.
export function toDateTimeInput(date: Date | string): string {
  return new Date(date).toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 16).replace(' ', 'T');
}

export const fromDateTimeInput = (value: string) => `${value}:00+07:00`; // what the API takes (ISO with offset)

// The list filters, kept in the URL query string (docs/05 §5.7).
export const FILTER_KEYS = ['q', 'from', 'to', 'type', 'walletId', 'categoryId', 'status'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
export type Filters = Partial<Record<FilterKey, string>>;

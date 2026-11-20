import type { Language } from '@/types/api';

const locale = (lang: Language) => (lang === 'vi' ? 'vi-VN' : 'en-US');

// 45000 → "45.000 ₫" (vi) or "₫45,000" (en). Amounts are whole VND.
export function formatMoney(amount: number, lang: Language): string {
  return new Intl.NumberFormat(locale(lang), { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(amount);
}

// Dates are always shown in Vietnam time, whatever the browser's time zone.
export function formatDate(date: Date | string, lang: Language, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  return new Intl.DateTimeFormat(locale(lang), { ...options, timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(date));
}

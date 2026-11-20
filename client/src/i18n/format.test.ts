import { expect, test } from 'vitest';
import { formatDate, formatMoney } from './format';

test('TC-F12-02 money is whole VND in the UI language: "₫45,000" in English, "45.000 ₫" in Vietnamese', () => {
  expect(formatMoney(45000, 'en')).toBe('₫45,000');
  expect(formatMoney(45000, 'vi')).toBe('45.000 ₫');
  expect(formatMoney(1234567, 'en')).toBe('₫1,234,567');
});

test('TC-F12-02 dates are shown in Vietnam time in the UI language', () => {
  // 18:30 UTC on 30 Nov is already 1 Dec in Vietnam (UTC+7).
  expect(formatDate('2026-11-30T18:30:00Z', 'en')).toBe('Dec 1, 2026');
  expect(formatDate('2026-11-30T18:30:00Z', 'vi', { day: '2-digit', month: '2-digit', year: 'numeric' })).toBe('01/12/2026');
});

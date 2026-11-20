import { expect, test } from 'vitest';
import { formatNumber, fromDateTimeInput, parseAmount, signedMoney, toDateTimeInput } from './helpers';

test.each([
  ['45000', 45000],
  ['45.000', 45000],
  ['45,000', 45000],
  ['1.500.000 đ', 1500000],
  ['45k', 45000],
  ['45 K', 45000],
  ['1.5k', 1500],
  ['1tr', 1000000],
  ['1,5tr', 1500000],
  ['1tr5', 1500000],
  ['2m', 2000000],
  ['', null],
  ['0', null],
  ['-5', null],
  ['12.5', null],
  ['abc', null],
  ['1.5tr5', null],
  ['9999999999999999999', null], // beyond Number.MAX_SAFE_INTEGER
])('TC-F4-11 amount field %j → %j', (text, amount) => {
  expect(parseAmount(text)).toBe(amount);
});

test('TC-F4-11 amounts show thousand separators and a sign for the type', () => {
  expect(formatNumber(1500000, 'vi')).toBe('1.500.000');
  expect(formatNumber(1500000, 'en')).toBe('1,500,000');
  expect(signedMoney('expense', 45000, 'vi')).toMatch(/^−45\.000\s₫$/);
  expect(signedMoney('income', 45000, 'en')).toBe('+₫45,000');
});

test('TC-F4-11 date-time field is Vietnam time whatever the browser time zone', () => {
  expect(toDateTimeInput('2026-11-30T17:10:00.000Z')).toBe('2026-12-01T00:10'); // already December in Vietnam
  expect(fromDateTimeInput('2026-12-01T00:10')).toBe('2026-12-01T00:10:00+07:00');
  expect(new Date(fromDateTimeInput('2026-12-01T00:10')).toISOString()).toBe('2026-11-30T17:10:00.000Z');
});

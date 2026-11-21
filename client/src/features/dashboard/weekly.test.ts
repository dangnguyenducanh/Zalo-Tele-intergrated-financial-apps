import { expect, test } from 'vitest';
import type { DayTotal } from './statsApi';
import { previousMonth, weekTotals } from './weekly';

const day = (d: number, expense: number, income = 0): DayTotal => ({ date: `2026-11-${String(d).padStart(2, '0')}`, expense, income });

test('TC-NF-14 weekly buckets: days 1–7, 8–14, 15–21 and 22 to the month end, per flow', () => {
  const days = [day(1, 100), day(7, 50), day(8, 10), day(14, 5, 3), day(15, 7), day(21, 1), day(22, 2, 9), day(30, 4), day(31, 6)];
  expect(weekTotals(days, 'expense')).toEqual([150, 15, 8, 12]); // day 31 still lands in the fourth week
  expect(weekTotals(days, 'income')).toEqual([0, 3, 0, 9]);
  expect(weekTotals([], 'expense')).toEqual([0, 0, 0, 0]);
});

test('TC-NF-14 the comparison month is the calendar month before, across a year boundary', () => {
  expect(previousMonth('2026-11')).toBe('2026-10');
  expect(previousMonth('2026-01')).toBe('2025-12');
});

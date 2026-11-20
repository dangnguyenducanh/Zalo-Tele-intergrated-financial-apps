import { expect, test } from 'vitest';
import { dayRange, monthKey, monthRange } from '../src/utils/vnTime.js';

const lateNov30 = new Date('2026-11-30T16:30:00Z'); // 23:30 on 30/11 in Vietnam
const earlyDec1 = new Date('2026-11-30T17:10:00Z'); // 00:10 on 01/12 in Vietnam (still 30/11 in UTC)
const inRange = (date, { start, end }) => date >= start && date < end;

test('TC-F4-07 month boundaries use Vietnam time', () => {
  expect(monthKey(lateNov30)).toBe('2026-11');
  expect(monthKey(earlyDec1)).toBe('2026-12');

  const november = monthRange('2026-11');
  expect(november).toEqual({ start: new Date('2026-10-31T17:00:00Z'), end: new Date('2026-11-30T17:00:00Z') });
  expect(inRange(lateNov30, november)).toBe(true);
  expect(inRange(earlyDec1, november)).toBe(false);
  expect(inRange(earlyDec1, monthRange('2026-12'))).toBe(true);
  expect(monthRange('2026-12').end).toEqual(new Date('2026-12-31T17:00:00Z')); // rolls over into the next year
});

test('TC-F4-07 day boundaries use Vietnam time', () => {
  expect(dayRange(earlyDec1)).toEqual({ start: new Date('2026-11-30T17:00:00Z'), end: new Date('2026-12-01T17:00:00Z') });
  expect(inRange(lateNov30, dayRange(earlyDec1))).toBe(false);
});

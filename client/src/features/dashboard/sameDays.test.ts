import { expect, test } from 'vitest';
import fixture from '../../../../shared/fixtures/compare-range.json';
import { sameDays, sumDays } from './sameDays';
import type { DayTotal } from './statsApi';

// The same file the server's compareRange() is tested on (server/test/vnTime.test.js), so the Dashboard and the assistant
// cannot drift apart.
test.each(fixture.monthCompare)('TC-F14-02 sameDays: $name', ({ month, today, current, previous }) => {
  expect(sameDays(month, today)).toEqual({ current, previous });
});

test('TC-F14-02 sumDays adds only the days inside the range, for the chosen flow', () => {
  const days: DayTotal[] = [
    { date: '2026-10-31', income: 5, expense: 1 },
    { date: '2026-11-01', income: 7, expense: 2 },
    { date: '2026-11-25', income: 0, expense: 4 },
    { date: '2026-11-26', income: 9, expense: 8 }, // after the range: a bill dated tomorrow is not spent yet
  ];
  const range = { from: '2026-11-01', to: '2026-11-25' };
  expect(sumDays(days, 'expense', range)).toBe(6);
  expect(sumDays(days, 'income', range)).toBe(7);
  expect(sumDays([], 'expense', range)).toBe(0);
});

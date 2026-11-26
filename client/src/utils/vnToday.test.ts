import { afterEach, expect, test, vi } from 'vitest';
import { vnThisMonth, vnToday } from './vnToday';

afterEach(() => vi.useRealTimers());

const clockAt = (iso: string) => vi.useFakeTimers({ toFake: ['Date'], now: new Date(iso) });

// Between 17:00 and 24:00 UTC the date in Vietnam is a day ahead of the date in UTC. A `toISOString().slice(0, 10)` would pass
// every test whose clock is at noon; these two sit on the boundary, whatever time zone the machine is set to.
test('TC-F14-02 vnToday is the Vietnam date, a day ahead of UTC from 17:00Z', () => {
  clockAt('2026-11-30T20:00:00Z'); // 03:00 on 01/12 in Vietnam, still 30/11 in UTC
  expect(vnToday()).toBe('2026-12-01');
  expect(vnThisMonth()).toBe('2026-12');

  clockAt('2026-11-30T16:59:59Z'); // 23:59:59 on 30/11 in Vietnam
  expect(vnToday()).toBe('2026-11-30');
  expect(vnThisMonth()).toBe('2026-11');

  clockAt('2026-12-31T18:00:00Z'); // 01:00 on 01/01/2027 in Vietnam: the year turns too
  expect(vnToday()).toBe('2027-01-01');
  expect(vnThisMonth()).toBe('2027-01');
});

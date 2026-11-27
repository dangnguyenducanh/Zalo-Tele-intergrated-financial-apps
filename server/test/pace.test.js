import { describe, expect, test } from 'vitest';
import fixture from '../../shared/fixtures/pace.json' with { type: 'json' };
import { PACE_FROM_DAY, pace } from '../src/services/budgets.js';

// shared/fixtures/pace.json is read by the agent service's pytest too (its get_budget_pace, T47), so the Budgets chip,
// /dubao, /month, the confirm warning and the assistant say the same thing (docs/02 §2.11.2, A2; "pace everywhere").
describe('TC-F14-28 pace(): every row of shared/fixtures/pace.json', () => {
  test.each(fixture.pace.map((row) => [row.name, row]))('TC-F14-28 %s', (_name, row) => {
    expect(pace(row.input)).toEqual(row.pace);
  });

  test('TC-F14-28 the file holds the A2 example, day 4 and day 5, over the limit, the last day and spent 0', () => {
    const rows = fixture.pace.map((row) => row.input);
    const a2 = fixture.pace.find((row) => row.input.spent === 7_100_000 && row.input.day === 25);
    expect(a2.pace).toEqual({ daysLeft: 6, perDay: 150_000, projectedEnd: 8_520_000, overDay: 29 }); // docs/02 A2: 900.000 for 6 days
    expect(rows.some((r) => r.day === PACE_FROM_DAY - 1)).toBe(true);
    expect(rows.some((r) => r.day === PACE_FROM_DAY)).toBe(true);
    expect(rows.some((r) => r.spent > r.limit)).toBe(true);
    expect(rows.some((r) => r.day === r.daysInMonth)).toBe(true);
    expect(rows.some((r) => r.spent === 0)).toBe(true);
  });

  test('TC-F14-28 nothing before day 5, and never a negative or a fractional number whatever the spending', () => {
    expect(PACE_FROM_DAY).toBe(5);
    for (const daysInMonth of [28, 29, 30, 31]) {
      for (let day = 1; day <= daysInMonth; day += 1) {
        for (const spent of [0, 1, 99, 1_000_000, 7_999_999, 8_000_000, 8_000_001, 12_345_678]) {
          const row = pace({ spent, limit: 8_000_000, day, daysInMonth });
          if (day < PACE_FROM_DAY) {
            expect(row).toBeNull();
            continue;
          }
          expect(Object.values(row).filter((n) => n !== null).every((n) => Number.isSafeInteger(n) && n >= 0)).toBe(true);
          expect(row.daysLeft).toBe(daysInMonth - day + 1);
          expect(row.perDay === null).toBe(spent >= 8_000_000); // no allowance once the limit is reached, never below 0
          if (row.overDay !== null) expect(row.overDay).toBeGreaterThan(day);
          if (row.overDay !== null) expect(row.overDay).toBeLessThanOrEqual(daysInMonth);
        }
      }
    }
  });
});

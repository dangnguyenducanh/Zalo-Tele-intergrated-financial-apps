import { describe, expect, test } from 'vitest';
import fixture from '../../shared/fixtures/money.json' with { type: 'json' };
import { money } from '../src/bot/core.js';
import en from '../src/bot/messages.en.js';
import vi from '../src/bot/messages.vi.js';

// shared/fixtures/money.json is read by the agent service's pytest too (T45, agent/tests/test_money.py), so an amount in a
// bot reply and in an assistant answer is written the same way.
describe('TC-F14-38 money(): every row of shared/fixtures/money.json, in both reply languages', () => {
  test.each(fixture.rows.map((row) => [String(row.amount), row]))('TC-F14-38 %s', (_amount, row) => {
    expect(money(row.amount, vi)).toBe(row.vi);
    expect(money(row.amount, en)).toBe(row.en);
  });
});

import { describe, expect, test } from 'vitest';
import fixture from '../../shared/fixtures/period.json' with { type: 'json' };
import { findPeriod, wordsOf } from '../src/bot/period.js';

// shared/fixtures/period.json is read by the agent service's pytest too (T45), so a time phrase means the same in
// the bot, the web quick add and the assistant.
describe('TC-F14-25 time words and counts: every row of shared/fixtures/period.json', () => {
  test.each(fixture.phrases.map((row) => [row.name, row]))('TC-F14-25 %s', (_name, row) => {
    const { phrases, rest } = findPeriod(wordsOf(row.text));
    expect({ found: phrases, rest }).toEqual({ found: row.found, rest: row.rest });
  });

  test('TC-F14-25 every kind the file documents is found by some row, and no row names another one', () => {
    const kinds = new Set(fixture.phrases.flatMap((row) => row.found.map((phrase) => phrase.kind)));
    expect([...kinds].sort()).toEqual(['date', 'day', 'days', 'items', 'month', 'top', 'week', 'year']);
  });

  test('TC-F14-25 the word indexes a phrase took are the ones the parser skips as amounts', () => {
    const words = wordsOf('chi tiêu 7 ngày qua 50');
    const { indexes } = findPeriod(words);
    expect([...indexes].sort()).toEqual([2, 3, 4]); // "7 ngày qua"; "chi", "tiêu" and the amount "50" are free
  });
});

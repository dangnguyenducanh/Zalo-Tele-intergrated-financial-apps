import { describe, expect, test } from 'vitest';
import { parseLine, parseText } from '../src/bot/parser.js';

// A user's categories as copied from the default templates (docs/03 §3.5), plus one custom category.
const categories = [
  { _id: 'food', type: 'expense', keywords: ['pho', 'bun', 'com', 'banh mi', 'cafe', 'ca phe', 'tra sua', 'an sang', 'an trua', 'coffee', 'lunch', 'dinner'] },
  { _id: 'transport', type: 'expense', keywords: ['grab', 'be', 'xanh sm', 'taxi', 'xang', 'gui xe', 'bus', 've xe', 'parking', 'fuel'] },
  { _id: 'repair', type: 'expense', keywords: ['xe'] }, // user-made "Sửa xe": shorter keyword than "gui xe"
  { _id: 'housing', type: 'expense', keywords: ['tien nha', 'tien tro', 'thue nha', 'rent'] },
  { _id: 'other', type: 'expense', keywords: [], isFallback: true },
  { _id: 'salary', type: 'income', keywords: ['luong', 'salary'] },
  { _id: 'bonus', type: 'income', keywords: ['thuong', 'bonus'] },
  { _id: 'gifts', type: 'income', keywords: ['li xi', 'qua', 'gift'] },
  { _id: 'otherIncome', type: 'income', keywords: ['nhan', 'received'], isFallback: true },
];
const wallets = [
  { _id: 'cash', aliases: ['tm', 'cash'] },
  { _id: 'momo', aliases: ['mm', 'momo'] },
  { _id: 'bank', aliases: ['ck', 'bank'] },
];
const now = new Date('2026-11-20T03:00:00Z'); // 10:00 on 20/11 in Vietnam
const yesterday = new Date('2026-11-19T03:00:00Z');
const ctx = { categories, wallets, defaultWalletId: 'cash', now };

const parse = (text, extra) => parseLine(text, { ...ctx, ...extra });

describe('TC-F8-01 parser rule table (docs/02 §2.5)', () => {
  test.each([
    ['45k', 45_000],
    ['45 k', 45_000],
    ['45 nghìn', 45_000],
    ['45 ngàn', 45_000],
    ['45ng', 45_000],
    ['1tr', 1_000_000],
    ['1 triệu', 1_000_000],
    ['1m', 1_000_000],
    ['1tr2', 1_200_000],
    ['1tr25', 1_250_000],
    ['1.5tr', 1_500_000],
    ['1,5tr', 1_500_000],
    ['150.000', 150_000],
    ['150,000', 150_000],
    ['150000', 150_000],
    ['150000đ', 150_000],
    ['150000 vnd', 150_000],
    ['45', 45_000], // bare number below 1,000 is read as thousands
  ])('TC-F8-01 amount "phở %s" → %i, removed from the note', (written, amount) => {
    expect(parse(`phở ${written}`)).toMatchObject({ amount, note: 'phở' });
  });

  test.each([
    ['+lương 15tr', 'salary'], // starts with "+"
    ['+ 500k', 'otherIncome'], // "+" alone → income fallback
    ['thưởng tết 2tr', 'bonus'],
    ['nhận 200k', 'otherIncome'],
    ['salary 15tr', 'salary'],
    ['bonus 1tr', 'bonus'],
    ['received 300k', 'otherIncome'],
    ['lì xì 500k', 'gifts'], // keyword of an income category
  ])('TC-F8-01 income "%s" → %s', (text, categoryId) => {
    expect(parse(text)).toMatchObject({ type: 'income', categoryId });
  });

  test.each([
    ['phở 45k', 'food'], // diacritics stripped for matching only
    ['PHỞ BÒ 45k', 'food'],
    ['bánh mì 20k', 'food'], // multi-word keyword
    ['coffee 30k', 'food'], // English keyword
    ['grab 32k', 'transport'],
    ['gửi xe 5k', 'transport'], // longest keyword wins: "gui xe" beats "xe"
    ['sửa xe 200k', 'repair'],
    ['tiền nhà 3tr', 'housing'],
    ['abc 45k', 'other'], // no keyword → Khác / Other
    ['bunker 45k', 'other'], // whole words only: "bun" does not match "bunker"
  ])('TC-F8-01 expense "%s" → %s', (text, categoryId) => {
    expect(parse(text)).toMatchObject({ type: 'expense', categoryId });
  });

  test.each([
    ['phở 45k mm', 'momo'],
    ['phở 45k momo', 'momo'],
    ['phở 45k tm', 'cash'],
    ['phở 45k ck', 'bank'],
    ['phở 45k BANK', 'bank'],
    ['phở 45k', 'cash'], // the user's default wallet
  ])('TC-F8-01 wallet "%s" → %s, alias removed from the note', (text, walletId) => {
    expect(parse(text)).toMatchObject({ walletId, note: 'phở' });
  });

  test('TC-F8-01 without a default wallet the first wallet is used', () => {
    expect(parse('phở 45k', { defaultWalletId: null })).toMatchObject({ walletId: 'cash' });
  });

  test.each([
    ['phở 45k hôm qua', yesterday],
    ['phở 45k hqua', yesterday],
    ['phở 45k yesterday', yesterday],
    ['phở 45k 15/11', new Date('2026-11-15T03:00:00Z')], // that day, same clock time
    ['phở 45k 15/11/2025', new Date('2025-11-15T03:00:00Z')],
    ['phở 45k', now],
  ])('TC-F8-01 date "%s" → %o, date words removed from the note', (text, occurredAt) => {
    expect(parse(text)).toMatchObject({ occurredAt, note: 'phở' });
  });

  test('TC-F8-01 dates follow the Vietnamese calendar, not the server clock (UTC)', () => {
    const justAfterMidnight = new Date('2026-11-19T17:30:00Z'); // 00:30 on 20/11 in Vietnam, still 19/11 in UTC
    expect(parse('phở 45k 15/11', { now: justAfterMidnight }).occurredAt).toEqual(new Date('2026-11-14T17:30:00Z'));
  });

  test('TC-F8-01 the four example messages', () => {
    expect(parse('phở 45k')).toEqual({ type: 'expense', amount: 45_000, categoryId: 'food', walletId: 'cash', occurredAt: now, note: 'phở' });
    expect(parse('grab 32k hôm qua mm')).toEqual({ type: 'expense', amount: 32_000, categoryId: 'transport', walletId: 'momo', occurredAt: yesterday, note: 'grab' });
    expect(parse('+lương 15tr')).toEqual({ type: 'income', amount: 15_000_000, categoryId: 'salary', walletId: 'cash', occurredAt: now, note: 'lương' });
    expect(parse('coffee 30k')).toEqual({ type: 'expense', amount: 30_000, categoryId: 'food', walletId: 'cash', occurredAt: now, note: 'coffee' });
  });

  test('TC-F8-01 the note keeps the original words, case and diacritics', () => {
    expect(parse('Cà phê Highlands 55k tm hôm qua').note).toBe('Cà phê Highlands');
  });
});

describe('TC-F8-02 parser edge cases', () => {
  test.each(['abc', '', '   ', 'phở', 'phở 0k', 'hôm qua mm'])('TC-F8-02 no amount in "%s" → null', (text) => {
    expect(parse(text)).toBeNull();
  });

  test('TC-F8-02 bare "45" → 45,000 and "1tr25" → 1,250,000', () => {
    expect(parse('45').amount).toBe(45_000);
    expect(parse('1tr25').amount).toBe(1_250_000);
  });

  test('TC-F8-02 a unit amount beats a bare count: "2 ly trà sữa 50k" → 50,000', () => {
    expect(parse('2 ly trà sữa 50k')).toMatchObject({ amount: 50_000, categoryId: 'food', note: '2 ly trà sữa' });
  });

  test('TC-F8-02 a day that does not exist is not a date: "31/02" stays in the note', () => {
    expect(parse('phở 45k 31/02')).toMatchObject({ occurredAt: now, note: 'phở 31/02' });
  });

  test('TC-F8-02 12 lines → only the first 10 are parsed; blank lines are skipped', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `phở ${i + 1}k`);
    const drafts = parseText(lines.join('\n\n'), ctx);

    expect(drafts).toHaveLength(10);
    expect(drafts.map((d) => d.amount)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => n * 1000));
  });

  test('TC-F8-02 one result per line, null where a line has no amount', () => {
    expect(parseText('phở 45k\r\nabc\ngrab 32k', ctx).map((d) => d?.amount ?? null)).toEqual([45_000, null, 32_000]);
    expect(parseText('', ctx)).toEqual([]);
  });
});

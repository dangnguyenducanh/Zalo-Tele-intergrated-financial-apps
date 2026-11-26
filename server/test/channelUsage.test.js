import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { ChannelUsage } from '../src/models/ChannelUsage.js';
import { maySend, recordSend } from '../src/services/channelUsage.js';
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js';

beforeAll(async () => {
  await startTestDb();
  await ChannelUsage.init(); // the unique index first
});
let errorLog;
beforeEach(() => {
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  errorLog.mockRestore();
  vi.restoreAllMocks();
  await clearTestDb();
});
afterAll(stopTestDb);

const NOV = new Date('2026-11-15T05:00:00Z');
const setSent = (sent, month = '2026-11', platform = 'zalo') => ChannelUsage.updateOne({ platform, month }, { sent }, { upsert: true });
const sentIn = async (month = '2026-11') => (await ChannelUsage.findOne({ platform: 'zalo', month }))?.sent ?? null;

// docs/02 §2.11.6: Zalo's free plan has 3,000 messages a month, so each kind of message is switched off in turn.
test.each([
  ['proactive', 1999, 2000],
  ['assistant', 2399, 2400],
  ['other', 2849, 2850],
])('TC-F14-18 maySend: %s is allowed at %i and off from %i Zalo messages', async (kind, last, first) => {
  await setSent(last);
  expect(await maySend('zalo', kind, NOV)).toBe(true);
  await setSent(first);
  expect(await maySend('zalo', kind, NOV)).toBe(false);
  await setSent(3000);
  expect(await maySend('zalo', kind, NOV)).toBe(false);
});

test('TC-F14-18 maySend: capture and link are always allowed, a month with no row counts 0, Telegram has no quota', async () => {
  for (const sent of [0, 2850, 3000, 99_999]) {
    await setSent(sent);
    expect(await maySend('zalo', 'capture', NOV)).toBe(true);
    expect(await maySend('zalo', 'link', NOV)).toBe(true);
    expect(await maySend('telegram', 'other', NOV)).toBe(true);
    expect(await maySend('telegram', 'proactive', NOV)).toBe(true);
  }
  await clearTestDb();
  for (const kind of ['proactive', 'assistant', 'other', 'capture', 'link']) expect(await maySend('zalo', kind, NOV)).toBe(true);
  await expect(maySend('zalo', 'chitchat', NOV)).rejects.toThrow(/unknown message kind/); // a typo is a bug, not a free pass
  await expect(maySend('telegram', 'chitchat', NOV)).rejects.toThrow(/unknown message kind/);
});

test('TC-F14-18 maySend: when the count cannot be read the message still goes out, and the failure is logged', async () => {
  vi.spyOn(ChannelUsage, 'findOne').mockImplementation(() => {
    throw new Error('db down');
  });
  expect(await maySend('zalo', 'other', NOV)).toBe(true);
  expect(await maySend('zalo', 'capture', NOV)).toBe(true);
  expect(errorLog).toHaveBeenCalledTimes(1); // only 'other' needed the count
});

test('TC-F14-19 recordSend adds 1 to one (platform, month) row, atomically, in the Vietnam month', async () => {
  await Promise.all(Array.from({ length: 25 }, () => recordSend('zalo', NOV)));
  expect(await ChannelUsage.find().lean()).toMatchObject([{ platform: 'zalo', month: '2026-11', sent: 25 }]);
  await expect(ChannelUsage.create({ platform: 'zalo', month: '2026-11', sent: 1 })).rejects.toMatchObject({ code: 11000 });

  // Sun 30/11 23:59:59 +07 is still November; Mon 01/12 00:00:00 +07 starts December, with its own count.
  await recordSend('zalo', new Date('2026-11-30T16:59:59Z'));
  expect(await sentIn('2026-11')).toBe(26);
  await recordSend('zalo', new Date('2026-11-30T17:00:00Z'));
  expect(await sentIn('2026-11')).toBe(26);
  expect(await sentIn('2026-12')).toBe(1);
  // 31/12 → 01/01 rolls the year.
  await recordSend('zalo', new Date('2026-12-31T17:00:00Z'));
  expect(await sentIn('2027-01')).toBe(1);

  // The guard reads the month of the clock it is given: the new month starts at 0.
  await setSent(2850);
  expect(await maySend('zalo', 'other', new Date('2026-11-30T16:59:59Z'))).toBe(false);
  expect(await maySend('zalo', 'other', new Date('2026-11-30T17:00:00Z'))).toBe(true);
});

test('TC-F14-19 recordSend never throws: a counter failure is logged and the caller carries on', async () => {
  vi.spyOn(ChannelUsage, 'updateOne').mockRejectedValue(new Error('db down'));
  await expect(recordSend('zalo', NOV)).resolves.toBeUndefined();
  expect(errorLog).toHaveBeenCalledTimes(1);
  expect(String(errorLog.mock.calls[0])).toContain('zalo');
});

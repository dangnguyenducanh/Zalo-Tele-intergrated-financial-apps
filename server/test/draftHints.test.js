import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { Category } from '../src/models/Category.js';
import { Transaction } from '../src/models/Transaction.js';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import { draftHints } from '../src/services/draftHints.js';
import { confirmedInRange } from '../src/services/stats.js';
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js';
import { registerUser, resetLoginLimit } from './helpers/auth.js';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Wallet.init(), Category.init(), Transaction.init()]);
});
afterEach(async () => {
  await clearTestDb();
  await resetLoginLimit();
});
afterAll(stopTestDb);

const NOW = new Date('2026-11-20T05:00:00Z'); // 12:00 in Vietnam
const DAY = 24 * 60 * 60 * 1000;

// A user with "Ăn uống" and "Đi lại"; `past(category, amounts, daysAgo)` stores confirmed expenses in the past.
async function setup() {
  const { user } = await registerUser();
  const categories = await Category.find({ userId: user.id });
  const food = categories.find((c) => c.names.vi === 'Ăn uống')._id;
  const transport = categories.find((c) => c.names.vi === 'Đi lại')._id;
  const make = (categoryId, amount, fields = {}) => ({
    userId: user.id, walletId: user.defaultWalletId, categoryId, type: 'expense', amount, occurredAt: new Date(NOW.getTime() - 2 * DAY), status: 'confirmed', ...fields,
  });
  const past = (categoryId, amounts, daysAgo = 2) =>
    Transaction.insertMany(amounts.map((amount) => make(categoryId, amount, { occurredAt: new Date(NOW.getTime() - daysAgo * DAY) })));
  return { userId: user.id, food, transport, make, past };
}

test('TC-F14-54 an amount at least 5× the category median with 5 samples gets the "big" hint; 4 samples, or 4.9×, none', async () => {
  const { userId, food, past } = await setup();
  await past(food, [50_000, 55_000, 55_000, 60_000, 50_000]); // median 55.000
  expect(await draftHints(userId, { amount: 450_000, categoryId: food }, { now: NOW })).toEqual([{ code: 'big', times: 8, median: 55_000 }]);
  expect(await draftHints(userId, { amount: 275_000, categoryId: food }, { now: NOW })).toEqual([{ code: 'big', times: 5, median: 55_000 }]); // exactly 5×
  expect(await draftHints(userId, { amount: 274_000, categoryId: food }, { now: NOW })).toEqual([]);
  expect(await draftHints(userId, { amount: 450_000, categoryId: food }, { now: NOW, guessed: false })).toHaveLength(1);

  await Transaction.deleteOne({ amount: 60_000 }); // 4 samples left
  expect(await draftHints(userId, { amount: 450_000, categoryId: food }, { now: NOW })).toEqual([]);
});

test('TC-F14-54 the median is of the category\'s confirmed, undeleted spending of the last 90 days only', async () => {
  const { userId, food, transport, make, past } = await setup();
  await past(food, [50_000, 50_000, 50_000, 50_000, 50_000]);
  await past(food, [1_000_000, 1_000_000, 1_000_000], 100); // older than 90 days: ignored
  await Transaction.insertMany([
    make(food, 1_000_000, { status: 'draft' }), // a draft is not money that moved
    make(food, 1_000_000, { deletedAt: new Date(NOW.getTime() - DAY) }),
    make(transport, 1_000_000), // another category
  ]);
  expect(await draftHints(userId, { amount: 250_000, categoryId: food }, { now: NOW })).toEqual([{ code: 'big', times: 5, median: 50_000 }]);
  expect(await draftHints(userId, { amount: 250_000, categoryId: transport }, { now: NOW })).toEqual([]); // one sample
  const other = await setup(); // another user's spending never counts
  await other.past(other.food, [1, 1, 1, 1, 1].map((n) => n * 50_000));
  expect(await draftHints(userId, { amount: 250_000, categoryId: other.food }, { now: NOW })).toEqual([]);
});

test('TC-F14-54 the median of an even number of samples is the middle two averaged, rounded', async () => {
  const { userId, food, past } = await setup();
  await past(food, [40_000, 50_000, 60_000, 70_000, 80_000, 90_000]); // median 65.000
  expect(await draftHints(userId, { amount: 325_000, categoryId: food }, { now: NOW })).toEqual([{ code: 'big', times: 5, median: 65_000 }]);
});

test('TC-F14-54 a guessed amount (a bare "450") is checked at 3×', async () => {
  const { userId, food, past } = await setup();
  await past(food, [55_000, 55_000, 55_000, 55_000, 55_000]);
  expect(await draftHints(userId, { amount: 165_000, categoryId: food }, { now: NOW, guessed: true })).toEqual([{ code: 'big', times: 3, median: 55_000 }]);
  expect(await draftHints(userId, { amount: 164_000, categoryId: food }, { now: NOW, guessed: true })).toEqual([]);
  expect(await draftHints(userId, { amount: 165_000, categoryId: food }, { now: NOW, guessed: false })).toEqual([]); // typed with a unit: 5×
});

test('TC-F14-54 the same amount and category made in the last 10 minutes gets the "duplicate" hint, once per draft, never from itself', async () => {
  const { userId, food, transport, make } = await setup();
  const earlier = await Transaction.create(make(food, 45_000, { status: 'draft', createdAt: new Date(NOW.getTime() - 5 * 60_000) }));
  expect(await draftHints(userId, { amount: 45_000, categoryId: food }, { now: NOW })).toEqual([{ code: 'duplicate' }]);
  expect(await draftHints(userId, { amount: 46_000, categoryId: food }, { now: NOW })).toEqual([]); // another amount
  expect(await draftHints(userId, { amount: 45_000, categoryId: transport }, { now: NOW })).toEqual([]); // another category
  expect(await draftHints(userId, { amount: 45_000, categoryId: food, id: earlier._id }, { now: NOW })).toEqual([]); // the draft itself

  const setCreated = (fields) => Transaction.collection.updateOne({ _id: earlier._id }, { $set: fields }); // createdAt is immutable for mongoose
  await setCreated({ createdAt: new Date(NOW.getTime() - 11 * 60_000) });
  expect(await draftHints(userId, { amount: 45_000, categoryId: food }, { now: NOW })).toEqual([]); // 11 minutes ago
  await setCreated({ createdAt: new Date(NOW.getTime() - 5 * 60_000), deletedAt: NOW });
  expect(await draftHints(userId, { amount: 45_000, categoryId: food }, { now: NOW })).toEqual([]); // discarded
});

test('TC-F14-54 both hints together: at most 2 lines, the "big" one first', async () => {
  const { userId, food, make, past } = await setup();
  await past(food, [55_000, 55_000, 55_000, 55_000, 55_000]);
  await Transaction.create(make(food, 450_000, { status: 'draft', createdAt: new Date(NOW.getTime() - 60_000) }));
  expect(await draftHints(userId, { amount: 450_000, categoryId: food }, { now: NOW })).toEqual([{ code: 'big', times: 8, median: 55_000 }, { code: 'duplicate' }]);
});

test('TC-F14-54 confirmedInRange is the confirmed, undeleted money of one user between two instants, end excluded', async () => {
  const { userId, make, food } = await setup();
  const start = new Date('2026-11-01T00:00:00Z');
  const end = new Date('2026-11-10T00:00:00Z');
  await Transaction.insertMany([
    make(food, 1, { occurredAt: start }),
    make(food, 2, { occurredAt: new Date(end.getTime() - 1) }),
    make(food, 3, { occurredAt: end }),
    make(food, 4, { occurredAt: new Date(start.getTime() - 1) }),
    make(food, 5, { occurredAt: start, status: 'draft' }),
  ]);
  const rows = await Transaction.aggregate([{ $match: confirmedInRange(userId, start, end) }, { $sort: { amount: 1 } }]);
  expect(rows.map((t) => t.amount)).toEqual([1, 2]);
});

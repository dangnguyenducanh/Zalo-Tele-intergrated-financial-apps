import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import app from '../src/app.js';
import { Category } from '../src/models/Category.js';
import { Transaction } from '../src/models/Transaction.js';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js';
import { registerUser, resetLoginLimit } from './helpers/auth.js';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Wallet.init(), Category.init(), Transaction.init()]); // unique indexes first
});
afterEach(async () => {
  await clearTestDb();
  await resetLoginLimit();
});
afterAll(stopTestDb);

// Calls the API as one logged-in user: api(token).get('/transactions') …
const api = (accessToken) => {
  const call = (method) => (path, body) => request(app)[method](`/api${path}`).set('Authorization', `Bearer ${accessToken}`).send(body);
  return { get: call('get'), post: call('post'), patch: call('patch'), delete: call('delete') };
};

// A registered user with the ids a transaction needs: default wallet, "Ăn uống", "Đi lại", "Lương".
async function newUser() {
  const { accessToken, user } = await registerUser();
  const me = api(accessToken);
  const { body: categories } = await me.get('/categories');
  const byName = (vi) => categories.find((c) => c.names?.vi === vi).id;
  return {
    me,
    user,
    walletId: user.defaultWalletId,
    food: byName('Ăn uống'),
    transport: byName('Đi lại'),
    salary: byName('Lương'),
    other: byName('Khác'),
  };
}

const balanceOf = async (me, walletId) => (await me.get(`/wallets/${walletId}`)).body.balance;

test('TC-F4-01 POST /transactions creates a confirmed web transaction', async () => {
  const { me, user, walletId, food } = await newUser();
  const body = { type: 'expense', amount: 45_000, walletId, categoryId: food, occurredAt: '2026-11-20T05:30:00.000Z', note: '  phở bò  ' };

  const created = await me.post('/transactions', body);
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({
    ...body,
    note: 'phở bò',
    userId: user.id,
    status: 'confirmed',
    source: 'web',
    deletedAt: null,
    id: expect.any(String),
  });
  expect(created.body).not.toHaveProperty('_id');

  const one = await me.get(`/transactions/${created.body.id}`);
  expect([one.status, one.body]).toEqual([200, created.body]);
  expect(await balanceOf(me, walletId)).toBe(-45_000); // the wallet balance counts it at once

  // Required fields and the type/category pairing are checked.
  for (const bad of [
    { ...body, occurredAt: undefined },
    { ...body, occurredAt: '20/11/2026' },
    { ...body, walletId: undefined },
    { ...body, categoryId: 'not-an-id' },
    { ...body, type: 'transfer' },
    { ...body, note: 'x'.repeat(201) },
    { ...body, type: 'income' }, // "Ăn uống" is an expense category
  ]) {
    const res = await me.post('/transactions', bad);
    expect([res.status, res.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
  }
  expect(await Transaction.countDocuments()).toBe(1);
});

test('TC-F4-01 PATCH /transactions/:id edits the editable fields', async () => {
  const { me, walletId, food, transport, salary } = await newUser();
  const { body: wallet } = await me.post('/wallets', { name: 'MoMo', type: 'ewallet', initialBalance: 0 });
  const { body: tx } = await me.post('/transactions', { type: 'expense', amount: 45_000, walletId, categoryId: food, occurredAt: '2026-11-20T05:30:00Z' });

  const edited = await me.patch(`/transactions/${tx.id}`, { amount: 55_000, categoryId: transport, walletId: wallet.id, note: 'grab' });
  expect(edited.status).toBe(200);
  expect(edited.body).toMatchObject({ id: tx.id, amount: 55_000, categoryId: transport, walletId: wallet.id, note: 'grab', status: 'confirmed' });
  expect([await balanceOf(me, walletId), await balanceOf(me, wallet.id)]).toEqual([0, -55_000]);

  const toIncome = await me.patch(`/transactions/${tx.id}`, { type: 'income', categoryId: salary, occurredAt: '2026-11-01T00:00:00+07:00' });
  expect(toIncome.body).toMatchObject({ type: 'income', categoryId: salary, occurredAt: '2026-10-31T17:00:00.000Z' });

  // The type and the category must still match after the edit; status and owner are not editable.
  const mismatch = await me.patch(`/transactions/${tx.id}`, { type: 'expense' });
  expect([mismatch.status, mismatch.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
  const ignored = await me.patch(`/transactions/${tx.id}`, { status: 'draft', userId: new mongoose.Types.ObjectId().toString() });
  expect(ignored.body).toMatchObject({ status: 'confirmed', type: 'income' });
});

test('TC-F4-02 only positive whole VND amounts up to 10^13 are accepted', async () => {
  const { me, walletId, food } = await newUser();
  const body = { type: 'expense', walletId, categoryId: food, occurredAt: '2026-11-20T05:30:00Z' };
  const { body: tx } = await me.post('/transactions', { ...body, amount: 1 });

  for (const amount of [0, -5, 12.5, '45k', '45000', 2 ** 53, null]) {
    const created = await me.post('/transactions', { ...body, amount });
    expect([amount, created.status, created.body.error?.code]).toEqual([amount, 400, 'VALIDATION_ERROR']);
    const edited = await me.patch(`/transactions/${tx.id}`, { amount });
    expect([amount, edited.status, edited.body.error?.code]).toEqual([amount, 400, 'VALIDATION_ERROR']);
  }
  expect((await me.post('/transactions', { ...body, amount: 10_000_000_000_000 })).status).toBe(201); // the ceiling, TC-F4-12
  expect(await Transaction.countDocuments()).toBe(2);
  expect((await Transaction.findById(tx.id)).amount).toBe(1);
});

test('TC-F4-03 user A cannot use, read or change user B\'s wallet, category or transaction', async () => {
  const userA = await newUser();
  const userB = await newUser();
  const body = { type: 'expense', amount: 45_000, walletId: userA.walletId, categoryId: userA.food, occurredAt: '2026-11-20T05:30:00Z' };

  const foreignWallet = await userA.me.post('/transactions', { ...body, walletId: userB.walletId });
  expect([foreignWallet.status, foreignWallet.body.error.code, foreignWallet.body.error.details]).toEqual([
    404,
    'NOT_FOUND',
    [{ path: 'walletId', issue: 'not_found' }],
  ]);
  const foreignCategory = await userA.me.post('/transactions', { ...body, categoryId: userB.food });
  expect([foreignCategory.status, foreignCategory.body.error.details]).toEqual([404, [{ path: 'categoryId', issue: 'not_found' }]]);
  expect(await Transaction.countDocuments()).toBe(0);

  const { body: txOfA } = await userA.me.post('/transactions', body);
  const editWithForeign = await userA.me.patch(`/transactions/${txOfA.id}`, { walletId: userB.walletId });
  expect(editWithForeign.status).toBe(404);

  const { body: txOfB } = await userB.me.post('/transactions', { ...body, walletId: userB.walletId, categoryId: userB.food });
  const asA = userA.me;
  for (const res of [
    await asA.get(`/transactions/${txOfB.id}`),
    await asA.patch(`/transactions/${txOfB.id}`, { amount: 1 }),
    await asA.delete(`/transactions/${txOfB.id}`),
    await asA.post(`/transactions/${txOfB.id}/restore`),
    await asA.post(`/transactions/${txOfB.id}/confirm`),
  ]) {
    expect([res.status, res.body.error.code]).toEqual([404, 'NOT_FOUND']);
  }
  expect(await Transaction.findById(txOfB.id)).toMatchObject({ amount: 45_000, deletedAt: null });
  expect((await Transaction.findById(txOfA.id)).walletId.toString()).toBe(userA.walletId);
  expect((await asA.get('/transactions')).body.items.map((t) => t.id)).toEqual([txOfA.id]);
  expect((await asA.get('/transactions/not-an-id')).status).toBe(400);
});

test('TC-F4-04 filters, text search and pagination', async () => {
  const userA = await newUser();
  const userB = await newUser();
  const { body: momo } = await userA.me.post('/wallets', { name: 'MoMo', type: 'ewallet', initialBalance: 0 });
  const userId = new mongoose.Types.ObjectId(userA.user.id);

  // 45 transactions, one every 12 hours from 2026-11-01 00:00 +07: every 3rd income, every 4th a draft,
  // every 5th from MoMo, every 9th a Telegram draft source; notes "phở #n" or "Grab #n".
  const start = Date.parse('2026-10-31T17:00:00Z');
  const rows = Array.from({ length: 45 }, (_, n) => {
    const income = n % 3 === 0;
    return {
      userId,
      walletId: n % 5 === 0 ? momo.id : userA.walletId,
      categoryId: income ? userA.salary : n % 2 === 0 ? userA.food : userA.transport,
      type: income ? 'income' : 'expense',
      amount: (n + 1) * 1_000,
      note: n % 2 === 0 ? `phở #${n}` : `Grab #${n}`,
      occurredAt: new Date(start + n * 12 * 3600_000),
      status: n % 4 === 0 ? 'draft' : 'confirmed',
      source: n % 9 === 0 ? 'telegram' : 'web',
    };
  });
  await Transaction.insertMany(rows);
  await Transaction.create({ ...rows[0], note: 'deleted phở', deletedAt: new Date() });
  await Transaction.create({ ...rows[0], userId: new mongoose.Types.ObjectId(userB.user.id), note: 'phở of B' });

  const newestFirst = [...rows].reverse();
  const amounts = (res) => res.body.items.map((t) => t.amount);
  const list = (query) => userA.me.get(`/transactions?${query}`);

  const page2 = await list('page=2&limit=20');
  expect(page2.status).toBe(200);
  expect(page2.body).toMatchObject({ page: 2, limit: 20, total: 45 });
  expect(amounts(page2)).toEqual(newestFirst.slice(20, 40).map((r) => r.amount));
  expect(amounts(await list('page=3&limit=20'))).toEqual(newestFirst.slice(40).map((r) => r.amount));
  const firstPage = await list('');
  expect([firstPage.body.page, firstPage.body.limit, firstPage.body.items.length]).toEqual([1, 20, 20]);
  expect(amounts(await list('sort=amount&limit=3'))).toEqual([1_000, 2_000, 3_000]);

  const expectSubset = async (query, keep) => {
    const res = await list(`${query}&limit=100`);
    expect([query, res.status, res.body.total, amounts(res)]).toEqual([query, 200, newestFirst.filter(keep).length, newestFirst.filter(keep).map((r) => r.amount)]);
  };
  // from/to are Vietnamese calendar days, both inclusive: 2026-11-03 00:00 +07 … 2026-11-04 23:59 +07.
  await expectSubset('from=2026-11-03&to=2026-11-04', (r) => r.occurredAt >= new Date('2026-11-02T17:00:00Z') && r.occurredAt < new Date('2026-11-04T17:00:00Z'));
  await expectSubset('from=2026-11-20', (r) => r.occurredAt >= new Date('2026-11-19T17:00:00Z'));
  await expectSubset('type=income', (r) => r.type === 'income');
  await expectSubset(`walletId=${momo.id}`, (r) => r.walletId === momo.id);
  await expectSubset(`categoryId=${userA.transport}`, (r) => r.categoryId === userA.transport);
  await expectSubset('status=draft', (r) => r.status === 'draft');
  await expectSubset('source=telegram', (r) => r.source === 'telegram');
  await expectSubset('q=GRAB', (r) => r.note.startsWith('Grab')); // case-insensitive
  await expectSubset(`q=${encodeURIComponent('phở #1')}`, (r) => r.note.startsWith('phở #1'));
  await expectSubset('q=.*', () => false); // regex characters are searched literally
  await expectSubset(`type=expense&status=confirmed&walletId=${userA.walletId}&from=2026-11-10&to=2026-11-15`, (r) =>
    r.type === 'expense' && r.status === 'confirmed' && r.walletId === userA.walletId &&
    r.occurredAt >= new Date('2026-11-09T17:00:00Z') && r.occurredAt < new Date('2026-11-15T17:00:00Z'));

  for (const bad of ['page=0', 'limit=0', 'limit=101', 'page=x', 'type=transfer', 'status=deleted', 'source=sms', 'walletId=abc', 'from=2026-02-30', 'to=20-11-2026', 'sort=name', `q=${'x'.repeat(101)}`]) {
    const res = await list(bad);
    expect([bad, res.status, res.body.error?.code]).toEqual([bad, 400, 'VALIDATION_ERROR']);
  }
});

test('TC-F4-05 DELETE is a soft delete and /restore brings the transaction back', async () => {
  const { me, walletId, food } = await newUser();
  const { body: tx } = await me.post('/transactions', { type: 'expense', amount: 45_000, walletId, categoryId: food, occurredAt: '2026-11-20T05:30:00Z' });
  expect(await balanceOf(me, walletId)).toBe(-45_000);

  expect((await me.delete(`/transactions/${tx.id}`)).status).toBe(204);
  expect((await me.get('/transactions')).body).toMatchObject({ items: [], total: 0 });
  expect((await me.get(`/transactions/${tx.id}`)).status).toBe(404);
  expect((await me.patch(`/transactions/${tx.id}`, { amount: 1 })).status).toBe(404);
  expect((await me.delete(`/transactions/${tx.id}`)).status).toBe(404);
  expect(await balanceOf(me, walletId)).toBe(0); // balances (and later stats) skip deleted rows
  expect(await Transaction.findById(tx.id)).toMatchObject({ amount: 45_000, deletedAt: expect.any(Date) }); // the row stays

  const restored = await me.post(`/transactions/${tx.id}/restore`);
  expect([restored.status, restored.body]).toEqual([200, { ...tx, deletedAt: null, updatedAt: expect.any(String) }]);
  expect((await me.get('/transactions')).body.items.map((t) => t.id)).toEqual([tx.id]);
  expect(await balanceOf(me, walletId)).toBe(-45_000);
  expect((await me.post(`/transactions/${tx.id}/restore`)).status).toBe(404); // nothing to restore any more
});

test('TC-F4-05 a transaction cannot be restored into a deleted wallet', async () => {
  const { me, food } = await newUser();
  const { body: wallet } = await me.post('/wallets', { name: 'Old bank', type: 'bank', initialBalance: 0 });
  const { body: tx } = await me.post('/transactions', { type: 'expense', amount: 10_000, walletId: wallet.id, categoryId: food, occurredAt: '2026-11-20T05:30:00Z' });
  await me.delete(`/transactions/${tx.id}`);
  expect((await me.delete(`/wallets/${wallet.id}`)).status).toBe(204); // allowed: no live transaction uses it

  const res = await me.post(`/transactions/${tx.id}/restore`);
  expect([res.status, res.body.error.details]).toEqual([404, [{ path: 'walletId', issue: 'not_found' }]]);
  expect((await Transaction.findById(tx.id)).deletedAt).toEqual(expect.any(Date));
});

test('TC-F4-08 POST /transactions/:id/confirm confirms a draft once', async () => {
  const { me, user, walletId, transport } = await newUser();
  const draft = await Transaction.create({
    userId: user.id,
    walletId,
    categoryId: transport,
    type: 'expense',
    amount: 32_000,
    occurredAt: new Date(),
    note: 'grab',
    status: 'draft',
    source: 'telegram',
    chatRef: { platform: 'telegram', chatId: '111', messageId: '7' },
  });
  expect(await balanceOf(me, walletId)).toBe(0); // drafts do not count yet

  const confirmed = await me.post(`/transactions/${draft.id}/confirm`);
  expect(confirmed.status).toBe(200);
  expect(confirmed.body.transaction).toMatchObject({ id: draft.id, status: 'confirmed', source: 'telegram', chatRef: { platform: 'telegram', chatId: '111', messageId: '7' } });
  expect(await balanceOf(me, walletId)).toBe(-32_000);

  const again = await me.post(`/transactions/${draft.id}/confirm`);
  expect([again.status, again.body.error.code]).toEqual([409, 'ALREADY_CONFIRMED']);
  await me.delete(`/transactions/${draft.id}`);
  expect((await me.post(`/transactions/${draft.id}/confirm`)).status).toBe(404);
});

test('TC-F4-08 a draft cannot be confirmed into a deleted wallet', async () => {
  const { me, user, food } = await newUser();
  const { body: wallet } = await me.post('/wallets', { name: 'Bank', type: 'bank', initialBalance: 0 });
  const draft = await Transaction.create({
    userId: user.id, walletId: wallet.id, categoryId: food, type: 'expense', amount: 20_000, occurredAt: new Date(), status: 'draft', source: 'telegram',
  });
  expect((await me.delete(`/wallets/${wallet.id}`)).status).toBe(204); // allowed: only a draft uses it

  const res = await me.post(`/transactions/${draft.id}/confirm`);
  expect([res.status, res.body.error.details]).toEqual([404, [{ path: 'walletId', issue: 'not_found' }]]);
  expect((await Transaction.findById(draft.id)).status).toBe('draft');
});

test('TC-F4-09 chatRef is unique per platform, chat and message; rows without chatRef are not limited', async () => {
  const { user, walletId, food } = await newUser();
  const draft = (chatRef) =>
    Transaction.create({ userId: user.id, walletId, categoryId: food, type: 'expense', amount: 45_000, occurredAt: new Date(), status: 'draft', source: 'telegram', chatRef });

  await draft({ platform: 'telegram', chatId: '111', messageId: '7' });
  await expect(draft({ platform: 'telegram', chatId: '111', messageId: '7' })).rejects.toMatchObject({ code: 11000 }); // webhook retried
  await draft({ platform: 'telegram', chatId: '222', messageId: '7' }); // Telegram numbers messages per chat
  await draft({ platform: 'zalo', chatId: '111', messageId: '7' });
  await draft(undefined);
  await draft(undefined);
  expect(await Transaction.countDocuments()).toBe(5);
  expect(await Transaction.countDocuments({ chatRef: mongoose.trusted({ $exists: true }) })).toBe(3);
});

test('TC-F13-01 POST /transactions/parse previews drafts and saves nothing', async () => {
  const { me, walletId, food, transport, salary } = await newUser();
  const { body: momo } = await me.post('/wallets', { name: 'MoMo', type: 'ewallet', initialBalance: 0, aliases: ['mm'] });

  const res = await me.post('/transactions/parse', { text: 'phở 45k' });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    drafts: [{ type: 'expense', amount: 45_000, categoryId: food, walletId, occurredAt: expect.any(String), note: 'phở' }],
    noAmountLines: [],
    truncated: false,
  });
  expect(Math.abs(Date.parse(res.body.drafts[0].occurredAt) - Date.now())).toBeLessThan(60_000); // "now"
  expect(await Transaction.countDocuments()).toBe(0);

  const several = await me.post('/transactions/parse', { text: 'grab 32k mm\nabc\n+lương 15tr' });
  expect(several.body.drafts).toEqual([
    expect.objectContaining({ type: 'expense', amount: 32_000, categoryId: transport, walletId: momo.id, note: 'grab' }),
    expect.objectContaining({ type: 'income', amount: 15_000_000, categoryId: salary, walletId, note: 'lương' }),
  ]);

  const noAmount = await me.post('/transactions/parse', { text: 'abc' });
  expect([noAmount.status, noAmount.body.error.code]).toEqual([422, 'NO_AMOUNT_FOUND']);
  for (const bad of [{}, { text: '' }, { text: '   ' }, { text: 42 }, { text: 'x'.repeat(2001) }]) {
    expect((await me.post('/transactions/parse', bad)).status).toBe(400);
  }
  expect(await Transaction.countDocuments()).toBe(0);
});

test('TC-F9-05 confirm with edits applies them to a draft only; a draft confirmed in the chat meanwhile is not changed', async () => {
  const { me, user, walletId, food, salary } = await newUser();
  const newDraft = () =>
    Transaction.create({ userId: user.id, walletId, categoryId: food, type: 'expense', amount: 40_000, occurredAt: new Date(), note: 'bún chả', status: 'draft', source: 'telegram' });

  // The inbox sends its edits with the confirm: one write, checked like a PATCH.
  const draft = await newDraft();
  expect((await me.post(`/transactions/${draft.id}/confirm`, { amount: 12.5 })).status).toBe(400);
  expect((await me.post(`/transactions/${draft.id}/confirm`, { type: 'income' })).status).toBe(400); // "Ăn uống" is an expense category
  const edited = await me.post(`/transactions/${draft.id}/confirm`, { amount: 45_000, note: ' bún chả Hà Nội ' });
  expect(edited.status).toBe(200);
  expect(edited.body.transaction).toMatchObject({ status: 'confirmed', amount: 45_000, note: 'bún chả Hà Nội' });

  // BUG-008: ✅ in the chat confirmed the draft at 40.000; a stale inbox card then confirms with 99.000.
  const stale = await newDraft();
  expect((await me.post(`/transactions/${stale.id}/confirm`)).status).toBe(200); // the bot calls the same service
  const late = await me.post(`/transactions/${stale.id}/confirm`, { amount: 99_000, type: 'income', categoryId: salary });
  expect([late.status, late.body.error.code]).toEqual([409, 'ALREADY_CONFIRMED']);
  expect(await Transaction.findById(stale.id).lean()).toMatchObject({ amount: 40_000, type: 'expense', status: 'confirmed' });
  expect(await balanceOf(me, walletId)).toBe(-85_000);
});

test('TC-F13-05 POST /transactions/parse names the lines it cannot save: no amount, or past the 10-line limit', async () => {
  const { me } = await newUser();

  const mixed = await me.post('/transactions/parse', { text: 'phở 45k\n\ncafe không tiền\ngrab 30k' });
  expect(mixed.status).toBe(200);
  expect(mixed.body).toMatchObject({ noAmountLines: [3], truncated: false }); // line numbers as typed, blank lines counted
  expect(mixed.body.drafts.map((d) => d.note)).toEqual(['phở', 'grab']);

  const eleven = Array.from({ length: 11 }, (_, i) => `món ${i + 1} ${i + 1}k`).join('\n');
  const long = await me.post('/transactions/parse', { text: eleven });
  expect([long.body.drafts.length, long.body.noAmountLines, long.body.truncated]).toEqual([10, [], true]);
});

test('TC-F13-07 POST /transactions/parse names a line over the 10^13 ₫ ceiling like a line with no amount (BUG-033)', async () => {
  const { me } = await newUser();

  const res = await me.post('/transactions/parse', { text: 'cafe 20000000000000\ncafe 45k' });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ noAmountLines: [1], truncated: false });
  expect(res.body.drafts.map((d) => d.amount)).toEqual([45_000]);
  const only = await me.post('/transactions/parse', { text: 'cafe 10000000000001' });
  expect([only.status, only.body.error.code]).toEqual([422, 'NO_AMOUNT_FOUND']);
});

test('TC-F8-25 POST /transactions/parse reads the amount, not a year or month typed before it; a date-only line has no amount (BUG-039)', async () => {
  const { me } = await newUser();

  const res = await me.post('/transactions/parse', { text: 'thuê nhà năm 2026 36tr\nhọc phí năm 2025 12.000.000\nbảo hiểm năm 2026 1500000\nan toi thang 10 50\ntiền nhà tháng 10' });
  expect(res.status).toBe(200);
  expect(res.body.drafts.map((d) => d.amount)).toEqual([36_000_000, 12_000_000, 1_500_000, 50_000]);
  expect(res.body.noAmountLines).toEqual([5]);
  const only = await me.post('/transactions/parse', { text: 'năm 2025' });
  expect([only.status, only.body.error.code]).toEqual([422, 'NO_AMOUNT_FOUND']);
  expect(await Transaction.countDocuments()).toBe(0);
});

test('TC-F13-08 POST /transactions/parse answers a question with question: true, no drafts and no reading of the user\'s data', async () => {
  const { me } = await newUser();
  const questions = ['tháng 10 thu bao nhiêu', 'tháng 3 năm 2025 tiêu bao nhiêu', '7 ngày qua tiêu bao nhiêu', '?phở 45k', 'hôm nay ăn gì?', '5 khoản chi lớn nhất tuần trước', 'top 3 cafe', 'tổng kết tuần trước'];

  const read = [vi.spyOn(Category, 'find'), vi.spyOn(Wallet, 'find')];
  for (const text of questions) {
    const res = await me.post('/transactions/parse', { text });
    expect([text, res.status, res.body]).toEqual([text, 200, { question: true, drafts: [], noAmountLines: [], truncated: false }]);
  }
  expect(read.map((spy) => spy.mock.calls.length)).toEqual([0, 0]); // the parser never ran
  read.forEach((spy) => spy.mockRestore());
  expect(await Transaction.countDocuments()).toBe(0);

  // A capture answers as before, with no question flag.
  const capture = await me.post('/transactions/parse', { text: 'phở 45k' });
  expect(capture.body).not.toHaveProperty('question');
  expect(capture.body.drafts).toMatchObject([{ amount: 45_000, note: 'phở' }]);
  // More than one line is a capture (docs/02 §2.11.1 rule 2), even when each line looks like a question.
  const two = await me.post('/transactions/parse', { text: 'tháng 10 thu bao nhiêu\nphở 45k' });
  expect(two.body).toMatchObject({ drafts: [{ amount: 45_000 }], noAmountLines: [1], truncated: false });
  expect(two.body).not.toHaveProperty('question');
  // A day count is never an amount, and what is no question and has no amount is still a 422.
  for (const text of ['chi tiêu 7 ngày qua', 'đã chi gì tháng 9', 'chi tiêu năm 2025']) {
    const none = await me.post('/transactions/parse', { text });
    expect([text, none.status, none.body.error.code]).toEqual([text, 422, 'NO_AMOUNT_FOUND']);
  }
  expect((await me.post('/transactions/parse', { text: 'ăn tối tháng 10 50' })).body.drafts).toMatchObject([{ amount: 50_000 }]);
  expect(await Transaction.countDocuments()).toBe(0);
});

test('TC-F4-12 one money value is at most 10^13 ₫, so wallet and month totals stay exact integers', async () => {
  const { me, walletId, food } = await newUser();
  const MAX = 10_000_000_000_000;
  const body = { type: 'expense', walletId, categoryId: food, occurredAt: '2026-10-20T05:30:00Z' };

  const { body: tx } = await me.post('/transactions', { ...body, amount: MAX });
  expect(tx.amount).toBe(MAX);
  for (const amount of [MAX + 1, Number.MAX_SAFE_INTEGER]) {
    expect((await me.post('/transactions', { ...body, amount })).status).toBe(400);
    expect((await me.patch(`/transactions/${tx.id}`, { amount })).status).toBe(400);
    expect((await me.post('/budgets', { month: '2026-10', categoryId: null, limit: amount })).status).toBe(400);
  }
  for (const initialBalance of [MAX + 1, -MAX - 1]) {
    expect((await me.post('/wallets', { name: `Big ${initialBalance}`, type: 'bank', initialBalance })).status).toBe(400);
  }
  expect((await me.post('/wallets', { name: 'Big', type: 'credit', initialBalance: -MAX })).status).toBe(201);
  expect((await me.post('/budgets', { month: '2026-10', categoryId: null, limit: MAX })).status).toBe(201);
  await expect(Transaction.create({ ...body, userId: tx.userId, amount: MAX + 1 })).rejects.toThrow(/amount/); // the model agrees
});

test('TC-F4-14 GET /transactions?source=whatsapp lists only WhatsApp transactions, not a validation error', async () => {
  const { me, walletId, food } = await newUser();
  const base = { userId: (await User.findOne())._id, walletId, categoryId: food, type: 'expense', amount: 45_000, occurredAt: new Date() };
  await Transaction.create([
    { ...base, note: 'web', source: 'web' },
    { ...base, note: 'telegram', source: 'telegram', status: 'draft', chatRef: { platform: 'telegram', chatId: '1', messageId: '1:1' } },
    { ...base, note: 'whatsapp draft', source: 'whatsapp', status: 'draft', chatRef: { platform: 'whatsapp', chatId: 'VN.13491208655302741918', messageId: 'wamid.1:1' } },
    { ...base, note: 'whatsapp saved', source: 'whatsapp', chatRef: { platform: 'whatsapp', chatId: 'VN.13491208655302741918', messageId: 'wamid.2:1' } },
  ]);

  const res = await me.get('/transactions?source=whatsapp');
  expect(res.status).toBe(200);
  expect(res.body.items.map((t) => t.note).sort()).toEqual(['whatsapp draft', 'whatsapp saved']);
  expect(res.body.items.every((t) => t.source === 'whatsapp' && t.chatRef.platform === 'whatsapp')).toBe(true);
  expect((await me.get('/transactions?source=sms')).status).toBe(400); // the list stays closed
});

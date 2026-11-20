import request from 'supertest';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import app from '../src/app.js';
import { Session } from '../src/models/Session.js';
import { registerUser, resetLoginLimit } from './helpers/auth.js';
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js';

// TC-NF-04 at the API: operator injection is refused and a script in a note is stored and sent back as plain
// data. The browser half (the note is shown as text and never runs) is in client/e2e/security.spec.ts.

beforeAll(startTestDb);
afterEach(async () => {
  await clearTestDb();
  await resetLoginLimit();
});
afterAll(stopTestDb);

const XSS = '<img src=x onerror=alert(1)>';

test('TC-NF-04 login and register with a MongoDB operator instead of a string answer 400 and open no session', async () => {
  const { email } = await registerUser();
  const sessionsBefore = await Session.countDocuments();

  for (const body of [
    { email: { $gt: '' }, password: 'anything' },
    { email, password: { $ne: null } },
    { email: { $regex: '.*' }, password: { $gt: '' } },
  ]) {
    const res = await request(app).post('/api/auth/login').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.headers['set-cookie']).toBeUndefined();
  }
  const register = await request(app).post('/api/auth/register').send({ name: 'X', email: { $gt: '' }, password: 'secret123' });
  expect(register.status).toBe(400);
  expect(await Session.countDocuments()).toBe(sessionsBefore);
});

test('TC-NF-04 a note with HTML is stored unchanged and only ever sent back as JSON, with nosniff and a CSP', async () => {
  const { accessToken, user } = await registerUser();
  const auth = { Authorization: `Bearer ${accessToken}` };
  const { body: categories } = await request(app).get('/api/categories').set(auth);
  const food = categories.find((c) => c.names?.vi === 'Ăn uống');

  const created = await request(app)
    .post('/api/transactions')
    .set(auth)
    .send({ type: 'expense', amount: 45_000, categoryId: food.id, walletId: user.defaultWalletId, occurredAt: new Date().toISOString(), note: XSS });
  expect(created.status).toBe(201);

  const list = await request(app).get('/api/transactions').set(auth);
  expect(list.headers['content-type']).toMatch(/^application\/json/);
  expect(list.headers['x-content-type-options']).toBe('nosniff'); // the browser never guesses "text/html"
  expect(list.headers['content-security-policy']).toContain("script-src 'self'");
  expect(list.body.items[0].note).toBe(XSS); // not escaped twice, not stripped: React escapes it when shown
});

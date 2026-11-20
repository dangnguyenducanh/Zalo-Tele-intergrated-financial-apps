import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import app from '../src/app.js';
import { startTestDb, stopTestDb } from './helpers/db.js';

afterAll(stopTestDb);

describe('while the database is unreachable', () => {
  test('TC-NF-06 health answers 503 {status:error, db:down}', async () => {
    vi.spyOn(mongoose, 'connect').mockRejectedValueOnce(new Error('connection refused'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', db: 'down' });
    log.mockRestore();
  });
});

describe('once the database is reachable', () => {
  beforeAll(startTestDb); // also proves the failed attempt above was not cached

  test('TC-NF-06 health answers 200 {status:ok, db:up}', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

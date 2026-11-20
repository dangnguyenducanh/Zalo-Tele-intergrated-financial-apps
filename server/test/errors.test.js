import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import app from '../src/app.js';
import { errorHandler, toErrorResponse } from '../src/middleware/error.js';
import { AppError } from '../src/utils/AppError.js';
import { startTestDb, stopTestDb } from './helpers/db.js';

afterAll(stopTestDb);

describe('before the database is connected', () => {
  test('TC-NF-07 an exception inside a route returns 500 JSON without the message or stack', async () => {
    // Make the shared connectDb middleware throw an unexpected error on a normal route.
    vi.spyOn(mongoose, 'connect').mockRejectedValueOnce(new Error('secret internal detail'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).get('/api/anything');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'Internal server error' } });
    expect(res.text).not.toMatch(/secret internal detail|\.js:\d+/);
    expect(log).toHaveBeenCalled(); // the real error is logged server-side, with the request id
    log.mockRestore();
  });

  test('TC-NF-07 malformed JSON body returns 400 VALIDATION_ERROR', async () => {
    const res = await request(app).post('/api/anything').set('Content-Type', 'application/json').send('{"amount":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('TC-NF-07 client mistakes keep their 4xx status instead of becoming 500', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const charset = await request(app).post('/api/anything').set('Content-Type', 'application/json; charset=latin1').send('{}');
    const encoding = await request(app).post('/api/anything').set('Content-Type', 'application/json').set('Content-Encoding', 'bogus').send('{}');
    const tooLarge = await request(app).post('/api/anything').set('Content-Type', 'application/json').send(`"${'x'.repeat(1_100_000)}"`);
    // Express 5 rejects a path parameter that is not valid percent-encoding (every /:id route from T05 on).
    const withParam = express().get('/w/:id', (req, res) => res.end()).use(errorHandler);
    const badParam = await request(withParam).get('/w/%E0%A4%A');

    expect([charset.status, charset.body.error.code]).toEqual([415, 'UNSUPPORTED_MEDIA_TYPE']);
    expect([encoding.status, encoding.body.error.code]).toEqual([415, 'UNSUPPORTED_MEDIA_TYPE']);
    expect([tooLarge.status, tooLarge.body.error.code]).toEqual([413, 'PAYLOAD_TOO_LARGE']);
    expect([badParam.status, badParam.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
    expect(log).not.toHaveBeenCalled(); // not logged as server bugs
    log.mockRestore();
  });
});

describe('with a database', () => {
  beforeAll(startTestDb);

  test('TC-NF-07 unknown route returns 404 JSON NOT_FOUND', async () => {
    const res = await request(app).get('/api/nope');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route GET /api/nope not found' } });
  });
});

test('TC-NF-07 maps AppError, zod, CastError and duplicate-key errors to the documented shape', () => {
  expect(toErrorResponse(new AppError(409, 'EMAIL_TAKEN', 'Email already registered'))).toEqual({
    status: 409,
    body: { error: { code: 'EMAIL_TAKEN', message: 'Email already registered' } },
  });

  const zodError = z.object({ amount: z.number().positive() }).safeParse({ amount: -1 }).error;
  expect(toErrorResponse(zodError)).toEqual({
    status: 400,
    body: {
      error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: [{ path: 'amount', issue: 'too_small' }] },
    },
  });

  const castError = Object.assign(new Error('Cast to ObjectId failed'), { name: 'CastError', path: '_id' });
  expect(toErrorResponse(castError).status).toBe(400);

  const duplicate = Object.assign(new Error('E11000 duplicate key'), { code: 11000, keyValue: { email: 'a@b.c' } });
  expect(toErrorResponse(duplicate)).toEqual({
    status: 409,
    body: { error: { code: 'CONFLICT', message: 'Resource already exists', details: [{ path: 'email', issue: 'duplicate' }] } },
  });

  expect(toErrorResponse(new TypeError('x is undefined')).status).toBe(500);
});

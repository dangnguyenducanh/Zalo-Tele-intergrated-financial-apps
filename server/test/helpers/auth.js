import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../../src/app.js';
import { authRateLimit } from '../../src/middleware/rateLimit.js';

// Reads the refresh-token cookie from a response as "rt=<token>", ready to send back in a Cookie header.
export function refreshCookie(res) {
  return res.headers['set-cookie']?.find((c) => c.startsWith('rt='))?.split(';')[0];
}

// Decodes (without verifying) the claims of an access token.
export const claimsOf = (accessToken) => jwt.decode(accessToken);

let count = 0;

// Registers a new user through the API and returns { user, accessToken, cookie, email, password }.
export async function registerUser(overrides = {}) {
  count += 1;
  const body = { name: `User ${count}`, email: `user${count}@example.com`, password: 'correct-horse-1', ...overrides };
  const res = await request(app).post('/api/auth/register').set('User-Agent', 'device-1').send(body);
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${res.text}`);
  return { ...res.body, cookie: refreshCookie(res), email: body.email.toLowerCase(), password: body.password };
}

// Logs in as another device (its own user agent) and returns { user, accessToken, cookie }.
export async function loginAs({ email, password }, userAgent = 'device-2') {
  const res = await request(app).post('/api/auth/login').set('User-Agent', userAgent).send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${res.text}`);
  return { ...res.body, cookie: refreshCookie(res) };
}

export const refresh = (cookie) => request(app).post('/api/auth/refresh').set('Cookie', cookie ?? '');

// Supertest always connects from 127.0.0.1, so failed logins from earlier tests in the same file would add up
// towards the 10-per-IP limit. Call this after each test; TC-F1-07 uses its own X-Forwarded-For addresses.
export const resetLoginLimit = () => authRateLimit.resetKey('127.0.0.1');

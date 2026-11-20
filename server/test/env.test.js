import { expect, test } from 'vitest';
import { parseEnv } from '../src/config/env.js';

test('TC-NF-09 the API refuses to start when a required variable is missing, naming it but not leaking values', () => {
  const source = { NODE_ENV: 'production', MONGODB_URI: 'mongodb://user:hunter2@db/finance', JWT_ACCESS_SECRET: 'short' };

  let message = '';
  try {
    parseEnv(source);
  } catch (err) {
    message = err.message;
  }

  expect(message).toMatch(/JWT_ACCESS_SECRET/);
  expect(message).toMatch(/TELEGRAM_BOT_TOKEN/);
  expect(message).not.toMatch(/hunter2|short/);
});

test('TC-NF-09 test mode fills every variable with a default and coerces numbers', () => {
  const env = parseEnv({ NODE_ENV: 'test', PORT: '4110' });

  expect(env.PORT).toBe(4110);
  expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(7);
  expect(env.JWT_ACCESS_SECRET.length).toBeGreaterThanOrEqual(32);
});

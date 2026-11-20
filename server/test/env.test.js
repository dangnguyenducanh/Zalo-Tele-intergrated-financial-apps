import { expect, test } from 'vitest';
import { parseEnv } from '../src/config/env.js';

test('TC-NF-09 the API refuses to start when a required variable is missing or invalid, naming it but not leaking values', () => {
  const source = {
    NODE_ENV: 'production',
    JWT_ACCESS_SECRET: 'short',
    TELEGRAM_WEBHOOK_SECRET: 'not allowed: hunter2', // optional, but checked when set
  };

  let message = '';
  try {
    parseEnv(source);
  } catch (err) {
    message = err.message;
  }

  expect(message).toMatch(/MONGODB_URI/);
  expect(message).toMatch(/JWT_ACCESS_SECRET/);
  expect(message).toMatch(/TELEGRAM_WEBHOOK_SECRET/);
  expect(message).not.toMatch(/hunter2|short/);
});

test('TC-NF-09 production needs only MONGODB_URI and JWT_ACCESS_SECRET; bot, KIE and seed variables are optional', () => {
  const env = parseEnv({
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb+srv://PASTE_USER:PASTE_PASSWORD@PASTE_HOST/finance',
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    KIE_URL: '', // an empty value, as copied from .env.example, counts as not set
    TELEGRAM_BOT_TOKEN: 'PASTE_TELEGRAM_BOT_TOKEN',
  });

  expect(env.KIE_URL).toBeUndefined();
  expect(env.ZALO_BOT_TOKEN).toBeUndefined();
  expect(env.TELEGRAM_WEBHOOK_SECRET).toBeUndefined();
  expect(env.APP_URL).toBeUndefined();
  expect(env.TELEGRAM_BOT_TOKEN).toBe('PASTE_TELEGRAM_BOT_TOKEN');
});

test('TC-NF-09 test mode fills every variable with a default and coerces numbers', () => {
  const env = parseEnv({ NODE_ENV: 'test', PORT: '4110' });

  expect(env.PORT).toBe(4110);
  expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(7);
  expect(env.JWT_ACCESS_SECRET.length).toBeGreaterThanOrEqual(32);
  expect(env.TELEGRAM_WEBHOOK_SECRET).toBe('test-telegram-secret');
});

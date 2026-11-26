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

test('TC-F7-11 WHATSAPP_NUMBER must be international digits and ZALO_BOT_URL an https URL that fits the card QR; both are optional', () => {
  const base = { NODE_ENV: 'production', MONGODB_URI: 'mongodb://h/db', JWT_ACCESS_SECRET: 'a'.repeat(64) };
  const unset = parseEnv(base);
  expect(unset.WHATSAPP_NUMBER).toBeUndefined();
  expect(unset.ZALO_BOT_URL).toBeUndefined();
  expect(parseEnv({ ...base, WHATSAPP_NUMBER: '84901234567', ZALO_BOT_URL: 'https://zalo.me/123' })).toMatchObject({
    WHATSAPP_NUMBER: '84901234567',
    ZALO_BOT_URL: 'https://zalo.me/123',
  });
  // The link card's QR encoder holds at most 106 bytes (client qrCode.ts).
  const zaloUrl = (bytes) => `https://zalo.me/${'a'.repeat(bytes - 'https://zalo.me/'.length)}`;
  expect(parseEnv({ ...base, ZALO_BOT_URL: zaloUrl(106) }).ZALO_BOT_URL).toHaveLength(106);
  // wa.me wants the international number without "+", spaces, dashes or a leading 0; a plain http link is refused.
  for (const bad of [
    { WHATSAPP_NUMBER: '+84 901 234 567' },
    { WHATSAPP_NUMBER: '0901-234-567' },
    { WHATSAPP_NUMBER: '0901234567' },
    { ZALO_BOT_URL: 'http://zalo.me/123' },
    { ZALO_BOT_URL: 'zalo.me/123' },
    { ZALO_BOT_URL: 'https:zalo.me/123' }, // as an href this opens our own site's /zalo.me/123
    { ZALO_BOT_URL: 'https:/zalo.me/123' },
    { ZALO_BOT_URL: zaloUrl(107) },
    { ZALO_BOT_URL: `https://zalo.me/${'ạ'.repeat(31)}` }, // 47 characters, 109 bytes
  ]) {
    expect(() => parseEnv({ ...base, ...bad }), JSON.stringify(bad)).toThrow(Object.keys(bad)[0]);
  }
});

test('TC-F8-41 the four WhatsApp settings are optional; when set, the phone number ID must be digits (it goes into a Graph API URL)', () => {
  const base = { NODE_ENV: 'production', MONGODB_URI: 'mongodb://h/db', JWT_ACCESS_SECRET: 'a'.repeat(64) };
  const unset = parseEnv({ ...base, WHATSAPP_ACCESS_TOKEN: '' }); // an empty value counts as not set
  for (const key of ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN']) expect(unset[key]).toBeUndefined();

  const set = { WHATSAPP_ACCESS_TOKEN: 'EAAJB123', WHATSAPP_PHONE_NUMBER_ID: '106540352242922', WHATSAPP_APP_SECRET: 'a1b2c3', WHATSAPP_VERIFY_TOKEN: 'verify me' };
  expect(parseEnv({ ...base, ...set })).toMatchObject(set);
  for (const bad of ['106540352242922/messages', '../me', '12 3', 'abc', `${'1'.repeat(31)}`]) {
    expect(() => parseEnv({ ...base, ...set, WHATSAPP_PHONE_NUMBER_ID: bad }), bad).toThrow('WHATSAPP_PHONE_NUMBER_ID');
  }
  // Under NODE_ENV=test the suites get harmless defaults, so they need no server/.env.
  expect(parseEnv({ NODE_ENV: 'test' })).toMatchObject({ WHATSAPP_ACCESS_TOKEN: 'test-whatsapp-token', WHATSAPP_PHONE_NUMBER_ID: '1234567890' });
});

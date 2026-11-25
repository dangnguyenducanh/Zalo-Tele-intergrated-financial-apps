import { z } from 'zod';

// Validates process.env once at startup and fails fast with the names of missing or invalid variables
// (never their values). Only MONGODB_URI and JWT_ACCESS_SECRET are required. The bot, KIE, APP_URL and
// seed variables are optional and checked only when set, so the API still boots without them; a
// feature that needs a missing one answers 503 FEATURE_NOT_CONFIGURED. Under NODE_ENV=test every
// variable has a harmless default, so the automated suites run without server/.env.
export function parseEnv(source) {
  const isTest = source.NODE_ENV === 'test';
  const required = (schema, testDefault) => (isTest ? schema.default(testDefault) : schema);
  const optional = (schema, testDefault) => (isTest ? schema.default(testDefault) : schema.optional());

  const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4100),
    MONGODB_URI: required(z.string(), 'mongodb://127.0.0.1:27017/finance_test'),
    MONGODB_DB: z.string().optional(), // unset = use the database name from the URI
    JWT_ACCESS_SECRET: required(z.string().min(32), 'test-only-secret-test-only-secret-0000'),
    ACCESS_TOKEN_TTL: z.string().default('15m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
    APP_URL: optional(z.url(), 'http://localhost:5300'),
    TELEGRAM_BOT_TOKEN: optional(z.string(), 'test-telegram-token'),
    TELEGRAM_BOT_USERNAME: optional(z.string(), 'test_bot'),
    TELEGRAM_WEBHOOK_SECRET: optional(z.string().regex(/^[A-Za-z0-9_-]{1,256}$/), 'test-telegram-secret'),
    ZALO_BOT_TOKEN: optional(z.string(), 'test-zalo-token'),
    ZALO_WEBHOOK_SECRET: optional(z.string().min(8).max(256), 'test-zalo-secret'),
    // The bot's share link (Zalo Bot Creator). The link card's QR code holds 106 bytes at most (client qrCode.ts).
    ZALO_BOT_URL: optional(
      z.url({ protocol: /^https$/ }).refine((url) => Buffer.byteLength(url) <= 106, 'at most 106 bytes, so it fits the QR code'),
      'https://zalo.me/test-bot',
    ),
    WHATSAPP_NUMBER: optional(z.string().regex(/^[1-9]\d{5,14}$/), '84900000000'), // international (no leading 0), digits only, for wa.me links
    KIE_URL: optional(z.url(), 'http://127.0.0.1:9'),
    KIE_API_KEY: optional(z.string(), 'test-kie-key'),
    SEED_ADMIN_EMAIL: z.string().optional(), // used by `npm run seed` only
    SEED_ADMIN_PASSWORD: z.string().optional(),
  });

  // An empty value (`KIE_URL=` as in .env.example) counts as not set.
  const values = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const result = schema.safeParse(values);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export const env = parseEnv(process.env);

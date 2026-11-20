import { z } from 'zod';

// Validates process.env once at startup and fails fast with the names of missing or invalid variables
// (never their values). Under NODE_ENV=test every variable has a harmless default, so the automated
// suites run without server/.env.
export function parseEnv(source) {
  const isTest = source.NODE_ENV === 'test';
  const required = (schema, testDefault) => (isTest ? schema.default(testDefault) : schema);

  const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4100),
    MONGODB_URI: required(z.string().min(1), 'mongodb://127.0.0.1:27017/finance_test'),
    MONGODB_DB: z.string().optional(), // empty = use the database name from the URI
    JWT_ACCESS_SECRET: required(z.string().min(32), 'test-only-secret-test-only-secret-0000'),
    ACCESS_TOKEN_TTL: z.string().min(1).default('15m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
    APP_URL: required(z.url(), 'http://localhost:5300'),
    TELEGRAM_BOT_TOKEN: required(z.string().min(1), 'test-telegram-token'),
    TELEGRAM_BOT_USERNAME: required(z.string().min(1), 'test_bot'),
    TELEGRAM_WEBHOOK_SECRET: required(z.string().regex(/^[A-Za-z0-9_-]{1,256}$/), 'test-telegram-secret'),
    ZALO_BOT_TOKEN: required(z.string().min(1), 'test-zalo-token'),
    ZALO_WEBHOOK_SECRET: required(z.string().min(8).max(256), 'test-zalo-secret'),
    KIE_URL: required(z.url(), 'http://127.0.0.1:9'),
    KIE_API_KEY: required(z.string().min(1), 'test-kie-key'),
    SEED_ADMIN_EMAIL: z.string().optional(), // used by `npm run seed` only
    SEED_ADMIN_PASSWORD: z.string().optional(),
  });

  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export const env = parseEnv(process.env);

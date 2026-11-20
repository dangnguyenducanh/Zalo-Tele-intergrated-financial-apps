// Starts the API for Playwright (playwright.config.ts → webServer) against a fresh in-memory MongoDB.
// Set MONGODB_URI (and MONGODB_DB) in the environment to run the E2E suite against a real database instead.
// Outbound HTTP is stubbed (bot-api-stub.js): bot replies never reach Telegram or Zalo, other external hosts fail.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { stubOutboundHttp } from './bot-api-stub.js';

if (!process.env.MONGODB_URI) {
  const mongod = await MongoMemoryServer.create(); // may download the MongoDB binary, so it runs before the stub
  process.env.MONGODB_URI = mongod.getUri();
}
stubOutboundHttp();
await import('../../src/local.js'); // imported after MONGODB_URI is set, because env.js reads it on import

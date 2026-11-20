// Starts the API for Playwright (playwright.config.ts → webServer) against a fresh in-memory MongoDB.
// Set MONGODB_URI (and MONGODB_DB) in the environment to run the E2E suite against a real database instead.
import { MongoMemoryServer } from 'mongodb-memory-server';

if (!process.env.MONGODB_URI) {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
}
await import('../../src/local.js'); // imported after MONGODB_URI is set, because env.js reads it on import

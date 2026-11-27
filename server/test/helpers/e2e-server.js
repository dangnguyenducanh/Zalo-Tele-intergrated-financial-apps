// Starts the API for Playwright (playwright.config.ts → webServer) against a fresh in-memory MongoDB.
// Set MONGODB_URI (and MONGODB_DB) in the environment to run the E2E suite against a real database instead.
// Outbound HTTP is stubbed (bot-api-stub.js): bot replies never reach Telegram or Zalo, the agent service answers canned texts
// and writes its own agentTurns rows, other external hosts fail.
// Mail is stubbed (mail-stub.js): codes are recorded in a file the tests read, and nothing opens SMTP, not even
// when the shell, a CI secret or a copied server/.env holds real Gmail settings.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AGENT_SECRET, AGENT_URL } from './agent-stub.js';
import { stubOutboundHttp } from './bot-api-stub.js';
import { installMailStub } from './mail-stub.js';

// Before the app is imported: config/env.js reads the environment on import, and with both set the mailer would use SMTP.
delete process.env.GMAIL_USER;
delete process.env.GMAIL_APP_PASSWORD;
// The agent service is a stub here (bot-api-stub.js) on a made-up host, whatever the shell or a copied server/.env holds.
process.env.AGENT_URL = AGENT_URL;
process.env.AGENT_SECRET = AGENT_SECRET;

if (!process.env.MONGODB_URI) {
  const mongod = await MongoMemoryServer.create(); // may download the MongoDB binary, so it runs before the stub
  process.env.MONGODB_URI = mongod.getUri();
}
stubOutboundHttp();
installMailStub((await import('../../src/services/mail.js')).setMailSender);
await import('../../src/local.js'); // imported after MONGODB_URI is set, because env.js reads it on import

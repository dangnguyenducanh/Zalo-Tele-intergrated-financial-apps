// Mail for the E2E API server (docs/07 §7.10.5), the way bot-api-stub.js does the bots: a sign-up or reset code is never
// sent, it is recorded here, so Playwright can read it. SMTP is not HTTP, so the MSW host block of bot-api-stub.js
// could not stop a real send: delivery itself is replaced, through the mailer's test seam.
//
// The record is one JSON line per mail in a file named after the API port (one file per worktree), the way the bot
// replies are kept: { to, purpose, code, language } with the full address, because the E2E accounts are made up and
// the test must pick its own mail out of many. The first line is a marker { stub: true, pid } that tells a test the
// server it talks to has this stub (client/e2e/helpers.ts checks it before anything is sent). Never loaded in production.
import { appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const mailFile = (port = process.env.PORT ?? '4100') => join(tmpdir(), `e2e-mail-${port}.jsonl`);

// `setMailSender` is passed in, not imported: services/mail.js reads the Gmail settings through config/env.js when it
// is first imported, and e2e-server.js must have removed them by then.
export function installMailStub(setMailSender) {
  const file = mailFile();
  writeFileSync(file, `${JSON.stringify({ stub: true, pid: process.pid })}\n`);
  setMailSender(async ({ to, purpose, code, language }) => {
    appendFileSync(file, `${JSON.stringify({ to, purpose, code, language })}\n`);
    console.info(`[mail-stub] ${purpose} code recorded`); // neither the code nor the address is logged
  });
}

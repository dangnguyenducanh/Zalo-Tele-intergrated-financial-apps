// Vitest setup file (vitest.config.js), run before every test file: services/mail.js is replaced, so no test can send
// mail (docs/07 §7.10.5). `sendCode` only records its calls (read them with helpers/mailbox.js); everything else in the
// module stays real and reads the environment at call time, so `canSendCodes()` is true under test and false once a
// test sets NODE_ENV to production without both GMAIL_* settings. server/test/mail.test.js tests the real module
// with vi.unmock(). The real module is loaded only when a test file imports it, never here, so that file can still
// replace nodemailer first.
import { beforeEach, vi } from 'vitest';

const mail = vi.hoisted(() => ({ sendCode: vi.fn() }));

vi.mock('../../src/services/mail.js', async (importOriginal) => ({ ...(await importOriginal()), sendCode: mail.sendCode }));

// Calls and one-off failures of the last test must not leak into the next one.
beforeEach(() => {
  mail.sendCode.mockReset().mockImplementation(async () => {});
});

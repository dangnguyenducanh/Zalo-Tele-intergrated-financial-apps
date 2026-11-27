import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

// Shared by the settings, journeys and non-functional specs. Every test registers its own fresh account through
// the API (its own cookie jar, so the browser stays logged out) against the in-memory database (playwright.config.ts).

export const PASSWORD = 'secret123';

// "YYYY-MM-DD" in Vietnam time, the day the app treats as today.
export const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

export type Account = { email: string; headers: Record<string, string>; walletId: string; category: (vi: string) => string };

// The mail the API under test did not send: server/test/helpers/mail-stub.js records every code in this file, one JSON
// line per mail, after a first line { stub: true, pid } that marks a server with the stub (one file per API port).
const MAIL_FILE = join(tmpdir(), `e2e-mail-${process.env.PORT ?? '4100'}.jsonl`);

function mailRecords(): { stub?: boolean; pid?: number; to?: string; code?: string }[] {
  try {
    return readFileSync(MAIL_FILE, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return []; // no file yet
  }
}

// Throws before anything is sent when the API on this port is not the E2E server with the mail stub: a dev server
// somebody left running (playwright.config.ts reuses it) would send real mail when Gmail is set up on it.
export function assertMailStub() {
  const marker = mailRecords()[0];
  const alive = () => {
    try {
      return marker?.stub === true && typeof marker.pid === 'number' && process.kill(marker.pid, 0); // signal 0 only asks whether it runs
    } catch {
      return false; // the server that wrote the marker is gone
    }
  };
  if (!alive()) throw new Error('The API on this port has no mail stub. Stop it and let Playwright start server/test/helpers/e2e-server.js.');
}

// The newest code mailed to this address (the full address, as typed), once it has been recorded. `not` skips the
// code you already have, for a resend.
export async function mailedCode(email: string, not?: string): Promise<string> {
  const newest = () => mailRecords().filter((record) => record.to === email.toLowerCase()).at(-1)?.code ?? '';
  await expect.poll(newest, { message: `a code mailed to ${email}`, timeout: 10_000 }).not.toBe(not ?? '');
  return newest();
}

// The Register form has been sent: the page is on /verify-email; type the code the stub recorded for this address.
export async function confirmSignup(page: Page, email: string) {
  await expect(page).toHaveURL(/\/verify-email$/);
  await page.getByRole('textbox', { name: 'Mã xác nhận' }).fill(await mailedCode(email)); // the 6th digit submits
}

// The one place a spec signs up through the API (docs/07-testing.md §7.10.1): register, read the code from the mail
// stub, verify. Every call comes from its own address (X-Forwarded-For, the server trusts one proxy hop), so a per-IP
// mail limit can't stop the suite. Returns the e-mail, the access token and the user.
export async function registerByApi(request: APIRequestContext, name = 'Lan', password = PASSWORD) {
  assertMailStub();
  const email = `${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const headers = { 'X-Forwarded-For': `10.${randomBytes(3).join('.')}` }; // random per call, so no two workers or calls share an address
  const pending = await request.post('/api/auth/register', { headers, data: { name, email, password, language: 'vi' } });
  expect(pending.status()).toBe(202);
  const { signupToken } = (await pending.json()) as { signupToken: string };
  const res = await request.post('/api/auth/register/verify', { headers, data: { email, code: await mailedCode(email), signupToken } });
  expect(res.status()).toBe(201);
  const { accessToken, user } = (await res.json()) as { accessToken: string; user: { defaultWalletId: string } };
  return { email, accessToken, user };
}

export async function createAccount(request: APIRequestContext, name = 'Lan'): Promise<Account> {
  const { email, accessToken, user } = await registerByApi(request, name);
  const headers = { Authorization: `Bearer ${accessToken}` };
  const categories = (await (await request.get('/api/categories', { headers })).json()) as { id: string; names?: { vi: string } }[];
  const category = (vi: string) => categories.find((c) => c.names?.vi === vi)?.id ?? '';
  return { email, headers, walletId: user.defaultWalletId, category };
}

// An expense (or income) today, in the seeded "Tiền mặt" wallet.
export async function addTransaction(request: APIRequestContext, account: Account, amount: number, categoryVi: string, note: string, type = 'expense') {
  const data = { type, amount, walletId: account.walletId, categoryId: account.category(categoryVi), occurredAt: `${TODAY}T09:00:00+07:00`, note };
  const res = await request.post('/api/transactions', { headers: account.headers, data });
  expect(res.status()).toBe(201);
}

// Logs in through the login page (Vietnamese UI) and waits for the app shell.
export async function logIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel(/^Mật khẩu/).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('button', { name: 'Tài khoản' })).toBeVisible();
}

export const noHorizontalScroll = (page: Page) => page.evaluate('document.documentElement.scrollWidth <= window.innerWidth');

import { randomBytes } from 'node:crypto';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

// Shared by the settings, journeys and non-functional specs. Every test registers its own fresh account through
// the API (its own cookie jar, so the browser stays logged out) against the in-memory database (playwright.config.ts).

export const PASSWORD = 'secret123';

// "YYYY-MM-DD" in Vietnam time, the day the app treats as today.
export const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

export type Account = { email: string; headers: Record<string, string>; walletId: string; category: (vi: string) => string };

// The one place a spec signs up through the API (docs/07-testing.md §7.10.1): when e-mail codes arrive, only this
// function changes. Every call comes from its own address (X-Forwarded-For, the server trusts one proxy hop), so a
// per-IP mail limit can't stop the suite. Returns the e-mail, the access token and the user.
export async function registerByApi(request: APIRequestContext, name = 'Lan', password = PASSWORD) {
  const email = `${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const forwardedFor = `10.${randomBytes(3).join('.')}`; // random per call, so no two workers or calls share an address
  const res = await request.post('/api/auth/register', { headers: { 'X-Forwarded-For': forwardedFor }, data: { name, email, password, language: 'vi' } });
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

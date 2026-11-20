import { expect, test, type APIRequestContext } from '@playwright/test';
import { addTransaction, createAccount, logIn, PASSWORD } from './helpers';

// Settings in a real browser against the real API: devices, password, theme and language.
// A second browser context is a second device (its own cookies and memory).
test.use({ locale: 'vi-VN' });

const profileOf = async (request: APIRequestContext, email: string, password = PASSWORD) =>
  (await (await request.post('/api/auth/login', { data: { email, password } })).json()) as { user?: { theme: string; language: string } };

test('TC-F1-10 "Log out other devices" in Settings sends the other browser to /login; this one keeps working', async ({ page, browser, request }, testInfo) => {
  const { email } = await createAccount(request); // registering through the API is one device too
  const phone = await browser.newContext({ locale: 'vi-VN', viewport: { width: 375, height: 812 } });
  const phonePage = await phone.newPage();
  await logIn(phonePage, email);
  await logIn(page, email);

  await page.getByRole('button', { name: 'Tài khoản' }).click();
  await page.getByRole('menuitem', { name: 'Cài đặt' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Cài đặt' })).toBeVisible();
  const devices = page.getByRole('region', { name: 'Thiết bị đang đăng nhập' });
  await expect(devices.getByRole('listitem')).toHaveCount(3);
  await expect(devices.getByRole('listitem').filter({ hasText: 'Thiết bị này' })).toHaveCount(1);
  await expect(devices.getByRole('listitem').first()).toContainText('Chrome'); // newest first: this browser
  await page.screenshot({ path: testInfo.outputPath('settings-devices.png'), fullPage: true, animations: 'disabled' });

  await devices.getByRole('button', { name: 'Đăng xuất các thiết bị khác' }).click();
  await page.getByRole('dialog', { name: 'Đăng xuất các thiết bị khác?' }).getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(devices.getByRole('listitem')).toHaveCount(1);
  await expect(devices).toContainText('Chỉ có thiết bị này đang đăng nhập.');

  // The phone's refresh cookie was revoked on the server: opening the app again lands on /login.
  await phonePage.reload();
  await expect(phonePage).toHaveURL(/\/login$/);
  await expect(phonePage.getByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeVisible();
  await phone.close();

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Cài đặt' })).toBeVisible();
});

test('TC-F1-12 change the password in Settings: other devices are logged out, the old password stops working', async ({ page, browser, request }) => {
  const { email } = await createAccount(request);
  const laptop = await browser.newContext({ locale: 'vi-VN' });
  const laptopPage = await laptop.newPage();
  await logIn(laptopPage, email);
  await logIn(page, email);
  await page.goto('/settings');

  const form = page.getByRole('form', { name: 'Đổi mật khẩu' });
  await form.getByLabel(/^Mật khẩu hiện tại/).fill('not-my-password');
  await form.getByLabel(/^Mật khẩu mới/).fill('brand-new-pass');
  await form.getByLabel(/^Nhập lại mật khẩu mới/).fill('brand-new-pass');
  await form.getByRole('button', { name: 'Đổi mật khẩu' }).click();
  await expect(form.getByLabel(/^Mật khẩu hiện tại/)).toHaveAccessibleDescription('Mật khẩu hiện tại không đúng');

  await form.getByLabel(/^Mật khẩu hiện tại/).fill(PASSWORD);
  await form.getByRole('button', { name: 'Đổi mật khẩu' }).click();
  await expect(page.getByText('Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Thiết bị đang đăng nhập' }).getByRole('listitem')).toHaveCount(1);

  await laptopPage.reload();
  await expect(laptopPage).toHaveURL(/\/login$/);
  await laptop.close();
  expect((await request.post('/api/auth/login', { data: { email, password: PASSWORD } })).status()).toBe(401);
  expect((await request.post('/api/auth/login', { data: { email, password: 'brand-new-pass' } })).status()).toBe(200);
});

test('TC-F12-01 Dark picked in Settings stays after a reload and follows the user to a new browser', async ({ page, browser, request }) => {
  const { email } = await createAccount(request);
  await page.emulateMedia({ colorScheme: 'light' });
  await logIn(page, email);
  await page.goto('/settings');

  const form = page.getByRole('form', { name: 'Tuỳ chọn' });
  await form.getByRole('radio', { name: 'Tối' }).check();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light'); // nothing changes before Save
  await form.getByRole('button', { name: 'Lưu tuỳ chọn' }).click();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect.poll(async () => (await profileOf(request, email)).user?.theme).toBe('dark');

  await page.reload();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect(page.getByRole('form', { name: 'Tuỳ chọn' }).getByRole('radio', { name: 'Tối' })).toBeChecked();

  const fresh = await browser.newContext({ colorScheme: 'light', locale: 'vi-VN' }); // empty localStorage, light OS
  const otherPage = await fresh.newPage();
  await logIn(otherPage, email);
  await expect(otherPage.locator('html')).toHaveCSS('color-scheme', 'dark');
  await fresh.close();
});

test('TC-F12-02 English picked in Settings: English UI, money as ₫45,000, saved for the bots and other browsers', async ({ page, browser, request }, testInfo) => {
  const account = await createAccount(request);
  await addTransaction(request, account, 45_000, 'Ăn uống', 'phở');
  await logIn(page, account.email);
  await page.goto('/settings');

  const form = page.getByRole('form', { name: 'Tuỳ chọn' });
  await form.getByRole('radio', { name: 'English' }).check();
  await form.getByRole('button', { name: 'Lưu tuỳ chọn' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(page.getByText('Preferences saved')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  // The bots read the profile language (server/test/preferences.test.js shows the Telegram reply switching).
  await expect.poll(async () => (await profileOf(request, account.email)).user?.language).toBe('en');
  await page.screenshot({ path: testInfo.outputPath('settings-english.png'), fullPage: true, animations: 'disabled' });

  await page.getByRole('link', { name: 'Transactions' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Transactions' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'phở' })).toContainText('₫45,000');

  const fresh = await browser.newContext({ locale: 'vi-VN' });
  const otherPage = await fresh.newPage();
  await otherPage.goto('/login');
  await otherPage.getByRole('textbox', { name: 'Email' }).fill(account.email);
  await otherPage.getByLabel(/^Mật khẩu/).fill(PASSWORD);
  await otherPage.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(otherPage.getByRole('heading', { level: 1, name: 'Hello, Lan' })).toBeVisible();
  await fresh.close();
});

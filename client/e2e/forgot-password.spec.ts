import { expect, test } from '@playwright/test';
import { assertMailStub, createAccount, logIn, mailedCode, noHorizontalScroll, PASSWORD } from './helpers';

// docs/02 §2.12.3 in a real browser against the real API: the Login link, the emailed code, the new password, and every
// other device logged out. The code is read from the E2E mail stub (docs/07 §7.10.5). Screenshots are for the PR.
test.use({ locale: 'vi-VN' });

const NEW_PASSWORD = 'mat-khau-moi-123';

test('TC-F1-66 forgot password: Login link, a wrong then the right code, the new password works and the other browser is logged out', async ({ page, browser, request }, testInfo) => {
  assertMailStub();
  const { email } = await createAccount(request);
  const signupCode = await mailedCode(email); // the sign-up code the account was made with

  // userA is logged in in a second browser, as on another device.
  const other = await browser.newContext({ locale: 'vi-VN' });
  const otherPage = await other.newPage();
  await logIn(otherPage, email);
  await expect(otherPage.getByRole('heading', { level: 1, name: /^Xin chào/ })).toBeVisible();

  await page.goto('/login');
  await page.getByRole('link', { name: 'Quên mật khẩu?' }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Quên mật khẩu' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('forgot-step1-1280.png'), animations: 'disabled' });
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('button', { name: 'Gửi mã' }).click();

  const heading = page.getByRole('heading', { level: 1, name: 'Nhập mã và mật khẩu mới' });
  await expect(heading).toBeFocused();
  await expect(page.getByText(/đăng xuất/)).toBeVisible(); // the help line about every device
  await page.screenshot({ path: testInfo.outputPath('forgot-step2-1280.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 375, height: 800 });
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('forgot-step2-375.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 1280, height: 720 });

  const code = await mailedCode(email, signupCode);
  const box = page.getByRole('textbox', { name: 'Mã xác nhận' });
  await page.getByLabel(/^Mật khẩu mới/).fill(NEW_PASSWORD);
  await page.getByLabel(/^Nhập lại mật khẩu mới/).fill(NEW_PASSWORD);
  await box.fill(code === '000000' ? '111111' : '000000'); // six digits, and nothing is sent until Save
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Đổi mật khẩu' }).click();
  await expect(box).toHaveAccessibleDescription('Mã không đúng. Còn 4 lần thử.');
  await expect(box).toBeFocused();

  await box.fill(code);
  await page.getByRole('button', { name: 'Đổi mật khẩu' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('status')).toHaveText('Mật khẩu đã được đổi, hãy đăng nhập lại');
  await expect(page.getByRole('button', { name: 'Tài khoản' })).toHaveCount(0); // no automatic login
  expect(page.url()).not.toContain(code);
  await page.screenshot({ path: testInfo.outputPath('forgot-done-login-1280.png'), animations: 'disabled' });

  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel(/^Mật khẩu/).fill(PASSWORD); // the old password is dead
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email hoặc mật khẩu không đúng.');
  await page.getByLabel(/^Mật khẩu/).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Xin chào/ })).toBeVisible();

  // The other browser held a session from before the reset: its next refresh sends it to /login.
  await otherPage.reload();
  await expect(otherPage).toHaveURL(/\/login$/);
  await other.close();
});

test('TC-F1-66 forgot password for an address with no account shows the same step 2 as for a real account', async ({ page }) => {
  assertMailStub();
  const email = `nobody-${Date.now()}@example.com`;
  await page.goto('/forgot-password');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('button', { name: 'Gửi mã' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Nhập mã và mật khẩu mới' })).toBeFocused();
  await expect(page.getByText(`Nếu email ${email} có tài khoản`)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0); // nothing tells the visitor the address has no account
});

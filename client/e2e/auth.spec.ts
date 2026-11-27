import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { addTransaction, createAccount as createAccountWithData, registerByApi } from './helpers';

// App shell journeys in a real browser against the real API (in-memory MongoDB, see playwright.config.ts):
// login/register, silent refresh on reload, logout, theme, language and the responsive layout.

const PASSWORD = 'secret123';
test.use({ locale: 'vi-VN' }); // Vietnamese is the default UI language

// Registers a fresh account through the API (its own cookie jar, so the browser stays logged out).
async function createAccount(request: APIRequestContext, name = 'Lan'): Promise<string> {
  return (await registerByApi(request, name)).email;
}

// The profile as the API stores it.
async function profileOf(request: APIRequestContext, email: string) {
  const res = await request.post('/api/auth/login', { data: { email, password: PASSWORD } });
  return (await res.json()).user as { theme: string; language: string };
}

async function logIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel(/^(Mật khẩu|Password)/).fill(PASSWORD);
  await page.getByRole('button', { name: /^(Đăng nhập|Log in)$/ }).click();
  // Wait for the app: the login page has its own theme/language switches, and the profile is applied on login.
  await expect(page.getByRole('button', { name: /^(Tài khoản|Account)$/ })).toBeVisible();
}

test('TC-F1-08 register, reload (still logged in), log out (back to /login)', async ({ page, context }) => {
  const email = `an-${Date.now()}@example.com`;
  await page.goto('/register');
  await page.getByRole('textbox', { name: 'Họ tên' }).fill('An');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel(/^Mật khẩu/).fill(PASSWORD);
  await page.getByLabel(/^Nhập lại mật khẩu/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng ký' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Xin chào, An' })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  // The refresh token is an httpOnly cookie and the access token is never written to storage.
  const refreshCookie = (await context.cookies()).find((cookie) => cookie.name === 'rt');
  expect(refreshCookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/auth' });
  expect(await page.evaluate('JSON.stringify(localStorage) + JSON.stringify(sessionStorage)')).not.toContain('eyJ');

  // The access token lived only in memory; the reload restores the session from the refresh cookie.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Xin chào, An' })).toBeVisible();

  await page.getByRole('button', { name: 'Tài khoản' }).click();
  await page.getByRole('menuitem', { name: 'Đăng xuất' }).click();
  await expect(page).toHaveURL(/\/login$/);

  // The session was revoked on the server, so a protected page now sends the visitor to /login.
  // The catalogue step opens /transactions; that route lands with T08, so "/" stands in for it until then.
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeVisible();
});

// BUG-013: logging out must not send the next person who logs in on this browser to the last user's page and filters.
test('TC-F1-25 after a logout the next user lands on / and sees their own transactions', async ({ page, request }, testInfo) => {
  const lan = await createAccountWithData(request, 'Lan');
  const minh = await createAccountWithData(request, 'Minh');
  await addTransaction(request, minh, 45000, 'Ăn uống', 'phở');
  await logIn(page, lan.email);
  await page.goto(`/transactions?walletId=${lan.walletId}`);
  await page.getByRole('button', { name: 'Tài khoản' }).click();
  await page.getByRole('menuitem', { name: 'Đăng xuất' }).click();
  await expect(page).toHaveURL(/\/login$/);

  // Minh logs in on the login page the logout left open.
  await page.getByRole('textbox', { name: 'Email' }).fill(minh.email);
  await page.getByLabel(/^Mật khẩu/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Xin chào, Minh' })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.screenshot({ path: testInfo.outputPath('next-user-landing-1280.png'), animations: 'disabled' });
  await page.goto('/transactions');
  await expect(page.getByRole('row').filter({ hasText: 'phở' })).toBeVisible();
});

test('TC-F12-01 dark theme persists after reload (localStorage) and after login in a new browser (profile)', async ({ page, browser, request }) => {
  const email = await createAccount(request);
  await logIn(page, email);

  await page.getByRole('button', { name: 'Chuyển sang giao diện tối' }).click();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect.poll(async () => (await profileOf(request, email)).theme).toBe('dark');

  await page.reload();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect(page.getByRole('button', { name: 'Chuyển sang giao diện sáng' })).toBeVisible();

  // A fresh browser: empty localStorage and a light OS theme, so only the profile can make it dark.
  const fresh = await browser.newContext({ colorScheme: 'light', locale: 'vi-VN' });
  const otherPage = await fresh.newPage();
  await logIn(otherPage, email);
  await expect(otherPage.getByRole('heading', { level: 1, name: 'Xin chào, Lan' })).toBeVisible();
  await expect(otherPage.locator('html')).toHaveCSS('color-scheme', 'dark');
  await fresh.close();
});

test('TC-F12-02 switching to English translates the UI and follows the user to a new browser', async ({ page, browser, request }) => {
  const email = await createAccount(request);
  await logIn(page, email);

  await page.getByRole('button', { name: 'Đổi ngôn ngữ sang English' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Hello, Lan' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect.poll(async () => (await profileOf(request, email)).language).toBe('en'); // the bots reply in it too

  const fresh = await browser.newContext({ locale: 'vi-VN' });
  const otherPage = await fresh.newPage();
  await logIn(otherPage, email);
  await expect(otherPage.getByRole('heading', { level: 1, name: 'Hello, Lan' })).toBeVisible();
  await fresh.close();
});

const viewports = [
  { name: 'phone', width: 375, height: 812, desktop: false },
  { name: 'tablet', width: 768, height: 1024, desktop: false },
  { name: 'desktop', width: 1280, height: 800, desktop: true },
];

for (const scheme of ['light', 'dark'] as const) {
  for (const viewport of viewports) {
    test(`TC-NF-02 shell pages at ${viewport.width}x${viewport.height} in ${scheme}: no horizontal scroll, ${viewport.desktop ? 'side drawer' : 'bottom nav'}`, async ({ page, request }, testInfo) => {
      const email = await createAccount(request);
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });

      const noHorizontalScroll = async (label: string) => {
        await page.screenshot({ path: testInfo.outputPath(`${label}-${viewport.name}-${scheme}.png`), fullPage: true });
        expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), `${label} scrolls sideways`).toBe(true);
      };

      for (const path of ['/login', '/register', '/verify-email', '/no-such-page']) {
        // /verify-email shows only while a sign-up is pending, so seed the entry Register keeps (docs/05 §5.11.1).
        if (path === '/verify-email') await page.evaluate(() => sessionStorage.setItem('pendingSignup', JSON.stringify({ email: 'lan@example.com', maskedEmail: 'l***@example.com', name: 'Lan', signupToken: 't', resendAt: Date.now() + 60_000 })));
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.locator('html')).toHaveCSS('color-scheme', scheme);
        await noHorizontalScroll(path.slice(1));
      }

      await logIn(page, email);
      await expect(page.getByRole('heading', { level: 1, name: 'Xin chào, Lan' })).toBeVisible();
      const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
      // The current page is marked by bold text, not by colour alone (WCAG 1.4.1).
      const current = nav.getByRole('link', { name: 'Tổng quan' });
      await expect(current).toHaveAttribute('aria-current', 'page');
      await expect(current.getByText('Tổng quan')).toHaveCSS('font-weight', '600'); // semibold, not colour alone
      if (viewport.desktop) {
        await expect(nav.getByRole('link', { name: 'Ví' })).toBeVisible(); // every page in the drawer
        await expect(page.getByRole('button', { name: 'Thêm' })).toHaveCount(0);
      } else {
        await expect(nav.getByRole('button', { name: 'Thêm' })).toBeVisible(); // bottom nav + "More"
        await expect(page.getByRole('link', { name: 'Ví' })).toHaveCount(0);
      }
      await noHorizontalScroll('home');

      if (!viewport.desktop) {
        await nav.getByRole('button', { name: 'Thêm' }).click();
        await expect(page.getByRole('dialog', { name: 'Các mục khác' }).getByRole('link', { name: 'Ví' })).toBeVisible();
        await noHorizontalScroll('more');
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
      }
    });
  }
}

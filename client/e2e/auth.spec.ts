import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// App shell journeys in a real browser: login/register, silent refresh on reload, logout, theme,
// language and the responsive layout.
//
// The auth API (task T02) is not on main yet, so the browser's /api/auth/* and /api/users/me calls
// are answered here, following the docs/04 contract. Accounts are shared by all browser contexts
// (like a database); the refresh cookie is per context. Once T02 is merged, delete FakeAuthApi and
// the `attach` calls to run the same journeys against the real API.

type User = {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  status: 'active';
  language: 'vi' | 'en';
  theme: 'light' | 'dark' | 'system';
  defaultWalletId: null;
};

class FakeAuthApi {
  private accounts = new Map<string, { user: User; password: string }>();

  addAccount(email: string, password: string, name = 'Lan') {
    const user: User = { id: `u${this.accounts.size + 1}`, email, name, role: 'user', status: 'active', language: 'vi', theme: 'system', defaultWalletId: null };
    this.accounts.set(email, { user, password });
  }

  profile(email: string): User | undefined {
    return this.accounts.get(email)?.user;
  }

  async attach(context: BrowserContext) {
    let loggedInEmail: string | null = null; // this context's refresh cookie
    const fail = (status: number, code: string) => ({ status, json: { error: { code, message: code } } });
    const session = (email: string) => ({ status: 200, json: { accessToken: `access-${email}`, user: this.profile(email) } });

    await context.route('**/api/auth/*', async (route) => {
      const action = new URL(route.request().url()).pathname.split('/').pop();
      const body = route.request().postDataJSON() as Record<string, string> | null;
      let reply: { status: number; json?: unknown };
      if (action === 'refresh') {
        reply = loggedInEmail ? session(loggedInEmail) : fail(401, 'INVALID_REFRESH');
      } else if (action === 'login') {
        const account = this.accounts.get(body?.email ?? '');
        if (!account || account.password !== body?.password) reply = fail(401, 'INVALID_CREDENTIALS');
        else reply = session((loggedInEmail = account.user.email));
      } else if (action === 'register' && body) {
        if (this.accounts.has(body.email!)) reply = fail(409, 'EMAIL_TAKEN');
        else {
          this.addAccount(body.email!, body.password!, body.name);
          this.profile(body.email!)!.language = body.language as User['language'];
          reply = { ...session((loggedInEmail = body.email!)), status: 201 };
        }
      } else if (action === 'logout') {
        loggedInEmail = null;
        reply = { status: 204 };
      } else {
        reply = fail(404, 'NOT_FOUND');
      }
      await route.fulfill(reply.json === undefined ? { status: reply.status } : { status: reply.status, json: reply.json });
    });

    await context.route('**/api/users/me', async (route) => {
      const email = route.request().headers()['authorization']?.replace('Bearer access-', '');
      const user = email ? this.profile(email) : undefined;
      if (!user) return route.fulfill(fail(401, 'UNAUTHENTICATED'));
      Object.assign(user, route.request().postDataJSON());
      await route.fulfill({ status: 200, json: { user } });
    });
  }
}

const api = new FakeAuthApi();
test.use({ locale: 'vi-VN' }); // Vietnamese is the default UI language
const PASSWORD = 'secret123';

async function logIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel(/^(Mật khẩu|Password)/).fill(PASSWORD);
  await page.getByRole('button', { name: /^(Đăng nhập|Log in)$/ }).click();
}

test('TC-F1-08 register, reload (still logged in), log out (back to /login)', async ({ page, context }) => {
  await api.attach(context);
  await page.goto('/register');
  await page.getByRole('textbox', { name: 'Họ tên' }).fill('An');
  await page.getByRole('textbox', { name: 'Email' }).fill('an@example.com');
  await page.getByLabel(/^Mật khẩu/).fill(PASSWORD);
  await page.getByLabel(/^Nhập lại mật khẩu/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng ký' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Xin chào, An' })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  // The access token lives only in memory; the reload restores it from the refresh cookie.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Xin chào, An' })).toBeVisible();

  await page.getByRole('button', { name: 'Tài khoản' }).click();
  await page.getByRole('menuitem', { name: 'Đăng xuất' }).click();
  await expect(page).toHaveURL(/\/login$/);

  // A protected page now sends the visitor to /login.
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeVisible();
});

test('TC-F12-01 dark theme persists after reload (localStorage) and after login in a new browser (profile)', async ({ page, context, browser }) => {
  api.addAccount('theme@example.com', PASSWORD);
  await api.attach(context);
  await logIn(page, 'theme@example.com');

  await page.getByRole('button', { name: 'Chuyển sang giao diện tối' }).click();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect.poll(() => api.profile('theme@example.com')?.theme).toBe('dark');

  await page.reload();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect(page.getByRole('button', { name: 'Chuyển sang giao diện sáng' })).toBeVisible();

  // A fresh browser: empty localStorage, so only the profile can make it dark.
  const fresh = await browser.newContext({ colorScheme: 'light', locale: 'vi-VN' });
  await api.attach(fresh);
  const otherPage = await fresh.newPage();
  await logIn(otherPage, 'theme@example.com');
  await expect(otherPage.getByRole('heading', { level: 1, name: 'Xin chào, Lan' })).toBeVisible();
  await expect(otherPage.locator('html')).toHaveCSS('color-scheme', 'dark');
  await fresh.close();
});

test('TC-F12-02 switching to English translates the UI and follows the user to a new browser', async ({ page, context, browser }) => {
  api.addAccount('lang@example.com', PASSWORD);
  await api.attach(context);
  await logIn(page, 'lang@example.com');

  await page.getByRole('button', { name: 'Đổi ngôn ngữ sang English' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Hello, Lan' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect.poll(() => api.profile('lang@example.com')?.language).toBe('en');

  const fresh = await browser.newContext({ locale: 'vi-VN' });
  await api.attach(fresh);
  const otherPage = await fresh.newPage();
  await logIn(otherPage, 'lang@example.com');
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
    test(`TC-NF-02 shell pages at ${viewport.width}x${viewport.height} in ${scheme}: no horizontal scroll, ${viewport.desktop ? 'side drawer' : 'bottom nav'}`, async ({ page, context }, testInfo) => {
      const email = `nf02-${scheme}-${viewport.name}@example.com`;
      api.addAccount(email, PASSWORD);
      await api.attach(context);
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });

      const noHorizontalScroll = async (label: string) => {
        await page.screenshot({ path: testInfo.outputPath(`${label}-${viewport.name}-${scheme}.png`), fullPage: true });
        expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), `${label} scrolls sideways`).toBe(true);
      };

      for (const path of ['/login', '/register', '/no-such-page']) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.locator('html')).toHaveCSS('color-scheme', scheme);
        await noHorizontalScroll(path.slice(1));
      }

      await logIn(page, email);
      await expect(page.getByRole('heading', { level: 1, name: 'Xin chào, Lan' })).toBeVisible();
      const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
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

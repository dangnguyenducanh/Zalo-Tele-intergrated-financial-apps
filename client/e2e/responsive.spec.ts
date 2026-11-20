import { expect, test } from '@playwright/test';
import { addTransaction, createAccount, logIn, noHorizontalScroll, TODAY } from './helpers';

// TC-NF-02 for every page behind the login, with some data on it, at phone, tablet and desktop widths in light
// and dark. The public pages (login, register, 404) are covered in auth.spec.ts. A normal user gets the 403
// page on /admin/*; the admin tables need an admin account, which the E2E server does not create.
test.use({ locale: 'vi-VN', reducedMotion: 'reduce' });

const PAGES = [
  { path: '/', title: 'Xin chào, Lan' },
  { path: '/transactions', title: 'Giao dịch' },
  { path: '/wallets', title: 'Ví' },
  { path: '/categories', title: 'Danh mục' },
  { path: '/budgets', title: 'Ngân sách' },
  { path: '/bot', title: 'Hộp thư bot' },
  { path: '/settings', title: 'Cài đặt' },
  { path: '/admin/users', title: 'Không có quyền truy cập' },
];

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812, desktop: false },
  { name: 'tablet', width: 768, height: 1024, desktop: false },
  { name: 'desktop', width: 1280, height: 800, desktop: true },
];

for (const scheme of ['light', 'dark'] as const) {
  for (const viewport of VIEWPORTS) {
    test(`TC-NF-02 every app page at ${viewport.width}x${viewport.height} in ${scheme}: no sideways scroll, ${viewport.desktop ? 'side drawer' : 'bottom nav'}`, async ({ page, request }, testInfo) => {
      const account = await createAccount(request);
      await addTransaction(request, account, 45_000, 'Ăn uống', 'phở bò tái chín nạm gầu gân sách');
      await addTransaction(request, account, 15_000_000, 'Lương', 'lương tháng', 'income');
      const budget = { month: TODAY.slice(0, 7), categoryId: account.category('Ăn uống'), limit: 50_000 };
      expect((await request.post('/api/budgets', { headers: account.headers, data: budget })).status()).toBe(201);

      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      await logIn(page, account.email);

      for (const { path, title } of PAGES) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
        await page.waitForLoadState('networkidle'); // lists and charts are in
        await expect(page.locator('html')).toHaveCSS('color-scheme', scheme);
        const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
        if (viewport.desktop) await expect(nav.getByRole('link', { name: 'Ví' })).toBeVisible();
        else await expect(nav.getByRole('button', { name: 'Thêm' })).toBeVisible();

        const label = path === '/' ? 'dashboard' : path.slice(1).replace('/', '-');
        await page.screenshot({ path: testInfo.outputPath(`${label}-${viewport.name}-${scheme}.png`), fullPage: true, animations: 'disabled' });
        // Polled: charts shrink to the width on their next ResizeObserver callback.
        await expect.poll(() => noHorizontalScroll(page), { message: `${path} scrolls sideways` }).toBe(true);
      }
    });
  }
}

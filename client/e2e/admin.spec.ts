import { expect, test } from '@playwright/test';

// The admin area seen by a normal user, in a real browser against the real API (see playwright.config.ts).
test.use({ locale: 'vi-VN' });

test('TC-F11-05 a normal user sees no admin menu and gets the 403 page on /admin/*', async ({ page, request }, testInfo) => {
  const email = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'secret123';
  expect((await request.post('/api/auth/register', { data: { name: 'Lan', email, password, language: 'vi' } })).status()).toBe(201);

  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel(/^Mật khẩu/).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();

  const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
  await expect(nav.getByRole('link', { name: 'Ví' })).toBeVisible(); // the side drawer is there…
  await expect(nav.getByRole('link', { name: 'Quản trị người dùng' })).toHaveCount(0); // …without the admin pages
  await expect(nav.getByRole('link', { name: 'Danh mục mặc định' })).toHaveCount(0);

  for (const path of ['/admin/users', '/admin/categories']) {
    await page.goto(path); // typed into the address bar: a full reload, the session comes back from the cookie
    await expect(page.getByRole('heading', { level: 1, name: 'Không có quyền truy cập' })).toBeVisible();
    await expect(page.getByText('Trang này chỉ dành cho quản trị viên.')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  }
  await page.screenshot({ path: testInfo.outputPath('admin-403.png'), fullPage: true });
});

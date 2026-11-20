import { expect, test } from '@playwright/test';
import { PASSWORD } from './helpers';

// Whole customer journeys across pages, in a real browser against the real API, parser and statistics.
// The feature specs test one screen each; these check that the screens agree with each other.
test.use({ locale: 'vi-VN', reducedMotion: 'reduce' });

test('TC-F13-02 journey, web only (MT-01 steps): register, quick add three lines, dashboard totals, edit, delete with Undo, log out', async ({ page }, testInfo) => {
  const email = `journey-${Date.now()}@example.com`;
  await page.goto('/register');
  await page.getByRole('textbox', { name: 'Họ tên' }).fill('An');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel(/^Mật khẩu/).fill(PASSWORD);
  await page.getByLabel(/^Nhập lại mật khẩu/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng ký' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Xin chào, An' })).toBeVisible();

  // Three lines in the dashboard's quick add: no bot, no form.
  const box = page.getByRole('textbox', { name: 'Thêm nhanh' });
  await box.fill('phở 45k\ngrab 32k\n+lương 15tr');
  await expect(page.getByRole('list', { name: 'Xem trước' }).getByRole('listitem')).toHaveCount(3);
  await box.press('Enter');
  await expect(box).toHaveValue('');
  const expense = page.getByRole('article', { name: 'Chi tiêu' });
  await expect(expense).toContainText(/77\.000\s₫/);
  await expect(page.getByRole('article', { name: 'Thu nhập' })).toContainText(/15\.000\.000\s₫/);
  await expect(page.getByRole('article', { name: 'Chênh lệch (thu − chi)' })).toContainText(/14\.923\.000\s₫/);
  await expect(page.getByRole('list', { name: 'Giao dịch gần đây' }).getByRole('listitem')).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath('journey-dashboard.png'), fullPage: true, animations: 'disabled' });

  // Edit on the transactions page; the dashboard follows.
  await page.getByRole('link', { name: 'Giao dịch' }).first().click();
  const pho = page.getByRole('row').filter({ hasText: 'phở' });
  await pho.getByRole('button', { name: 'Sửa giao dịch phở' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sửa giao dịch' });
  await dialog.getByRole('textbox', { name: 'Số tiền (₫)' }).fill('50k');
  await dialog.getByRole('button', { name: 'Lưu' }).click();
  await expect(pho).toContainText(/−50\.000\s₫/);

  // Delete with Undo: gone, then back.
  const grab = page.getByRole('row').filter({ hasText: 'grab' });
  await grab.getByRole('button', { name: 'Xoá giao dịch grab' }).click();
  await expect(grab).toBeHidden();
  await page.getByRole('button', { name: 'Hoàn tác' }).click();
  await expect(grab).toContainText(/−32\.000\s₫/);

  await page.getByRole('link', { name: 'Tổng quan' }).first().click();
  await expect(expense).toContainText(/82\.000\s₫/); // 50k + 32k: the edit counted, the undone delete did not
  await expect(page.getByRole('article', { name: 'Chênh lệch (thu − chi)' })).toContainText(/14\.918\.000\s₫/);

  await page.getByRole('button', { name: 'Tài khoản' }).click();
  await page.getByRole('menuitem', { name: 'Đăng xuất' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/transactions');
  await expect(page).toHaveURL(/\/login$/); // the session was revoked on the server
});

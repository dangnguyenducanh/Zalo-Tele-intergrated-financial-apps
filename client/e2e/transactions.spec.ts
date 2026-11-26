import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { noHorizontalScroll, registerByApi } from './helpers';

// Transactions screen and quick add in a real browser against the real API and parser (in-memory MongoDB,
// see playwright.config.ts). Every account is new, so each test starts with no transactions.

const PASSWORD = 'secret123';
test.use({ locale: 'vi-VN' }); // Vietnamese is the default UI language

// Registers a fresh account through the API (its own cookie jar); returns its email and an Authorization header.
async function createAccount(request: APIRequestContext) {
  const { email, accessToken } = await registerByApi(request);
  return { email, headers: { Authorization: `Bearer ${accessToken}` } };
}

async function logIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel(/^Mật khẩu/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('button', { name: 'Tài khoản' })).toBeVisible();
}

// How many transactions the database holds for this account (read through the API, not the screen).
async function countSaved(request: APIRequestContext, headers: Record<string, string>) {
  const res = await request.get('/api/transactions', { headers });
  return ((await res.json()) as { total: number }).total;
}

test('TC-F4-06 add, edit, delete with Undo: the table updates each time', async ({ page, request }, testInfo) => {
  const { email } = await createAccount(request);
  await logIn(page, email);
  await page.getByRole('link', { name: 'Giao dịch' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Giao dịch' })).toBeVisible();
  await expect(page.getByText('Chưa có giao dịch nào')).toBeVisible();

  await page.getByRole('button', { name: 'Thêm giao dịch' }).click();
  const add = page.getByRole('dialog', { name: 'Thêm giao dịch' });
  await add.getByRole('textbox', { name: 'Số tiền (₫)' }).fill('45k');
  await expect(add.getByRole('textbox', { name: 'Số tiền (₫)' })).toHaveAccessibleDescription(/45\.000\s₫/);
  await add.getByRole('combobox', { name: 'Danh mục' }).selectOption({ label: 'Ăn uống' });
  await add.getByRole('textbox', { name: 'Ghi chú' }).fill('phở bò');
  await add.getByRole('button', { name: 'Lưu' }).click();
  await expect(add).toBeHidden();
  const row = page.getByRole('row').filter({ hasText: 'phở bò' });
  await expect(row).toContainText(/−45\.000\s₫/);
  await expect(row).toContainText('Tiền mặt'); // the default wallet seeded on register

  await row.getByRole('button', { name: 'Sửa giao dịch phở bò' }).click();
  const edit = page.getByRole('dialog', { name: 'Sửa giao dịch' });
  await expect(edit.getByRole('textbox', { name: 'Số tiền (₫)' })).toHaveValue('45.000');
  await edit.getByRole('textbox', { name: 'Số tiền (₫)' }).fill('50.000');
  await edit.getByRole('button', { name: 'Lưu' }).click();
  await expect(row).toContainText(/−50\.000\s₫/);

  await row.getByRole('button', { name: 'Xoá giao dịch phở bò' }).click();
  await expect(row).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('transactions-undo.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Hoàn tác' }).click();
  await expect(row).toContainText(/−50\.000\s₫/); // back, with the edited amount
  await page.screenshot({ path: testInfo.outputPath('transactions.png'), fullPage: true, animations: 'disabled' });
});

test('TC-F13-02 quick add "phở 45k" + Enter saves; "abc" shows an inline error and saves nothing', async ({ page, request }, testInfo) => {
  const { email, headers } = await createAccount(request);
  await logIn(page, email);
  await page.goto('/transactions');

  const box = page.getByRole('textbox', { name: 'Thêm nhanh' });
  await box.fill('phở 45k');
  const preview = page.getByRole('list', { name: 'Xem trước' }); // the server parser, before anything is saved
  await expect(preview).toContainText('Ăn uống');
  await expect(preview).toContainText('Tiền mặt');
  await page.screenshot({ path: testInfo.outputPath('quick-add-preview.png'), animations: 'disabled' });
  await box.press('Enter');
  await expect(box).toHaveValue('');
  await expect(page.getByRole('row').filter({ hasText: 'phở' })).toContainText(/−45\.000\s₫/);

  await box.fill('abc');
  await box.press('Enter');
  await expect(box).toHaveAccessibleDescription('Không tìm thấy số tiền. Ví dụ: "phở 45k".');
  await expect(box).toHaveAttribute('aria-invalid', 'true');
  expect(await countSaved(request, headers)).toBe(1);
});

test('TC-F13-03 several lines at once save several transactions (phone layout)', async ({ page, request }, testInfo) => {
  const { email, headers } = await createAccount(request);
  await page.setViewportSize({ width: 375, height: 812 });
  await logIn(page, email);
  await page.goto('/transactions');

  const box = page.getByRole('textbox', { name: 'Thêm nhanh' });
  await box.fill('phở 45k\ngrab 32k hôm qua\n+lương 15tr');
  await expect(page.getByRole('list', { name: 'Xem trước' }).getByRole('listitem')).toHaveCount(3);
  await box.press('Enter');
  await expect(box).toHaveValue('');

  const cards = page.getByRole('list', { name: 'Danh sách giao dịch' }).getByRole('listitem');
  await expect(cards).toHaveCount(3); // cards, not a table, on a phone
  await expect(cards.filter({ hasText: 'lương' })).toContainText(/\+15\.000\.000\s₫/);
  expect(await countSaved(request, headers)).toBe(3);
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'no sideways scroll on a phone').toBe(true);
  await page.screenshot({ path: testInfo.outputPath('transactions-phone.png'), fullPage: true, animations: 'disabled' });
});

test('TC-F2-05 wallet card updates after a quick add, without reloading the page', async ({ page, request }, testInfo) => {
  const { email } = await createAccount(request);
  await logIn(page, email);
  await page.getByRole('link', { name: 'Ví' }).click();

  await page.getByRole('button', { name: 'Thêm ví' }).click();
  const dialog = page.getByRole('dialog', { name: 'Thêm ví' });
  await dialog.getByRole('textbox', { name: 'Tên ví' }).fill('Momo');
  await dialog.getByRole('radio', { name: 'Ví điện tử' }).check();
  await dialog.getByRole('textbox', { name: 'Số dư ban đầu (₫)' }).fill('500.000');
  await dialog.getByRole('combobox', { name: 'Tên gọi tắt cho bot' }).fill('mm');
  await dialog.getByRole('combobox', { name: 'Tên gọi tắt cho bot' }).press('Enter');
  await dialog.getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByRole('article', { name: 'Momo' })).toContainText(/500\.000\s₫/);

  await page.getByRole('link', { name: 'Giao dịch' }).click();
  const box = page.getByRole('textbox', { name: 'Thêm nhanh' });
  await box.fill('cafe 30k mm');
  await expect(page.getByRole('list', { name: 'Xem trước' })).toContainText('Momo'); // "mm" picked the wallet
  await box.press('Enter');
  await expect(page.getByRole('row').filter({ hasText: 'cafe' })).toContainText('Momo');

  await page.getByRole('link', { name: 'Ví' }).click(); // client-side navigation, no reload
  await expect(page.getByRole('article', { name: 'Momo' })).toContainText(/470\.000\s₫/);
  await page.screenshot({ path: testInfo.outputPath('wallet-after-quick-add.png'), fullPage: true, animations: 'disabled' });
});

test('TC-F13-10 quick add question notice: phone and desktop, light and dark, no sideways scroll, no axe violation, nothing saved', async ({ page, request }) => {
  const account = await createAccount(request);
  await logIn(page, account.email);
  for (const [width, height, scheme] of [[375, 812, 'light'], [375, 812, 'dark'], [1280, 800, 'light'], [1280, 800, 'dark']] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/transactions');
    const box = page.getByRole('textbox', { name: 'Thêm nhanh' });
    await box.fill('tháng 10 thu bao nhiêu');
    await expect(page.getByRole('status').filter({ hasText: 'Đây là câu hỏi' })).toBeVisible();
    await expect(box).toHaveAccessibleDescription(/Câu hỏi không được lưu/);
    expect(await noHorizontalScroll(page)).toBe(true);
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
    await box.press('Enter');
    await box.press('Shift+Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(box).toHaveValue('tháng 10 thu bao nhiêu');
  }
  expect(await countSaved(request, account.headers)).toBe(0);
});

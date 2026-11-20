import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// Wallets and categories screens in a real browser against the real API (in-memory MongoDB, see playwright.config.ts).

const PASSWORD = 'secret123';
test.use({ locale: 'vi-VN' }); // Vietnamese is the default UI language

// Registers a fresh account through the API (its own cookie jar) and returns its email and access token.
async function createAccount(request: APIRequestContext) {
  const email = `wallets-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request.post('/api/auth/register', { data: { name: 'Lan', email, password: PASSWORD, language: 'vi' } });
  expect(res.status()).toBe(201);
  return { email, token: ((await res.json()) as { accessToken: string }).accessToken };
}

async function logIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel(/^Mật khẩu/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('button', { name: 'Tài khoản' })).toBeVisible();
}

test('TC-F2-05 wallet card shows the computed balance and updates after changes (wallet part)', async ({ page, request }, testInfo) => {
  const { email, token } = await createAccount(request);
  await logIn(page, email);
  await page.getByRole('link', { name: 'Ví' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ví' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Tiền mặt' })).toBeVisible(); // the default wallet seeded on register

  // Create a wallet in the UI: the card appears with its opening balance, without reloading the page.
  await page.getByRole('button', { name: 'Thêm ví' }).click();
  const dialog = page.getByRole('dialog', { name: 'Thêm ví' });
  await dialog.getByRole('textbox', { name: 'Tên ví' }).fill('Momo');
  await dialog.getByRole('radio', { name: 'Ví điện tử' }).check();
  await dialog.getByRole('textbox', { name: 'Số dư ban đầu (₫)' }).fill('500.000');
  await dialog.getByRole('combobox', { name: 'Tên gọi tắt cho bot' }).fill('MM');
  await dialog.getByRole('combobox', { name: 'Tên gọi tắt cho bot' }).press('Enter');
  await dialog.getByRole('button', { name: 'Lưu' }).click();
  const momo = page.getByRole('article', { name: 'Momo' });
  await expect(momo).toContainText(/500\.000\s₫/);
  await expect(momo).toContainText('mm');

  // Quick add (T08) is not built yet: the same two calls it will make ('cafe 30k mm' → parse → save) go
  // through the API, then the page is reloaded. With T08 the quick add box replaces this step and the reload.
  const headers = { Authorization: `Bearer ${token}` };
  const parsed = await request.post('/api/transactions/parse', { headers, data: { text: 'cafe 30k mm' } });
  const { drafts } = (await parsed.json()) as { drafts: Record<string, unknown>[] };
  expect(drafts[0]).toMatchObject({ type: 'expense', amount: 30000 });
  const saved = await request.post('/api/transactions', { headers, data: drafts[0] });
  expect(saved.status()).toBe(201);
  await page.reload();
  await expect(page.getByRole('article', { name: 'Momo' })).toContainText(/470\.000\s₫/);

  // A wallet in use cannot be deleted: the reason is shown, and archiving moves it to "Ví đã lưu trữ".
  await page.getByRole('button', { name: 'Xoá ví Momo' }).click();
  await page.getByRole('dialog', { name: 'Xoá ví?' }).getByRole('button', { name: 'Xoá' }).click();
  await expect(page.getByRole('alert')).toContainText('Ví đang có giao dịch nên không xoá được');
  await page.getByRole('button', { name: 'Lưu trữ ví Momo' }).click();
  await expect(page.getByRole('region', { name: 'Ví đã lưu trữ' }).getByRole('article', { name: 'Momo' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('wallets.png'), fullPage: true, animations: 'disabled' });
});

test('TC-F3-04 categories against the real API: seeded defaults, "Phở Bò" stored as the keyword "pho bo"', async ({
  page,
  request,
}, testInfo) => {
  const { email } = await createAccount(request);
  await page.setViewportSize({ width: 375, height: 812 }); // phone: the dialog goes full screen
  await logIn(page, email);
  await page.goto('/categories');

  const food = page.getByRole('listitem', { name: 'Ăn uống' });
  await expect(food).toContainText('banh mi'); // a default copied on register, shown in the UI language
  await page.getByRole('button', { name: 'Sửa danh mục Ăn uống' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sửa danh mục' });
  await dialog.getByRole('combobox', { name: 'Từ khoá cho bot' }).fill('Phở Bò');
  await dialog.getByRole('combobox', { name: 'Từ khoá cho bot' }).press('Enter');
  await page.screenshot({ path: testInfo.outputPath('category-dialog-phone.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Lưu' }).click();
  await expect(dialog).toBeHidden();

  await page.reload(); // read back from the database
  await expect(page.getByRole('listitem', { name: 'Ăn uống' })).toContainText('pho bo');
  await page.getByRole('tab', { name: 'Thu' }).click();
  await expect(page.getByRole('listitem', { name: 'Lương' })).toBeVisible();
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'no sideways scroll on a phone').toBe(true);
  await page.screenshot({ path: testInfo.outputPath('categories-phone.png'), fullPage: true, animations: 'disabled' });
});

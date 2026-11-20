import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// Dashboard and budgets in a real browser against the real API and statistics (in-memory MongoDB, see
// playwright.config.ts). Every account is new; its money is added through the API, then read on screen.

const PASSWORD = 'secret123';
// Vietnamese UI; the bar colours below are the light theme's; reduced motion = charts drawn at once (Recharts 'auto').
test.use({ locale: 'vi-VN', colorScheme: 'light', reducedMotion: 'reduce' });

// "YYYY-MM" in Vietnam time: this month (the one the app opens on) and the month before.
const THIS_MONTH = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);
const LAST_MONTH = (() => {
  const [year = 0, month = 1] = THIS_MONTH.split('-').map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
})();

type Headers = Record<string, string>;

// Registers a fresh account through the API; returns its email, an Authorization header and its seeded ids.
async function createAccount(request: APIRequestContext) {
  const email = `dash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request.post('/api/auth/register', { data: { name: 'Lan', email, password: PASSWORD, language: 'vi' } });
  expect(res.status()).toBe(201);
  const { accessToken } = (await res.json()) as { accessToken: string };
  const headers = { Authorization: `Bearer ${accessToken}` };
  const wallets = (await (await request.get('/api/wallets', { headers })).json()) as { id: string }[];
  const categories = (await (await request.get('/api/categories', { headers })).json()) as { id: string; names?: { vi: string } }[];
  const category = (vi: string) => categories.find((c) => c.names?.vi === vi)?.id ?? '';
  return { email, headers, walletId: wallets[0]?.id ?? '', category };
}

async function addTransaction(request: APIRequestContext, headers: Headers, data: Record<string, unknown>) {
  const res = await request.post('/api/transactions', { headers, data });
  expect(res.status()).toBe(201);
}

async function addBudget(request: APIRequestContext, headers: Headers, month: string, categoryId: string | null, limit: number) {
  const res = await request.post('/api/budgets', { headers, data: { month, categoryId, limit } });
  expect(res.status()).toBe(201);
}

async function logIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel(/^Mật khẩu/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('button', { name: 'Tài khoản' })).toBeVisible();
}

test('TC-F6-04 dashboard cards and charts, with text summaries, update after a quick add and a month switch', async ({ page, request }, testInfo) => {
  const { email, headers, walletId, category } = await createAccount(request);
  const expense = (categoryId: string, amount: number, month: string) =>
    addTransaction(request, headers, { type: 'expense', amount, walletId, categoryId, occurredAt: `${month}-01T10:00:00+07:00`, note: 'e2e' });
  await addTransaction(request, headers, {
    type: 'income',
    amount: 15_000_000,
    walletId,
    categoryId: category('Lương'),
    occurredAt: `${THIS_MONTH}-01T09:00:00+07:00`,
    note: 'lương',
  });
  await expense(category('Ăn uống'), 450_000, THIS_MONTH);
  await expense(category('Đi lại'), 150_000, THIS_MONTH);
  await expense(category('Mua sắm'), 300_000, LAST_MONTH);
  await addBudget(request, headers, THIS_MONTH, null, 1_000_000);

  await logIn(page, email); // lands on the dashboard
  await expect(page.getByRole('heading', { level: 1, name: 'Xin chào, Lan' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Thu nhập' })).toContainText(/15\.000\.000\s₫/);
  await expect(page.getByRole('article', { name: 'Chi tiêu' })).toContainText(/600\.000\s₫/);
  await expect(page.getByRole('article', { name: 'Chênh lệch (thu − chi)' })).toContainText(/14\.400\.000\s₫/);
  await expect(page.getByRole('article', { name: 'Ngân sách còn lại' })).toContainText(/400\.000\s₫/);

  const pie = page.getByRole('figure', { name: 'Chi tiêu theo danh mục' });
  await expect(pie.locator('.recharts-pie-sector')).toHaveCount(2); // the chart is drawn …
  await expect(pie.getByRole('listitem')).toHaveText([/^Ăn uống: 450\.000\s₫ \(75%\)$/, /^Đi lại: 150\.000\s₫ \(25%\)$/]); // … and summed up in text
  const bars = page.getByRole('figure', { name: 'Thu chi theo ngày' });
  await expect(bars.locator('.recharts-bar-rectangle').first()).toBeVisible();
  await expect(bars).toContainText(/Tổng thu 15\.000\.000\s₫, tổng chi 600\.000\s₫\. Ngày chi nhiều nhất: 1 tháng \d+, 600\.000\s₫\./);
  await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true, animations: 'disabled' });

  // A quick add on the dashboard refreshes the cards by itself (RTK Query tags).
  const box = page.getByRole('textbox', { name: 'Thêm nhanh' });
  await box.fill('cafe 50k');
  await expect(page.getByRole('list', { name: 'Xem trước' })).toContainText('Tiền mặt');
  await box.press('Enter');
  await expect(page.getByRole('article', { name: 'Chi tiêu' })).toContainText(/650\.000\s₫/);
  await expect(page.getByRole('list', { name: 'Giao dịch gần đây' })).toContainText('cafe');

  await page.getByRole('button', { name: 'Tháng trước' }).click();
  await expect(page.getByRole('article', { name: 'Chi tiêu' })).toContainText(/300\.000\s₫/);
  await expect(page.getByRole('article', { name: 'Thu nhập' })).toContainText(/^Thu nhập0\s₫$/);
  await expect(page.getByRole('article', { name: 'Ngân sách còn lại' })).toContainText('Chưa đặt ngân sách tổng');
  await expect(pie.getByRole('listitem')).toHaveText([/^Mua sắm: 300\.000\s₫ \(100%\)$/]);
  await expect(bars).toContainText(/Tổng thu 0\s₫, tổng chi 300\.000\s₫\./);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible(); // the phone's bottom navigation
  // Polled: the charts shrink to the new width on their next ResizeObserver callback, not at once.
  await expect.poll(() => page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), { message: 'no sideways scroll on a phone' }).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dashboard-phone.png'), fullPage: true, animations: 'disabled' });
});

test('TC-F5-04 budget bars are green, amber and red with text labels; "Copy from last month" copies with 201', async ({ page, request }, testInfo) => {
  const { email, headers, walletId, category } = await createAccount(request);
  const expense = (name: string, amount: number) =>
    addTransaction(request, headers, { type: 'expense', amount, walletId, categoryId: category(name), occurredAt: `${THIS_MONTH}-01T10:00:00+07:00`, note: 'e2e' });
  await addBudget(request, headers, THIS_MONTH, category('Ăn uống'), 1_000_000);
  await addBudget(request, headers, THIS_MONTH, category('Đi lại'), 1_000_000);
  await addBudget(request, headers, THIS_MONTH, null, 2_000_000);
  await expense('Ăn uống', 500_000); // 50 %
  await expense('Đi lại', 900_000); // 90 %
  await expense('Mua sắm', 1_000_000); // all spending: 2,400,000 of 2,000,000 = 120 %
  await addBudget(request, headers, LAST_MONTH, category('Ăn uống'), 1_200_000); // this month has one already: kept as it is
  await addBudget(request, headers, LAST_MONTH, category('Giải trí'), 400_000);
  await addBudget(request, headers, LAST_MONTH, category('Hoá đơn'), 800_000);

  await logIn(page, email);
  await page.getByRole('link', { name: 'Ngân sách' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ngân sách' })).toBeVisible();

  const food = page.getByRole('article', { name: 'Ăn uống' });
  await expect(food).toContainText('Trong hạn mức');
  await expect(food).toContainText(/Đã chi 500\.000\s₫ \/ 1\.000\.000\s₫ \(50%\)/);
  await expect(food.getByRole('progressbar', { name: 'Ăn uống' })).toHaveCSS('accent-color', 'rgb(27, 127, 59)'); // green
  const transport = page.getByRole('article', { name: 'Đi lại' });
  await expect(transport).toContainText('Sắp hết');
  await expect(transport).toContainText('(90%)');
  await expect(transport.getByRole('progressbar')).toHaveCSS('accent-color', 'rgb(237, 108, 2)'); // amber
  const overall = page.getByRole('article', { name: 'Tổng chi tiêu' });
  await expect(overall).toContainText('Vượt ngân sách');
  await expect(overall).toContainText(/Vượt 400\.000\s₫/);
  await expect(overall.getByRole('progressbar')).toHaveCSS('accent-color', 'rgb(198, 40, 40)'); // red

  const copied = page.waitForResponse((res) => res.url().endsWith('/api/budgets/copy'));
  await page.getByRole('button', { name: 'Chép từ tháng trước' }).click();
  const res = await copied;
  expect(res.status()).toBe(201);
  expect(await res.json()).toEqual({ created: 2 });
  await expect(page.getByText('Đã chép ngân sách: 2')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Giải trí' })).toContainText(/\/ 400\.000\s₫/);
  await expect(page.getByRole('article', { name: 'Hoá đơn' })).toContainText(/\/ 800\.000\s₫/);
  await expect(food).toContainText(/\/ 1\.000\.000\s₫/); // not overwritten by last month's 1,200,000
  await expect(page.getByRole('article')).toHaveCount(5);
  await page.screenshot({ path: testInfo.outputPath('budgets.png'), fullPage: true, animations: 'disabled' });
});

/// <reference lib="dom" /> // page.evaluate below runs in the browser (canvas, FileReader)
import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// Bot inbox in a real browser against the real API (in-memory MongoDB, see playwright.config.ts).
// The Telegram draft comes in through the real webhook; the receipt is read by the real KIE service.

const PASSWORD = 'secret123';
// The API runs with NODE_ENV=test, so its webhook secret is the test default unless the environment sets one.
const TELEGRAM_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? 'test-telegram-secret';
test.use({ locale: 'vi-VN' });

async function createAccount(request: APIRequestContext) {
  const email = `bot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request.post('/api/auth/register', { data: { name: 'Lan', email, password: PASSWORD, language: 'vi' } });
  expect(res.status()).toBe(201);
  const { accessToken } = (await res.json()) as { accessToken: string };
  return { email, headers: { Authorization: `Bearer ${accessToken}` } };
}

async function logIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel(/^Mật khẩu/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('button', { name: 'Tài khoản' })).toBeVisible();
}

const drafts = async (request: APIRequestContext, headers: Record<string, string>) =>
  (await (await request.get('/api/transactions?status=draft', { headers })).json()) as { total: number; items: { amount: number; source: string }[] };

// A private Telegram chat message, in the shape Telegram POSTs to the webhook (server/test/fixtures/telegram-updates.json).
function telegramUpdate(chatId: number, messageId: number, text: string) {
  const person = { id: chatId, first_name: 'Anh', last_name: 'Nguyen' };
  return { update_id: messageId, message: { message_id: messageId, from: { ...person, is_bot: false }, chat: { ...person, type: 'private' }, date: 1763620200, text } };
}

test('TC-F9-01 link Telegram with the code on the page, then correct and confirm its draft (phone layout)', async ({ page, request }, testInfo) => {
  const { email, headers } = await createAccount(request);
  await page.setViewportSize({ width: 375, height: 812 });
  await logIn(page, email);
  await page.getByRole('link', { name: 'Hộp thư bot' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Hộp thư bot' })).toBeVisible();
  await expect(page.getByText('Không có bản nháp nào.', { exact: false })).toBeVisible();

  // The code shown on the page, sent from a Telegram chat as "/start CODE" (what the deep link does).
  await page.getByRole('button', { name: 'Tạo mã liên kết' }).press('Enter'); // keyboard: focus must follow the code
  const linkCard = page.getByRole('region', { name: 'Liên kết Telegram / Zalo' });
  await expect(linkCard.getByRole('img', { name: 'Mã QR mở bot Telegram với mã liên kết' })).toBeVisible();
  const code = (await linkCard.getByText(/^[A-Z2-9]{6}$/).textContent())!;
  await expect(page.locator(':focus')).toContainText(code);
  await expect(linkCard.getByRole('link', { name: 'Mở Telegram' })).toHaveAttribute('href', new RegExp(`\\?start=${code}$`));
  await linkCard.screenshot({ path: testInfo.outputPath('bot-link-code.png'), animations: 'disabled' });
  const chatId = Math.floor(Math.random() * 1e9);
  const webhook = { headers: { 'X-Telegram-Bot-Api-Secret-Token': TELEGRAM_SECRET } };
  expect((await request.post('/api/webhooks/telegram', { ...webhook, data: telegramUpdate(chatId, 1, `/start ${code}`) })).status()).toBe(200);
  // The page looks for new links while the code is live, so the account shows up without a reload.
  await expect(page.getByRole('region', { name: 'Tài khoản đã liên kết' })).toContainText('Telegram · Anh Nguyen', { timeout: 10_000 });

  // "phở 45k" from the chat → a draft, reviewed on the web.
  expect((await request.post('/api/webhooks/telegram', { ...webhook, data: telegramUpdate(chatId, 2, 'phở 45k') })).status()).toBe(200);
  await expect.poll(async () => (await drafts(request, headers)).total).toBe(1);
  await page.reload();
  const card = page.getByRole('form', { name: 'phở' });
  await expect(card).toContainText('Telegram');
  await expect(card.getByRole('combobox', { name: 'Danh mục' })).toHaveValue(/.+/);
  await card.getByRole('textbox', { name: 'Số tiền (₫)' }).fill('50k');
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'no sideways scroll on a phone').toBe(true);
  await page.screenshot({ path: testInfo.outputPath('bot-inbox-phone.png'), fullPage: true, animations: 'disabled' });
  await card.getByRole('button', { name: 'Xác nhận' }).press('Enter');
  await expect(card).toBeHidden();
  await expect(page.getByRole('heading', { level: 2, name: /^Bản nháp chờ duyệt/ })).toBeFocused(); // not lost to <body>
  await expect(page.getByText('Đã lưu giao dịch')).toBeVisible();
  expect((await drafts(request, headers)).total).toBe(0);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/transactions');
  const row = page.getByRole('row').filter({ hasText: 'phở' });
  await expect(row).toContainText(/−50\.000\s₫/);
  await expect(row).not.toContainText('Nháp');
});

test('TC-F10-03 an 8 MB phone photo is shrunk in the browser: the request stays under 4.5 MB and KIE makes a draft', async ({ page, request }, testInfo) => {
  const kieUrl = process.env.KIE_URL;
  const kieIsUp = kieUrl ? await fetch(`${kieUrl}/health`, { signal: AbortSignal.timeout(3000) }).then((res) => res.ok, () => false) : false;
  test.skip(!kieIsUp, 'needs the KIE service: run with KIE_URL and KIE_API_KEY set (see server/test/kie.contract.test.js)');
  test.setTimeout(180_000); // KIE takes 20–40 s per receipt

  const { email, headers } = await createAccount(request);
  await logIn(page, email);
  await page.goto('/bot');

  // A real receipt (total 116.000 ₫) blown up to a 3764×4584 "phone photo" of more than 8 MB.
  const sample = await readFile(new URL('../../server/test/fixtures/receipts/mcocr_public_145014khrvg.jpg', import.meta.url));
  const photoBase64 = await page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${base64}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width * 4, bitmap.height * 4);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i++) if (i % 4 !== 3) pixels.data[i]! += Math.random() * 24 - 12; // sensor noise → a big JPEG
    context.putImageData(pixels, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.98 });
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
    return dataUrl.slice(dataUrl.indexOf(',') + 1);
  }, sample.toString('base64'));
  const photo = Buffer.from(photoBase64, 'base64');
  expect(photo.length).toBeGreaterThan(8 * 1024 * 1024);

  // Look at the upload on its way to the API (Chromium gives no body for a blob upload outside interception).
  let body: Buffer = Buffer.alloc(0);
  await page.route('**/api/receipts', async (route) => {
    body = route.request().postDataBuffer() ?? Buffer.alloc(0);
    await route.continue();
  });
  const answered = page.waitForResponse('**/api/receipts', { timeout: 150_000 });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Chọn ảnh hoá đơn' }).click();
  await (await chooser).setFiles({ name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: photo });

  await expect.poll(() => body.length).toBeGreaterThan(0);
  expect(body.length).toBeLessThan(4.5 * 1024 * 1024); // Vercel's request limit
  const frame = body.indexOf(Buffer.from([0xff, 0xc0])); // JPEG start-of-frame: height, then width
  expect(frame).toBeGreaterThan(0);
  expect(Math.max(body.readUInt16BE(frame + 5), body.readUInt16BE(frame + 7))).toBeLessThanOrEqual(1600);
  await expect(page.getByRole('status')).toHaveText('Đang đọc hoá đơn… (khoảng 20–40 giây)');

  expect((await answered).status()).toBe(201);
  await expect(page.getByRole('status')).toContainText('Đã tạo bản nháp từ hoá đơn.');
  const card = page.getByRole('form').filter({ hasText: 'Hoá đơn' });
  await expect(card.getByRole('textbox', { name: 'Số tiền (₫)' })).toHaveValue('116.000');
  expect((await drafts(request, headers)).items).toEqual([expect.objectContaining({ amount: 116000, source: 'receipt' })]);
  await page.screenshot({ path: testInfo.outputPath('bot-receipt-draft.png'), fullPage: true, animations: 'disabled' });
});

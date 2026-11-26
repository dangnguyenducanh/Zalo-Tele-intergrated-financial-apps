/// <reference lib="dom" /> // page.evaluate below runs in the browser
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page, type Request } from '@playwright/test';
import { createAccount, logIn, noHorizontalScroll, PASSWORD } from './helpers';

// Linking that starts in the chat (docs/02 §2.10.3) in a real browser against the real API (in-memory MongoDB,
// playwright.config.ts). The unlinked Zalo message arrives through the real webhook; the claim link is read from
// the stubbed bot's reply (server/test/helpers/bot-api-stub.js writes the same file).
const ZALO_SECRET = process.env.ZALO_WEBHOOK_SECRET ?? 'test-zalo-secret';
const REPLIES = join(tmpdir(), `e2e-bot-replies-${process.env.PORT ?? '4100'}.jsonl`);
const WARNING =
  'Chỉ bấm Xác nhận nếu chính bạn vừa nhắn tin cho bot. Cuộc chat được liên kết có thể xem chi tiêu và ghi tiền vào tài khoản này.';
test.use({ locale: 'vi-VN' });

const newChatId = () => `e2e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function repliesTo(chatId: string): string[] {
  try {
    return readFileSync(REPLIES, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { chatId: string; text: string })
      .filter((reply) => reply.chatId === chatId)
      .map((reply) => reply.text);
  } catch {
    return []; // no reply yet
  }
}

// A private Zalo text, in the shape Zalo POSTs to the webhook (server/test/fixtures/zalo-events.json).
async function zaloSays(request: APIRequestContext, chatId: string, text: string, name = 'Anh Nguyen') {
  const message = {
    message_id: `m${Math.random().toString(36).slice(2)}`,
    date: Date.now(),
    from: { id: chatId, display_name: name, is_bot: false },
    chat: { id: chatId, chat_type: 'PRIVATE' },
    text,
  };
  const res = await request.post('/api/webhooks/zalo', {
    headers: { 'X-Bot-Api-Secret-Token': ZALO_SECRET },
    data: { event_name: 'message.text.received', message },
  });
  expect(res.status()).toBe(200);
}

// An unlinked chat says hello → the "tap to link" address in the bot's reply, as a path on the site under test
// (the reply uses APP_URL, which need not be this worktree's port).
async function claimLinkFor(request: APIRequestContext, chatId: string, name?: string) {
  await zaloSays(request, chatId, 'xin chào', name);
  await expect.poll(() => repliesTo(chatId).length, { timeout: 10_000 }).toBeGreaterThan(0);
  const reply = repliesTo(chatId).at(-1)!;
  expect(reply).toContain('Vui lòng liên kết');
  expect(reply).toContain('Please link');
  expect(reply).toContain('(hiệu lực 10 phút)');
  expect(reply).toContain('(valid 10 minutes)');
  const url = new URL(/https?:\/\/\S+\/link\?t=[A-Za-z0-9_-]{32}/.exec(reply)![0]);
  return { path: url.pathname + url.search, token: url.searchParams.get('t')! };
}

const chatLinks = async (request: APIRequestContext, headers: Record<string, string>) =>
  (await (await request.get('/api/chat-links', { headers })).json()) as { platform: string; displayName: string; viaClaim: boolean }[];

// The whole element is inside the viewport: a fixed one (the snackbar) can stick out without any page scroll.
async function expectOnScreen(page: Page, selector: string, message: string) {
  // The snackbar grows in: wait for it to reach its full size.
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'));
  const [left, right, width] = await page.locator(selector).evaluate((el) => {
    const box = el.getBoundingClientRect();
    return [box.left, box.right, document.documentElement.clientWidth];
  });
  expect(left, message).toBeGreaterThanOrEqual(0);
  expect(right, message).toBeLessThanOrEqual(width!);
}

async function seriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test('TC-F7-23 claim link, logged out: log in → warning → Confirm → linked → "Not you? Unlink" removes the chat; the token stays out of URLs', async ({
  page,
  request,
}, testInfo) => {
  const account = await createAccount(request);
  const chatId = newChatId();
  const { path, token } = await claimLinkFor(request, chatId);

  const apiRequests: Request[] = [];
  page.on('request', (sent) => {
    if (new URL(sent.url()).pathname.startsWith('/api/')) apiRequests.push(sent);
  });
  const visited: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) visited.push(frame.url());
  });

  // Tapped on a phone, not logged in.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('textbox', { name: 'Email' }).fill(account.email);
  await page.getByLabel(/^Mật khẩu/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();

  // Back on /link: who is linked to what, and the warning.
  const question = page.getByRole('heading', { level: 1, name: `Liên kết Zalo · Anh Nguyen với Lan (${account.email})?` });
  await expect(question).toBeVisible();
  await expect(question).toBeFocused();
  await expect(page).toHaveURL(/\/link$/);
  await expect(page.getByText(WARNING)).toBeVisible();
  const confirm = page.getByRole('button', { name: 'Xác nhận' });
  await expect(confirm).toHaveAccessibleDescription(WARNING);

  // Switching the scheme live fades the buttons' colours; axe and the screenshots must see the final ones.
  const noFades = await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important }' });
  for (const width of [360, 375, 390, 1280]) {
    await page.setViewportSize({ width, height: 812 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      expect(await noHorizontalScroll(page), `no sideways scroll at ${width} px`).toBe(true);
      expect(await seriousViolations(page), `axe at ${width} px, ${colorScheme}`).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`link-confirm-${width}-${colorScheme}.png`), animations: 'disabled' });
    }
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await noFades.evaluate((style) => (style as Element).remove());
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(1500); // so the recording shows the warning long enough to read

  // Keyboard only: from the focused question, Tab reaches Confirm.
  await question.focus();
  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { level: 1, name: 'Hộp thư bot' })).toBeVisible();
  await expect(page).toHaveURL(/\/bot$/);
  await expect(page.getByText('Đã liên kết ✓ Zalo · Anh Nguyen')).toBeVisible();
  const notice = page.getByRole('group', { name: 'Chat mới được liên kết từ đường link chat: Zalo · Anh Nguyen. Không phải bạn?' });
  await expect(notice).toBeVisible();
  await notice.scrollIntoViewIfNeeded();
  expect(await noHorizontalScroll(page)).toBe(true);
  expect(await seriousViolations(page)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('bot-claim-notice-375.png'), animations: 'disabled' });
  await page.waitForTimeout(1500); // for the recording
  expect(await chatLinks(request, account.headers)).toMatchObject([{ platform: 'zalo', displayName: 'Anh Nguyen', viaClaim: true }]);
  // The chat heard the same text as after "/link CODE".
  await expect.poll(() => repliesTo(chatId).at(-1)).toBe('✅ Đã liên kết với tài khoản Lan. Thử gửi: phở 45k');

  // "Not you? Unlink" removes the chat.
  await notice.getByRole('button', { name: 'Huỷ liên kết Zalo · Anh Nguyen' }).click();
  await page.getByRole('dialog', { name: 'Huỷ liên kết?' }).getByRole('button', { name: 'Huỷ liên kết' }).click();
  await expect(notice).toBeHidden();
  await expect(page.getByRole('heading', { level: 2, name: 'Tài khoản đã liên kết' })).toBeFocused();
  await expect(page.getByText('Chưa liên kết tài khoản chat nào.')).toBeVisible();
  expect(await chatLinks(request, account.headers)).toEqual([]);
  await page.waitForTimeout(1000); // for the recording

  // The token was in the first address only. Later: not in any page address or history entry, and in the API only
  // as the body of preview and claim, never in a request URL or Referer.
  expect(visited[0]).toContain(token);
  expect(visited.slice(1).filter((url) => url.includes(token))).toEqual([]);
  expect(apiRequests.filter((sent) => sent.url().includes(token)).map((sent) => sent.url())).toEqual([]);
  const referers = await Promise.all(apiRequests.map(async (sent) => (await sent.allHeaders()).referer ?? ''));
  expect(referers.filter((referer) => referer.includes(token))).toEqual([]);
  expect(apiRequests.filter((sent) => sent.postData()?.includes(token)).map((sent) => new URL(sent.url()).pathname)).toEqual([
    '/api/chat-links/claim/preview',
    '/api/chat-links/claim',
  ]);
  await page.goBack();
  expect(page.url()).not.toContain(token);
});

test('TC-F7-23 claim link, logged in: Cancel leaves it usable; Dismiss survives a reload; a used link and a chat linked meanwhile say so', async ({
  page,
  request,
}, testInfo) => {
  const account = await createAccount(request);
  const longName = 'Nguyễn_Thị_Phương_Thảo_Official_Shop_Mỹ_Phẩm_Chính_Hãng_Giá_Rẻ';
  const chatId = newChatId();
  const { path, token } = await claimLinkFor(request, chatId, longName);
  await page.setViewportSize({ width: 360, height: 780 });
  await logIn(page, account.email);

  // Cancel: nothing is linked and the token is left to expire.
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(`^Liên kết Zalo · ${longName} với Lan`) })).toBeVisible();
  expect(await noHorizontalScroll(page), 'a long chat name wraps on /link').toBe(true);
  await page.screenshot({ path: testInfo.outputPath('link-confirm-long-name-360.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Huỷ' }).click();
  await expect(page).toHaveURL(/\/bot$/);
  expect(await chatLinks(request, account.headers)).toEqual([]);
  expect((await request.post('/api/chat-links/claim/preview', { headers: account.headers, data: { token } })).status()).toBe(200);

  // The same link again: Confirm. A long name stays inside the message and the notice.
  await page.goto(path);
  await page.getByRole('button', { name: 'Xác nhận' }).click();
  const snackbar = page.locator('.MuiSnackbar-root .MuiAlert-message');
  await expect(snackbar).toHaveText(`Đã liên kết ✓ Zalo · ${longName}`);
  await page.screenshot({ path: testInfo.outputPath('bot-linked-long-name-360.png'), animations: 'disabled' });
  await expectOnScreen(page, '.MuiSnackbar-root .MuiAlert-root', '"Linked ✓" with a long name stays on a 360 px screen');
  const dismiss = page.getByRole('button', { name: `Đóng thông báo về Zalo · ${longName}` });
  await expect(dismiss).toBeVisible();
  const notice = page.getByRole('group', { name: /Chat mới được liên kết từ đường link chat/ });
  await notice.scrollIntoViewIfNeeded();
  expect(await noHorizontalScroll(page), 'the notice wraps the name').toBe(true);
  expect(await notice.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await notice.screenshot({ path: testInfo.outputPath('bot-claim-notice-long-name-360.png'), animations: 'disabled' });
  await dismiss.click();
  await expect(notice).toBeHidden();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Tài khoản đã liên kết' })).toContainText(longName);
  await expect(notice).toBeHidden();

  // The used link again.
  await page.goto(path);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Đường link đã hết hạn hoặc đã được dùng. Gửi một tin nhắn bất kỳ cho bot để nhận link mới.' }),
  ).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('link-expired-360.png'), animations: 'disabled' });
  await page.getByRole('link', { name: 'Đến Hộp thư bot' }).click();
  await expect(page).toHaveURL(/\/bot$/);

  // A second chat gets a claim link, then is linked with a website code before the link is confirmed.
  const second = newChatId();
  const meanwhile = await claimLinkFor(request, second);
  await page.goto(meanwhile.path);
  await expect(page.getByRole('button', { name: 'Xác nhận' })).toBeVisible();
  const { code } = (await (await request.post('/api/chat-links/code', { headers: account.headers })).json()) as { code: string };
  await zaloSays(request, second, `/link ${code}`);
  await expect.poll(async () => (await chatLinks(request, account.headers)).length).toBe(2);
  await page.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Cuộc chat này đã được liên kết với một tài khoản.' })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('link-already-linked-360.png'), animations: 'disabled' });
  await expect(page.getByRole('link', { name: 'Đến Hộp thư bot' })).toBeVisible();
});

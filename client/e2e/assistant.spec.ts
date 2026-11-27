import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccount, logIn, noHorizontalScroll, type Account } from './helpers';

// The "Hỏi Sổ chi tiêu" drawer in a real browser against the real API (docs/07 §7.9.5 *drawer E2E*). The E2E API server answers the
// agent service with canned texts and writes its agentTurns rows like the real agent (server/test/helpers/bot-api-stub.js): these
// specs prove the screens and the real Express code, not the numbers. A spec switches the stub to a 503 by writing a word to a file.
test.use({ locale: 'vi-VN', reducedMotion: 'reduce' });

const MODE_FILE = join(tmpdir(), `e2e-agent-${process.env.PORT ?? '4100'}.txt`);
const setAgent = (mode: 'down' | 'busy' | 'ok') => (mode === 'ok' ? rmSync(MODE_FILE, { force: true }) : writeFileSync(MODE_FILE, mode));
test.beforeEach(() => setAgent('ok'));
test.afterEach(() => setAgent('ok')); // a failed spec must not leave the agent down for the next file

const QUESTION = 'tháng 10 thu bao nhiêu';
const CHIP = 'Đây là câu hỏi · Hỏi Sổ chi tiêu ›';
const ANSWER = 'Tháng 10 bạn thu 15.000.000 ₫.';
const DOWN = 'Trợ lý đang bận bảo trì, thử lại sau';

// How many transactions the database holds for this account (read through the API, not the screen).
async function countSaved(request: APIRequestContext, account: Account) {
  return ((await (await request.get('/api/transactions', { headers: account.headers })).json()) as { total: number }).total;
}

const drawer = (page: Page) => page.getByRole('dialog', { name: 'Hỏi Sổ chi tiêu' });
const askBox = (dialog: Locator) => dialog.getByRole('textbox', { name: 'Câu hỏi của bạn' });
// Text of the thread. The visually hidden live region repeats each answer and error once, so a plain search of the dialog finds it twice.
const said = (dialog: Locator, text: string, exact = true) => dialog.getByRole('log').getByText(text, { exact });

async function ask(dialog: Locator, text: string) {
  await askBox(dialog).fill(text);
  await askBox(dialog).press('Enter');
}

async function violations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

for (const [width, height, scheme] of [[1280, 800, 'light'], [1280, 800, 'dark'], [375, 812, 'light'], [375, 812, 'dark']] as const) {
  test(`TC-F14-116 drawer at ${width}x${height} in ${scheme}: Enter saves nothing, the chip opens it with the answer, a capture saves only on Lưu, no axe violation, 503 bubble, focus returns`, async ({ page, request }, testInfo) => {
    const account = await createAccount(request);
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: scheme });
    await logIn(page, account.email);
    const phone = width < 600;

    // A question typed in QuickAdd: Enter saves nothing, the chip is the way in.
    const box = page.getByRole('textbox', { name: 'Thêm nhanh' });
    await box.fill(QUESTION);
    const chip = page.getByRole('button', { name: CHIP });
    await expect(chip).toBeVisible();
    await box.press('Enter');
    await expect(box).toHaveValue(QUESTION);
    expect(await countSaved(request, account)).toBe(0);

    await chip.click();
    const dialog = drawer(page);
    await expect(dialog).toBeVisible();
    await expect.poll(async () => Math.round((await dialog.boundingBox())!.width)).toBe(phone ? width : 420); // 420 px from sm, full width on phones
    await expect(askBox(dialog)).toBeFocused();
    await expect(said(dialog, ANSWER)).toBeVisible(); // the chip sent the text
    await expect(said(dialog, QUESTION)).toBeVisible(); // as the first message
    await expect(said(dialog, 'Theo mẫu')).toBeVisible();
    await expect(said(dialog, 'Nguồn: Giao dịch đã xác nhận 1/10–31/10/2026')).toBeVisible();
    const toggle = dialog.getByRole('button', { name: 'Số liệu' });
    await expect(toggle).toHaveAttribute('aria-expanded', phone ? 'false' : 'true'); // folded by default on phones
    if (phone) await toggle.click();
    await expect(dialog.getByRole('list', { name: 'Số liệu' })).toContainText('Thu 10/2026: 15.000.000');
    await expect(dialog.getByRole('button', { name: 'Còn tháng 9?' })).toBeVisible(); // a follow-up under the newest answer
    await expect(dialog.getByText('Còn 29 câu hỏi hôm nay')).toBeVisible();
    expect(await countSaved(request, account)).toBe(0); // a question is never saved

    // A capture typed in the drawer gets the preview card and is saved only by its button.
    await ask(dialog, 'phở 45k');
    const card = dialog.getByRole('group', { name: 'Giao dịch từ câu này' });
    await expect(card).toContainText('Ăn uống');
    await expect(card).toContainText('Tiền mặt');
    await expect(dialog.getByText('Còn 29 câu hỏi hôm nay')).toBeVisible(); // a capture is not a question
    expect(await countSaved(request, account)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`drawer-${width}-${scheme}.png`), animations: 'disabled' });
    expect(await violations(page)).toEqual([]); // axe with the drawer open
    expect(await noHorizontalScroll(page)).toBe(true);
    await card.getByRole('button', { name: 'Lưu' }).click();
    await expect(dialog.getByText('Đã lưu giao dịch: 1')).toBeVisible();
    expect(await countSaved(request, account)).toBe(1);

    // The agent service stops: the bubble says so and Thử lại works once it is back.
    setAgent('down');
    await ask(dialog, 'số dư các ví');
    await expect(said(dialog, DOWN)).toBeVisible();
    await expect(said(dialog, 'Trang Tổng quan và Giao dịch vẫn hiện số liệu của bạn.')).toBeVisible();
    await expect(askBox(dialog)).toHaveValue('số dư các ví'); // the question stays in the input
    expect(await violations(page)).toEqual([]);
    setAgent('ok');
    await dialog.getByRole('button', { name: 'Thử lại' }).click();
    await expect(said(dialog, 'Mình trả lời được các câu hỏi về thu chi của bạn, ví dụ:', false)).toBeVisible();
    await expect(askBox(dialog)).toHaveValue('');

    // Esc closes it, and focus goes back to what opened it.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(chip).toBeFocused();
    expect(await countSaved(request, account)).toBe(1); // only the capture was ever saved
  });
}

test('TC-F14-117 ask-back in the drawer: options are buttons with their full label, a typed 2 shows no capture card, a lapsed one says so, the buttons survive a reload', async ({ page, request }, testInfo) => {
  const account = await createAccount(request);
  await page.setViewportSize({ width: 375, height: 812 });
  await logIn(page, account.email);

  const opener = page.getByRole('button', { name: 'Hỏi Sổ chi tiêu' });
  await expect(opener).toHaveText('', { useInnerText: true }); // icon only on a phone: the name is its aria-label
  await page.screenshot({ path: testInfo.outputPath('dashboard-button-375.png'), clip: { x: 0, y: 0, width: 375, height: 200 }, animations: 'disabled' });
  await opener.click();
  const dialog = drawer(page);
  await expect(askBox(dialog)).toBeFocused();

  await ask(dialog, 'chi tiêu');
  const choices = dialog.getByRole('group', { name: 'Chọn một ý' });
  await expect(choices.getByRole('button')).toHaveText(['Thu chi theo kỳ · tháng này', 'Chi theo danh mục · Ăn uống']);
  await choices.getByRole('button', { name: 'Chi theo danh mục · Ăn uống' }).click(); // sends "2"
  await expect(said(dialog, 'Bạn chọn ý 2: Ăn uống tháng này 45.000 ₫.')).toBeVisible();
  await expect(choices).toBeHidden(); // answered: the buttons go

  // A typed 2 is the same message, and never a capture (2 is not 2.000 ₫).
  await ask(dialog, 'chi tiêu');
  await expect(choices).toBeVisible();
  await ask(dialog, '2');
  await expect(said(dialog, 'Bạn chọn ý 2: Ăn uống tháng này 45.000 ₫.')).toHaveCount(2);
  await expect(dialog.getByRole('group', { name: 'Giao dịch từ câu này' })).toHaveCount(0);
  expect(await countSaved(request, account)).toBe(0);

  // The ask-back is a row of the thread: after a reload its buttons are there, for the newest turn.
  await ask(dialog, 'chi tiêu');
  await expect(choices).toBeVisible();
  await page.reload();
  await opener.click();
  await expect(drawer(page).getByRole('group', { name: 'Chọn một ý' }).getByRole('button')).toHaveCount(2);
  await drawer(page).getByRole('group', { name: 'Chọn một ý' }).getByRole('button', { name: 'Thu chi theo kỳ · tháng này' }).click();
  await expect(said(drawer(page), 'Bạn chọn ý 1: Ăn uống tháng này 45.000 ₫.')).toBeVisible();

  // An ask-back whose ten minutes are over: the digit gets the "expired" line, no capture, no transaction.
  await ask(drawer(page), 'chi tiêu hết hạn');
  await ask(drawer(page), '2');
  await expect(said(drawer(page), 'Câu hỏi đã hết hạn, hãy hỏi lại')).toBeVisible();
  await expect(drawer(page).getByRole('group', { name: 'Giao dịch từ câu này' })).toHaveCount(0);
  expect(await countSaved(request, account)).toBe(0);

  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused(); // back on the header button
});

test('TC-F14-118 the thread reloads, Xoá hides it and keeps the count, and the count is the server\'s', async ({ page, request }, testInfo) => {
  const account = await createAccount(request);
  await logIn(page, account.email);
  const opener = page.getByRole('button', { name: 'Hỏi Sổ chi tiêu' });
  await expect(opener).toHaveText('Hỏi Sổ chi tiêu', { useInnerText: true }); // the text shows from sm up
  await page.screenshot({ path: testInfo.outputPath('dashboard-button-1280.png'), clip: { x: 232, y: 64, width: 1048, height: 120 }, animations: 'disabled' });
  await opener.click();
  let dialog = drawer(page);
  await expect(dialog.getByRole('group', { name: 'Câu hỏi gợi ý' }).getByRole('button')).toHaveCount(4);
  await expect(dialog.getByText('Còn 30 câu hỏi hôm nay')).toBeVisible();

  await dialog.getByRole('button', { name: 'Tháng này ăn uống hết bao nhiêu?' }).click();
  await expect(said(dialog, 'Tháng này bạn chi 45.000 ₫ cho ăn uống.')).toBeVisible();
  await ask(dialog, QUESTION);
  await expect(said(dialog, ANSWER)).toBeVisible();
  await expect(dialog.getByText('Còn 28 câu hỏi hôm nay')).toBeVisible();

  await page.reload();
  await opener.click();
  dialog = drawer(page);
  await expect(said(dialog, ANSWER)).toBeVisible(); // the thread survived the reload, oldest first
  const text = (await dialog.getByRole('log').textContent()) ?? '';
  expect(text.indexOf('Tháng này bạn chi 45.000')).toBeLessThan(text.indexOf(ANSWER));
  await expect(dialog.getByText('Còn 28 câu hỏi hôm nay')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Còn tháng 9?' })).toBeVisible(); // follow-ups under the newest answer only
  await expect(dialog.getByRole('button', { name: 'Còn tháng trước?' })).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Xoá' }).click();
  await expect(dialog.getByRole('group', { name: 'Câu hỏi gợi ý' })).toBeVisible();
  await expect(said(dialog, ANSWER)).toHaveCount(0);
  await expect(dialog.getByText('Còn 28 câu hỏi hôm nay')).toBeVisible(); // clearing gives nothing back

  await page.reload();
  await opener.click();
  await expect(drawer(page).getByRole('group', { name: 'Câu hỏi gợi ý' })).toBeVisible(); // still cleared
  await expect(drawer(page).getByText('Còn 28 câu hỏi hôm nay')).toBeVisible();
  await ask(drawer(page), 'tổng kết tuần');
  await expect(said(drawer(page), 'Tuần này bạn chi ít hơn tuần trước.')).toBeVisible();
  await expect(said(drawer(page), 'AI')).toBeVisible(); // route agent
  await expect(drawer(page).getByText('Còn 27 câu hỏi hôm nay')).toBeVisible();
});

test('TC-F14-119 with the agent service stopped the app still works: the bubble and Thử lại, busy, Dashboard numbers, capture in QuickAdd and in the drawer', async ({ page, request }) => {
  const account = await createAccount(request);
  await page.setViewportSize({ width: 375, height: 812 });
  await logIn(page, account.email);
  setAgent('down');

  // A question typed in QuickAdd, sent by the chip: the drawer shows the unavailable bubble and keeps the question.
  const box = page.getByRole('textbox', { name: 'Thêm nhanh' });
  await box.fill(QUESTION);
  await page.getByRole('button', { name: CHIP }).click();
  const dialog = drawer(page);
  await expect(said(dialog, DOWN)).toBeVisible();
  await expect(askBox(dialog)).toHaveValue(QUESTION);

  // Busy has its own text.
  setAgent('busy');
  await dialog.getByRole('button', { name: 'Thử lại' }).click();
  await expect(said(dialog, 'Trợ lý đang trả lời nhiều người, thử lại sau vài giây')).toBeVisible();
  await expect(said(dialog, DOWN)).toHaveCount(0); // the new bubble replaces the old one

  // Capture never needs the agent: in the drawer, then in QuickAdd after closing it.
  await ask(dialog, 'phở 45k');
  await expect(dialog.getByRole('group', { name: 'Giao dịch từ câu này' })).toBeVisible();
  await dialog.getByRole('group', { name: 'Giao dịch từ câu này' }).getByRole('button', { name: 'Lưu' }).click();
  await expect(dialog.getByText('Đã lưu giao dịch: 1')).toBeVisible();
  await dialog.getByRole('button', { name: 'Đóng' }).click();
  await expect(dialog).toBeHidden();
  await box.fill('cafe 30k');
  await box.press('Enter');
  await expect(page.getByText('Đã lưu giao dịch: 1', { exact: true }).last()).toBeVisible();
  expect(await countSaved(request, account)).toBe(2);

  // The numbers are on the Dashboard and Transactions, agent or not.
  await expect(page.getByRole('article', { name: 'Chi tiêu' })).toContainText(/75\.000\s₫/);
  await page.goto('/transactions');
  await expect(page.getByRole('main')).toContainText('cafe'); // a card list on a phone, a table on a desktop

  // Back up: a question is answered again, no redeploy and no reload of the server.
  setAgent('ok');
  await page.goto('/');
  await page.getByRole('button', { name: 'Hỏi Sổ chi tiêu' }).click();
  await ask(drawer(page), 'số dư các ví');
  await expect(said(drawer(page), 'Mình trả lời được các câu hỏi về thu chi của bạn, ví dụ:', false)).toBeVisible();
});

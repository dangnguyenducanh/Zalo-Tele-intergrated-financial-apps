import { expect, test } from '@playwright/test';
import { addTransaction, createAccount, logIn } from './helpers';

// TC-NF-04 in the browser: text that looks like HTML is shown as text and never runs. The API half (operator
// injection answers 400, the note is stored unchanged and sent as JSON) is in server/test/security.test.js.
test.use({ locale: 'vi-VN' });

const XSS = '<img src=x onerror=alert(1)>';

test('TC-NF-04 a note "<img src=x onerror=alert(1)>" is shown as text on every screen and no script runs', async ({ page, request }, testInfo) => {
  const account = await createAccount(request);
  await addTransaction(request, account, 45_000, 'Ăn uống', XSS);
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message()); // alert(1) would land here
    void dialog.dismiss();
  });
  await logIn(page, account.email);

  // Dashboard (latest transactions), transactions table, and the edit dialog's note field.
  await expect(page.getByRole('list', { name: 'Giao dịch gần đây' })).toContainText(XSS);
  await page.goto('/transactions');
  const row = page.getByRole('row').filter({ hasText: XSS });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: `Sửa giao dịch ${XSS}` }).click();
  await expect(page.getByRole('dialog', { name: 'Sửa giao dịch' }).getByRole('textbox', { name: 'Ghi chú' })).toHaveValue(XSS);
  await page.screenshot({ path: testInfo.outputPath('xss-as-text.png'), animations: 'disabled' });

  expect(await page.locator('img[src="x"]').count()).toBe(0); // no element was created from the note
  expect(dialogs).toEqual([]);
});

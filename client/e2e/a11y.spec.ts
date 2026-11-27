import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { addTransaction, createAccount, logIn } from './helpers';

// TC-NF-03: axe-core (WCAG 2.1 A/AA rules, colour contrast included) finds no serious or critical problem on
// the login page, the verify-email page and every user page (dashboard, transactions and the rest), in light
// and in dark. A failure lists every problem on every page: the page, the rule, its help text and the elements.
test.use({ locale: 'vi-VN', reducedMotion: 'reduce' });

async function seriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${page.url().replace(/^https?:\/\/[^/]+/, '')} ${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`TC-NF-03 login, verify-email and every user page have no serious or critical axe violations in ${scheme}`, async ({ page, request }) => {
    const account = await createAccount(request);
    await addTransaction(request, account, 45_000, 'Ăn uống', 'phở');
    await addTransaction(request, account, 15_000_000, 'Lương', 'lương', 'income');
    await page.emulateMedia({ colorScheme: scheme });

    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeVisible();
    const found = await seriousViolations(page);

    // /verify-email shows only while a sign-up is pending, so seed the entry Register keeps (docs/05 §5.11.1).
    await page.evaluate(() => sessionStorage.setItem('pendingSignup', JSON.stringify({ email: 'lan@example.com', maskedEmail: 'l***@example.com', name: 'Lan', signupToken: 't', resendAt: Date.now() + 60_000 })));
    await page.goto('/verify-email');
    await expect(page.getByRole('heading', { level: 1, name: 'Kiểm tra email của bạn' })).toBeVisible();
    found.push(...(await seriousViolations(page)));

    await logIn(page, account.email);
    for (const [path, title] of [
      ['/', 'Xin chào, Lan'],
      ['/transactions', 'Giao dịch'],
      ['/settings', 'Cài đặt'],
      ['/wallets', 'Ví'],
      ['/categories', 'Danh mục'],
      ['/budgets', 'Ngân sách'],
      ['/bot', 'Hộp thư bot'],
    ]) {
      await page.goto(path!);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await page.waitForLoadState('networkidle');
      found.push(...(await seriousViolations(page)));
    }
    expect(found).toEqual([]); // every page is checked before failing, so one run lists every problem
  });
}

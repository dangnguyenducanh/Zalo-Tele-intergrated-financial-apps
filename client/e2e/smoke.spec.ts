import { expect, test } from '@playwright/test';

// Local variant of the deploy smoke: the same checks run against the Vercel URL after a deploy.
test('TC-NF-06 health is ok and a deep link still loads the SPA after a reload', async ({ page, request }) => {
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok', db: 'up' });

  // The app shell (T03) replaced the health page: a rendered <h1> proves the SPA loaded on the deep link
  // (a visitor without a session lands on /login, which is still the SPA).
  await page.goto('/budgets');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

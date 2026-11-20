import { expect, test } from '@playwright/test';

// The design system's fonts in a real browser (docs/05 §5.3): served by the app itself, never by a font CDN,
// and the face that draws Vietnamese text is the web font's own Vietnamese subset, not a system fallback.
test.use({ locale: 'vi-VN' });

test('TC-NF-13 the UI fonts are self-hosted and draw Vietnamese text', async ({ page, baseURL }) => {
  const appHost = new URL(baseURL!).host;
  const external: string[] = [];
  page.on('request', (request) => {
    const { host, protocol } = new URL(request.url());
    if (protocol.startsWith('http') && host !== appHost) external.push(request.url());
  });

  await page.goto('/login');
  const heading = page.getByRole('heading', { level: 1, name: 'Đăng nhập' });
  await expect(heading).toBeVisible();
  expect(await heading.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"Chivo Variable"/);

  const faces = await page.evaluate(async () =>
    (await document.fonts.load('500 16px "Chivo Variable"', 'Sổ chi tiêu ữ')).map((face) => ({ status: face.status, range: face.unicodeRange })),
  );
  expect(faces.length).toBeGreaterThan(0);
  expect(faces.every((face) => face.status === 'loaded')).toBe(true);
  expect(faces.some((face) => /U\+1EA0-1EF9/i.test(face.range))).toBe(true); // the Vietnamese subset (ạ…ỹ)

  expect(external, 'requests to other hosts').toEqual([]);
});

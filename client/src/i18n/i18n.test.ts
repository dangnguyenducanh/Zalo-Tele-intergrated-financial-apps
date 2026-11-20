import { expect, test } from 'vitest';
import { resources } from './index';

// Read as plain text at build time (Vite `?raw`), so the test needs no Node APIs.
const backendTexts = Object.values({
  ...import.meta.glob<string>('../../../docs/04-backend.md', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob<string>('../../../server/src/**/*.js', { query: '?raw', import: 'default', eager: true }),
});

// "a.b.c" for every leaf string.
function keysOf(strings: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(strings).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null ? keysOf(value as Record<string, unknown>, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

// Error codes the API can send: "401 `TOKEN_EXPIRED`" in docs/04 and "401, 'TOKEN_EXPIRED'" in server code.
function backendErrorCodes(): Set<string> {
  const codes = new Set<string>();
  for (const text of backendTexts) {
    for (const match of text.matchAll(/\b[1-5]\d\d\s*(?:[,:]\s*'|`)([A-Z][A-Z_]+)['`]/g)) codes.add(match[1]!);
  }
  return codes;
}

test('TC-F12-03 vi and en have the same namespaces and the same keys', () => {
  const vi = resources.vi!;
  const en = resources.en!;
  expect(Object.keys(en).sort()).toEqual(Object.keys(vi).sort());
  for (const ns of Object.keys(vi)) {
    expect(keysOf(en[ns]!).sort(), `namespace "${ns}"`).toEqual(keysOf(vi[ns]!).sort());
  }
});

test('TC-F12-03 every backend error code has errors.<CODE> in both languages', () => {
  const codes = backendErrorCodes();
  expect(codes).toContain('TOKEN_EXPIRED'); // sanity check that the scan found the docs/04 table
  expect(codes).toContain('NOT_FOUND'); // ... and the server source
  for (const lang of ['vi', 'en']) {
    const errors = resources[lang]!.errors!;
    expect([...codes].filter((code) => !(code in errors)), `missing in ${lang}/errors.json`).toEqual([]);
  }
});

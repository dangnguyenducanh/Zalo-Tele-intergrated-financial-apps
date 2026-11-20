// Minimal JUnit XML reader for Vitest / Playwright reports (no dependency needed).
// Test names must start with a catalogue ID, e.g. "TC-F1-05 refresh rotates token".
export const ID_RE = /\b(TC-[A-Z0-9]+-\d+|MT-\d+)\b/;

export function parseJunit(xml) {
  const out = [];
  const re = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  for (let m; (m = re.exec(xml)); ) {
    const attrs = m[1];
    const body = m[2] ?? '';
    const name = /\bname="([^"]*)"/.exec(attrs)?.[1] ?? '';
    const time = Number(/\btime="([^"]*)"/.exec(attrs)?.[1] ?? 0);
    const result = /<(failure|error)\b/.test(body) ? 'Fail' : /<skipped\b/.test(body) ? 'Skipped' : 'Pass';
    out.push({ name, time, result });
  }
  return out;
}

// Time words and counts in a message (docs/02 §2.5 and §2.11.1 rule 5): "hôm qua", "tuần trước", "tháng 10", "năm 2025",
// "20/11", "7 ngày qua", "top 3", "5 khoản". Pure: no database, no clock, no date ranges yet.
// The numbers inside these phrases are never an amount, so the parser skips them (BUG-039, D9) and classify() takes the
// phrases out before it looks for an amount. Cases: shared/fixtures/period.json, also read by the agent service's period.py.
import { normalize } from '../utils/normalize.js';

// A money unit written apart from its number: "45 k", "1 triệu". A number followed by one is money, never part of a phrase.
export const UNIT_WORD = /^(k|nghin|ngan|ng|tr|trieu|m|d|vnd)$/;

// "+lương 15tr" → ['lương', '15tr']: the words of a line as typed, without the income marker.
export const wordsOf = (line) => String(line ?? '').trim().replace(/^\+/, '').split(/\s+/).filter(Boolean);

// "Phở," → "pho": a word normalized and without punctuation around it, for matching.
export const toKey = (word) => normalize(word).replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');

// Phrases made of words only (compared as keys).
const WORD_PHRASES = [
  ['day', ['hom', 'nay']],
  ['day', ['hom', 'qua']],
  ['day', ['hqua']],
  ['day', ['yesterday']],
  ['week', ['tuan', 'nay']],
  ['week', ['tuan', 'truoc']],
  ['week', ['cuoi', 'tuan']],
  ['month', ['thang', 'nay']],
  ['month', ['thang', 'truoc']],
];
const AFTER_DAYS = ['qua', 'truoc', 'nay']; // "7 ngày qua", "7 ngày trước", "7 ngày nay"

// The number at keys[i] when it is only digits of the given shape and no money unit follows it; NaN otherwise.
const plain = (keys, i, shape = /^\d+$/) => (shape.test(keys[i] ?? '') && !UNIT_WORD.test(keys[i + 1] ?? '') ? Number(keys[i]) : NaN);
const within = (n, low, high) => n >= low && n <= high; // false for NaN

// "ngày" written with its accent, in either Unicode form: the original word decides, because "ngay" alone is "at once".
const hasAccent = (word) => word.normalize('NFC').toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') === 'ngày';

// The phrase that starts at words[i]: { kind, length }, or null.
function phraseAt(words, keys, i) {
  const number = (offset, shape) => plain(keys, i + offset, shape);

  if (i === 0 && keys[0] === 'top' && within(number(1, /^\d{1,3}$/), 1, 999)) return { kind: 'top', length: 2 };
  if (within(number(0, /^\d{1,3}$/), 1, 366) && keys[i + 1] === 'ngay') {
    const follows = AFTER_DAYS.includes(keys[i + 2]);
    if (follows || hasAccent(words[i + 1])) return { kind: 'days', length: follows ? 3 : 2 };
  }
  if (within(number(0, /^\d{1,2}$/), 1, 50) && keys[i + 1] === 'khoan') return { kind: 'items', length: 2 };
  if (keys[i] === 'thang' && within(number(1, /^\d{1,2}$/), 1, 12)) {
    const withYear = keys[i + 2] === 'nam' && within(plain(keys, i + 3, /^\d{4}$/), 1900, 2099);
    return { kind: 'month', length: withYear ? 4 : 2 };
  }
  if (keys[i] === 'thang' && within(number(1, /^\d{4}$/), 2000, 2099)) return { kind: 'year', length: 2 };
  if (keys[i] === 'nam' && within(number(1, /^\d{4}$/), 1900, 2099)) return { kind: 'year', length: 2 };
  const date = /^(\d{1,2})\/(\d{1,2})(?:\/\d{4})?$/.exec(keys[i]);
  if (date && within(Number(date[1]), 1, 31) && within(Number(date[2]), 1, 12)) return { kind: 'date', length: 1 };
  const named = WORD_PHRASES.find(([, sequence]) => sequence.every((key, n) => keys[i + n] === key));
  return named ? { kind: named[0], length: named[1].length } : null;
}

// The phrases in a line's words, left to right: { phrases: [{ kind, text }] (the words as typed), indexes (the positions
// of every word a phrase took) and rest (the other words, joined by one space) }.
export function findPeriod(words) {
  const keys = words.map(toKey);
  const phrases = [];
  const indexes = new Set();
  for (let i = 0; i < words.length; i++) {
    const found = phraseAt(words, keys, i);
    if (!found) continue;
    phrases.push({ kind: found.kind, text: words.slice(i, i + found.length).join(' ') });
    for (let n = 0; n < found.length; n++) indexes.add(i + n);
    i += found.length - 1;
  }
  return { phrases, indexes, rest: words.filter((_, i) => !indexes.has(i)).join(' ') };
}

// Rule-based text parser (docs/02 §2.5). No AI, no database: the caller passes the user's
// categories and wallets. Used by both bots and the web quick add (POST /transactions/parse).
import { MAX_MONEY } from '../models/Transaction.js';
import { normalize } from '../utils/normalize.js';
import { dayRange, vnDate, vnParts } from '../utils/vnTime.js';
import { UNIT_WORD, findPeriod, toKey, wordsOf } from './period.js';

const MAX_LINES = 10;
const NOTE_MAX = 200;
const DAY_MS = 24 * 60 * 60 * 1000; // exact in Vietnam: no daylight saving
const INCOME_WORDS = ['luong', 'thuong', 'nhan', 'salary', 'bonus', 'received'];
const SPLIT_MIN = 2; // "chia N": N people share the bill (docs/02 §2.11.2 A5)
const SPLIT_MAX = 50;
const YESTERDAY_WORDS = ['hqua', 'yesterday']; // plus the two words "hom qua"

// A message → one result per non-empty line (first 10 lines only); null where a line has no amount.
export function parseText(text, ctx) {
  const lines = String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(0, MAX_LINES).map((line) => readLine(line, ctx));
}

// One line → { type, amount, categoryId, walletId, occurredAt, note }, or null when there is no amount.
export function parseLine(text, ctx) {
  const draft = readLine(text, ctx);
  if (draft) delete draft.guessed;
  return draft;
}

// parseLine() plus `guessed`: the amount was a bare number read as thousands ("phở 45"), which the draft check
// watches more closely (A6). parseText() keeps it for the services; parseLine() leaves it out.
export function readLine(text, { categories = [], wallets = [], defaultWalletId, now = new Date() } = {}) {
  const line = String(text ?? '').trim();
  const words = wordsOf(line); // original words, kept for the note
  const keys = words.map(toKey); // the same words, normalized for matching
  const used = new Set(); // indexes of words that were dates, wallets or the amount

  const occurredAt = findDate(keys, used, now);
  const walletId = findWallet(keys, used, wallets) ?? defaultWalletId ?? wallets[0]?._id ?? null;
  const people = findSplit(keys, used); // before the amount, so the N is never read as money (A5)
  const found = findAmount(keys, used, findPeriod(words).indexes);
  if (found === null) return null;

  const rest = keys.filter((_, i) => !used.has(i));
  const matchText = ` ${rest.join(' ').replace(/[^a-z0-9]+/g, ' ').trim()} `; // padded so keywords match whole words
  const income = categories.filter((c) => c.type === 'income');
  const isIncome =
    line.startsWith('+') ||
    INCOME_WORDS.some((w) => matchText.includes(` ${w} `)) ||
    bestCategory(income, matchText) !== null;
  const type = isIncome ? 'income' : 'expense';
  const ofType = categories.filter((c) => c.type === type);
  const category = bestCategory(ofType, matchText) ?? ofType.find((c) => c.isFallback) ?? null;
  const left = words.filter((_, i) => !used.has(i)).join(' ');
  const split = people ? splitBill(found.value, people, left) : { amount: found.value, note: left.slice(0, NOTE_MAX) };

  return { type, amount: split.amount, categoryId: category?._id ?? null, walletId, occurredAt, note: split.note, guessed: found.guessed };
}

// "chia 4" → 4: the words "chia" and a whole number from 2 to 50 are used up, so the N is never an amount
// ("chia 1" and "chia 51" are not a split and stay in the note). null when there is no such pair.
function findSplit(keys, used) {
  for (let i = 0; i < keys.length - 1; i++) {
    const people = /^\d{1,2}$/.test(keys[i + 1]) ? Number(keys[i + 1]) : 0;
    if (keys[i] === 'chia' && !used.has(i) && !used.has(i + 1) && people >= SPLIT_MIN && people <= SPLIT_MAX) {
      used.add(i).add(i + 1);
      return people;
    }
  }
  return null;
}

// A total shared by `people` → { amount, note }: each share rounded up to the next 1.000 ₫, and the note with
// "(1.200.000 ₫ ÷ 4)" at its end (the note is cut short, not the label, to stay within 200 characters).
// The chat's lone "chia N" divides a waiting draft with the same function.
export function splitBill(total, people, note = '') {
  const label = `(${total.toLocaleString('vi-VN')} ₫ ÷ ${people})`;
  return { amount: Math.ceil(total / people / 1000) * 1000, note: `${note.slice(0, NOTE_MAX - label.length - 1)} ${label}`.trim() };
}

// A message that is only "chia 4" (case, accents and spaces ignored) → 4; null for anything else, or an N outside 2-50.
export function loneSplit(text) {
  const people = Number(/^chia (\d{1,2})$/.exec(normalize(text))?.[1]);
  return people >= SPLIT_MIN && people <= SPLIT_MAX ? people : null;
}

// "hôm qua" / "hqua" / "yesterday" → now − 1 day; "dd/mm" or "dd/mm/yyyy" → that day; otherwise now.
function findDate(keys, used, now) {
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] === 'hom' && keys[i + 1] === 'qua') {
      used.add(i).add(i + 1);
      return new Date(now.getTime() - DAY_MS);
    }
    if (YESTERDAY_WORDS.includes(keys[i])) {
      used.add(i);
      return new Date(now.getTime() - DAY_MS);
    }
    const m = keys[i].match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
    const date = m && onDay(now, Number(m[3] ?? vnParts(now).year), Number(m[2]), Number(m[1]));
    if (date) {
      used.add(i);
      return date;
    }
  }
  return now;
}

// `now` moved to another Vietnamese calendar day, keeping its clock time; null for a day that doesn't exist (31/02).
export function onDay(now, year, month, day) {
  const start = vnDate(year, month, day);
  const real = vnParts(start);
  if (real.month !== month || real.day !== day) return null;
  return new Date(start.getTime() + (now.getTime() - dayRange(now).start.getTime()));
}

// The first word that is one of a wallet's aliases ("mm", "tm", "ck"…).
function findWallet(keys, used, wallets) {
  for (let i = 0; i < keys.length; i++) {
    if (used.has(i)) continue;
    const wallet = wallets.find((w) => (w.aliases ?? []).some((alias) => normalize(alias) === keys[i]));
    if (wallet) {
      used.add(i);
      return wallet._id;
    }
  }
  return null;
}

// Every amount the words could be, in the order written: { value, guessed, explicit, indexes }. A number that is
// part of a time word or a count (`never`, from findPeriod(): "tháng 10", "năm 2026", "7 ngày qua", "top 3", "5 khoản";
// BUG-039, D9) is not one, unless a money unit follows it ("tháng 10k", "tháng 10 k"). `explicit` is an amount nobody had
// to guess (docs/02 §2.11.1 rule 5): a unit, thousands separators or 5+ digits; a bare 1-4 digit number is not.
export function amountCandidates(keys, used, never) {
  const found = [];
  for (let i = 0; i < keys.length; i++) {
    if (used.has(i)) continue;
    const next = keys[i + 1];
    const withUnit = next && !used.has(i + 1) && UNIT_WORD.test(next) ? readAmount(keys[i] + next) : null;
    const amount = withUnit ?? (never.has(i) ? null : readAmount(keys[i]));
    if (amount) found.push({ ...amount, explicit: Boolean(withUnit) || !/^\d{1,4}$/.test(keys[i]), indexes: withUnit ? [i, i + 1] : [i] });
  }
  return found;
}

// The amount in VND ({ value, guessed, … }). An amount with a unit or separators ("50k", "150.000") beats a bare
// number read as thousands ("2" in "2 ly trà sữa 50k"); otherwise the first one wins.
function findAmount(keys, used, never) {
  const found = amountCandidates(keys, used, never);
  const pick = found.find((a) => !a.guessed) ?? found[0];
  if (!pick) return null;
  pick.indexes.forEach((i) => used.add(i));
  return pick;
}

// One normalized word → { value, guessed } or null. See the table in docs/02 §2.5.
function readAmount(key) {
  let m = key.match(/^(\d+)(?:[.,](\d+))?(?:k|nghin|ngan|ng)$/); // 45k, 45ng, 1.5k
  if (m) return checked(Number(`${m[1]}.${m[2] ?? 0}`) * 1e3);
  m = key.match(/^(\d+)(?:[.,](\d+))?(?:tr|trieu|m)(\d{1,3})?$/); // 1tr, 1m, 1.5tr, 1,5tr, 1tr2, 1tr25
  if (m && !(m[2] && m[3])) return checked(Number(`${m[1]}.${m[2] ?? m[3] ?? 0}`) * 1e6);
  if (/^\d{1,3}$/.test(key)) return checked(Number(key) * 1e3, true); // bare "45" → 45,000 (a guess the confirm step shows)
  m = key.match(/^(\d{1,3}(?:[.,]\d{3})+|\d+)(?:d|vnd)?$/); // 150.000, 150,000, 150000, 150000đ
  if (m) return checked(Number(m[1].replace(/[.,]/g, '')));
  return null;
}

// Only whole amounts from 1 ₫ to the 10^13 ₫ ceiling count ("0k" or a 14-digit number is not an amount), so a
// line the API would refuse is named as unreadable by every caller: both bots and the web quick add (BUG-033).
function checked(value, guessed = false) {
  const rounded = Math.round(value);
  return rounded > 0 && rounded <= MAX_MONEY ? { value: rounded, guessed } : null;
}

// The category whose keyword is the longest whole-word match in the text, or null.
export function bestCategory(categories, text) {
  let best = null;
  let bestLength = 0;
  for (const category of categories) {
    for (const keyword of category.keywords ?? []) {
      const key = normalize(keyword);
      if (key.length > bestLength && text.includes(` ${key} `)) {
        best = category;
        bestLength = key.length;
      }
    }
  }
  return best;
}

// classify(): is a typed message a question or money to capture? (docs/02 §2.11.1). A pure function: no database, no
// network, no model. A capture read as a question saves nothing, but a question read as a capture creates money data,
// so a tie goes to "question". The first rule that fires decides.
import { amountCandidates } from './parser.js';
import { findPeriod, toKey, wordsOf } from './period.js';

const LAST_WORDS = ['chua', 'khong', 'ko']; // rule 4: "45k là nhiều chưa", "ăn ngoài nhiều không"
// Rule 6, matched on whole words without accents: strong markers. "sao" only as the first or last word, "mấy" only with its accent.
const STRONG = [' bao gio ', ' khi nao ', ' the nao ', ' tai sao ', ' vi sao ', ' tong ket ', ' so voi ', ' how much ', ' why '];
const TRAILING_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

// A word as typed, in NFC and lower case: "tìm" typed with a combining accent still equals "tìm".
const typed = (word) => word.normalize('NFC').toLowerCase().replace(TRAILING_PUNCTUATION, '');

const question = (rule) => ({ answer: 'question', rule });
const capture = (rule) => ({ answer: 'capture', rule });

// → { answer: 'question' | 'capture', rule: '1' … '8' | '5b' }, the rule that decided it. `followUp`: an assistant answer
// went to this chat in the last 10 minutes (always true in the web drawer); chat and the web quick add pass false until the
// follow-up exists (T50).
export function classifyWithRule(text, { followUp = false } = {}) {
  const trimmed = String(text ?? '').trim();
  if (trimmed.startsWith('?')) return question('1');
  if (trimmed.split(/\r?\n/).filter((line) => line.trim()).length > 1) return capture('2');
  if (trimmed.endsWith('?')) return question('3'); // even with an amount

  const words = wordsOf(trimmed);
  const keys = words.map(toKey);
  const spoken = ` ${keys.filter(Boolean).join(' ')} `; // padded, so a phrase matches whole words only
  if (LAST_WORDS.includes(keys.filter(Boolean).at(-1)) || spoken.includes(' bao nhieu ')) return question('4');

  // Time words and counts are taken out first, so a year after "năm"/"tháng" or a day count is never an amount.
  const { phrases, indexes, rest } = findPeriod(words);
  if (amountCandidates(keys, new Set(), indexes).some((amount) => amount.explicit)) return capture('5');
  const numberLeft = /\d/.test(rest); // a bare number counts too
  if (!numberLeft && phrases.some((phrase) => phrase.kind === 'top' || phrase.kind === 'items')) return question('5b');

  if (STRONG.some((marker) => spoken.includes(marker)) || keys[0] === 'sao' || keys.filter(Boolean).at(-1) === 'sao') return question('6');
  if (words.some((word) => typed(word) === 'mấy')) return question('6');
  const weak = keys[0] === 'top' || typed(words[0] ?? '') === 'tìm' || (keys[0] === 'con' && keys[1] === 'lai');
  if (weak && !numberLeft) return question('6');

  if (followUp) return question('7'); // a bare number is no amount in a follow-up, so nothing else is left but a question
  return capture('8'); // a bare number is still guessed as thousands; no amount at all gives the help text
}

export const classify = (text, options) => classifyWithRule(text, options).answer;

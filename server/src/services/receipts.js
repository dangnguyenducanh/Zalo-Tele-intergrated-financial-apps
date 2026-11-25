// Receipt photos (docs/02 §2.6, docs/04 §4.8): image → the KIE service's POST /analyze → a draft transaction.
// Used by the web upload (POST /api/receipts) and by the bots (a photo sent in the chat).
import { bestCategory, onDay } from '../bot/parser.js';
import { env } from '../config/env.js';
import { Category } from '../models/Category.js';
import { Transaction } from '../models/Transaction.js';
import { User } from '../models/User.js';
import { Wallet } from '../models/Wallet.js';
import { AppError } from '../utils/AppError.js';
import { normalize } from '../utils/normalize.js';
import { pickTotal } from './receiptTotal.js';

const KIE_TIMEOUT_MS = 120_000; // KIE reads one image at a time (~20 s each), so a photo may wait in its queue

const unreadable = () => new AppError(422, 'RECEIPT_UNREADABLE', 'No total could be read from the receipt');

// What the file really is, from its first bytes (a file name or a declared type can say anything).
export function imageType(bytes) {
  const head = bytes.subarray(0, 4).toString('hex');
  if (head.startsWith('ffd8ff')) return 'image/jpeg';
  if (head === '89504e47') return 'image/png';
  return null;
}

// POST ${KIE_URL}/analyze with the image in field "image" and the shared key in X-KIE-Key.
// Returns only the parts we use: the base64 images and boxes (hundreds of KB) are dropped here. The text (full_text and
// lines) stays, because the total is picked from it (receiptTotal.js); it is not stored.
export async function analyzeReceipt(bytes, type) {
  if (!env.KIE_URL) throw new AppError(503, 'FEATURE_NOT_CONFIGURED', 'Receipt reading is not configured (KIE_URL)');
  const form = new FormData();
  form.append('image', new Blob([bytes], { type }), type === 'image/png' ? 'receipt.png' : 'receipt.jpg');

  let res;
  let body;
  try {
    res = await fetch(`${env.KIE_URL.replace(/\/$/, '')}/analyze`, {
      method: 'POST',
      headers: { 'X-KIE-Key': env.KIE_API_KEY ?? '' },
      body: form,
      signal: AbortSignal.timeout(KIE_TIMEOUT_MS), // also covers reading the answer
    });
    body = res.ok ? await res.json() : null;
  } catch (err) {
    if (err.name === 'TimeoutError') throw new AppError(504, 'KIE_TIMEOUT', 'The receipt service did not answer in time');
    throw new AppError(502, 'KIE_UNAVAILABLE', 'The receipt service is unreachable');
  }
  if ([400, 413, 415].includes(res.status)) throw unreadable(); // KIE could not open the image
  if (!res.ok) throw new AppError(502, 'KIE_UNAVAILABLE', `The receipt service answered ${res.status}`); // down, or a wrong key

  const { fields = {}, line_items: lineItems = [], reconciliation = {}, timings_ms: timings = {}, full_text: fullText = '', lines = [] } = body;
  return { fields, lineItems, reconciliation, timings, fullText, lines };
}

// What KIE read → the draft's fields (docs/02 §2.6). Pure, so the KIE contract test can check real output.
// The amount comes from pickTotal; with no total left on the receipt it is the sum of the item lines, flagged as an
// estimate, and those lines become the items. The category is the longest keyword match (the text parser's rule) on
// the merchant and item names.
export function receiptToDraft({ fields, lineItems, reconciliation, timings, fullText, lines }, { categories, now = new Date() }) {
  const total = pickTotal({ fields, reconciliation, fullText, lines });
  if (!total || !Number.isSafeInteger(total.amount)) throw unreadable();
  const { amount, estimated } = total;

  const merchant = String(fields.merchant ?? '').trim();
  const items = total.items ?? lineItems.map((item) => ({ name: item.name, quantity: item.quantity, unitPrice: item.unit_price, amount: item.amount }));
  const category = bestCategory(categories, ` ${keywordText([merchant, ...items.map((item) => item.name)])} `) ?? categories.find((c) => c.isFallback);
  const itemSum = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

  return {
    type: 'expense',
    amount,
    categoryId: category?._id,
    occurredAt: receiptDate(fields.date, now),
    note: merchant.slice(0, 200),
    receipt: {
      merchant,
      address: fields.address,
      date: fields.date,
      total: amount,
      items,
      reconciled: Math.abs(itemSum - amount) <= (reconciliation.tolerance ?? 0), // the line items add up to the total
      estimated: estimated || undefined, // only stored when true
      kieMs: Math.round(Object.values(timings).reduce((sum, ms) => sum + ms, 0)),
    },
  };
}

// Receipt words that read as a category keyword once accents are dropped: phím (key) is not phim (film), phố (street)
// is not phở, bé (small) is not Be (the ride app), sạch (clean) is not sách (book). These words are left out before
// matching. When OCR has dropped the accents, only the word next to them tells: "ban phim" is a keyboard, "rau sach"
// clean vegetables.
// ponytail: hand-kept lists; accented keywords in the category templates would make them unnecessary.
const NOT_KEYWORDS = new Set(['phím', 'phố', 'bé', 'sạch']);
const NOT_KEYWORD_PHRASES = /(?<=^| )(?:ban phim|rau sach)(?= |$)/g;

// The merchant and item names as the parser's keyword text: whole words, lower case, no accents.
function keywordText(names) {
  const words = names.join(' ').toLowerCase().normalize('NFC').split(/[^\p{L}\p{N}]+/u);
  return normalize(words.filter((word) => !NOT_KEYWORDS.has(word)).join(' ')).replace(NOT_KEYWORD_PHRASES, '');
}

// "13/08/2020" → that Vietnamese day at the current time of day (like "dd/mm/yyyy" in the text parser); else now.
function receiptDate(text, now) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(text ?? '').trim());
  return (m && onDay(now, Number(m[3]), Number(m[2]), Number(m[1]))) || now;
}

// A receipt photo → KIE → a draft on the user's default wallet, which the user then confirms or discards.
// `source` is 'receipt' for a web upload, or the chat platform (with its chatRef and file reference) for a bot photo.
export async function createReceiptDraft(userId, bytes, { source = 'receipt', chatRef, fileRef } = {}) {
  const type = imageType(bytes);
  if (!type) throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Only JPEG and PNG images are supported');
  const kie = await analyzeReceipt(bytes, type);

  const [categories, wallet, user] = await Promise.all([
    Category.find({ userId, type: 'expense', deletedAt: null }).sort({ _id: 1 }).lean(),
    Wallet.findOne({ userId, deletedAt: null, archived: false }).sort({ createdAt: 1, _id: 1 }).lean(),
    User.findById(userId).lean(),
  ]);
  const draft = receiptToDraft(kie, { categories });
  draft.receipt.fileRef = fileRef;
  return Transaction.create({ ...draft, walletId: user?.defaultWalletId ?? wallet?._id, userId, status: 'draft', source, chatRef });
}

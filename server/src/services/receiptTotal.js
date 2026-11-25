// Which number on a receipt is the amount paid (docs/02 §2.6, docs/04 §4.8). Pure: KIE's text lines in, a number out.
// KIE's own fields.total is only one candidate: it also picks subtotals, invoice numbers, years and account codes
// (BUG-034…037), so the printed text is read again here.
import { normalize } from '../utils/normalize.js';

// Money as printed: thousands separators and a first digit that is not 0 ("92.400", "7,480,000", "-22.700"), maybe
// with zero decimals ("92,400.00"). Invoice and voucher numbers (004829, PT-09/2023), years, dates, phone and tax
// numbers never look like this.
const MONEY = /(-?)(?<![\d.,])([1-9]\d{0,2}(?:[.,]\d{3})+)(?:[.,]00)?(?![.,]?\d)/g;

// Labels, matched as whole words on a line without accents. OCR often drops accented vowels
// ("Tổng cộng tiền" → "Tng cng tin"), so any vowel of a label may be missing.
const label = (...phrases) => new RegExp(`(?:^| )(?:${phrases.map((p) => p.replace(/[aeiouy]/g, '$&?')).join('|')})(?= |$)`);
// The amount due ("Khách cần trả", "Tiền cần thanh toán", "Tổng cộng tiền thanh toán") beats a plain "Tổng cộng".
const PAYABLE = label('can thanh toan', 'phai thanh toan', 'can tra', 'phai tra', 'tien thanh toan', 'tong thanh toan');
const FINAL = label('tong cong', 'tong tien', 'thanh toan', 'so tien', 'can tra', 'phai tra');
const SUBTOTAL = label('tien hang', 'tam tinh');
// Amounts that are never the total: subtotal, discounts, points, list prices, cash given ("Khách thanh toán 50.000",
// "Số tiền nhận"), change, payment method.
const NOT_FINAL = label(
  ...['tien hang', 'tam tinh', 'chiet khau', 'giam gia', 'khuyen mai', 'tich luy', 'gia dang ky', 'gia niem yet'],
  ...['khach dua', 'khach tra', 'khach thanh toan', 'tien nhan', 'tra lai', 'tien thoi', 'tien thua', 'tien mat', 'ngan hang'],
);
const VAT = /(?:^| )(?:gtgt|vat)(?= |$)/;
// "(đã bao gồm VAT)", "(đã gồm thuế GTGT)": said of the grand total, so that line is not the VAT line.
const VAT_INCLUDED = /(?:^| )(?:da )?(?:bao )?go?m (?:ca )?(?:thue )?(?:gtgt|vat)(?= |$)/g;
// A phone, tax, account or document number label at the start of a line: its numbers are never money, even with dots
// in them ("ĐT: +84 912.345.678", "Mã GD: 2.611.240").
const CODE = /^(?:dt|sdt|tel|hotline|dien thoai|fax|mst|stk|ma \w+|so (?:hd|hoa don|ct|chung tu|phieu|tk|tai khoan|gd))(?= |$)/;
const IN_WORDS = label('bang chu'); // "Bằng chữ: Hai triệu năm trăm nghìn đồng"

// One text line → its amounts, its words (accents dropped, amounts removed) and what kind of line it is.
function readLine(raw) {
  const name = raw.replace(MONEY, ' ').replace(/\s+/g, ' ').trim();
  const text = normalize(name).replace(/[^a-z0-9]+/g, ' ').replace(VAT_INCLUDED, ' ').trim();
  const code = CODE.test(text);
  const amounts = code ? [] : [...raw.matchAll(MONEY)].map(([, sign, digits]) => Number(sign + digits.replace(/[.,]/g, '')));
  const kind = NOT_FINAL.test(text) ? 'notFinal' : VAT.test(text) ? 'vat' : FINAL.test(text) ? 'final' : 'other';
  // An item line: a name and a price, and none of the labels above ("1 × 18.900" has no name).
  const item = kind === 'other' && amounts.some((n) => n > 0) && /[a-z]{2}/.test(text);
  return { raw, code, amounts, name, text, kind, item };
}

const positive = (amounts) => amounts.filter((n) => n > 0);

// What the receipt says was paid: { amount, estimated, items? }, or null when nothing usable is printed.
// In order: the amount in words, subtotal + VAT − discounts, a grand-total label, the same sum without labels,
// KIE's total, else the sum of the item lines as an estimate (a torn receipt).
export function pickTotal({ fields = {}, reconciliation = {}, lines = [], fullText = '' }) {
  const rows = (lines.length > 0 ? lines : String(fullText).split('\n')).map((line) => readLine(String(line)));
  // A name on its own line, then "1 × 45.900 45.900" (WinMart+, mcocr): the price line is that item.
  rows.forEach((row, i) => {
    const above = rows[i - 1];
    if (row.kind === 'other' && !row.item && positive(row.amounts).length > 0 && above?.kind === 'other' && above.amounts.length === 0 && /[a-z]{2}/.test(above.text)) {
      Object.assign(row, { item: true, name: above.name });
    }
  });
  const printed = new Set(rows.flatMap((row) => positive(row.amounts)));
  const found = (amount) => ({ amount, estimated: false });

  // 1. "Bằng chữ: …", when it agrees with a number printed on the receipt (OCR garbles words more often than digits).
  for (const row of rows) {
    const match = IN_WORDS.exec(row.text);
    const inWords = match ? wordsToNumber(row.text.slice(match.index + match[0].length)) : 0;
    if (printed.has(inWords)) return found(inWords);
  }

  // 2. Subtotal + VAT + discounts (printed negative) = a printed number. The subtotal is the value on, above or
  // below a "Tổng/Cộng tiền hàng" line, because a photo read sideways can shift values one row off their labels.
  const vat = Math.max(0, ...rows.filter((row) => row.kind === 'vat').flatMap((row) => row.amounts));
  const discounts = [...new Set(rows.flatMap((row) => row.amounts.filter((n) => n < 0)))].reduce((sum, n) => sum + n, 0);
  const totalsFrom = (subtotals) =>
    vat + discounts === 0
      ? []
      : positive(subtotals)
          .filter((subtotal) => vat * 10 <= subtotal) // VAT is at most 10% in Vietnam
          .map((subtotal) => subtotal + vat + discounts)
          .filter((total) => total > 0 && printed.has(total));
  const besideSubtotal = rows.flatMap((row, i) => (SUBTOTAL.test(row.text) ? rows.slice(Math.max(0, i - 1), i + 2) : []));
  const checked = totalsFrom(besideSubtotal.flatMap((row) => row.amounts));
  if (checked.length > 0) return found(Math.max(...checked));

  // 3. The value of a grand-total label: on its line, else a line holding only that value just above or below it.
  // An amount-due label ("Khách cần trả") first. Of several values, the one that is another less the discounts
  // ("Tổng cộng 115.100", "Thanh toán 92.400"), else the largest.
  const valueOnly = (row) => row?.amounts.length === 1 && row.amounts[0] > 0 && /^(d|vnd|dong)?$/.test(row.text);
  const valueOf = (row, i) => {
    const own = positive(row.amounts);
    if (own.length > 0) return [own.at(-1)];
    const beside = [rows[i - 1], rows[i + 1]].find(valueOnly);
    return beside ? beside.amounts : [];
  };
  const labelledBy = (labels) => rows.flatMap((row, i) => (row.kind === 'final' && labels.test(row.text) ? valueOf(row, i) : []));
  const labelled = [PAYABLE, FINAL].map(labelledBy).find((values) => values.length > 0);
  const net = labelled ? totalsFrom(labelled).filter((total) => labelled.includes(total)) : [];
  if (labelled) return found(Math.max(...(net.length > 0 ? net : labelled)));

  // 4. No label next to its value (a sideways photo read as columns): any printed amount as the subtotal, but only
  // when the receipt has a subtotal label and exactly one total fits (on a torn receipt, a price minus an item
  // discount can equal another price).
  const fitting = new Set(besideSubtotal.length > 0 ? totalsFrom([...printed]) : []);
  if (fitting.size === 1) return found([...fitting][0]);

  // 5. KIE's total, if it is printed and is not just one item's price or a subtotal: KIE's items add up to it (then it
  // may be printed without separators, "116000" or "116 000"), or it stands as money on a grand-total line or a line
  // with only numbers.
  const raw = String(fields.total ?? '').trim().replace(/[.,]00$/, ''); // "92400.00"
  const kieTotal = /^[1-9]/.test(raw) ? Number(raw.replace(/\D/g, '')) : 0;
  const anyGrouping = new RegExp(`(?<![\\d.,])${String(kieTotal).replace(/\B(?=(\d{3})+$)/g, '[., ]?')}(?![.,]?\\d)`);
  const itemsAddUp = reconciliation.is_math_consistent === true && rows.some((row) => !row.code && anyGrouping.test(row.raw));
  const onTotalLine = rows.some((row) => (row.kind === 'final' || (row.kind === 'other' && !row.item)) && row.amounts.includes(kieTotal));
  if (kieTotal > 0 && (itemsAddUp || onTotalLine)) return found(kieTotal);

  // 6. No total left on the receipt: the item lines that are, less the discounts among them (printed negative),
  // flagged so the user checks it.
  const summed = rows.filter((row) => row.item || row.amounts.some((n) => n < 0));
  const items = summed.map((row) => ({ name: row.name, amount: row.item ? positive(row.amounts).at(-1) : Math.min(...row.amounts) }));
  const amount = items.reduce((sum, item) => sum + item.amount, 0);
  return rows.some((row) => row.item) && amount > 0 ? { amount, estimated: true, items } : null;
}

const DIGITS = new Map([['khong', 0], ['mot', 1], ['hai', 2], ['ba', 3], ['bon', 4], ['tu', 4], ['nam', 5], ['lam', 5], ['sau', 6], ['bay', 7], ['tam', 8], ['chin', 9]]);
const SCALES = new Map([['nghin', 1e3], ['ngan', 1e3], ['trieu', 1e6], ['triu', 1e6], ['ty', 1e9]]); // "triu": OCR drops the "ệ"

// Vietnamese number words without accents → the number, e.g. "bay trieu bon tram tam muoi nghin dong" → 7480000.
// Words before the first number word are skipped; the first other word after it ("dong", "chan") ends the number.
export function wordsToNumber(text) {
  let total = 0;
  let group = 0; // the part below 1000, before its scale word
  let digit = null; // the digit just read, which "muoi" turns into tens
  let started = false;
  for (const word of text.split(' ')) {
    if (DIGITS.has(word)) {
      digit = DIGITS.get(word);
      group += digit;
    } else if (word === 'muoi') {
      group += digit === null ? 10 : digit * 9; // "mười" = 10, "tám mươi" = 8 × 10
      digit = null;
    } else if (word === 'tram') {
      group *= 100;
      digit = null;
    } else if (SCALES.has(word)) {
      total += (group || 1) * SCALES.get(word);
      group = 0;
      digit = null;
    } else if (word === 'linh' || word === 'le') {
      digit = null; // "một trăm linh năm" = 105
    } else if (started) break;
    else continue;
    started = true;
  }
  return total + group;
}

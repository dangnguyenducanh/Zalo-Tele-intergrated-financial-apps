// Which number on a receipt is the amount paid (docs/02 §2.6, docs/04 §4.8). Pure: KIE's text lines in, a number out.
// KIE's own fields.total is only one candidate: it also picks subtotals, invoice numbers, years, account codes and the
// cash handed over (BUG-034…037), so the printed text is read again here.
import { normalize } from '../utils/normalize.js';

// Money as printed: thousands separators and a first digit that is not 0 ("92.400", "7,480,000", "-22.700"), maybe
// with zero decimals ("92,400.00"). Invoice and voucher numbers (004829, PT-09/2023), years, dates and tax numbers
// never look like this. Phone numbers can ("912.345.678"), so CODE blanks them first.
const MONEY = /(-?)(?<![\d.,])([1-9]\d{0,2}(?:[.,]\d{3})+)(?:[.,]00)?(?![.,]?\d)/g;

// A number we already know (KIE's total, the amount in words), written with any grouping: 116000, 116.000, 116 000.
const written = (n) => new RegExp(`(?<![\\d.,])${String(n).replace(/\B(?=(\d{3})+$)/g, '[., ]?')}(?![.,]?\\d)`);

// A phone, tax, account or document number, wherever it stands on the line: its label and the digits after it are
// never money ("ĐC: 12 Lê Lợi - ĐT: (028) 38.221.234", "Liên hệ: +84 912.345.678", "Mã GD: 2.611.240", "Số: 12.345").
// Matched on the line folded to lower case without accents, character for character, then blanked in the line.
const CODE = new RegExp(
  '(?:' +
  [
    '(?<![a-z])(?:s?dt|tel|hotline|dien thoai|fax|mst|ma so thue|stk|so tk|so tai khoan|lien he|so\\W*(?:hd|hoa don|ct|chung tu|phieu|gd))(?=\\s*[:+(0])',
    '^ma \\w+(?=\\s*:)',
    '^so(?=\\s*[:\\d])',
    '\\+84',
    '\\(0\\d{1,3}\\)',
  ].join('|') + ')[^a-z]*',
  'g',
);
const fold = (line) =>
  line.toLowerCase().replace(/[^\x20-\x7e]/g, (ch) => {
    const base = ch.normalize('NFD')[0];
    return base === 'đ' ? 'd' : base;
  });
const blankCodes = (line) => {
  let blanked = line;
  for (const { index, 0: code } of fold(line).matchAll(CODE)) blanked = blanked.slice(0, index) + ' '.repeat(code.length) + blanked.slice(index + code.length);
  return blanked;
};

// Labels, matched as whole words on a line without accents. OCR often drops accented vowels
// ("Tổng cộng tiền" → "Tng cng tin"), so any vowel of a label may be missing.
const loose = (phrases) => phrases.map((p) => p.replace(/[aeiouy]/g, '$&?')).join('|');
const label = (...phrases) => new RegExp(`(?:^| )(?:${loose(phrases)})(?= |$)`);

const SUBTOTAL = label('tien hang', 'tam tinh', 'subtotal', 'sub total', 'chua thue', 'truoc thue', 'chua vat');
// The amount due ("Khách cần trả", "Tiền cần thanh toán", "Tổng cộng tiền thanh toán") beats a plain "Tổng cộng".
const DUE = label('can thanh toan', 'phai thanh toan', 'can tra', 'phai tra', 'tien thanh toan', 'tong thanh toan', 'amount due');
const IN_WORDS = label('bang chu'); // "Bằng chữ: Hai triệu năm trăm nghìn đồng"
// What a line with a label holds; the first match wins.
const KINDS = [
  ['heading', label('don gia', 'ten hang', 'mat hang', 'dvt', 'sl', 'so luong', 'hinh thuc')], // no amount of its own
  // A tax line starts with its tax word ("VAT 8%", "Tiền thuế GTGT", "Tổng tiền thuế"; OCR's "Tiền thu GTGT" is not
  // "Tiền thừa"). A grand total that mentions VAT ("Tổng cộng (đã gồm 8% VAT)", "Thành tiền sau VAT") stays a total.
  ['vat', new RegExp(`^(?=.*(?:^| )(?:thue|vat|gtgt|tax)(?: |$))(?:(?:${loose(['tong cong', 'tong', 'total'])}) )?(?:${loose(['tien'])} )?(?:thue|thu|vat|gtgt|tax)(?= |$)`)],
  // Points and list prices are never paid ("Số dư điểm: 12.500", "Giá gốc: 25.000"); a negative one is a discount.
  ['points', new RegExp(`^(?:${loose(['diem'])})(?= |$)|${label('tich luy', 'tich diem', 'so du', 'gia goc', 'gia dang ky', 'gia niem yet').source}`)],
  ['change', label('tra lai', 'thoi lai', 'tien thoi', 'tien thua', 'tra khach', 'change')],
  ['cash', label('khach dua', 'khach tra', 'khach da tra', 'khach thanh toan', 'khach hang thanh toan', 'da thanh toan', 'tien nhan', 'tien mat', 'ngan hang', 'cash')],
  ['discount', label('chiet khau', 'giam gia', 'khuyen mai', 'km', 'discount', 'voucher')], // often printed without a minus
  ['subtotal', SUBTOTAL],
  ['total', label('tong cong', 'tong tien', 'thanh toan', 'so tien', 'can tra', 'phai tra', 'thanh tien', 'cong tien', 'total', 'grand total', 'amount due')],
  // A bare "Tổng:", "Cộng:" or "g cộng :" (OCR cut "Tổn") at the start of the line; not "Công ty", "Cộng hòa".
  ['total', new RegExp(`^(?:[a-z]{1,2} )?(?:${loose(['tong', 'cong'])})(?= |$)(?! (?:ty|hoa)(?= |$))`)],
];

// One text line → its amounts, its words (accents dropped, amounts removed) and what kind of line it is.
// A line with 3 or more amounts is a column of values read sideways: none of them belongs to a label or an item.
function readLine(line) {
  const raw = blankCodes(line.normalize('NFC'));
  const amounts = [...raw.matchAll(MONEY)].map(([, sign, digits]) => Number(sign + digits.replace(/[.,]/g, '')));
  const name = raw.replace(MONEY, ' ').replace(/\s+/g, ' ').trim();
  const text = normalize(name).replace(/[^a-z0-9]+/g, ' ').trim();
  const kind = KINDS.find(([, test]) => test.test(text))?.[0] ?? 'other';
  const column = amounts.length >= 3;
  // An item line: a name and a price, and none of the labels above ("1 × 18.900" has no name).
  const item = kind === 'other' && !column && amounts.some((n) => n > 0) && /[a-z]{2}/.test(text);
  return { raw, amounts, name, text, kind, column, item };
}

const positive = (amounts) => amounts.filter((n) => n > 0);
const sum = (numbers) => numbers.reduce((total, n) => total + n, 0);
// The sums of the first 2, 3, … values.
const runningSums = (values) => values.slice(1).map((_, k) => sum(values.slice(0, k + 2)));
// A line holding only an amount ("115.100", "92.400 đ") that no item name owns.
const valueOnly = (row) => row?.kind === 'other' && !row.item && row.amounts.length === 1 && row.amounts[0] > 0 && /^(d|vnd|dong)?$/.test(row.text);
// What a line takes off the total: a discount line's amount (with or without its minus), else a negative amount.
const discountOf = (row) => (row.column ? 0 : row.kind === 'discount' ? -Math.abs(row.amounts.at(-1) ?? 0) : Math.min(0, ...row.amounts));

// What the receipt says was paid: { amount, estimated, checked?, items? }, or null when nothing usable is printed.
// A photo turned a little can come back with every value one line above its label ("115.100", "Tổng tiền 22.700",
// "Giảm giá 92.400", "Tổng cộng"). So when the last label has no value and the lines as printed give no cross-checked
// total, they are read again with each value moved one line down, and that reading counts only if it cross-checks.
export function pickTotal({ fields = {}, reconciliation = {}, lines = [], fullText = '' }) {
  const texts = (lines.length > 0 ? lines : String(fullText).split('\n')).map(String);
  const asPrinted = readTotal(texts, fields, reconciliation);
  const lastLabel = texts.map(readLine).findLast((row) => !['other', 'heading'].includes(row.kind));
  if (asPrinted?.checked || !lastLabel || /\d/.test(lastLabel.raw)) return asPrinted;
  const shifted = readTotal(valuesMovedDown(texts), fields, reconciliation);
  return shifted?.checked ? shifted : asPrinted;
}

// Each line's words with the amounts of the line above it (codes stay blanked, so a phone number never moves).
function valuesMovedDown(texts) {
  const blanked = texts.map((text) => blankCodes(text.normalize('NFC')));
  return [...blanked, ''].map((line, i) => `${line.replace(MONEY, ' ')} ${(blanked[i - 1]?.match(MONEY) ?? []).join(' ')}`.trim());
}

// One reading of the lines. In order: the amount in words, subtotal + VAT − discounts, cash − change (these three are
// cross-checked), a grand-total label (cross-checked when it is another less the discounts), the same sums without
// labels (sideways photos), KIE's total, else the sum of the item lines as an estimate (a torn receipt).
function readTotal(texts, fields, reconciliation) {
  const rows = texts.map(readLine);
  // A name on its own line, then "1 × 45.900 45.900" or the price alone (WinMart+, mcocr): the price line is that item.
  rows.forEach((row, i) => {
    const above = rows[i - 1];
    if (row.kind === 'other' && !row.item && !row.column && positive(row.amounts).length > 0 && above?.kind === 'other' && above.amounts.length === 0 && /[a-z]{2}/.test(above.text)) {
      Object.assign(row, { item: true, name: above.name });
    }
  });

  // A total printed without separators ("Tổng cộng 35000", "Số tiền: 2500000 đ") counts when KIE's total or the amount
  // in words is that number.
  const kieText = String(fields.total ?? '').trim().replace(/[.,]00$/, ''); // "92400.00"
  const kieTotal = /^[1-9]/.test(kieText) ? Number(kieText.replace(/\D/g, '')) : 0;
  const inWords = rows.flatMap((row) => {
    const match = IN_WORDS.exec(row.text);
    return match ? [wordsToNumber(row.text.slice(match.index + match[0].length))] : [];
  });
  for (const row of rows.filter((r) => r.kind === 'total' && r.amounts.length === 0)) {
    const confirmed = [...inWords, kieTotal].find((n) => n > 0 && written(n).test(row.raw));
    if (confirmed) row.amounts = [confirmed];
  }
  const printed = new Set(rows.flatMap((row) => positive(row.amounts)));
  const totals = new Set(rows.flatMap((row) => (row.item ? [] : positive(row.amounts)))); // not an item's price
  const found = (amount, checked = true) => ({ amount, estimated: false, checked });

  // 1. "Bằng chữ: …", when it agrees with a number printed on the receipt (OCR garbles words more often than digits).
  const agreed = inWords.find((n) => printed.has(n));
  if (agreed) return found(agreed);

  // 2. Subtotal + VAT − discounts = a printed total. The subtotal is the value on, above or below a "Tổng/Cộng tiền
  // hàng" line, because a photo read sideways can shift values one row off their labels. The discounts are tried as
  // the negative amounts alone and with the discount lines added (a shifted discount label sits next to another value).
  const vat = Math.max(0, ...rows.filter((row) => row.kind === 'vat' && !row.column).flatMap((row) => row.amounts));
  const negatives = sum(rows.filter((row) => row.kind !== 'discount').flatMap((row) => row.amounts.filter((n) => n < 0)));
  const discounts = [...new Set([negatives, negatives + sum(rows.filter((row) => row.kind === 'discount').map(discountOf))])];
  const totalsFrom = (subtotals) =>
    positive(subtotals)
      .filter((subtotal) => vat * 10 <= subtotal) // VAT is at most 10% in Vietnam
      .flatMap((subtotal) => discounts.filter((discount) => vat + discount !== 0).map((discount) => subtotal + vat + discount))
      .filter((total) => totals.has(total));
  const besideSubtotal = rows.flatMap((row, i) => (row.kind === 'subtotal' ? rows.slice(Math.max(0, i - 1), i + 2) : []));
  const checked = totalsFrom(besideSubtotal.filter((row) => !row.column).flatMap((row) => row.amounts));
  if (checked.length > 0) return found(Math.max(...checked));

  // 3. Cash handed over − change = the amount paid ("Thanh toán 50.000", "Tiền thừa 15.000" → 35.000). The change is on
  // its line, or beside a bare change label (values one row off). Of several, the one from the largest cash amount.
  const changes = rows.flatMap((row, i) => {
    if (row.kind !== 'change' || row.column) return [];
    if (/\d/.test(row.raw)) return positive(row.amounts).slice(-1);
    return [rows[i - 1], rows[i + 1]].filter((r) => r && !r.column && !r.item && r.amounts.length === 1 && r.amounts[0] > 0).map((r) => r.amounts[0]);
  });
  const cashAmounts = rows.flatMap((row) => (row.item || row.kind === 'points' ? [] : positive(row.amounts)));
  const paid = changes.flatMap((change) => cashAmounts.filter((cash) => cash - change !== change && printed.has(cash - change)).map((cash) => [cash, cash - change]));
  if (paid.length > 0) return found(paid.sort(([a], [b]) => b - a)[0][1]);

  // 4. The value of a grand-total label: on its line, else a line holding only that value just above or below it.
  // A lone price just above, taken as the last item's price, is the value when it adds up the item prices above it
  // (a photo read one row off: "Trà đào", "115.000", "Tổng:"). An amount-due label ("Khách cần trả") first. Of several
  // values, the one that is another less the discounts ("Tổng cộng 115.000", "Chiết khấu 23.000", "Thanh toán
  // 92.000"), else the largest.
  const addsUpAbove = (j) => {
    const prices = rows.slice(0, j).filter((row) => row.item).map((row) => positive(row.amounts).at(-1));
    return rows[j]?.item && valueOnly({ ...rows[j], item: false }) && prices.length >= 2 && sum(prices) === rows[j].amounts[0];
  };
  const valueOf = (row, i) => {
    if (/\d/.test(row.raw)) return positive(row.amounts).slice(-1); // "Tổng SL: 6" has no value beside it
    const beside = [rows[i - 1], rows[i + 1]].find(valueOnly) ?? (addsUpAbove(i - 1) ? rows[i - 1] : undefined);
    return beside ? beside.amounts : [];
  };
  const labelledBy = (labels) => rows.flatMap((row, i) => (row.kind === 'total' && !row.column && labels.test(row.text) ? valueOf(row, i) : []));
  const labelled = [DUE, /./].map(labelledBy).find((values) => values.length > 0);
  if (labelled) {
    const net = totalsFrom(labelled).filter((total) => labelled.includes(total));
    return net.length > 0 ? found(Math.max(...net)) : found(Math.max(...labelled), false);
  }

  // 5. No label next to its value (a sideways photo read as columns): any printed amount as the subtotal, but only
  // when the receipt has a subtotal label and exactly one total fits (on a torn receipt, a price minus an item
  // discount can equal another price).
  const fitting = new Set(rows.some((row) => SUBTOTAL.test(row.text)) ? totalsFrom([...totals]) : []);
  if (fitting.size === 1) return found([...fitting][0], false);

  // 6. A column read sideways with no discount: the value that is the sum of the values next to it, the item prices
  // ("115.100 17.400 32.900 45.900 18.900").
  const columnSums = rows
    .filter((row) => row.column)
    .flatMap((row) => {
      const values = positive(row.amounts);
      return values.filter((value, i) => [values.slice(i + 1), values.slice(0, i).reverse()].some((next) => runningSums(next).includes(value)));
    });
  if (columnSums.length > 0) return found(Math.max(...columnSums), false);

  // 7. KIE's total, if it is printed and is not just one item's price or a subtotal: KIE's items add up to it (then it
  // may be printed without separators, "116000" or "116 000"), or it stands on a line that is not an item.
  const itemsAddUp = reconciliation.is_math_consistent === true && rows.some((row) => written(kieTotal).test(row.raw));
  const onTotalLine = rows.some((row) => row.kind === 'other' && !row.item && !row.column && row.amounts.includes(kieTotal));
  if (kieTotal > 0 && (itemsAddUp || onTotalLine)) return found(kieTotal, false);

  // 8. No total left on the receipt: the item lines, less the discounts among them, flagged so the user checks it.
  const items = rows
    .filter((row) => row.item || discountOf(row) < 0)
    .map((row) => ({ name: row.name, amount: row.item ? positive(row.amounts).at(-1) : discountOf(row) }));
  const amount = sum(items.map((item) => item.amount));
  return rows.some((row) => row.item) && amount > 0 ? { amount, estimated: true, items } : null;
}

const DIGITS = new Map([['khong', 0], ['mot', 1], ['hai', 2], ['ba', 3], ['bon', 4], ['tu', 4], ['nam', 5], ['lam', 5], ['nham', 5], ['sau', 6], ['bay', 7], ['tam', 8], ['chin', 9]]);
// "triu": OCR drops the "ệ"; "tỉ" is another spelling of "tỷ".
const SCALES = new Map([['nghin', 1e3], ['ngan', 1e3], ['trieu', 1e6], ['triu', 1e6], ['ty', 1e9], ['ti', 1e9]]);

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

# Pure rules (no model, no I/O) for the payable total of a receipt (docs/02 §2.6): which of the copied money lines
# is the amount to pay, and whether a verbatim re-read shows that amount printed on the paper.
import datetime
import re
import unicodedata

MAX_MONEY = 10**13  # the app's ceiling (server/src/models/Transaction.js)


def fold(text):
    """Lower case without Vietnamese accents; the receipt short form "T.Toán" becomes "thanh toan"."""
    decomposed = unicodedata.normalize('NFD', str(text).lower().replace('đ', 'd'))
    plain = ''.join(ch for ch in decomposed if unicodedata.category(ch) != 'Mn')
    return re.sub(r'\bt\. ?(?=toan)', 'thanh ', plain)


def is_money(value):
    """A whole number of VND from 1 to 10^13."""
    return type(value) is int and 1 <= value <= MAX_MONEY


# The labels of the amount to pay, best group first.
PAYABLE = r'(can|phai) (thanh toan|tra\b)|khach can tra|tong( cong)?( tien)? thanh toan|amount (due|to pay|payable)|total payment'
GROUPS = [PAYABLE, r'\bso tien\b', r'tong cong|\btotal\b|tong tien(?! hang)|^\W*thanh toan']
# A printed goods subtotal ("Thanh toán tiền hàng đợt 2", the reason on a voucher, is not one).
GOODS_SUBTOTAL = r'(tong|cong) tien hang|cong hang|tam tinh|sub ?total|truoc thue|chua thue'
# Lines that are never the amount to pay (unless the label also matches PAYABLE).
NOT_THE_TOTAL = '|'.join([
    r'tien hang|' + GOODS_SUBTOTAL,                                            # goods subtotals
    r'\bvat\b|\bgtgt\b|tien thue|thue suat|\btax\b',                           # VAT
    r'giam|chiet khau|khuyen mai|uu dai|voucher|coupon|discount',              # discounts
    r'\bdiem\b|\bpoints?\b',                                                   # loyalty points
    r'khach dua|khach tra|tien mat|\bcash\b',                                  # cash handed over
    r'tra lai|thoi lai|tien thoi|tien thua|\bchange\b',                        # change
    r'so luong|tong sl\b|so mon|\bqty\b|quantity|total items?',                # counts, not money
])
VAT_INCLUDED = r'(da )?(bao )?gom (ca )?(thue )?(gtgt|vat)|(vat|tax) incl\w*|incl\w* (vat|tax)'  # a note, not a VAT line
# Lines that hold an identifier, a phone number or a date: their numbers are never money.
IDENTIFIER = (r'\b(mst|ma so thue|tax code|so (hd|hoa don|ct|gd|phieu|tk|tai khoan)|tai khoan|stk|sdt|dien thoai|dt:|'
              r'tel|hotline|phone|fax|ky hieu|mau so|ma (gd|don|kh|hd))(?!\w)|^\W*(so ?:|ngay\b|gio\b)')


def _is_identifier(label):
    return re.search(IDENTIFIER, fold(label)) is not None


def _is_not_the_total(label):
    return re.search(NOT_THE_TOTAL, re.sub(VAT_INCLUDED, ' ', fold(label))) is not None


def pick_total(lines):
    """The amount to pay among the copied {label, amount} lines, or None. The last line of the best group wins."""
    usable = [line for line in lines if is_money(line['amount']) and not _is_identifier(line['label'])]
    for pattern in GROUPS:
        hits = [line for line in usable if re.search(pattern, fold(line['label']))
                and (pattern == PAYABLE or not _is_not_the_total(line['label']))]
        if hits:
            # "Số tiền bằng chữ" carries the model's own conversion of the words: only used when nothing else matches.
            figures = [line for line in hits if 'bang chu' not in fold(line['label'])]
            return (figures or hits)[-1]['amount']
    return None


def choose_total(direct_total, lines):
    """The picked line's amount, else the direct read's total unless the paper shows it only as something else."""
    picked = pick_total(lines)
    if picked:
        return picked
    labels = [line['label'] for line in lines if line['amount'] == direct_total]
    only_something_else = labels and all(_is_identifier(label) or _is_not_the_total(label) for label in labels)
    return direct_total if is_money(direct_total) and not only_something_else else None


# Parts of a line that hold digits but no money.
NOT_MONEY = [
    r'(?<![\d.,])\d{1,2} ?[/.-] ?\d{1,2} ?[/.-] ?(\d{4}|\d{2})(?![\d.,]?\d)|\d{4}-\d{1,2}-\d{1,2}',  # dates
    r'(?<![\d.,])\d{1,2}/\d{4}|\d{1,2}:\d{2}(:\d{2})?|(ngay|thang|nam) *\d{1,4}',  # month/year, time, "năm 2026"
    r'[a-z]+[-_./]?\d[\w./-]*',  # codes that start with letters: HD004829, PT-09/2023, 1C26TTV
]


def _money_in(text):
    """The money-shaped numbers of one printed line."""
    rest = re.sub(r'vnd|(?<![a-z])x(?= ?\d)', ' ', fold(text))  # "VND45,000", "x18.900"
    for pattern in NOT_MONEY:
        rest = re.sub(pattern, ' ', rest)
    for number in re.findall(r'(?<![\d.,])(\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]00)?(?![.,]?\d)', rest):
        digits = re.sub(r'\D', '', number)
        grouped = digits != number
        # A leading zero is a code or a phone number; so is a long bare number; a bare 2026 is a year.
        if digits.startswith('0') or (not grouped and (len(digits) > 8 or 1900 <= int(digits) <= 2100)):
            continue
        if is_money(int(digits)):
            yield int(digits)


def _printed(text_lines):
    """(amount, label) for the money of a verbatim re-read; a number on its own line takes the text line above it."""
    above = ''
    for text in text_lines:
        has_words = re.search(r'[a-z]{2}', re.sub(r'vnd|dong', ' ', fold(text)))
        if has_words:
            above = text
        if not _is_identifier(text):
            for amount in _money_in(text):
                yield amount, text if has_words else above


def printed_amounts(text_lines):
    """The money-shaped numbers in a verbatim re-read of the receipt."""
    return {amount for amount, _ in _printed(text_lines)}


def goods_subtotal_only(amount, text_lines):
    """Whether the re-read shows the amount, and only as the goods subtotal (the total below it is torn off)."""
    labels = [fold(label) for printed, label in _printed(text_lines) if printed == amount]
    return bool(labels) and all(re.search(GOODS_SUBTOTAL, label) for label in labels)


def receipt_date(text):
    """The date the model read, as dd/mm/yyyy; "" when it is not a real date."""
    text = fold(text or '')
    if m := re.search(r'(\d{4})-(\d{1,2})-(\d{1,2})', text):
        year, month, day = m.groups()
    elif m := re.search(r'(?<!\d)(\d{1,2}) ?(?:[/.-]|thang) ?(\d{1,2}) ?(?:[/.-]|nam) ?(\d{4}|\d{2})(?!\d)', text):
        day, month, year = m.groups()
    else:
        return ''
    year = int(year) + (2000 if len(year) == 2 else 0)
    try:
        date = datetime.date(year, int(month), int(day))
    except ValueError:
        return ''
    return date.strftime('%d/%m/%Y') if 2000 <= date.year <= 2100 else ''

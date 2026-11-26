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


# The labels of the amount to pay. Best of all, and nothing printed below such a line changes it.
PAYABLE = (r'(can|phai) (thanh toan|tra\b)|khach can tra|tong( cong)?( so)?( tien)? thanh toan|'
           r'amount (due|to pay|payable)|total payment')
# A voucher's "Số tiền": that and nothing else ("Số tiền đặt cọc" is something else). Matched on the words alone.
VOUCHER_AMOUNT = (r'(da (nhan|thu|nop) du )?so tien( (bang so|(viet )?bang chu\b.*|thanh toan|thu|chi|nop|giao dich|'
                  r'chuyen( khoan)?))?( (amount|vnd|dong))*')
TOTAL = r'tong cong|\btotal\b|tong (so )?tien(?! hang)|^\W*thanh toan'
# A label that is only "the total". One that says more ("Tổng tiền đã thu") may be anything: it ranks last.
BARE_TOTAL = r'(tong( cong| so)?( tien)?|total( amount)?|thanh toan|cong)( (vnd|dong|d))?'
# "Tổng cộng sau VAT", "Total after discount", "Tổng đã trừ voucher": the total that holds what is named after "sau". The
# words before it must name a total ("Giá sau giảm" and "Thành tiền sau thuế" can belong to one item).
AFTER = (r'\b(sau|after|less|da (tru|khau tru))\b(?=.*\b(thue|vat|gtgt|tax|giam|chiet khau|ck|khuyen mai|km|uu dai|voucher|coupon|discounts?|'
         r'diem|points?)\b)')
AFTER_TOTAL = r'\btong\b|total|thanh toan|^\W*(so )?tien\W*$|^\W*cong\W*$'

# Never the amount to pay, whatever else the label says: "Tiền phải trả lại" is change, not an amount to pay.
CHANGE = (r'tra lai|thoi lai|tien (phai )?thoi|tien (thua|du|le)\b|doi lai|hoan (lai|tien|tra)|\btra (cho )?khach|'
          r'(pay|give) back|\bchange\b|\b(return|refund)\b')
RECEIVED = (r'(khach (hang )?|\bkh )(dua|gui|tra\b)|tien (khach |kh )?(da )?(dua|nhan)\b(?! du)|tien (khach )?gui(?! xe)|'
            r'nhan (cua|tu) khach|nhan duoc|^\W*da nhan\b(?! du)|\breceived\b|tendered|customer (paid|gave)')
# ("Đã nhận đủ số tiền" stays a voucher line)
SAVINGS = r'tiet kiem|\bsav(e|ed|ings?)\b'
DEBT = r'cong no\b|\b(con|tong|tien) no\b|\bno cu\b|\bdu no\b|\bso du\b'
BEFORE = (r'\b(chua|khong)( bao)?( gom| co)?( \d{1,2} ?%)? (thue|vat|gtgt)\b|'
          r'truoc (khi )?(thue|vat|gtgt|giam|chiet khau|ck\b|khuyen mai)|'
          r'\b(excl\w*\.?|before|not incl\w*)( of)? (vat|tax|discount)|(vat|tax) excl')
NEVER = '|'.join([CHANGE, RECEIVED, SAVINGS, DEBT, BEFORE])

# A printed goods subtotal ("Thanh toán tiền hàng đợt 2", the reason on a voucher, is not one).
GOODS_SUBTOTAL = r'(tong|cong) tien hang|cong hang|tam tinh|sub ?total|truoc thue|chua thue'
# Also not the amount to pay, unless the label is PAYABLE.
NOT_THE_TOTAL = '|'.join([
    r'tien hang|' + GOODS_SUBTOTAL,                                            # goods subtotals
    r'\bvat\b|\bgtgt\b|tien thue|tong( cong)? thue|thue suat|\btax\b',         # VAT
    r'giam|chiet khau|khuyen mai|uu dai|voucher|coupon|discount',              # discounts
    r'\bdiem\b|\bpoints?\b',                                                   # loyalty points
    r'tien mat|\bcash\b',                                                      # cash
    r'so luong|tong sl\b|so mon|\bqty\b|quantity|total items?',                # counts, not money
])
# "(đã bao gồm VAT)", "(giá đã có VAT)", "(gồm 8% VAT)", "(incl. VAT)", "VAT included": a note on a total.
_THE_TAX = r'(\d{1,2} ?% )?(thue )?(\d{1,2} ?% )?(gtgt|vat|tax|thue)\b( \d{1,2} ?%)?'
VAT_INCLUDED = (r'\b((da )?(bao )?gom( ca)?|da co|co|incl(uding|uded|usive of)?\b\.?|inc\b\.?) ?' + _THE_TAX +
                r'|\b(vat|tax|thue( gtgt)?)( \d{1,2} ?%)? (incl(uded|usive)?\b\.?|inc\b\.?|da (bao )?gom)')
TOTAL_WORD = r'total|\btong\b|\bcong\b|thanh toan|thanh tien|so tien'

WEAK = 3  # the rank of a label that says more than "total"

# What a line below the picked figure can do to it.
DISCOUNT = r'giam|chiet khau|\bck\b|khuyen mai|uu dai|voucher|coupon|discount'
POINTS = r'\bdiem\b|\bpoints?\b'
POINTS_SPENT = r'(tru|doi|dung|tieu) diem|diem (da )?(su )?(dung|tru|doi|tieu)|redeem'
DISCOUNT_SUM = r'tong( so)?( tien)?( da| duoc)? (giam|chiet khau)|da giam|total discount'  # a summary, already taken off
VAT = r'\b(vat|gtgt|thue|tax)\b'
# A VAT line that adds nothing: the VAT is inside the figure, or the line is the base the VAT is worked out on.
VAT_NOT_ADDED = r'trong do|\bgom\b|da co|\bincl|\binc\b|tien hang|chiu thue|taxable|truoc|before|chua|excl'
PAID = (r'(khach (hang )?|\bkh )(dua|gui|tra\b|thanh toan)|tien (khach |kh )?(dua|nhan)|da nhan|tien mat|chuyen khoan|'
        r'\bck\b|\bthe\b|momo|zalo ?pay|vnpay|\bqr\b|\bcash\b|\bcard\b|tendered|received|customer paid')

# Lines that hold an identifier, a phone number or a date: their numbers are never money.
IDENTIFIER = (r'\b(mst|ma so thue|tax code|so (hd|hoa don|ct|gd|phieu|tk|tai khoan)|tai khoan|stk|sdt|dien thoai|dt:|'
              r'tel|hotline|phone|fax|ky hieu|mau so|ma (gd|don|kh|hd))(?!\w)|^\W*(so ?:|ngay\b|gio\b)')


def _is_identifier(label):
    return re.search(IDENTIFIER, fold(label)) is not None


def _is_not_the_total(label):
    text = fold(label)
    if re.search(NEVER, text):  # on the whole label: "chưa bao gồm VAT" must not lose its "VAT" to the note below
        return True
    without_note = re.sub(VAT_INCLUDED, ' ', text)
    if re.search(TOTAL_WORD, without_note):  # "VAT included" on its own stays a VAT line
        text = without_note
    return re.search(NOT_THE_TOTAL, text) is not None


def _words(text, note=''):
    """The words of a folded label, without what is in brackets (and the note, if given)."""
    return ' '.join(re.findall(r'[a-z]+', re.sub(r'\([^)]*\)?', ' ', re.sub(note, ' ', text) if note else text)))


def _rank(label):
    """How surely a label names the amount to pay: 0 an amount to pay or a total after VAT or a discount, 1 a voucher's
    "Số tiền", 2 a total, 3 a label with "tổng" or "total" and more words. None: it names something else."""
    text = fold(label)
    if re.search(NEVER, text):
        return None
    if re.search(PAYABLE, text):
        return 0
    if after := re.search(AFTER, text):
        head = text[:after.start()]
        return 0 if re.search(AFTER_TOTAL, head) and not _is_not_the_total(head) else None
    if _is_not_the_total(text):
        return None
    if re.fullmatch(VOUCHER_AMOUNT, _words(text)):
        return 1
    if not re.search(TOTAL, text):
        return None
    return 2 if re.fullmatch(BARE_TOTAL, _words(text, VAT_INCLUDED)) else WEAK


def _amounts(lines, pattern):
    """The amounts, without their sign, of the lines whose label matches."""
    return {abs(line['amount']) for line in lines if re.search(pattern, fold(line['label']))} - {0}


def _handed_over(lines):
    """Positions of the lines that are the cash handed over, whatever they say ("Thanh toán", "Khách nộp"): less the
    printed change, they give a printed total."""
    change = _amounts(lines, CHANGE)
    totals = _amounts(lines, TOTAL + '|thanh tien')
    paid = _amounts(lines, PAID)
    return {at for at, line in enumerate(lines)
            if not re.search(PAYABLE, fold(line['label'])) and any(line['amount'] - c in totals for c in change)
            and not any(cash - c == line['amount'] for cash in paid for c in change)}


def _candidates(lines):
    """{position: rank} of the lines that may be the amount to pay."""
    handed_over = _handed_over(lines)
    ranks = {at: _rank(line['label']) for at, line in enumerate(lines)
             if at not in handed_over and is_money(line['amount']) and not _is_identifier(line['label'])}
    return {at: rank for at, rank in ranks.items() if rank is not None}


def _in_words(line):
    """"Số tiền bằng chữ" carries the model's own conversion of the words."""
    return 'bang chu' in fold(line['label'])


def _best(candidates, lines):
    """The position of the last line of the best rank, or None. An amount in words only when nothing else matches."""
    if not candidates:
        return None
    hits = [at for at, rank in candidates.items() if rank == min(candidates.values())]
    return ([at for at in hits if not _in_words(lines[at])] or hits)[-1]


def _holds_it(other, at, lines):
    """Whether lines[at] is lines[other] plus the VAT, less the discounts, printed between them: it is that figure's
    total after them, not a rival."""
    return other < at and lines[other]['amount'] + sum({_adjustment(line) for line in lines[other + 1:at]}) == lines[at]['amount']


def _names_another_total(direct_total, at, candidates, lines):
    """Whether the direct read's total is printed on another line that may be a total as much as lines[at]: a line of
    the same or a better rank, or, when the pick's own label is a weak one, any line not known as something else. Not a
    figure that the pick only adds its VAT and discounts to."""
    return any(line['amount'] == direct_total and not _in_words(line) and other != at and not _holds_it(other, at, lines)
               and (candidates[other] <= candidates[at] if other in candidates
                    else candidates[at] == WEAK and not _is_something_else(line['label']))
               for other, line in enumerate(lines))


def _adjustment(line):
    """What a line does to a figure above it: VAT adds its amount, a discount or spent points take it off, else 0."""
    text, amount = fold(line['label']), abs(line['amount'])
    after = re.search(AFTER, text)
    if (amount < 100  # a rate ("Thuế suất 8%" copied as 8), never a VAT or a discount in VND
            or _is_identifier(line['label']) or _rank(line['label']) is not None
            or (after and re.search(TOTAL_WORD, text[:after.start()]))  # "Thành tiền sau thuế" is a figure, too
            or re.search('|'.join([CHANGE, RECEIVED, SAVINGS, DEBT, DISCOUNT_SUM]), text)):
        return 0
    if re.search(DISCOUNT + '|' + POINTS_SPENT, text) or (line['amount'] < 0 and re.search(POINTS, text)):
        return -amount
    return amount if re.search(VAT, text) and not re.search(VAT_NOT_ADDED, text) else 0


def _changed_below(at, lines):
    """Whether VAT or discount lines below lines[at] change its figure: None if not, else the amount they add to it.
    They leave it alone when the paper shows it already holds them: another figure plus VAT less discounts gives it,
    or it is what was paid."""
    total, label, below = lines[at]['amount'], fold(lines[at]['label']), lines[at + 1:]
    # ponytail: an "amount to pay" label is trusted as it stands; check the lines below it too if one ever proves early.
    if re.search(PAYABLE, label):
        return None
    adjustments = {_adjustment(line) for line in below} - {0}  # a set: "Thuế suất" and "Tiền thuế" print one VAT twice
    if re.search(VAT_INCLUDED + r'|\b(sau|after)\b.*\b(thue|vat|gtgt|tax)\b', label):
        adjustments = {amount for amount in adjustments if amount < 0}
    if added := sum(adjustments):
        elsewhere = [line for line in lines
                     if not re.search('|'.join([PAID, CHANGE, RECEIVED, SAVINGS, DEBT]), fold(line['label']))]
        change = max(_amounts(lines, CHANGE), default=0)
        adds_up = any(line['amount'] + added == total for line in elsewhere)
        if not adds_up and total not in {cash - change for cash in _amounts(lines, PAID)}:
            return added
    # "Tổng giảm giá" repeats what the total already holds, unless the figure it leaves is printed below.
    for cut in _amounts(below, DISCOUNT_SUM):
        if any(line['amount'] == total - cut for line in below):
            return -cut
    return None


def is_foot_line(name):
    """Whether an "item" name is a line of the receipt's foot: a total, the cash handed over or the change."""
    return _rank(name) is not None or re.search('|'.join([CHANGE, RECEIVED, r'tien mat|\bcash\b']), fold(name)) is not None


def _is_something_else(label):
    """Whether the label names something that is not a total: an identifier, a subtotal, VAT, cash, change, savings…"""
    return _is_identifier(label) or (_rank(label) is None and _is_not_the_total(label))


def pick_total(lines):
    """The amount to pay among the copied {label, amount} lines, or None. The last line of the best rank wins, unless
    a VAT or discount line below it changes it."""
    at = _best(_candidates(lines), lines)
    return None if at is None or _changed_below(at, lines) is not None else lines[at]['amount']


def choose_total(direct_total, lines):
    """The amount to pay from both reads, or None when they do not settle it."""
    candidates = _candidates(lines)
    at = _best(candidates, lines)
    if at is not None:
        total = lines[at]['amount']
        if direct_total != total and _names_another_total(direct_total, at, candidates, lines):
            return None  # each read names another total line, and neither label is the better one
        added = _changed_below(at, lines)
        if added is None:
            return total
        return direct_total if direct_total == total + added else None  # subtotal + VAT - discounts confirms it
    # No line is picked: the direct total, unless the paper shows it only as something else, or as a figure that changes.
    shown = [at for at, line in enumerate(lines) if line['amount'] == direct_total]
    handed_over = _handed_over(lines)
    as_total = [at for at in shown if at not in handed_over and not _is_something_else(lines[at]['label'])]
    if (shown and not as_total) or (as_total and _changed_below(as_total[-1], lines) is not None):
        return None
    return direct_total if is_money(direct_total) else None


# Parts of a line that hold digits but no money.
NOT_MONEY = [
    r'(?<![\d.,])\d{1,2} ?[/.-] ?\d{1,2} ?[/.-] ?(\d{4}|\d{2})(?![\d.,]?\d)|\d{4}-\d{1,2}-\d{1,2}',  # dates
    r'(?<![\d.,])\d{1,2}/\d{4}|\d{1,2}:\d{2}(:\d{2})?',  # month/year, time
    r'\b(ngay|thang|nam)\b *\d{1,4}(?![.,]?\d)',  # "năm 2026", not the "Nam" of "Việt Nam 45.000"
    r'[a-z]+[-_./]?\d[\w./-]*',  # codes that start with letters: HD004829, PT-09/2023, 1C26TTV
]


def _money_in(text):
    """The money-shaped numbers of one printed line."""
    rest = re.sub(r'vnd|(?<![a-z])x(?= ?\d)', ' ', fold(text))  # "VND45,000", "x18.900"
    rest = re.sub(r'(?<=[a-z]{2})\.(?=\d{1,3}[.,]\d{3}(?!\d))', ' ', rest)  # "Tổng.45.000" is not a code
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

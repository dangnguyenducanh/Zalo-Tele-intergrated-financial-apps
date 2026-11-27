# Pure rules (no model, no I/O) for the payable total of a receipt (docs/02 §2.6): a total is shown only when the direct read
# and the line copy agree on it and nothing disputes it; and whether a verbatim re-read shows that amount printed on the paper.
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
          r'(pay|give) back|\bchange\b|\b(return|refund)\b|^\W*(thua|thoi|du)\W*$')  # the last: "Thừa" alone
RECEIVED = (r'(khach (hang )?|\bkh )(dua|gui|tra\b)|tien (khach |kh )?(da )?(dua|nhan)\b(?! du)|tien (khach )?gui(?! xe)|'
            r'nhan (cua|tu) khach|nhan duoc|^\W*da nhan\b(?! du)|\breceived\b|tendered|customer (paid|gave)')
# ("Đã nhận đủ số tiền" stays a voucher line)
SAVINGS = r'tiet kiem|\bsav(e|ed|ings?)\b'
DEBT = r'cong no\b|\b(con|tong|tien) no\b|\bno cu\b|\bdu no\b|\bso du\b'
BEFORE = (r'\b(chua|khong)( bao)?( gom| co)?( \d{1,2} ?%)? (thue|vat|gtgt)\b|'
          r'truoc (khi )?(thue|vat|gtgt|giam|chiet khau|ck\b|khuyen mai)|'
          r'\b(excl\w*\.?|before|not incl\w*)( of)? (vat|tax|discount)|(vat|tax) excl')
FOREIGN = r'\b(usd|eur|jpy|cny|krw|sgd|aud)\b|\$'  # another currency, not VND
NEVER = '|'.join([CHANGE, RECEIVED, SAVINGS, DEBT, BEFORE, FOREIGN])

# A printed goods subtotal ("Thanh toán tiền hàng đợt 2", the reason on a voucher, is not one).
GOODS_SUBTOTAL = r'(tong|cong) tien hang|cong hang|tam tinh|sub ?total|truoc thue|chua thue'
COUNTS = r'so luong|tong sl\b|so mon|\bqty\b|quantity|total items?'
# Also not the amount to pay, unless the label is PAYABLE.
NOT_THE_TOTAL = '|'.join([
    r'tien hang|' + GOODS_SUBTOTAL,                                            # goods subtotals
    r'\bvat\b|\bgtgt\b|tien thue|tong( cong)? thue|thue suat|\btax\b',         # VAT
    r'giam|chiet khau|khuyen mai|uu dai|voucher|coupon|discount',              # discounts
    r'\bdiem\b|\bpoints?\b',                                                   # loyalty points
    r'tien mat|\bcash\b',                                                      # cash
    COUNTS,                                                                    # counts, not money
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

BEFORE_VAT = '|'.join([GOODS_SUBTOTAL, BEFORE, r'chiu thue|taxable|truoc'])

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


def _in_words(line):
    """"Số tiền bằng chữ" carries the model's own conversion of the words."""
    return 'bang chu' in fold(line['label'])


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
        before = [line for line in lines if re.search(BEFORE_VAT, fold(line['label']))]  # the figure the VAT is added to
        change = max(_amounts(lines, CHANGE), default=0)
        adds_up = any(line['amount'] + added == total for line in before)
        if not adds_up and total not in {cash - change for cash in _amounts(lines, PAID)}:
            return added
    # "Tổng giảm giá" repeats what the total already holds, unless the figure it leaves is printed below.
    for cut in _amounts(below, DISCOUNT_SUM):
        if any(line['amount'] == total - cut for line in below):
            return -cut
    return None


def is_foot_line(name):
    """Whether an "item" name is a line of the receipt's foot: a total, the cash handed over or the change. A name that
    only has "total" somewhere in it is a product ("Kem đánh răng Colgate Total")."""
    rank = _rank(name)
    if rank == WEAK and not re.match(r'\W*(tong|total)\b', fold(name)):
        rank = None
    return rank is not None or re.search('|'.join([CHANGE, RECEIVED, r'tien mat|\bcash\b']), fold(name)) is not None


CASH_LIKE = '|'.join([CHANGE, RECEIVED, r'tien mat|\bcash\b'])  # cash handed over, change, cash received


def _shown(reread):
    """{amount: [its printed label, ...]} for the money of a verbatim re-read."""
    printed = {}
    for amount, label in _printed(reread):
        printed.setdefault(amount, []).append(label)
    return printed


def _only_cash(amount, printed):
    """Whether the re-read prints the amount only as cash handed over or change."""
    labels = printed.get(abs(amount), []) if isinstance(amount, int) else []
    return bool(labels) and all(re.search(CASH_LIKE, fold(label)) for label in labels)


def _relabelled(lines, printed, direct_total):
    """The copied lines, where the label the model gave is a guess that the verbatim re-read can correct. It can take a total
    away: an amount the re-read prints only as cash handed over or change takes that printed label (on a short receipt the
    model echoed the words of its prompt and put the cash on "amount to pay"). It lends a total label only to a label that
    names nothing (the copy misread "cần" as "chờ"), on the direct read's amount, when the re-read prints that amount only next
    to total labels and no copied line calls it cash."""
    cash = {line['amount'] for line in lines if re.search(CASH_LIKE + '|' + PAYMENT, fold(line['label']))}

    def label(line):
        shown = printed.get(abs(line['amount']), []) if isinstance(line['amount'], int) else []
        if _only_cash(line['amount'], printed):
            return shown[0]
        names_nothing = _rank(line['label']) is None and not _is_not_the_total(line['label']) and not _is_identifier(line['label'])
        if line['amount'] == direct_total and names_nothing and line['amount'] not in cash and shown \
                and all(_rank(text) is not None for text in shown):
            return shown[0]
        return line['label']
    return [{**line, 'label': label(line)} for line in lines]


def _has_words(text):
    return re.search(r'[a-z]{2}', re.sub(r'vnd|dong', ' ', fold(text))) is not None


def _paired(lines):
    """The copied lines, where a number copied on its own line (a label with no words) takes the label of the label-only line
    right above it, but only if that is a lone label: labels listed in a block before their numbers pair nothing."""
    paired, above, before, above_label = [], '', '', ''  # the kinds of the last two lines with words or money
    for line in lines:
        words, money = _has_words(line['label']), bool(line['amount'])
        if words or money:
            lone = above == 'label' and before != 'label'
            paired.append({**line, 'label': above_label} if money and not words and lone else line)
            above, before, above_label = ('full' if words and money else 'label' if words else 'number'), above, line['label']
        else:
            paired.append(line)
    return paired


def _totals(lines):
    """{position: rank} of the money lines whose label names a total or an amount to pay (never the model's own conversion
    of an amount in words)."""
    return {at: rank for at, line in enumerate(lines)
            if is_money(line['amount']) and not _is_identifier(line['label']) and not _in_words(line)
            and (rank := _rank(line['label'])) is not None}


def _explained(other, at, lines):
    """Whether the difference between lines[at] and the smaller lines[other] is the sum of some of the lines printed between
    them (a service charge, a delivery fee, a surcharge, a rounding)."""
    gap, sums = lines[at]['amount'] - lines[other]['amount'], {0}
    between = [line['amount'] for line in lines[other + 1:at] if is_money(line['amount'])]
    for amount in between[:20]:  # ponytail: only the first 20 lines between are tried; more is "not explained" (blank, never wrong)
        sums |= {total + amount for total in sums if total + amount <= gap}
    return gap in sums


def _echoes(totals, lines):
    """Positions of the total lines that only repeat the cash handed over: the amount is also printed on a cash line, and a
    smaller total line of the same rank is not explained by the lines printed between them (a smaller one printed below it
    never is)."""
    cash = {line['amount'] for line in lines if re.search(RECEIVED + r'|tien mat|\bcash\b', fold(line['label']))}
    return {at for at, rank in totals.items()
            if lines[at]['amount'] in cash and any(
                totals[other] == rank and lines[other]['amount'] < lines[at]['amount']
                and not (other < at and _explained(other, at, lines)) for other in totals)}


# Money lines that can follow the amount to pay without changing it: the change, savings, a debt, another currency, a count;
# a VAT, discount or points line is _changed_below's call; cash, card or transfer only when it pays the figure in full
# (a smaller one may be a part payment or a card fee).
LEAVES_ALONE = '|'.join([CHANGE, SAVINGS, DEBT, FOREIGN, COUNTS, DISCOUNT, POINTS, POINTS_SPENT, DISCOUNT_SUM, VAT])
PAYMENT = '|'.join([RECEIVED, PAID, r'tien mat|\bcash\b'])
SMALLEST_FEE = 1000  # VND: a smaller number below a total is a rate or a count, never money to pay
FEE = (r'\bphi\b|phu thu|\bfee\b|\bcharge|\bservice|delivery|\bship(ping|per)?\b|giao hang|van chuyen|dong goi|packag|'
       r'lam tron|\bround|\btip\b|\bboa\b')  # a fee, a surcharge, a delivery or a rounding: money added to the figure


def _leaves_alone(line, total):
    """Whether a money line printed below a figure is known not to change it."""
    text = fold(line['label'])
    return (re.search(LEAVES_ALONE, text) is not None or _is_identifier(line['label']) or _in_words(line)
            or (re.search(PAYMENT, text) is not None and abs(line['amount']) >= total))


def _may_change(at, totals, lines, same):
    """Whether something printed below lines[at] may change its figure: a VAT or discount line that does (_changed_below),
    or a money line that is not known to leave it alone, such as a fee, a surcharge or a rounding. `same` are the amounts
    that are no change to it: the figure itself and the cash it was paid with."""
    if _changed_below(at, lines) is not None:
        return True
    return any(abs(line['amount']) >= SMALLEST_FEE and other not in totals and not _leaves_alone(line, lines[at]['amount'])
               and not (line['amount'] in same and not re.search(FEE, fold(line['label'])))  # a repeat of the figure or its cash
               for other, line in enumerate(lines) if other > at)


NOT_CASH = '|'.join([GOODS_SUBTOTAL, VAT, DISCOUNT, POINTS, COUNTS, SAVINGS, DEBT, CHANGE])  # figures that are no cash handed over


def _cash_is_printed(at, copy, change):
    """With a change printed, the figure needs its cash (figure + change) printed too: without it the figure is most likely
    that cash itself. The cash is a line that says cash or payment, or one printed after the figure (a line before it whose
    label names nothing can be a subtotal that happens to fit). The cash and the change can only take a candidate away;
    they never pick one."""
    total = copy[at]['amount']
    return not change or any(
        total + c == line['amount'] and not _is_identifier(line['label']) and not re.search(NOT_CASH, fold(line['label']))
        and (other > at or re.search(PAYMENT + '|' + CASH_LIKE, fold(line['label'])) or _rank(line['label']) is not None)
        for c in change for other, line in enumerate(copy))


def _moves(line):
    """What a line does to a figure it follows: a fee, a surcharge or VAT adds its amount, a discount or spent points take it off."""
    if re.search(FEE, fold(line['label'])) and is_money(line['amount']) and _rank(line['label']) is None:
        return line['amount']
    return _adjustment(line)


def _held(at, totals, lines):
    """Whether another total line, as well labelled or better, is this figure plus the fees, VAT and discounts printed anywhere
    on the receipt: this one is then the figure before them, wherever the copy lists the lines."""
    moves = [move for other, line in enumerate(lines) if other not in totals and (move := _moves(line))]
    sums = {0}
    for move in moves[:12]:  # ponytail: only the first 12 fee, VAT and discount lines are tried
        sums |= {total + move for total in sums}
    return any(lines[other]['amount'] - lines[at]['amount'] in sums for other, rank in totals.items()
               if other != at and rank <= totals[at] and lines[other]['amount'] != lines[at]['amount'])


def _undisputed(at, totals, lines, copy):
    """Whether nothing in the copy or the paper argues against lines[at] being the amount to pay: no other total line
    of another amount below it or better labelled than it, nothing below it that may change it, and the cash is no echo.
    `lines` are the copied lines as the re-read relabels them (it can only take a line away: a relabelled cash is no total);
    `copy` are the copied lines with their own labels, which say what the change is."""
    total, echoes, change = lines[at]['amount'], _echoes(totals, lines), _amounts(copy, CHANGE)
    if at in echoes or not _cash_is_printed(at, copy, change) or _held(at, totals, lines):
        return False
    same = {total} | {total + c for c in change}  # the figure, and the cash it was paid with
    if any(lines[other]['amount'] not in same and other not in echoes and (other > at or rank < totals[at])
           for other, rank in totals.items()):
        return False
    return not _may_change(at, totals, lines, same)


def choose_total(direct_total, lines, reread=()):
    """The amount to pay, or None. It is shown only when the direct read and the line copy agree: a copied line whose label
    names a total holds the direct read's amount, nothing in the copy disputes it, and nothing printed below it changes it.
    A receipt in doubt gives None: the owner types the amount. `reread` is the verbatim re-read: an amount it prints only
    next to cash or change words is cash, whatever label the copy gave it."""
    if not is_money(direct_total):
        return None
    copy = _paired(lines)
    lines = _relabelled(copy, _shown(reread), direct_total)
    totals = _totals(lines)
    holders = [at for at in totals if lines[at]['amount'] == direct_total]
    return direct_total if holders and _undisputed(holders[-1], totals, lines, copy) else None


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
    """(amount, label) for the money of a verbatim re-read. A number on its own line takes the label line right above it
    only if that line is a lone label: a block of labels followed by a block of numbers (or labels and numbers mixed) pairs
    nothing, so its numbers have the label "" (the order of the model's lines says nothing then)."""
    above = before = ''  # the last two lines that show words or money, as 'label', 'number' or 'full' (words and money)
    above_text = ''
    for text in text_lines:
        words = re.search(r'[a-z]{2}', re.sub(r'vnd|dong', ' ', fold(text))) is not None
        money = [] if _is_identifier(text) else list(_money_in(text))
        if not words and not money:
            continue
        kind = 'full' if words and money else 'label' if words else 'number'
        for amount in money:
            yield amount, text if words else above_text if above == 'label' and before != 'label' else ''
        above, before, above_text = kind, above, text


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

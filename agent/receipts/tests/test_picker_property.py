# Property test of the picker: random receipts built from cash, change, surcharge, VAT, discount and torn layouts, read
# with a perfect copy and a perfect re-read (the worst case for "an amount that is really printed"), and with every kind
# of wrong direct read. The rule under test (docs/02 §2.6, rules/bug-prevention §2): a wrong amount is a bug, an empty
# total is acceptable, because the user types it. So the picker answers the right total or none, never another amount.
import random

import pytest

from picker import choose_total

TOTALS = ['Tổng cộng', 'Tổng tiền', 'Total', 'TỔNG CỘNG', 'Tổng thanh toán', 'Cần thanh toán', 'Khách cần trả', 'Tổng cộng tiền thanh toán',
          'Amount due', 'Total payment', 'Phải thanh toán', 'Tiền cần thanh toán']
UNRANKED_TOTALS = ['Phải thu', 'Thực thu', 'Tổng bill', 'Thu khách', 'Tổng hóa đơn', 'Thành tiền', 'Cộng thanh toán', 'Tổng giá trị',
                   'Tổng giá trị đơn hàng', 'Tổng đơn hàng']
SUBTOTALS = ['Cộng tiền hàng', 'Tổng tiền hàng', 'Tạm tính', 'Subtotal', 'Giá trị hàng hóa', 'Giá trị đơn', 'Tổng hàng', 'Tiền hàng']
FEES = ['Phí giao hàng', 'Phí phục vụ 5%', 'Phụ thu', 'Phí đóng gói', 'Làm tròn', 'Phí vận chuyển', 'Thuế GTGT 10%', 'VAT 10%',
        'Service charge', 'Ship', 'Phụ thu lễ', 'Phí dịch vụ']
DISCOUNTS = ['Giảm giá', 'Chiết khấu', 'Voucher', 'Khuyến mãi', 'Discount', 'Giảm giá thành viên']
CASH_KNOWN = ['Tiền khách đưa', 'Khách đưa', 'Tiền mặt', 'Cash', 'Khách trả', 'Tiền KH đưa']
CASH_OTHER = ['Thanh toán', 'Đã thanh toán', 'Tiền nộp', 'Khách nộp', 'Đã trả', 'Nhận', 'Thu tiền', 'Payment', 'Paid', 'Đưa',
              'Số tiền thanh toán', 'Tổng thanh toán', 'Thanh toán tiền mặt']
CARDS = ['Thanh toán thẻ', 'Chuyển khoản QR', 'MoMo', 'Visa', 'ZaloPay']
CHANGES = ['Tiền thối', 'Tiền thừa', 'Trả lại', 'Change', 'Tiền trả lại', 'Tiền dư', 'Thối lại', 'Tiền thối lại']
ITEMS = ['Cà phê sữa', 'Bánh mì thịt', 'Trà đào', 'Cơm sườn', 'Phở bò', 'Bún chả', 'Nước cam', 'Sữa chua', 'Gà rán', 'Mì Ý']
TORN = ['no', 'no', 'no', 'after items', 'after subtotal', 'after fees', 'total blanked', 'one item']


def make(rng):
    """(printed lines [(label, amount)], the amounts that are right answers, the wrong direct reads to try). The picker may always
    answer "no total". A receipt cut right after a bare "Total" line, or with only the exact cash or card amount left, cannot be told
    from a complete one: what that line shows is then a right answer too."""
    items = [(rng.choice(ITEMS) + f' x{rng.randint(1, 3)}', rng.randrange(8, 120) * 1000) for _ in range(rng.randint(1, 5))]
    torn = rng.choice(TORN)
    if torn == 'one item':
        items = items[:1]
    goods = sum(amount for _, amount in items)
    printed, wrong = list(items), {items[0][1], items[-1][1], goods}
    if torn in ('after items', 'one item'):
        return printed, set(), wrong
    sub_label = rng.choice(SUBTOTALS + TOTALS[:3] + UNRANKED_TOTALS[:3]) if rng.random() < 0.7 else None  # a goods subtotal line
    if sub_label:
        printed.append((sub_label, goods))
    goods_shown = {goods} if sub_label in TOTALS else set()
    if torn == 'after subtotal':
        return printed, goods_shown, wrong
    total, fees = goods, rng.choice([0, 0, 1, 1, 2, 3])
    for _ in range(fees):
        fee = rng.choice([5000, 7000, 10000, 12000, 15000, 20000, 25000, 30000])
        printed.append((rng.choice(FEES), fee))
        total += fee
        wrong.add(total)
    if torn == 'after fees':
        return printed, goods_shown if not fees else set(), wrong
    if rng.random() < 0.25:
        cut = rng.choice([5000, 10000, 20000])
        printed.append((rng.choice(DISCOUNTS), cut))
        total -= cut
    wrong |= {goods + (total - goods) // 2}
    label = rng.choice(TOTALS + UNRANKED_TOTALS)
    if torn != 'total blanked':
        printed.append((label, total))
    pay = rng.choice(['exact', 'round', 'round', 'card', 'none'])
    if pay in ('exact', 'round'):
        step = rng.choice([10000, 50000, 100000, 200000, 500000])
        cash = total if pay == 'exact' else ((total // step) + 1) * step
        printed.append((rng.choice(CASH_KNOWN + CASH_OTHER), cash))
        wrong.add(cash)
        if cash != total:
            printed.append((rng.choice(CHANGES), cash - total))
            wrong.add(cash - total)
    elif pay == 'card':
        printed.append((rng.choice(CARDS), total))
    if rng.random() < 0.2:
        printed.append((rng.choice(['Tích điểm', 'Điểm tích lũy', 'Points']), rng.randrange(10, 900)))
    if torn == 'total blanked':
        shown = ({total} if pay in ('exact', 'card') else set()) | (goods_shown if total == goods else set())
        return printed, shown, wrong - shown
    return printed, {total}, wrong - {total}


def reread_of(printed, rng):
    """The verbatim re-read: label and amount on one line, or the labels apart from the amounts, or nothing."""
    mode = rng.choice(['inline', 'inline', 'stacked', 'block', 'none'])
    money = lambda n: f'{n:,}'.replace(',', '.')  # noqa: E731
    if mode == 'inline':
        return [f'{label} {money(amount)}' for label, amount in printed]
    if mode == 'stacked':
        return [text for label, amount in printed for text in (label, money(amount))]
    if mode == 'block':
        return [label for label, _ in printed] + [money(amount) for _, amount in printed]
    return []


def test_the_picker_never_presents_a_wrong_total():
    """TC-F10-24 over random cash, change, surcharge, VAT, discount and torn receipts and every kind of wrong direct read, the picker gives a right total or none (PR #124 round 4)"""
    rng = random.Random(124)
    wrong_answers, right, clean, checked = [], 0, 0, 0
    for _ in range(4000):
        printed, ok, off = make(rng)
        copied = [{'label': label, 'amount': amount} for label, amount in printed]
        reread = reread_of(printed, rng)
        for direct in [*sorted(ok), None, *sorted(off)]:
            got = choose_total(direct, copied, reread)
            checked += 1
            if got is not None and got not in ok:
                wrong_answers.append((direct, ok, printed))
        if len(ok) == 1 and all(label in TOTALS or label in CASH_KNOWN + CARDS + CHANGES + FEES + SUBTOTALS + DISCOUNTS
                                or label.split(' x')[0] in ITEMS for label, _ in printed if label != 'Tích điểm'):
            clean += 1
            right += choose_total(*ok, copied, reread) == next(iter(ok))
    assert not wrong_answers, f'{len(wrong_answers)} of {checked} reads gave a wrong total, for example {wrong_answers[:3]}'
    assert right >= 0.5 * clean, f'only {right} of {clean} clean receipts are read right: the picker must not answer "no total" for everything'


def test_a_receipt_that_cannot_be_told_from_a_torn_one_gives_no_total_in_any_order():
    """TC-F10-26 whatever follows the items, an amount that only the items hold is not a total (PR #124 round 3)"""
    rng = random.Random(7)
    for _ in range(2000):
        items = [(rng.choice(ITEMS), rng.randrange(8, 120) * 1000) for _ in range(rng.randint(1, 6))]
        copied = [{'label': label, 'amount': amount} for label, amount in items]
        reread = [f'{label} {amount:,}'.replace(',', '.') for label, amount in items]
        for direct in [None, sum(amount for _, amount in items), *[amount for _, amount in items]]:
            assert choose_total(direct, copied, reread) is None, (direct, items)

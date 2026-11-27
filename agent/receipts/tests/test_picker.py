# The pure rules that decide which amount is the payable total (docs/02 §2.6). The line lists are what the real
# model copied from our synthetic test receipts (spike 2026-11-25), shortened to the lines that matter.
import pytest

from picker import MAX_MONEY, choose_total, goods_subtotal_only, is_foot_line, is_money, printed_amounts, receipt_date


def lines(*pairs):
    return [{'label': label, 'amount': amount} for label, amount in pairs]


def picked(copied, reread=()):
    """The amounts the picker would present for this copy: each amount on a copied line, tried as the direct read."""
    return {amount for amount in {line['amount'] for line in copied} if choose_total(amount, copied, reread) == amount}


VAT = {
    'goods subtotal, VAT line, then the payable total': lines(
        ('Cộng tiền hàng:', 6800000), ('Thuế suất GTGT: 10%', 680000), ('Tổng cộng tiền thanh toán:', 7480000),
        ('Số tiền viết bằng chữ: Bảy triệu bốn trăm tám mươi mươi nghìn đồng.', 7480000)),
    'a wrong amount in words after the total': lines(
        ('Cộng tiền hàng hóa, dịch vụ:', 6800000), ('Tiền thuế GTGT:', 680000), ('Tổng tiền thanh toán:', 7480000),
        ('Số tiền viết bằng chữ:', 4810000)),
    'bilingual labels': lines(
        ('Cộng tiền hàng (Total amount):', 6800000), ('Thuế suất GTGT (VAT rate): 10%', 680000),
        ('Tổng cộng tiền thanh toán (Total payment):', 7480000)),
    'a total that says VAT is included is not a VAT line': lines(
        ('Cộng tiền hàng', 6800000), ('Tiền thuế GTGT 10%', 680000), ('Tổng cộng (đã bao gồm VAT)', 7480000)),
}


@pytest.mark.parametrize('recorded', VAT.values(), ids=VAT.keys())
def test_vat_invoice(recorded):
    """TC-F10-23 a VAT invoice gives the payable total, never the goods subtotal or the VAT (BUG-034)"""
    assert picked(recorded) == {7480000}


def test_a_copy_that_lists_money_lines_after_the_total_gives_no_total():
    """TC-F10-23 item amounts copied after the total line may be anything (a fee, a later total): no total (PR #124 round 4)"""
    recorded = lines(('Cộng tiền hàng hóa, dịch vụ:', 6800000), ('Tiền thuế GTGT:', 680000), ('Tổng tiền thanh toán:', 7480000),
                     ('Số tiền viết bằng chữ:', 4810000), ('Thành tiền:', 3600000), ('Thành tiền:', 2000000))
    assert picked(recorded) == set()


POINTS_CASH_CHANGE = {
    'sideways photo: points off, cash and change, misread "cần"': (92400, lines(
        ('Rau muống VietGAP 500g', 18900), ('Tổng tiền hàng', 115100), ('Điểm tích lũy', -22700),
        ('Tiền khách đưa', 100000), ('Tiền thối lại', 7600), ('Tiền căn thanh toán', 92400), ('Khách hàng: 09xx xxx 512', 0))),
    'sideways photo: points, amount to pay, then card': (92400, lines(
        ('TỔNG TIỀN HÀNG:', 115100), ('ĐIỂM TÍCH LŨY:', -22700), ('TIỀN CẦN THANH TOÁN:', 92400), ('Thẻ ngân hàng', 92400))),
    'abbreviated "phải t.toán", discount, cash handed over and change': (87500, lines(
        ('TỔNG TIỀN PHẢI T.TOÁN', 87500), ('TỔNG TIỀN ĐÃ GIẢM', 0), ('TIỀN KHÁCH TRẢ', 87500),
        ('TIỀN MẶT', 100000), ('TIỀN TRẢ LẠI', 12500))),
    'total, then cash and a change of zero': (36000, lines(('Tổng thanh toán', 36000), ('Tiền mặt', 36000), ('Trả lại khách', 0))),
    'quantity totals and a points balance are not money': (143000, lines(
        ('TỔNG CỘNG', 143000), ('Total items', 8), ('Tổng số lượng', 21), ('Tổng điểm', 152430), ('Tổng giảm giá', 20000),
        ('TIỀN KHÁCH TRẢ', 163000))),
    'the amount to pay wins over a total printed before a discount': (92000, lines(
        ('Tổng cộng', 115000), ('Giảm giá 20%', 23000), ('Khách cần trả', 92000))),
    'a payable label that also names VAT still counts': (540000, lines(
        ('Subtotal', 500000), ('VAT 8%', 40000), ('Tổng thanh toán (VAT)', 540000))),
}


@pytest.mark.parametrize('expected, recorded', POINTS_CASH_CHANGE.values(), ids=POINTS_CASH_CHANGE.keys())
def test_discount_points_cash_change(expected, recorded):
    """TC-F10-24 discounts, points, cash, change and goods subtotals never win over the amount to pay (BUG-037)"""
    assert picked(recorded) == {expected}


# The line copies of the PR #124 review (the right total is 87000), where a really printed amount won: change, cash
# received and savings.
REVIEW_COPIES = {
    'change, "phải trả lại"': [('Tổng cộng', 87000), ('Tiền khách đưa', 100000), ('Tiền phải trả lại', 13000)],
    'change after the amount to pay': [('Khách phải trả', 87000), ('Tiền mặt', 100000), ('Phải trả lại khách', 13000)],
    'change, upper case': [('TỔNG CỘNG', 87000), ('TIỀN MẶT', 100000), ('TIỀN PHẢI TRẢ LẠI', 13000)],
    'change, "còn phải trả lại"': [('Tổng thanh toán', 87000), ('Khách đưa', 100000), ('Còn phải trả lại', 13000)],
    'cash received as "số tiền nhận"': [('Tổng tiền', 87000), ('Số tiền nhận', 100000), ('Số tiền thừa', 13000)],
    'cash received as "thanh toán"': [('Tổng cộng', 87000), ('Thanh toán', 100000), ('Tiền thừa', 13000)],
    'savings': [('Tổng cộng', 87000), ('Tổng tiền tiết kiệm', 22700)],
    'savings after the change': [('TỔNG CỘNG', 87000), ('Tiền khách đưa', 100000), ('Tiền thối lại', 13000),
                                 ('Tổng tiền đã tiết kiệm', 8000)],
    'savings in English': [('TOTAL', 87000), ('Total savings', 8000)],
}


@pytest.mark.parametrize('copied', REVIEW_COPIES.values(), ids=REVIEW_COPIES.keys())
def test_change_cash_received_and_savings_are_never_the_total(copied):
    """TC-F10-24 change, cash received and savings are never the total, even when really printed (BUG-037)"""
    recorded = lines(*copied)
    assert choose_total(87000, recorded) == 87000
    assert picked(recorded) <= {87000}
    for _, wrong in copied:  # even a direct read that took the wrong line does not get it through
        assert choose_total(wrong, recorded) in (87000, None), wrong


CHANGE_WORDS = [
    'Tiền phải trả lại', 'Phải trả lại khách', 'Số tiền phải trả lại', 'Cần trả lại', 'Còn phải trả lại',
    'Tiền thừa phải trả khách', 'Phải trả khách', 'Tiền phải thối lại', 'Tiền phải đổi lại', 'Trả lại tiền thừa',
    'Hoàn lại khách', 'Amount to pay back', 'Change due', 'Tiền dư', 'Tổng tiền dư', 'Tiền lẻ', 'Return',
]
CASH_RECEIVED_WORDS = [
    'Số tiền nhận', 'Số tiền đã nhận', 'Tổng tiền nhận', 'Tiền nhận của khách', 'Số tiền khách gửi', 'Tiền khách gửi',
    'Tổng tiền khách đưa', 'Số tiền khách trả', 'Total received', 'Amount received', 'Total cash tendered',
    'Tiền KH đưa', 'TỔNG TIỀN KH ĐƯA', 'Tổng tiền nhận được', 'Customer paid',
]
SAVINGS_AND_DEBT_WORDS = [
    'Số tiền tiết kiệm', 'Tổng tiền tiết kiệm', 'Tổng tiền đã tiết kiệm', 'TỔNG CỘNG TIẾT KIỆM', 'Total savings',
    'Total saved', 'Total you save',
    'Số tiền còn nợ', 'Tổng tiền còn nợ', 'Tổng nợ', 'Tổng công nợ', 'Số tiền nợ cũ', 'Tổng số dư',
]
NEVER_THE_TOTAL = CHANGE_WORDS + CASH_RECEIVED_WORDS + SAVINGS_AND_DEBT_WORDS


@pytest.mark.parametrize('label', NEVER_THE_TOTAL)
def test_a_line_that_is_never_the_total(label):
    """TC-F10-24 no wording of change, cash received, savings or a debt is picked, in any label group (BUG-037)"""
    cash = ('Tiền khách đưa', 130100)  # a printed change comes with the cash it was given from
    paid = 150000 if label in CASH_RECEIVED_WORDS else None  # cash that pays the total pays it in full
    other = paid or 15000
    assert picked(lines(('Tổng cộng', 115100), cash, (label, other))) == {115100}
    assert picked(lines(('Tiền cần thanh toán', 92400), ('Tiền khách đưa', 100000), (label, paid or 7600))) == {92400}
    assert picked(lines((label, 7600))) == set()
    assert choose_total(7600, lines((label, 7600))) is None


# Wordings no list names: whatever else a "Tổng …" or "Total …" line says, it is not the bare total.
SAYS_MORE = ['Tổng tiền đã thu', 'Tổng tiền đã thanh toán', 'Tổng tiền đặt cọc', 'Tổng tiền còn lại', 'Tổng cộng thối',
             'Total thừa', 'Tổng tiền tích lũy', 'Tổng tiền phí dịch vụ', 'Total balance', 'Total paid', 'Total deposit']


@pytest.mark.parametrize('label', SAYS_MORE)
def test_a_total_line_that_says_more_does_not_beat_a_bare_total(label):
    """TC-F10-24 a "Tổng …" or "Total …" line with more words never outranks a bare "Tổng cộng", whatever they are (BUG-037)"""
    recorded = lines(('Tổng cộng', 115100), (label, 15000))
    # It may be the cash, a fee or a later total, so the bare total above it is not presented either: the owner types it.
    assert picked(recorded) == set()
    for direct in (115100, 15000, None):
        assert choose_total(direct, recorded) is None, direct
    # With no bare total, such a line is still read when the direct read agrees with it.
    assert picked(lines(('Tổng tiền hóa đơn', 87000))) == {87000}
    assert choose_total(87000, lines(('Thành tiền', 87000), (label, 100000))) is None
    assert choose_total(100000, lines(('Thành tiền', 87000), (label, 100000))) == 100000


@pytest.mark.parametrize('label', ['Số tiền đặt cọc', 'Số tiền trong quỹ', 'Số tiền làm tròn', 'Số tiền gửi xe'])
def test_so_tien_of_something_else_does_not_beat_the_total(label):
    """TC-F10-25 only a bare voucher "Số tiền" ranks above "Tổng cộng"; one of something else is no total (BUG-035)"""
    assert picked(lines((label, 15000), ('Tổng cộng', 115100))) == {115100}
    assert 15000 not in picked(lines(('Tổng cộng', 115100), (label, 15000)))  # below it, it may change the total: none at all


@pytest.mark.parametrize('label', ['Số tiền:', 'SỐ TIỀN (VNĐ)', 'Số tiền (Amount):', 'Số tiền bằng số', 'Số tiền thu',
                                   'Số tiền chi', 'Số tiền thanh toán', 'Số tiền giao dịch', 'Số tiền chuyển khoản',
                                   'Đã nhận đủ số tiền'])
def test_voucher_so_tien_wordings(label):
    """TC-F10-25 the amount line of a voucher or transfer slip is still read, also "Đã nhận đủ số tiền" (BUG-035)"""
    assert picked(lines(('TỔNG', 3000000), (label, 2500000))) == {2500000}
    assert picked(lines((label, 2500000), ('TỔNG', 3000000))) == set()  # a figure below it may be the real total: none
    assert picked(lines((label, 2500000), ('Bằng chữ', 2000000))) == {2500000}  # the amount in words is the model's own sum


def test_the_amount_in_words_is_never_a_total():
    """TC-F10-25 a line that heads the amount in words carries the model's own conversion, which is no printed total (BUG-035)"""
    assert picked(lines(('Đã nhận đủ số tiền (viết bằng chữ)', 2500000))) == set()


# A total printed after VAT or a discount: (the VAT or discount line, its amount, the label below it, the total).
AFTER_LINES = [
    ('Thuế VAT 8%', 9208, 'Tổng cộng sau VAT', 124308),
    ('Thuế GTGT', 9208, 'Tổng cộng sau thuế GTGT', 124308),
    ('VAT', 9208, 'TỔNG SAU THUẾ', 124308),
    ('VAT', 9208, 'TOTAL AFTER TAX', 124308),
    ('Giảm giá', 23100, 'Tổng cộng sau giảm giá', 92000),
    ('Giảm giá', 23100, 'Tổng tiền sau giảm giá', 92000),
    ('Chiết khấu 20%', 23100, 'Tổng tiền sau chiết khấu', 92000),
    ('Khuyến mãi', 23100, 'Cộng sau khuyến mãi', 92000),
    ('Trừ điểm', 22700, 'Tổng tiền sau khi trừ điểm', 92400),
    ('Điểm tích lũy', -22700, 'Tổng tiền sau trừ điểm', 92400),
    ('Discount', 23100, 'Total after discount', 92000),
    ('Giảm giá', 23100, 'Tổng cộng (đã trừ voucher)', 92000),
    ('Voucher', 23100, 'Tổng tiền đã trừ voucher', 92000),
    ('Discount', 23100, 'Total less discount', 92000),
]


@pytest.mark.parametrize('adjustment, off, label, total', AFTER_LINES, ids=[row[2] for row in AFTER_LINES])
def test_the_total_after_vat_or_a_discount(adjustment, off, label, total):
    """TC-F10-23 the total printed after VAT or a discount is the total, not the figure before it (BUG-034)"""
    recorded = lines(('Tổng cộng', 115100), (adjustment, off), (label, total))
    assert picked(recorded) == {total}
    assert choose_total(total, recorded) == total
    assert choose_total(115100, recorded) is None  # the direct read took the figure before it: the reads disagree
    assert choose_total(None, recorded) is None


# A VAT or discount line below the picked figure changes it, and no line is recognised as the figure after it.
CHANGED_LATER = {
    'VAT added below': [('Tổng cộng', 115100), ('Thuế VAT 8%', 9208)],
    'discount below': [('Tổng cộng', 115100), ('Giảm giá', 23100)],
    'discount with a minus sign': [('TỔNG CỘNG', 115100), ('CHIẾT KHẤU', -23100)],
    'points taken off': [('Tổng cộng', 115100), ('Điểm tích lũy', -22700)],
    'points spent': [('Tổng cộng', 115100), ('Đổi điểm', 22700)],
    'voucher used': [('Total', 115100), ('Voucher', 20000)],
    'VAT, then a total in other words': [('Tổng cộng', 115100), ('Thuế GTGT', 9208), ('Thành tiền sau thuế', 124308)],
    'VAT on two lines': [('Tổng cộng', 115100), ('Thuế suất GTGT: 8%', 9208), ('Tiền thuế GTGT', 9208)],
    'voucher amount, then VAT': [('Số tiền', 115100), ('VAT 8%', 9208)],
    'total after a discount, then VAT': [('Tổng cộng sau giảm giá', 92000), ('VAT 8%', 7360), ('Tổng cộng', 99360)],
    'sum of the discounts, then the figure they leave': [('Tổng cộng', 115100), ('Tổng giảm giá', 23100), ('TC', 92000)],
    'paid more than the figure above the VAT': [('Tổng cộng', 115100), ('VAT 8%', 9208), ('Tiền mặt', 124308)],
    'a discount named "after tax"': [('Tổng cộng', 115100), ('Chiết khấu sau thuế', 5000)],
    'VAT named "after discount"': [('Tổng cộng', 92000), ('Thuế GTGT sau giảm giá', 7360)],
    'a discount named "before tax"': [('Tổng cộng', 115100), ('Giảm giá trước thuế', 5000)],
    '"CK" as a discount rate': [('Tổng cộng', 115100), ('CK 10%', 11510)],
}


@pytest.mark.parametrize('copied', CHANGED_LATER.values(), ids=CHANGED_LATER.keys())
def test_a_figure_a_later_vat_or_discount_line_changes_is_not_presented(copied):
    """TC-F10-23 a figure that a later VAT or discount line changes is not presented as the total (BUG-034)"""
    recorded = lines(*copied)
    assert picked(recorded) == set()
    assert choose_total(copied[0][1], recorded) is None


@pytest.mark.parametrize('label', ['Tổng cộng (có VAT)', 'Tổng cộng (đã gồm VAT)', 'Total (incl. VAT)', 'Tổng cộng', 'Tổng tiền đã bao gồm thuế GTGT'])
def test_the_figure_plus_the_vat_printed_below_it_is_the_total(label):
    """TC-F10-23 a total that is the figure above it plus the VAT printed between them is the total when the direct read has it; the figure before the VAT is not (BUG-034)"""
    recorded = lines(('Tổng cộng', 115100), ('Thuế VAT 8%', 9208), (label, 124308))
    assert choose_total(124308, recorded) == 124308
    for direct in (115100, None):  # the figure before the VAT, or no direct read: the reads do not agree
        assert choose_total(direct, recorded) is None, direct
    discounted = lines(('Tổng cộng', 115100), ('Giảm giá', 23100), (label, 92000))
    assert choose_total(92000, discounted) == 92000
    for direct in (115100, None):
        assert choose_total(direct, discounted) is None, direct
    # Two total lines that do not add up are still two reads that disagree.
    assert choose_total(115100, lines(('Tổng cộng', 115100), ('Thuế VAT 8%', 9208), (label, 120000))) is None


def test_a_total_computed_from_vat_and_discounts_is_not_presented():
    """TC-F10-23 subtotal + VAT - discounts is arithmetic, not a printed total: no copied total line holds it, so it is never presented (BUG-034)"""
    vat = lines(('Tổng cộng', 115100), ('Thuế VAT 8%', 9208))
    assert choose_total(124308, vat) is None
    both = lines(('Tổng cộng', 100000), ('Giảm giá', 10000), ('Thuế GTGT', 7200))
    assert choose_total(97200, both) is None
    assert choose_total(92000, lines(('Tổng cộng', 115100), ('Giảm giá', 23100))) is None
    assert choose_total(100000, vat) is None


# VAT and discount lines below the picked figure that leave it as it is.
UNCHANGED = {
    '"trong đó" VAT': [('Tổng cộng', 87000), ('Trong đó VAT 8%', 6444)],
    'a note that prices include VAT': [('Tổng cộng', 87000), ('(Giá đã bao gồm thuế GTGT)', 6444)],
    'the figure before VAT is printed above': [('Tiền trước thuế', 80556), ('Tổng cộng', 87000), ('VAT 8%', 6444)],
    'goods less discount plus VAT gives it': [('Tổng tiền hàng', 90000), ('Tổng cộng', 87000), ('Giảm giá', 10000),
                                              ('Thuế GTGT', 7000)],
    'it was paid, cash less change': [('Tổng cộng', 87000), ('VAT 8%', 6444), ('Tiền mặt', 100000), ('Tiền thừa', 13000)],
    'it was paid by card': [('Tổng cộng', 87000), ('VAT 8%', 6444), ('Thẻ ngân hàng', 87000)],
    '"CK" as a bank transfer': [('Tổng cộng', 87000), ('CK', 87000)],
    'it was paid by e-wallet': [('Tổng cộng', 87000), ('VAT 8%', 6444), ('MoMo', 87000)],
    'the total says VAT is included': [('Tổng cộng (đã bao gồm VAT)', 87000), ('VAT 8%', 6444)],
    'the total is the one after VAT': [('Tổng cộng sau VAT', 87000), ('VAT 8%', 6444)],
    'an amount to pay, then the VAT in it': [('Khách phải trả', 87000), ('VAT 8%', 6444)],
    'no discount and no VAT': [('Tổng cộng', 87000), ('Giảm giá', 0), ('Thuế', 0)],
    'points earned and a points balance': [('Tổng cộng', 87000), ('Điểm tích lũy', 87), ('Tổng điểm', 1520)],
    'the sum of the discounts already taken off': [('Tổng cộng', 87000), ('Tổng tiền đã giảm', 8000)],
    'savings': [('Tổng cộng', 87000), ('Bạn đã tiết kiệm', 8000)],
    'the sum of the discounts, "được giảm"': [('Tổng cộng', 87000), ('Tổng tiền được giảm', 8000)],
    'the VAT table below the total': [('Tổng cộng', 87000), ('Tiền chịu thuế', 80556), ('Thuế GTGT 8%', 6444)],
    'paid with "KH đưa" and "tiền dư"': [('Tổng cộng', 87000), ('VAT 8%', 6444), ('Tiền KH đưa', 100000), ('Tiền dư', 13000)],
    'paid with "đã nhận" and "tiền lẻ"': [('Tổng cộng', 87000), ('VAT 8%', 6444), ('Đã nhận', 100000), ('Tiền lẻ', 13000)],
    'paid in English': [('Total', 87000), ('VAT 8%', 6444), ('Customer paid', 100000), ('Return', 13000)],
    'a VAT rate copied as an amount': [('Tổng cộng', 87000), ('Thuế suất GTGT', 8)],
    'a discount rate copied as an amount': [('Tổng cộng', 87000), ('Giảm giá', 10)],
}


@pytest.mark.parametrize('copied', UNCHANGED.values(), ids=UNCHANGED.keys())
def test_a_total_that_later_lines_leave_alone_is_kept(copied):
    """TC-F10-23 a total that already holds the VAT and discounts printed below it is kept (BUG-034)"""
    recorded = lines(*copied)
    assert picked(recorded) == {87000}
    assert choose_total(87000, recorded) == 87000


@pytest.mark.parametrize('cash_label', ['Khách thanh toán', 'Thanh toán', 'Tiền thanh toán', 'KH thanh toán', 'Đã thanh toán', 'Thanh toán bằng tiền',
                                        'Số tiền nộp', 'Tiền nộp', 'Khách nộp'])
def test_cash_handed_over_under_any_label_is_not_the_total(cash_label):
    """TC-F10-24 a figure that is a printed total plus the printed change is the cash handed over, whatever its label (BUG-037)"""
    recorded = lines(('Tổng cộng', 87000), (cash_label, 100000), ('Tiền thừa', 13000))
    assert choose_total(87000, recorded) == 87000  # the cash under any label is no rival, and it is not "money below" either
    # the direct read took the cash, or nothing: never presented, and the cash and the change pick nothing
    for direct in (100000, 13000, None):
        assert choose_total(direct, recorded) is None, direct
    # under a label we do not rank, even a total that the cash and the change fit is not presented
    unranked = lines(('Thành tiền', 87000), (cash_label, 100000), ('Tiền thừa', 13000))
    for direct in (87000, 100000, None):
        assert choose_total(direct, unranked) is None, direct


@pytest.mark.parametrize('cash_label', ['Khách thanh toán', 'Đã thanh toán', 'Tiền thanh toán', 'KH thanh toán', 'Khách nộp', 'Tiền nộp'])
def test_a_direct_total_whose_cash_is_not_printed_is_the_cash(cash_label):
    """TC-F10-24 with a change printed, a direct total on an unranked line is trusted only if its cash (total + change) is printed too (PR #124 round 2)"""
    assert choose_total(100000, lines((cash_label, 100000), ('Tiền thừa', 13000))) is None  # the total is torn off: this is the cash
    assert choose_total(87000, lines((cash_label, 100000), ('Tiền thừa', 13000))) is None  # no copied line holds 87.000
    assert choose_total(87000, lines(('g cộng :', 87000), (cash_label, 100000), ('Tiền thừa', 13000))) is None  # a torn label


def test_two_reads_naming_different_totals_give_no_total():
    """TC-F10-24 a picked line does not silently override another total line the direct read took (BUG-037)"""
    assert choose_total(87000, lines(('Tổng cộng', 87000), ('Thanh toán', 100000))) is None
    assert choose_total(115100, lines(('Tổng cộng', 115100), ('Thanh toán', 92000))) is None
    assert choose_total(80000, lines(('Tổng thanh toán', 80000), ('Khách phải trả', 87000))) is None
    # A better label below the direct read's line, even with a discount printed between, does not override it: the reads disagree.
    assert choose_total(115000, lines(('Tổng cộng', 115000), ('Giảm giá', 23000), ('Khách cần trả', 92000))) is None
    # The model's own conversion of the amount in words never counts: not as the direct read, not as a rival.
    assert choose_total(2000000, lines(('SỐ TIỀN', 2500000), ('Số tiền viết bằng chữ', 2000000))) is None
    assert choose_total(2500000, lines(('SỐ TIỀN', 2500000), ('Số tiền viết bằng chữ', 2000000))) == 2500000


# Round 3 of the PR #124 review: on short plain receipts the model echoed the words of its own prompt as labels
# ("subtotal", "VAT", "amount to pay", "cash") and shifted the printed amounts onto them, so the cash handed over
# was "amount to pay". The labels of the copy cannot be trusted alone; the verbatim re-read holds the printed ones.
def reread(*pairs):
    """A verbatim re-read as the model answers it: the label on one line, its amount on the next."""
    return [text for pair in pairs for text in pair]


ECHOED_REPRO = (
    146000,
    lines(('subtotal', 146000), ('VAT', 350000), ('discount', 204000), ('points', 0), ('total', 146000),
          ('amount to pay', 350000), ('cash', 204000)),
    reread(('Phở bò tái x1', '89.000'), ('Cơm sườn x2', '57.000'), ('Tổng thanh toán', '146.000'), ('Khách đưa', '350.000'),
           ('Trả lại', '204.000')))


def test_the_review_repro_of_an_echoed_copy():
    """TC-F10-24 the cash printed as "Khách đưa" is not the total, whatever the copy calls it (PR #124 round 2)"""
    direct, copied, printed = ECHOED_REPRO
    assert choose_total(direct, copied, printed) == 146000
    assert choose_total(None, copied, printed) is None  # no direct read: the copy alone does not pick
    assert choose_total(350000, copied, printed) is None  # the direct read took the cash: never presented
    assert choose_total(350000, lines(('amount to pay', 350000), ('cash', 204000)), printed) is None  # only the cash is left
    assert choose_total(direct, copied) in (146000, None)  # without the re-read the two reads disagree: no total, not 350000


def test_an_amount_to_pay_that_is_the_total_plus_the_printed_change_is_the_cash():
    """TC-F10-24 "total + change = cash" holds for a line labelled as an amount to pay too (PR #124 round 2)"""
    copied = lines(('total', 115000), ('amount to pay', 200000), ('cash', 200000), ('change', 85000))
    for direct in (115000, 200000, None):
        assert choose_total(direct, copied) in (115000, None), direct
    assert choose_total(115000, copied) == 115000
    assert picked(copied) == {115000}
    for payable in ('Khách phải trả', 'Tiền cần thanh toán', 'Tổng thanh toán', 'Amount due'):
        assert picked(lines(('Tổng cộng', 115000), (payable, 200000), ('Tiền mặt', 200000), ('Tiền thối', 85000))) == {115000}


def test_a_better_label_never_overrides_the_direct_read_whatever_the_paper_shows():
    """TC-F10-24 a better-labelled total line of another amount, a discount between them or a re-read that prints it as one: the reads disagree, no total (PR #124 round 4)"""
    copied = lines(('Tổng cộng', 115000), ('Khách cần trả', 92000))
    assert choose_total(115000, copied) is None
    assert choose_total(115000, copied, ['Tổng cộng', '115.000', 'Khách cần trả', '92.000']) is None
    assert choose_total(115000, copied, ['Tổng cộng 115.000', 'Khách cần trả 92.000']) is None
    assert choose_total(92000, copied) == 92000  # the direct read has the later total: both reads agree
    # printed as cash, the amount-to-pay line is cash: it is no rival, and the total above it stands
    assert choose_total(115000, copied, ['Tổng cộng 115.000', 'Tiền khách đưa 130.000']) is None  # 92.000 is no such cash
    assert choose_total(115000, lines(('Tổng cộng', 115000), ('Khách cần trả', 130000)), ['Tổng cộng 115.000', 'Tiền khách đưa 130.000']) == 115000
    assert choose_total(130000, lines(('Tổng cộng', 115000), ('Khách cần trả', 130000)), ['Tổng cộng 115.000', 'Tiền khách đưa 130.000']) is None
    # two payable labels that disagree give no total, re-read or not
    assert choose_total(80000, lines(('Tổng thanh toán', 80000), ('Khách phải trả', 87000)),
                        ['Tổng thanh toán 80.000', 'Khách phải trả 87.000']) is None


@pytest.mark.parametrize('printed_as', ['Tiền khách đưa', 'Khách đưa', 'Tiền mặt', 'Cash', 'Cash tendered', 'Tiền KH đưa',
                                        'Số tiền nhận', 'Trả lại', 'Tiền thối', 'Change', 'Tiền thừa phải trả khách'])
def test_an_amount_the_reread_prints_only_as_cash_or_change_is_never_the_total(printed_as):
    """TC-F10-24 whatever the copy calls it, an amount the re-read prints only as cash handed over or change is not the total (PR #124 round 2)"""
    printed = ['Tổng cộng 87.000', f'{printed_as} 100.000']
    for label in ('Tổng cộng', 'Khách cần trả', 'Tổng thanh toán', 'Thành tiền', 'total', 'amount to pay', 'Số tiền'):
        copied = lines(('Tổng cộng', 87000), (label, 100000))
        # a re-read that prints the amount as the change makes 87.000 a total whose cash (187.000) is not printed
        assert choose_total(87000, copied, printed) in (87000, None), label
        assert choose_total(100000, copied, printed) is None, label  # the direct read took the cash: never presented
        assert choose_total(100000, lines((label, 100000)), printed) is None, label  # both reads took the cash
        assert choose_total(None, lines((label, 100000)), printed) is None, label
    assert choose_total(100000, [], printed) is None  # no copied line at all
    # the cash that equals the total is still printed as a total
    assert choose_total(87000, lines(('Tổng cộng', 87000), ('Tiền mặt', 87000)), ['Tổng cộng 87.000', 'Tiền mặt 87.000']) == 87000


BLOCK_REREADS = {
    'labels, then the amounts': ['Xúc xích x2', 'Tổng cộng', 'Tiền khách đưa', 'Tiền thôi', '549.000', '1.050.000', '501.000'],
    'labels mixed with amounts': ['Total', 'Cash', '549.000', 'Change', '1.050.000', '501.000'],
    'only the labels': ['Tổng cộng', 'Tiền khách đưa', 'Tiền thôi'],
}


@pytest.mark.parametrize('printed', BLOCK_REREADS.values(), ids=BLOCK_REREADS.keys())
def test_a_reread_that_lists_labels_apart_from_amounts_pairs_nothing(printed):
    """TC-F10-24 labels listed in a block before their amounts are not paired with them, so the total is not taken for the cash (PR #124 round 2)"""
    copied = lines(('Xúc xích x2', 84000), ('Tổng cộng', 549000), ('Tiền khách đưa', 1050000), ('Tiền thôi', 501000))
    assert choose_total(549000, copied, printed) == 549000
    assert choose_total(None, copied, printed) is None
    assert choose_total(1050000, copied, printed) is None  # the cash is still the cash


@pytest.mark.parametrize('change_label', ['Thừa', 'THỪA', 'Dư', 'Thối', 'Tiền lẻ', 'Thối lại:'])
def test_a_change_line_with_a_one_word_label(change_label):
    """TC-F10-24 a change printed as one word ("Thừa", "Dư", "Thối") is change: it never wins, and it proves the amount paid (PR #124 round 2)"""
    assert picked(lines(('Tổng cộng', 87000), ('Tiền khách đưa', 100000), (change_label, 13000))) == {87000}
    assert picked(lines(('Tổng cộng', 87000), (change_label, 13000))) == set()  # a change whose cash is not printed
    assert choose_total(None, lines(('Cần thu', 87000), ('Đã thanh toán', 100000), (change_label, 13000))) is None
    assert choose_total(87000, lines(('Tổng cộng', 87000), ('Đã thanh toán', 100000), (change_label, 13000))) == 87000


@pytest.mark.parametrize('label', ['Total (USD)', 'Total USD', 'TOTAL EUR', 'Tổng cộng (USD)', 'Total $', 'Tổng US$'])
def test_a_total_in_another_currency_is_not_the_total(label):
    """TC-F10-25 a total in a foreign currency is not the amount to pay in VND (PR #124 round 2)"""
    recorded = lines(('Tổng cộng', 2325000), (label, 92))
    assert picked(recorded) == {2325000}
    assert choose_total(2325000, recorded) == 2325000
    assert picked(lines((label, 92))) == set()


# A real photo (MC-OCR sample, a degraded printout) whose copy gave the received amount a "total" label too: the copy has
# "Tổng tiền 169000", "Tổng tiền 189000" and "Tiền khách trả 189000", and the direct read took the 189000.
RECEIVED_TWICE = lines(('Thành tiền', 46000), ('Thành tiền', 42000), ('Thành tiền', 6000), ('Tổng tiền', 169000), ('Tổng tiền', 189000),
                       ('Tiền khách trả', 189000))


def test_a_total_line_that_repeats_the_received_amount_gives_way_to_a_smaller_total():
    """TC-F10-24 a total line whose amount is also printed on a cash line gives way to a smaller total line nothing links it to (MC-OCR photo, PR #124 round 3)"""
    assert choose_total(169000, RECEIVED_TWICE) == 169000
    for direct in (189000, None):  # the received amount is no total; a missing direct read picks nothing
        assert choose_total(direct, RECEIVED_TWICE) is None, direct
    assert picked(RECEIVED_TWICE) == {169000}
    # a line between the two that is the difference explains it: the larger one is the figure after it (a service charge)
    charged = lines(('Tổng cộng', 100000), ('Phí phục vụ 5%', 5000), ('Tổng cộng', 105000), ('Tiền mặt', 105000))
    for direct in (105000, 100000, None):
        assert choose_total(direct, charged) in (105000, None), direct
    assert choose_total(105000, charged) == 105000
    # one total line equal to the cash (paid exactly) is still the total
    assert choose_total(87000, lines(('Tổng cộng', 87000), ('Tiền mặt', 87000))) == 87000
    assert choose_total(87000, lines(('Tổng cộng', 87000), ('Tiền khách đưa', 87000))) == 87000
    assert choose_total(None, lines(('Tổng cộng', 87000), ('Tiền khách đưa', 87000))) is None


# The same MC-OCR photo, blurred: four live runs of the model (PR #124 round 4). The direct read is the 189.000 the customer
# paid in every run; the copy labels it as the cash, as a number or as nothing; the re-read even prints it as "Tổng tiền".
BLURRED_REREAD = ['Tổng số:', '29', 'Tổng cộng :', '169,000', 'Tổng tiền :', '189,000', 'Tiến khách trả:', 'VND', '189,000']
BLURRED_RUNS = {
    'cash named in the copy': lines(('Đơn hàng', 46000), ('Đơn hàng', 42000), ('Tổng tiền', 169000), ('Tiền khách trả', 189000)),
    'labels are the numbers': lines(('6,000', 6000), ('46,000', 46000), ('169,000', 169000), ('189,000', 189000), ('189,000', 189000)),
    'the cash among labels that name nothing': lines(
        ('Tất cả', 169000), ('Tất cả', 189000), ('Tất cả', 189000), ('Giá bán: 8 HOP', 48000), ('Giá bán: 12 HOP', 75000),
        ('Tổng tiền:', 169000), ('Tiền khách trả:', 189000), ('Tổng số:', 29)),
}


@pytest.mark.parametrize('copied', BLURRED_RUNS.values(), ids=BLURRED_RUNS.keys())
def test_a_blurred_photo_whose_direct_read_and_reread_both_name_the_cash_gives_no_total(copied):
    """TC-F10-24 the cash is never the total, although the direct read took it and the re-read printed it next to "Tổng tiền" (MC-OCR photo, PR #124 round 4)"""
    for reread in ([], BLURRED_REREAD):
        assert choose_total(189000, copied, reread) is None
    # the re-read, with its typo "Tiến khách trả", does not lend a total label to a label that says it is cash, or to a number
    assert choose_total(169000, copied, BLURRED_REREAD) in (169000, None)


def test_the_reread_lends_a_total_label_only_to_a_label_that_names_nothing():
    """TC-F10-24 the copy misread "cần" as "chờ": the re-read prints the amount next to "Tiền cần thanh toán" only, so the two reads agree on it (PR #124 round 4)"""
    copied = lines(('Tổng tiền hàng', 115100), ('Tiền khách đưa', 100000), ('Tiền chờ thanh toán', 92400), ('Tiền thôi lại', 7600))
    printed = ['Tổng tiền hàng 115.100', 'Tiền cần thanh toán 92.400', 'Tiền khách đưa 100.000', 'Tiền thôi lại 7.600']
    assert choose_total(92400, copied, printed) == 92400
    assert choose_total(92400, copied) is None  # without the re-read nothing says that label is a total
    # not when the copy says what the line is, nor when the re-read prints the amount next to something else too
    assert choose_total(100000, copied, ['Tiền cần thanh toán 100.000']) is None
    assert choose_total(92400, copied, printed + ['Tiền khách trả 92.400']) is None


def test_a_figure_that_a_subtotal_printed_above_it_happens_to_fit_is_not_the_cash_of_the_total():
    """TC-F10-24 the cash of a total is a line that says cash or payment, or one printed after it: a goods subtotal above, whose label names nothing, that equals "figure + change" does not save the cash (found by the property test, PR #124 round 4)"""
    copied = lines(('Bánh mì thịt x1', 73000), ('Mì Ý x1', 89000), ('Cơm sườn x1', 83000), ('Bánh mì thịt x1', 10000), ('Giá trị đơn', 255000),
                   ('Chiết khấu', 10000), ('Phải thanh toán', 245000), ('Tổng thanh toán', 250000), ('Change', 5000))
    assert choose_total(250000, copied) is None  # the cash, labelled "Tổng thanh toán": 245.000 + 5.000, and 255.000 is only the goods
    assert choose_total(255000, copied) is None
    assert choose_total(245000, copied) == 245000


def test_a_fee_below_a_total_is_a_fee_even_when_it_has_the_amount_of_the_total():
    """TC-F10-26 a delivery fee that equals the figure above it is no repeat of it (found by the property test, PR #124 round 4)"""
    copied = lines(('Mì Ý x3', 10000), ('Tổng cộng', 10000), ('Phí giao hàng', 10000))
    assert picked(copied) == set()
    assert picked(lines(('Mì Ý x3', 10000), ('Tổng cộng', 10000), ('Thẻ ngân hàng', 10000))) == {10000}  # a repeat of the figure
    assert picked(lines(('Mì Ý x3', 10000), ('Tổng cộng', 10000), ('Ví điện tử', 10000))) == {10000}


def test_a_figure_that_the_fees_and_vat_printed_anywhere_turn_into_another_total_is_the_figure_before_them():
    """TC-F10-24 whatever order the copy lists its lines in, a total that plus the printed fees, VAT and discounts is another, as well labelled total line is the figure before them (PR #124 round 4)"""
    # round 3 B2 with the lines in another order: the final total listed first
    scrambled = lines(('TỔNG CỘNG', 155000), ('Khách đưa', 155000), ('Phí dịch vụ', 15000), ('Thuế GTGT 10%', 5000), ('Tổng cộng', 135000))
    assert choose_total(135000, scrambled) is None
    assert choose_total(155000, scrambled) in (155000, None)
    # round 3 B1 with the fee listed before the total: the change equals the fee, and 68.000 is the figure plus the fee
    cash = lines(('Phải thanh toán', 68000), ('Khách đưa', 73000), ('Trả lại', 5000), ('Ship', 5000), ('Total', 63000))
    assert choose_total(63000, cash) is None
    assert choose_total(73000, cash) is None
    # a better-labelled total is not held by a worse-labelled line that the fee explains: the amount to pay stands
    assert choose_total(180000, lines(('Total', 160000), ('Phí đóng gói', 20000), ('Khách cần trả', 180000), ('Thanh toán', 200000),
                                      ('Trả lại', 20000))) == 180000


def test_an_amount_to_pay_beside_a_total_that_nothing_explains_gives_no_total():
    """TC-F10-24 an amount-to-pay pick that no other read backs, beside another total that no VAT or discount line explains, is not presented (PR #124 round 2)"""
    # the review's copy where the re-read printed the labels but not the amounts, and the direct read is off
    echoed = lines(('subtotal', 190500), ('VAT', 300000), ('discount', 109500), ('total', 190500), ('amount to pay', 300000), ('cash', 109500))
    assert choose_total(317500, echoed) is None
    assert choose_total(None, echoed) is None
    assert choose_total(190500, echoed) is None  # the direct read backs the total line, the copy's label backs the other: no total
    labels_only = ['Tổng giá trị đơn hàng', 'Đã thanh toán', 'Tiền dư']
    assert choose_total(317500, echoed, labels_only) is None
    # the re-read with its amounts shows 300.000 is not an amount to pay: it plus the change printed is not even a total
    printed = ['Tổng giá trị đơn hàng', '190.500', 'Đã thanh toán', '300.000', 'Tiền dư', '109.500']
    assert choose_total(317500, echoed, printed) is None  # a direct read that no copied line holds
    assert choose_total(190500, echoed, printed) is None  # "Đã thanh toán" is no cash word we know: 300.000 still disputes it
    # two reads that agree stand, and so does a pick the discount line explains
    assert choose_total(92400, lines(('Tổng cộng', 115100), ('Tiền cần thanh toán', 92400))) == 92400
    assert choose_total(92400, lines(('Tổng cộng', 115100), ('Giảm giá', 22700), ('Tiền cần thanh toán', 92400))) == 92400
    assert choose_total(None, lines(('Tổng cộng', 115100), ('Giảm giá', 22700), ('Tiền cần thanh toán', 92400))) is None


# A bare or unusual label on the total ("Tổng", "Thành tiền", "Tổng giá trị đơn hàng", ...) is no label we rank. The printed
# cash and change can only take a candidate away: they never pick a line, so such a total is left for the owner to type.
UNRANKED_TOTAL_LABELS = ['Tổng', 'Thành tiền', 'Tổng giá trị đơn hàng', 'TỔNG', 'Tổng bill', 'Phải thu', 'Thực thu', 'Net amount',
                         'Balance due', 'Thu khách', 'Tổng đơn hàng', 'Tổng hóa đơn']


@pytest.mark.parametrize('label', UNRANKED_TOTAL_LABELS)
def test_an_unranked_total_label_is_not_read_even_when_the_cash_and_change_fit(label):
    """TC-F10-23 a line under a label we do not rank is no total, although it plus the printed change is the cash handed over: the cash and the change pick nothing (PR #124 round 4)"""
    copied = lines(('Cà phê sữa x2', 58000), ('Bánh mì x1', 22000), (label, 80000), ('Tiền khách đưa', 100000), ('Tiền thối', 20000))
    assert picked(copied) == set()
    for direct in (None, 80000, 160000, 100000, 20000):  # right, off, the cash, the change
        assert choose_total(direct, copied) is None, direct
    for paid, change in (('Đã thanh toán', 'Tiền dư'), ('Khách nộp', 'Tiền thừa'), ('Nhận', 'Tiền trả lại'), ('Paid', 'Change')):
        assert choose_total(80000, lines((label, 80000), (paid, 100000), (change, 20000))) is None, paid
    assert choose_total(80000, lines(('Điểm tích lũy', 800), (label, 80000), ('Tiền mặt', 100000), ('Tiền thừa', 20000))) is None


def test_the_copy_of_a_sideways_photo_can_list_the_cash_before_the_amount_to_pay():
    """TC-F10-23 the copy of a sideways photo can list the cash before the amount to pay: with a ranked label the reads still agree, with a misread one there is no total (PR #124 round 4)"""
    copied = lines(('Tổng tiền hàng', 115100), ('Tiền khách đưa', 100000), ('Tiền cần thanh toán', 92400), ('Tiền thôi lại', 7600))
    assert choose_total(92400, copied) == 92400
    for direct in (None, 115100, 100000):  # a direct read of the goods subtotal or the cash is never presented
        assert choose_total(direct, copied) is None, direct
    misread = lines(('Tổng tiền hàng', 115100), ('Tiền khách đưa', 100000), ('Tiền chờ thanh toán', 92400), ('Tiền thôi lại', 7600))
    for direct in (None, 115100, 92400, 100000):
        assert choose_total(direct, misread) is None, direct


def test_an_item_that_plus_the_change_is_another_item_is_not_the_total():
    """TC-F10-23 items alone never make a total: with the total torn off, an item plus the change that is a later item gives none (PR #124 round 2)"""
    # 22.000 + 20.000 = 42.000, but 42.000 is followed by another item and is no cash line
    torn = lines(('Bánh mì x1', 22000), ('Cơm sườn x1', 42000), ('Nước cam x1', 15000), ('Tiền khách đưa', 100000), ('Tiền thối', 20000))
    assert choose_total(None, torn) is None
    assert choose_total(79000, torn) is None  # the item sum, as the model invents it
    for line in torn:  # and no amount of the copy, taken as the direct read, is a total
        assert choose_total(line['amount'], torn) is None, line
    # with a total printed among them, the direct read that agrees with it is presented
    printed = lines(('Bánh mì x1', 22000), ('Cơm sườn x1', 42000), ('Tổng cộng', 64000), ('Tiền khách đưa', 100000), ('Tiền thối', 36000))
    assert choose_total(64000, printed) == 64000
    assert choose_total(None, printed) is None


def test_an_unranked_line_is_not_read_without_the_change_or_as_something_else():
    """TC-F10-23 no change printed, a line that is something else, or two candidates: no total from the unranked line (PR #124 round 2)"""
    assert choose_total(None, lines(('Thành tiền', 80000), ('Tiền mặt', 100000))) is None
    assert choose_total(None, lines(('Thành tiền', 80000), ('Tiền mặt', 100000), ('Tiền thối', 0))) is None
    for other in ('Tạm tính', 'Cộng tiền hàng', 'VAT', 'Điểm tích lũy', 'Tiền thuế', 'Giảm giá', 'Số lượng', 'Tiết kiệm'):
        assert choose_total(None, lines((other, 80000), ('Tiền khách đưa', 100000), ('Tiền thối', 20000))) is None, other
    # two figures that each plus a printed change give a printed amount: nothing says which one is the total
    assert choose_total(None, lines(('Thành tiền', 80000), ('Phải thu', 90000), ('Tiền khách đưa', 100000), ('Tiền thối', 20000),
                                    ('Trả lại', 10000))) is None
    # one that took an item is no total either
    assert choose_total(22000, lines(('Bánh mì x1', 22000), ('Thành tiền', 80000), ('Tiền khách đưa', 100000), ('Tiền thối', 20000))) is None
    # an identifier is not money, whatever the sum
    assert choose_total(None, lines(('Số HĐ', 80000), ('Tiền khách đưa', 100000), ('Tiền thối', 20000))) is None


@pytest.mark.parametrize('label', [
    'Total (incl. VAT)', 'TOTAL INCL. TAX', 'Total including VAT', 'Total (VAT included)', 'Total (inc. VAT)',
    'Tổng cộng (có VAT)', 'Tổng cộng (gồm 8% VAT)', 'Tổng cộng (giá đã có VAT)', 'Tổng cộng (bao gồm 8% VAT)',
    'Tổng cộng (đã bao gồm thuế GTGT 8%)', 'Tổng tiền đã gồm thuế', 'Tổng cộng (VAT 8% đã bao gồm)',
])
def test_a_vat_included_total(label):
    """TC-F10-23 a total printed as holding the VAT is read (BUG-034)"""
    assert picked(lines(('Cộng tiền hàng', 115100), ('Thuế GTGT', 9208), (label, 124308))) == {124308}
    assert choose_total(124308, lines((label, 124308))) == 124308


@pytest.mark.parametrize('label', [
    'Tổng cộng chưa bao gồm VAT', 'Tổng cộng (chưa có VAT)', 'Tổng tiền không bao gồm thuế', 'Total excl. VAT',
    'Total (not including VAT)', 'Total before tax', 'Tổng cộng trước thuế', 'Tổng thanh toán chưa VAT',
    'Tổng tiền trước chiết khấu', 'VAT included', 'Thuế VAT đã bao gồm', 'Tổng thuế sau giảm giá',
])
def test_a_figure_without_vat_or_the_vat_itself_is_not_the_total(label):
    """TC-F10-23 a figure before VAT or discounts, or the VAT amount itself, is never the total (BUG-034)"""
    assert picked(lines((label, 115100))) == set()
    assert choose_total(115100, lines((label, 115100))) is None


def test_voucher_so_tien():
    """TC-F10-25 a receipt voucher gives "Số tiền", not the made-up lines around it (BUG-035)"""
    recorded = lines(('SỐ TIỀN', 2500000), ('BẰNG CHỮ', 2000000), ('KÈM THEO', 500000), ('TỔNG', 3000000), ('TRẢ NHỎ', 1000000))
    assert picked(recorded) == set()  # made-up lines printed below the amount may be a later total: none (round 4)
    assert picked(lines(('SỐ TIỀN', 2500000), ('BẰNG CHỮ', 2000000), ('KÈM THEO', 0))) == {2500000}
    assert picked(lines(('Số tiền', 2500000), ('Số tiền (viết bằng chữ)', 2500000))) == {2500000}
    assert picked(lines(('Số tiền', 2500000), ('Số tiền viết bằng chữ', 2000000))) == {2500000}
    assert picked(lines(('Số tiền giảm', 20000), ('Số tiền khách đưa', 100000))) == set()


IDENTIFIERS = lines(
    ('Số: PT-09/2023', 2023), ('Số HĐ: 004829', 4829), ('Mã số thuế:', 109876543), ('MST', 312345678),
    ('Điện thoại: 024 3795 6688', 6688), ('Hotline', 71066866), ('Ngày: 14/05/2024', 2024), ('Số CT:', 2611240045789),
    ('Số tài khoản', 1234567890), ('Số phiếu thu', 1111))


def test_identifiers_are_never_picked_or_used_as_the_direct_total():
    """TC-F10-25 document numbers, dates, years, phone numbers and tax codes are never the total (BUG-035)"""
    assert picked(IDENTIFIERS) == set()
    for line in IDENTIFIERS:
        assert choose_total(line['amount'], IDENTIFIERS) is None, line


def test_printed_amounts_reads_only_money_shaped_numbers():
    """TC-F10-25 only money-shaped numbers of a verbatim re-read prove that a total is printed (BUG-035)"""
    text = ['Mã số thuế: 0109876543', 'Điện thoại: 024 3795 6688', 'Số: 0001258', 'Số: PT-09/2023', 'Số HD: 004829',
            'Ngày 12 tháng 11 năm 2026', 'Ngày: 14/05/2024 07:15', '2026-11-24 19:05', 'Ký hiệu: 1C26TTV', 'ĐT: 0283 838 4567',
            '8930000000017', '2611240045789', '2023', 'Hotline: 1900 1234', 'GD: 000XY0000000001 Ngày: 15/06/2025-16:53']
    assert printed_amounts(text) == set()
    money = ['Tổng cộng tiền thanh toán: 7.480.000', 'SỐ TIỀN: 2.500.000đ', 'TỔNG 87,000', 'Total 45000 VND',
             'Phải trả 92.400,00', '-22.700', '1 x 18.900', 'VND143,000', 'Tổng thanh toán 2.000']
    assert printed_amounts(money) >= {7480000, 2500000, 87000, 45000, 92400, 22700, 18900, 143000, 2000}
    # "Việt Nam" is not the "năm" of a date, and a label glued to its amount by a dot is not a code.
    assert printed_amounts(['Siêu thị Việt Nam 45.000', 'Tổng.52.000']) == {45000, 52000}


TORN_A_LINES = lines(('Thành tiền', 20000), ('Thành tiền', 15000), ('Thành tiền', 18000), ('TỔNG CỘNG:', 53000),
                     ('Tiền khách đã:', 53000), ('Tiền đổi trả:', 0), ('Số HD: 004829', 0))
TORN_A_TRANSCRIPT = ['CỬA HÀNG TIỆN LỢI MINH KHANG', 'ĐT: 0283 838 4567', 'Ngày: 14/05/2024', 'Số HD: 004829', 'Giờ: 18:42',
                     'Sữa chua uống Probi (lốc 5)', '20.000', 'Bánh mì sandwich', '15.000', 'Nước cam ép Twister 1L', '18.000',
                     'TỔNG CỘNG:', 'Tiền khách đư', 'Tiền thối l']


def test_torn_receipt_total_is_not_printed():
    """TC-F10-26 the "Tổng cộng" the model invents on a torn receipt is not in the verbatim re-read (BUG-036)"""
    invented = choose_total(53000, TORN_A_LINES)
    assert invented == 53000  # the line copy alone would present the item sum as printed
    assert invented not in printed_amounts(TORN_A_TRANSCRIPT)


# Cut just below the goods subtotal: the line copy relabels it as an amount to pay; the re-read shows what is printed.
CUT_BELOW_SUBTOTAL = {
    'shop receipt, label repeated': (115100,
        lines(('TỔNG TIỀN HÀNG:', 115100), ('ĐIỂM TÍCH LUY:', 22700), ('TỔNG TIỀN:', 115100), ('TỔNG TIỀN:', 115100)),
        ['Bánh quy bơ 300g', '1', '21.900', 'TỔNG TIỀN HÀNG:', '115.100', 'ĐIỂM TÍCH LUY:', '-22.700']),
    'VAT invoice': (6800000,
        lines(('Cộng tiền hàng:', 6800000), ('Tiền thuế GTGT:', 680000), ('Số tiền thanh toán:', 6800000)),
        ['4.000.000', '4.000.000', 'Cộng tiền hàng:', '6.800.000', 'Thuế suất GTGT: 10%', 'Tiền thuế GTGT:', '680.000']),
    'on one line, with the currency': (500000,
        lines(('Tổng cộng', 500000)), ['Tạm tính: 500.000 VND']),
}


@pytest.mark.parametrize('invented, recorded, reread', CUT_BELOW_SUBTOTAL.values(), ids=CUT_BELOW_SUBTOTAL.keys())
def test_goods_subtotal_relabelled_as_the_total(invented, recorded, reread):
    """TC-F10-26 an amount the re-read shows only as the goods subtotal is not the amount to pay (BUG-036)"""
    assert choose_total(invented, recorded) == invented
    assert goods_subtotal_only(invented, reread)


@pytest.mark.parametrize('total, reread', [
    (92400, ['Tổng tiền hàng', '92.400', 'Tiền cần thanh toán', '92.400']),
    (45000, ['Cộng tiền hàng: 45.000', 'Tổng thanh toán 45.000đ']),
    (2500000, ['Lý do: Thanh toán tiền hàng đợt 2', 'Số tiền:', '2.500.000 VND']),
    (63000, ['Tổng cộng :', 'Tiền khách trả:', 'VND', '63,000']),
    (87000, ['g cộng :', 'khách trả:']),
], ids=['equal to the subtotal', 'one line each', 'goods named in the reason', 'number below its labels', 'not shown at all'])
def test_a_total_printed_as_a_total_is_kept(total, reread):
    """TC-F10-24 a payable total that equals the goods subtotal is kept when it is printed as a total too"""
    assert not goods_subtotal_only(total, reread)


def test_direct_total_is_not_taken_from_a_subtotal_vat_or_cash_line():
    """TC-F10-26 with the total torn off, a goods subtotal, VAT, points, cash or change amount is not the total (BUG-036)"""
    torn = lines(('Cộng tiền hàng:', 6800000), ('Tiền thuế GTGT:', 680000), ('Điểm tích lũy', -22700), ('Tiền mặt', 100000), ('Tiền trả lại', 12500))
    for amount in (6800000, 680000, 100000, 12500):
        assert choose_total(amount, torn) is None, amount
    assert choose_total(115100, lines(('Tổng tiền hàng', 115100), ('Điểm tích lũy', -22700))) is None


def test_direct_total_is_not_used_when_no_copied_line_has_a_total_label():
    """TC-F10-24 the direct total alone is no total: a copied line under a total label must hold it too (PR #124 round 4)"""
    assert choose_total(87000, lines(('g cộng :', 87000), ('khách trả:', 100000), ('ra lại VND:', 13000))) is None
    assert choose_total(63000, lines(('Tổng cộng :', 0), ('63,000', 0))) is None
    assert choose_total(None, []) is None
    assert choose_total(92400, lines(('Tổng cộng', 115100), ('Tiền cần thanh toán', 92400))) == 92400


def test_money_is_whole_vnd_from_1_to_10_13():
    """TC-F10-25 money is a whole number of VND from 1 to 10^13 (BUG-035)"""
    assert MAX_MONEY == 10**13
    assert is_money(1) and is_money(MAX_MONEY)
    for bad in (0, -5, MAX_MONEY + 1, 12.5, 100.0, True, None, '45000'):
        assert not is_money(bad), bad
    assert picked(lines(('Tổng cộng', MAX_MONEY + 1))) == set()
    assert choose_total(MAX_MONEY + 1, []) is None
    assert picked(lines(('Tổng thanh toán', 45000), ('Tổng thanh toán', 0))) == {45000}  # a later 0 hides nothing


@pytest.mark.parametrize('printed, expected', [
    ('14/05/2024', '14/05/2024'), ('Ngày: 4/5/2024 07:15', '04/05/2024'), ('13-06-2025', '13/06/2025'),
    ('15.06.2025-16:53', '15/06/2025'), ('2026-11-24 19:05', '24/11/2026'), ('Ngày 12 tháng 11 năm 2026', '12/11/2026'),
    ('10/06/25', '10/06/2025'), ('31/02/2024', ''), ('0283 838 4567', ''), ('09/2023', ''), ('', ''), (None, ''),
])
def test_receipt_date(printed, expected):
    """TC-F10-29 the date is dd/mm/yyyy, or empty when the receipt shows no real date"""
    assert receipt_date(printed) == expected


# ---- Round 3 of the PR #124 review (head c51abf5): the receipts on which the picker answered the cash, a pre-fee total or an
# item as the exact total. The rule that these tests keep: a total is presented only when the reads agree on it; the cash and
# the change can only take a candidate away, and a torn receipt gives no total.
B1_CASH_LABELS = ['Thanh toán', 'Đã thanh toán', 'Tiền nộp', 'Khách nộp', 'Đã trả', 'Nhận', 'Thu khách', 'Payment', 'Paid', 'Đưa']


@pytest.mark.parametrize('cash_label', B1_CASH_LABELS)
def test_b1_a_change_that_equals_a_fee_does_not_turn_the_total_into_the_cash(cash_label):
    """TC-F10-24 the cash under any label and a change that equals a fee: the amount to pay stays the total, never the cash or the pre-fee figure (PR #124 round 3 B1)"""
    copied = lines(('Total', 160000), ('Phí đóng gói', 20000), ('Khách cần trả', 180000), (cash_label, 200000), ('Trả lại', 20000))
    assert choose_total(180000, copied) == 180000
    for direct in (160000, 200000, None):  # a direct read that took the pre-fee figure or the cash is never presented
        assert choose_total(direct, copied) in (180000, None), direct
    vat = lines(('Thành tiền', 100000), ('VAT 10%', 10000), ('Tổng thanh toán', 110000), (cash_label, 120000), ('Tiền thối', 10000))
    assert choose_total(110000, vat) == 110000
    for direct in (100000, 120000, None):
        assert choose_total(direct, vat) in (110000, None), direct


def test_b2_two_surcharge_lines_between_two_totals_when_paid_exactly():
    """TC-F10-24 paid exactly in cash, with two surcharge lines between a bare total and the final total: the final total is kept (PR #124 round 3 B2)"""
    copied = lines(('Tổng tiền', 100000), ('Phí phục vụ 5%', 5000), ('Phụ thu lễ', 10000), ('Tổng cộng', 115000), ('Tiền mặt', 115000))
    printed = ['Tổng tiền 100.000', 'Phí phục vụ 5% 5.000', 'Phụ thu lễ 10.000', 'Tổng cộng 115.000', 'Tiền mặt 115.000']
    assert choose_total(115000, copied, printed) == 115000
    assert choose_total(115000, copied) == 115000
    for direct in (100000, None):
        assert choose_total(direct, copied, printed) in (115000, None), direct
    real = lines(('Tổng tiền', 380000), ('Phí giao hàng', 15000), ('Phụ thu', 12000), ('Total', 407000), ('Khách đưa', 407000))
    assert choose_total(407000, real) == 407000


def test_b3_a_torn_receipt_with_items_and_no_total_gives_no_total():
    """TC-F10-26 cut after the items, a direct read that is the amount of one item is not a total, although that amount is printed (PR #124 round 3 B3)"""
    two = lines(('Bò lúc lắc', 54000), ('Rau muống xào tỏi', 163500))
    printed = ['Bò lúc lắc 1 54.000', 'Rau muống xào tỏi 3 54.500', '54.000đ', '163.500đ']
    assert choose_total(163500, two, printed) is None
    four = lines(('Rau muống xào tỏi x3', 267000), ('Tôm hùm nướng x3', 168000), ('Gà nướng mật ong x1', 94900), ('Lẩu thái hải sản x1', 63400))
    printed = ['Rau muống xào tỏi x3 89.000 267.000', 'Tôm hùm nướng x3 56.000 168.000', 'Gà nướng mật ong x1 94.900', 'Lẩu thái hải sản x1 63.400']
    assert choose_total(63400, four, printed) is None
    # the item amounts, one by one, whatever the direct read took
    for line in four:
        assert choose_total(line['amount'], four, printed) is None, line


def test_s1_an_unranked_total_label_does_not_trust_the_direct_read():
    """TC-F10-24 a total label we do not rank, with a goods subtotal we do not know: the goods subtotal or a points number is not presented (PR #124 round 3 S1)"""
    copied = lines(('Giá trị đơn', 140000), ('Phụ thu', 15000), ('Thu khách', 155000), ('MoMo', 155000))
    assert choose_total(140000, copied) is None  # the figure that the surcharge below it changes
    assert choose_total(155000, copied) in (155000, None)
    # a number that is on no line of the copy, only printed on a points line
    fuel = lines(('Thành tiền', 489100), ('Tích điểm: +489', 489))
    assert choose_total(489, fuel, ['Thành tiền 489.100đ', 'Tích điểm: +489']) is None


def test_the_currency_nit_a_total_in_another_currency_is_not_picked_under_an_amount_to_pay_label():
    """TC-F10-25 a total in another currency is never the VND total, not even under an amount-to-pay label (PR #124 round 3 nit)"""
    both = lines(('Tổng thanh toán (VND)', 612500), ('Tổng thanh toán (USD)', 2450))
    assert choose_total(2450, both) is None
    assert choose_total(612500, both) in (612500, None)
    assert picked(lines(('Tổng thanh toán (USD)', 2450))) == set()


def test_the_nit_a_product_with_total_in_its_name_is_a_line_item():
    """TC-F10-23 an item whose name has "Total" in it ("Colgate Total") stays in the line items (PR #124 round 3 nit)"""
    assert not is_foot_line('Kem đánh răng Colgate Total')
    assert not is_foot_line('Sữa Total 1L')
    for foot in ('Tổng cộng', 'TOTAL', 'Tiền khách đưa', 'Tiền thối', 'Cash'):
        assert is_foot_line(foot), foot

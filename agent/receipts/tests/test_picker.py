# The pure rules that decide which amount is the payable total (docs/02 §2.6). The line lists are what the real
# model copied from our synthetic test receipts (spike 2026-11-25), shortened to the lines that matter.
import pytest

from picker import MAX_MONEY, choose_total, goods_subtotal_only, is_money, pick_total, printed_amounts, receipt_date


def lines(*pairs):
    return [{'label': label, 'amount': amount} for label, amount in pairs]


VAT = {
    'goods subtotal, VAT line, then the payable total': lines(
        ('Cộng tiền hàng:', 6800000), ('Thuế suất GTGT: 10%', 680000), ('Tổng cộng tiền thanh toán:', 7480000),
        ('Số tiền viết bằng chữ: Bảy triệu bốn trăm tám mươi mươi nghìn đồng.', 7480000)),
    'total payment before item lines and a wrong amount in words': lines(
        ('Cộng tiền hàng hóa, dịch vụ:', 6800000), ('Tiền thuế GTGT:', 680000), ('Tổng tiền thanh toán:', 7480000),
        ('Số tiền viết bằng chữ:', 4810000), ('Thành tiền:', 3600000), ('Thành tiền:', 2000000)),
    'bilingual labels': lines(
        ('Cộng tiền hàng (Total amount):', 6800000), ('Thuế suất GTGT (VAT rate): 10%', 680000),
        ('Tổng cộng tiền thanh toán (Total payment):', 7480000)),
    'a total that says VAT is included is not a VAT line': lines(
        ('Cộng tiền hàng', 6800000), ('Tiền thuế GTGT 10%', 680000), ('Tổng cộng (đã bao gồm VAT)', 7480000)),
}


@pytest.mark.parametrize('recorded', VAT.values(), ids=VAT.keys())
def test_vat_invoice(recorded):
    """TC-F10-23 a VAT invoice gives the payable total, never the goods subtotal or the VAT (BUG-034)"""
    assert pick_total(recorded) == 7480000


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
    assert pick_total(recorded) == expected


# The line copies of the PR #124 review (the right total is 87000), where a really printed amount won: change, cash
# received and savings.
REVIEW_COPIES = {
    'change, "phải trả lại"': [('Tổng cộng', 87000), ('Tiền khách đưa', 100000), ('Tiền phải trả lại', 13000)],
    'change after the amount to pay': [('Khách phải trả', 87000), ('Tiền mặt', 100000), ('Phải trả lại khách', 13000)],
    'change, upper case': [('TỔNG CỘNG', 87000), ('TIỀN MẶT', 100000), ('TIỀN PHẢI TRẢ LẠI', 13000)],
    'change, "còn phải trả lại"': [('Tổng thanh toán', 87000), ('Khách đưa', 100000), ('Còn phải trả lại', 13000)],
    'cash received as "số tiền nhận"': [('Thành tiền', 87000), ('Số tiền nhận', 100000), ('Số tiền thừa', 13000)],
    'cash received as "thanh toán"': [('Tổng cộng', 87000), ('Thanh toán', 100000), ('Tiền thừa', 13000)],
    '"thanh toán" cash under "thành tiền"': [('Thành tiền', 87000), ('Thanh toán', 100000), ('Tiền thừa', 13000)],
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
    assert pick_total(recorded) in (87000, None)
    for _, wrong in copied:  # even a direct read that took the wrong line does not get it through
        assert choose_total(wrong, recorded) in (87000, None), wrong


NEVER_THE_TOTAL = [
    # change
    'Tiền phải trả lại', 'Phải trả lại khách', 'Số tiền phải trả lại', 'Cần trả lại', 'Còn phải trả lại',
    'Tiền thừa phải trả khách', 'Phải trả khách', 'Tiền phải thối lại', 'Tiền phải đổi lại', 'Trả lại tiền thừa',
    'Hoàn lại khách', 'Amount to pay back', 'Change due',
    # cash received
    'Số tiền nhận', 'Số tiền đã nhận', 'Tổng tiền nhận', 'Tiền nhận của khách', 'Số tiền khách gửi', 'Tiền khách gửi',
    'Tổng tiền khách đưa', 'Số tiền khách trả', 'Total received', 'Amount received', 'Total cash tendered',
    # savings
    'Số tiền tiết kiệm', 'Tổng tiền tiết kiệm', 'Tổng tiền đã tiết kiệm', 'TỔNG CỘNG TIẾT KIỆM', 'Total savings',
    'Total saved', 'Total you save',
    # debts and balances
    'Số tiền còn nợ', 'Tổng tiền còn nợ', 'Tổng nợ', 'Tổng công nợ', 'Số tiền nợ cũ', 'Tổng số dư',
]


@pytest.mark.parametrize('label', NEVER_THE_TOTAL)
def test_a_line_that_is_never_the_total(label):
    """TC-F10-24 no wording of change, cash received, savings or a debt is picked, in any label group (BUG-037)"""
    assert pick_total(lines(('Tổng cộng', 115100), (label, 15000))) == 115100
    assert pick_total(lines(('Tiền cần thanh toán', 92400), (label, 7600))) == 92400
    assert pick_total(lines((label, 7600))) is None
    assert choose_total(7600, lines((label, 7600))) is None


@pytest.mark.parametrize('label', ['Số tiền đặt cọc', 'Số tiền trong quỹ', 'Số tiền làm tròn', 'Số tiền gửi xe'])
def test_so_tien_of_something_else_does_not_beat_the_total(label):
    """TC-F10-25 only a bare voucher "Số tiền" ranks above "Tổng cộng" (BUG-035)"""
    assert pick_total(lines(('Tổng cộng', 115100), (label, 15000))) == 115100


@pytest.mark.parametrize('label', ['Số tiền:', 'SỐ TIỀN (VNĐ)', 'Số tiền (Amount):', 'Số tiền bằng số', 'Số tiền thu',
                                   'Số tiền chi', 'Số tiền thanh toán', 'Số tiền giao dịch', 'Số tiền chuyển khoản',
                                   'Đã nhận đủ số tiền', 'Đã nhận đủ số tiền (viết bằng chữ)'])
def test_voucher_so_tien_wordings(label):
    """TC-F10-25 the amount line of a voucher or transfer slip is still read, also "Đã nhận đủ số tiền" (BUG-035)"""
    assert pick_total(lines((label, 2500000), ('TỔNG', 3000000))) == 2500000


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
]


@pytest.mark.parametrize('adjustment, off, label, total', AFTER_LINES, ids=[row[2] for row in AFTER_LINES])
def test_the_total_after_vat_or_a_discount(adjustment, off, label, total):
    """TC-F10-23 the total printed after VAT or a discount is the total, not the figure before it (BUG-034)"""
    recorded = lines(('Tổng cộng', 115100), (adjustment, off), (label, total))
    assert pick_total(recorded) == total
    assert choose_total(total, recorded) == total
    assert choose_total(115100, recorded) == total


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
}


@pytest.mark.parametrize('copied', CHANGED_LATER.values(), ids=CHANGED_LATER.keys())
def test_a_figure_a_later_vat_or_discount_line_changes_is_not_presented(copied):
    """TC-F10-23 a figure that a later VAT or discount line changes is not presented as the total (BUG-034)"""
    recorded = lines(*copied)
    assert pick_total(recorded) is None
    assert choose_total(copied[0][1], recorded) is None


def test_a_direct_total_that_adds_up_with_vat_and_discounts_is_kept():
    """TC-F10-23 subtotal + VAT - discounts confirms the direct total, and nothing else (BUG-034)"""
    vat = lines(('Tổng cộng', 115100), ('Thuế VAT 8%', 9208))
    assert choose_total(124308, vat) == 124308
    both = lines(('Tổng cộng', 100000), ('Giảm giá', 10000), ('Thuế GTGT', 7200))
    assert choose_total(97200, both) == 97200
    assert choose_total(92000, lines(('Tổng cộng', 115100), ('Giảm giá', 23100))) == 92000
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
    'the total says VAT is included': [('Tổng cộng (đã bao gồm VAT)', 87000), ('VAT 8%', 6444)],
    'the total is the one after VAT': [('Tổng cộng sau VAT', 87000), ('VAT 8%', 6444)],
    'an amount to pay, then the VAT in it': [('Khách phải trả', 87000), ('VAT 8%', 6444)],
    'no discount and no VAT': [('Tổng cộng', 87000), ('Giảm giá', 0), ('Thuế', 0)],
    'points earned and a points balance': [('Tổng cộng', 87000), ('Điểm tích lũy', 87), ('Tổng điểm', 1520)],
    'the sum of the discounts already taken off': [('Tổng cộng', 87000), ('Tổng tiền đã giảm', 8000)],
    'savings': [('Tổng cộng', 87000), ('Bạn đã tiết kiệm', 8000)],
}


@pytest.mark.parametrize('copied', UNCHANGED.values(), ids=UNCHANGED.keys())
def test_a_total_that_later_lines_leave_alone_is_kept(copied):
    """TC-F10-23 a total that already holds the VAT and discounts printed below it is kept (BUG-034)"""
    recorded = lines(*copied)
    assert pick_total(recorded) == 87000
    assert choose_total(87000, recorded) == 87000


def test_two_reads_naming_different_totals_give_no_total():
    """TC-F10-24 a picked line does not silently override another total line the direct read took (BUG-037)"""
    assert choose_total(87000, lines(('Tổng cộng', 87000), ('Thanh toán', 100000))) is None
    assert choose_total(115100, lines(('Tổng cộng', 115100), ('Thanh toán', 92000))) is None
    assert choose_total(80000, lines(('Tổng thanh toán', 80000), ('Khách phải trả', 87000))) is None
    # A better label still wins, and the model's own conversion of the amount in words never counts.
    assert choose_total(115000, lines(('Tổng cộng', 115000), ('Khách cần trả', 92000))) == 92000
    assert choose_total(2000000, lines(('SỐ TIỀN', 2500000), ('Số tiền viết bằng chữ', 2000000))) == 2500000


@pytest.mark.parametrize('label', [
    'Total (incl. VAT)', 'TOTAL INCL. TAX', 'Total including VAT', 'Total (VAT included)', 'Total (inc. VAT)',
    'Tổng cộng (có VAT)', 'Tổng cộng (gồm 8% VAT)', 'Tổng cộng (giá đã có VAT)', 'Tổng cộng (bao gồm 8% VAT)',
    'Tổng cộng (đã bao gồm thuế GTGT 8%)', 'Tổng tiền đã gồm thuế', 'Tổng cộng (VAT 8% đã bao gồm)',
])
def test_a_vat_included_total(label):
    """TC-F10-23 a total printed as holding the VAT is read (BUG-034)"""
    assert pick_total(lines(('Cộng tiền hàng', 115100), ('Thuế GTGT', 9208), (label, 124308))) == 124308
    assert choose_total(124308, lines((label, 124308))) == 124308


@pytest.mark.parametrize('label', [
    'Tổng cộng chưa bao gồm VAT', 'Tổng cộng (chưa có VAT)', 'Tổng tiền không bao gồm thuế', 'Total excl. VAT',
    'Total (not including VAT)', 'Total before tax', 'Tổng cộng trước thuế', 'Tổng thanh toán chưa VAT',
    'Tổng tiền trước chiết khấu', 'VAT included', 'Thuế VAT đã bao gồm', 'Tổng thuế sau giảm giá',
])
def test_a_figure_without_vat_or_the_vat_itself_is_not_the_total(label):
    """TC-F10-23 a figure before VAT or discounts, or the VAT amount itself, is never the total (BUG-034)"""
    assert pick_total(lines((label, 115100))) is None
    assert choose_total(115100, lines((label, 115100))) is None


def test_voucher_so_tien():
    """TC-F10-25 a receipt voucher gives "Số tiền", not the made-up lines around it (BUG-035)"""
    recorded = lines(('SỐ TIỀN', 2500000), ('BẰNG CHỮ', 2000000), ('KÈM THEO', 500000), ('TỔNG', 3000000), ('TRẢ NHỎ', 1000000))
    assert pick_total(recorded) == 2500000
    assert pick_total(lines(('Số tiền', 2500000), ('Số tiền (viết bằng chữ)', 2500000))) == 2500000
    assert pick_total(lines(('Số tiền', 2500000), ('Số tiền viết bằng chữ', 2000000))) == 2500000
    assert pick_total(lines(('Số tiền giảm', 20000), ('Số tiền khách đưa', 100000))) is None


IDENTIFIERS = lines(
    ('Số: PT-09/2023', 2023), ('Số HĐ: 004829', 4829), ('Mã số thuế:', 109876543), ('MST', 312345678),
    ('Điện thoại: 024 3795 6688', 6688), ('Hotline', 71066866), ('Ngày: 14/05/2024', 2024), ('Số CT:', 2611240045789),
    ('Số tài khoản', 1234567890), ('Số phiếu thu', 1111))


def test_identifiers_are_never_picked_or_used_as_the_direct_total():
    """TC-F10-25 document numbers, dates, years, phone numbers and tax codes are never the total (BUG-035)"""
    assert pick_total(IDENTIFIERS) is None
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


TORN_A_LINES = lines(('TỔNG CỘNG:', 53000), ('Tiền khách đã:', 53000), ('Tiền đổi trả:', 0), ('Thành tiền', 20000),
                     ('Thành tiền', 15000), ('Thành tiền', 18000), ('Số HD: 004829', 0))
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


def test_direct_total_is_used_when_no_line_is_picked():
    """TC-F10-24 the direct total is used when no copied line has a payable label"""
    assert choose_total(87000, lines(('g cộng :', 87000), ('khách trả:', 100000), ('ra lại VND:', 13000))) == 87000
    assert choose_total(63000, lines(('Tổng cộng :', 0), ('63,000', 0))) == 63000
    assert choose_total(None, []) is None
    assert choose_total(92400, lines(('Tổng cộng', 115100), ('Tiền cần thanh toán', 92400))) == 92400


def test_money_is_whole_vnd_from_1_to_10_13():
    """TC-F10-25 money is a whole number of VND from 1 to 10^13 (BUG-035)"""
    assert MAX_MONEY == 10**13
    assert is_money(1) and is_money(MAX_MONEY)
    for bad in (0, -5, MAX_MONEY + 1, 12.5, 100.0, True, None, '45000'):
        assert not is_money(bad), bad
    assert pick_total(lines(('Tổng cộng', MAX_MONEY + 1))) is None
    assert choose_total(MAX_MONEY + 1, []) is None
    assert pick_total(lines(('Tổng thanh toán', 45000), ('Tổng thanh toán', 0))) == 45000  # a later 0 hides nothing


@pytest.mark.parametrize('printed, expected', [
    ('14/05/2024', '14/05/2024'), ('Ngày: 4/5/2024 07:15', '04/05/2024'), ('13-06-2025', '13/06/2025'),
    ('15.06.2025-16:53', '15/06/2025'), ('2026-11-24 19:05', '24/11/2026'), ('Ngày 12 tháng 11 năm 2026', '12/11/2026'),
    ('10/06/25', '10/06/2025'), ('31/02/2024', ''), ('0283 838 4567', ''), ('09/2023', ''), ('', ''), (None, ''),
])
def test_receipt_date(printed, expected):
    """TC-F10-29 the date is dd/mm/yyyy, or empty when the receipt shows no real date"""
    assert receipt_date(printed) == expected

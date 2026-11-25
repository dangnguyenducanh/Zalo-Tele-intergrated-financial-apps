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

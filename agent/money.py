# Money in a reply, written as Express writes it (server/src/bot/core.js money(): Intl.NumberFormat 'currency' VND).
# shared/fixtures/money.json is read by this module's pytest and by Express's vitest, so the two can never drift apart.


def money(amount, language):
    """1100000 → '1.100.000 ₫' (a no-break space before the sign) in Vietnamese, '₫1,100,000' in English; minus in front."""
    if type(amount) is not int:  # not float (a total that is not exact), not bool, not text: refuse rather than guess
        raise TypeError('money() takes whole dong as an int')
    digits = f'{abs(amount):,}'
    sign = '-' if amount < 0 else ''
    if language == 'en':
        return f'{sign}₫{digits}'
    return f'{sign}{digits.replace(",", ".")} ₫'

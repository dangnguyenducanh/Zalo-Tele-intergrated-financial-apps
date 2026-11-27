# The reading method: three reads of the photo at once, the picker (the direct read and the copied lines must agree), then
# the check that the chosen total is really printed. A total no verbatim re-read shows is not returned: the app asks the user to type it.
import asyncio
import time

from picker import choose_total, goods_subtotal_only, is_foot_line, is_money, printed_amounts, receipt_date
from vllm_client import BadAnswer, NotTheAskedJson, Receipt

TOLERANCE = 1000  # VND: line items that add up to the total within this "match" (KIE's tolerance)


def _ms(since):
    return round((time.monotonic() - since) * 1000)


async def _reread(model, task, image_url):
    """The lines of a verbatim re-read. A re-read the model answers badly shows nothing."""
    try:
        return (await model.ask(task, image_url)).texts
    except BadAnswer:
        return []


async def _direct(model, image_url):
    """The direct read. One the model answers with something other than the asked JSON (a page with no money lines can
    do that) reads nothing: the copied lines and the re-read still decide the total, and without them it is "no total"."""
    try:
        return await model.ask('receipt', image_url)
    except NotTheAskedJson:
        return Receipt(merchant=None, address=None, date=None, items=[], total_payable=None)


async def read_receipt(model, image_url):
    """The photo → the answer of POST /analyze."""
    started = time.monotonic()
    # The re-read does not depend on the other two, so all three run at once (vLLM batches them).
    direct, copied, transcript = await asyncio.gather(
        _direct(model, image_url), model.ask('lines', image_url), _reread(model, 'transcript', image_url))
    timings = {'read': _ms(started)}

    total = choose_total(direct.total_payable, [line.model_dump() for line in copied.lines], transcript)
    if total and goods_subtotal_only(total, transcript):
        total = None  # the paper shows it as the goods subtotal; the amount to pay is torn off
    elif total and total not in printed_amounts(transcript):
        checking = time.monotonic()
        if total not in printed_amounts(await _reread(model, 'numbers', image_url)):
            total = None  # most likely made up, e.g. the sum of the items on a torn receipt
        timings['check'] = _ms(checking)
    return answer(direct, total, timings)


def answer(direct, total, timings):
    """The contract of docs/04 §4.8 (the KIE fields the app reads)."""
    items = [
        {'name': item.name.strip(), 'quantity': item.quantity if item.quantity and 0 < item.quantity < 1e6 else 1,
         'unit_price': item.unit_price if is_money(item.unit_price) else None, 'amount': item.amount}
        for item in direct.items if item.name.strip() and is_money(item.amount) and not is_foot_line(item.name)
    ]
    adds_up = bool(total and items) and abs(sum(item['amount'] for item in items) - total) <= TOLERANCE
    return {
        'fields': {'total': str(total or ''), 'merchant': (direct.merchant or '').strip(),
                   'address': (direct.address or '').strip(), 'date': receipt_date(direct.date)},
        'line_items': items,
        'reconciliation': {'is_math_consistent': adds_up},
        'timings_ms': timings,
    }

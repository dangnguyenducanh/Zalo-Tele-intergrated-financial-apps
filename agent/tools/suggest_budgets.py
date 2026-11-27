# suggest_budgets(month, top?): a limit for each expense category of `month`, the median of its monthly totals over the 3 months before it, rounded up to
# the next 50.000 ₫ (docs/02 §2.11.2 B4, §2.11.3). A category counts the months in which it had spending: with only 2 months (or 1) the median of those.
from pydantic import BaseModel, ConfigDict

from ..money import money
from .budgets import month_bounds
from .registry import Limit
from .scope import MAX_TIME_MS, MonthText, category_name, confirmed

STEP = 50_000  # whole dong: a budget is a round number
WINDOW = 3
TEXT = {
    'vi': {'label': 'Gợi ý ngân sách', 'month': 'tháng {month}/{year}', 'none': 'chưa có chi tiêu trong 3 tháng trước để gợi ý'},
    'en': {'label': 'Suggested budget', 'month': '{month}/{year}', 'none': 'no spending in the 3 months before to go on'},
}


class Args(BaseModel):
    model_config = ConfigDict(extra='forbid')
    month: MonthText  # the month to suggest limits for; the 3 months before it are read
    top: Limit = 5  # how many suggestions the answer shows (the data keeps them all)


def months_before(month, count):
    """The `count` months before 'YYYY-MM', oldest first."""
    index = int(month[:4]) * 12 + int(month[5:]) - 1
    return [f'{(index - back) // 12:04d}-{(index - back) % 12 + 1:02d}' for back in range(count, 0, -1)]


def suggestion(totals):
    """The median of the monthly totals rounded up to the next STEP, exact: the median is held doubled so a median of two is not a float."""
    ordered, middle = sorted(totals), len(totals) // 2
    twice = 2 * ordered[middle] if len(ordered) % 2 else ordered[middle - 1] + ordered[middle]
    return -(-twice // (2 * STEP)) * STEP


def handle(ctx, args):
    window = months_before(args.month, WINDOW)
    first, _ = month_bounds(window[0])
    until, _ = month_bounds(args.month)
    rows = ctx.db['transactions'].aggregate([
        {'$match': {**confirmed(ctx), 'type': 'expense', 'occurredAt': {'$gte': first, '$lt': until}}},
        {'$group': {'_id': {'category': '$categoryId', 'month': {'$dateToString': {'format': '%Y-%m', 'date': '$occurredAt', 'timezone': '+07:00'}}}, 'total': {'$sum': '$amount'}}}],
        maxTimeMS=MAX_TIME_MS)
    by_category = {}
    for row in rows:
        if round(row['total']) > 0:
            by_category.setdefault(row['_id']['category'], []).append(round(row['total']))
    live = {row['_id']: row for row in ctx.db['categories'].find(
        {'userId': ctx.user_id, 'deletedAt': None, 'type': 'expense'}, {'name': 1, 'names': 1}, max_time_ms=MAX_TIME_MS)}
    found = [{'categoryId': cid, 'name': category_name(live[cid], ctx.language), 'suggested': suggestion(totals), 'months': len(totals)}
             for cid, totals in by_category.items() if cid in live]
    found.sort(key=lambda row: (-row['suggested'], row['categoryId']))  # the biggest first, then the category made first
    text = TEXT.get(ctx.language, TEXT['vi'])
    heading = f"{text['label']} {text['month'].format(month=int(args.month[5:]), year=args.month[:4])}"  # "Gợi ý ngân sách tháng 12/2026": the month it is for
    facts = [{'id': str(row['categoryId']), 'label': f"{heading} · {row['name']}", 'display': money(row['suggested'], ctx.language)} for row in found[:args.top]]
    data = {'month': args.month, 'basedOn': window, 'suggestions': [{**row, 'categoryId': str(row['categoryId'])} for row in found]}
    return data, facts or [{'id': 'none', 'label': text['label'], 'display': text['none']}]

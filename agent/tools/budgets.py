# What get_budgets and get_budget_pace both read (docs/02 §2.11.3, docs/03 `budgets`): a month's budgets with how much of each is spent, the way
# services/budgets.js lists them: the overall budget has no category, its spent is every confirmed expense of the month, and the budget of a deleted
# category is left out.
from datetime import date
from fractions import Fraction

from .get_period_summary import day_start
from .scope import MAX_TIME_MS, category_name, confirmed, own_ids

OVERALL = {'vi': 'Tổng', 'en': 'Overall'}


def month_bounds(month):
    """[start, end) of 'YYYY-MM' in Vietnam time, as aware UTC datetimes."""
    year, number = int(month[:4]), int(month[5:])
    return day_start(date(year, number, 1)), day_start(date(year + (number == 12), number % 12 + 1, 1))


def percent(spent, limit):
    """Whole percent used, rounded half up as Math.round does on the Budgets page (it may pass 100)."""
    return (2 * spent * 100 + limit) // (2 * limit)


def spent_in_month(ctx, month):
    """({categoryId: total}, total of all) of the month's confirmed expenses, in whole dong."""
    first, after = month_bounds(month)
    rows = ctx.db['transactions'].aggregate(
        [{'$match': {**confirmed(ctx), 'type': 'expense', 'occurredAt': {'$gte': first, '$lt': after}}}, {'$group': {'_id': '$categoryId', 'total': {'$sum': '$amount'}}}],
        maxTimeMS=MAX_TIME_MS)
    by_category = {row['_id']: round(row['total']) for row in rows}
    return by_category, sum(by_category.values())


def budget_rows(ctx, month, category_ids):
    """(rows, names) for the month: rows are [{categoryId (None for the overall budget), name, limit, spent, percent}], the overall one first, then the fullest
    first; with `category_ids` (checked to be the user's own) only the budgets of those categories. `names` is {categoryId: name} of the live categories asked for,
    so a caller can say that one has no budget."""
    wanted = own_ids(ctx, 'categories', category_ids)
    budgets = list(ctx.db['budgets'].find({'userId': ctx.user_id, 'month': month}, {'categoryId': 1, 'limit': 1}, max_time_ms=MAX_TIME_MS))
    live = {row['_id']: row for row in ctx.db['categories'].find({'userId': ctx.user_id, 'deletedAt': None}, {'name': 1, 'names': 1}, max_time_ms=MAX_TIME_MS)}
    by_category, everything = spent_in_month(ctx, month)
    rows = []
    for budget in budgets:
        cid, limit = budget.get('categoryId'), round(budget['limit'])
        if limit <= 0 or (cid is not None and cid not in live) or (wanted and cid not in wanted):
            continue
        spent = everything if cid is None else by_category.get(cid, 0)
        rows.append({'categoryId': cid, 'name': OVERALL.get(ctx.language, OVERALL['vi']) if cid is None else category_name(live[cid], ctx.language),
                     'limit': limit, 'spent': spent, 'percent': percent(spent, limit)})
    rows.sort(key=lambda row: (row['categoryId'] is not None, -Fraction(row['spent'], row['limit']), str(row['categoryId'])))
    return rows, {cid: category_name(live[cid], ctx.language) for cid in wanted}

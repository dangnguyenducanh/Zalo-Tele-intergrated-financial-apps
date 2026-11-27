# compare_periods(start, end, unit?, categoryIds?): income and expense of a period against the period before it (docs/02 §2.11.3 "Number rules").
# The rule is the one of compareRange() in server/src/utils/vnTime.js and of the Dashboard's MonthCompare (sameDays.ts); all three are tested on
# shared/fixtures/compare-range.json. `unit` is what period.py knows about the phrase (day, week, month, year): the model never sets it, so it is
# left out of the schema the model is shown (Tool.hidden).
from calendar import monthrange
from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..money import money
from .get_period_summary import day_start
from .scope import MAX_TIME_MS, ObjectIdText, category_name, confirmed, own_ids

UNITS = ('day', 'week', 'month', 'year')
LABELS = {'vi': {'expense': 'Chi', 'income': 'Thu', 'versus': 'so với cùng kỳ trước'}, 'en': {'expense': 'Expense', 'income': 'Income', 'versus': 'vs the period before'}}


def days_in_month(year, month):
    return monthrange(year, month)[1]


def shift_months(first, last, months):
    """Both ends back by `months`, keeping the day of the month and capping it at the shorter month's last day (31/03 → 28/02). A period from the 1st to a
    month's last day is taken as a whole month and goes to the whole month before (dates alone cannot tell it from a month to date: see ranges())."""
    whole = first.day == 1 and last.day == days_in_month(last.year, last.month)

    def back(day, to_last_day):
        year, index = divmod(day.year * 12 + day.month - 1 - months, 12)
        end = days_in_month(year, index + 1)
        return date(year, index + 1, end if to_last_day else min(day.day, end))

    return back(first, False), back(last, whole)


def implied_unit(first, last):
    """The unit the dates alone say, the first line that fits: one day; from 1/1 and past January a year; from the 1st a month; from a Monday for at most 7 days a week."""
    if first == last:
        return 'day'
    if (first.month, first.day) == (1, 1) and (last.year > first.year or last.month > 1):
        return 'year'
    if first.day == 1:
        return 'month'
    if first.weekday() == 0 and (last - first).days + 1 <= 7:
        return 'week'
    return None


def compare_range(start, end, unit=None):
    """The period one calendar unit before [start, end] (both Vietnam days, both included): Mon 23-Wed 25/11 → Mon 16-Wed 18/11, 01-25/11 → 01-25/10,
    01-31/10 → 01-30/09. Without a unit the dates decide; no unit fits: the period shifts back by its own length. ValueError for a start after the end
    or an unknown unit."""
    if unit is not None and unit not in UNITS:
        raise ValueError(f'unknown unit {unit}')
    if start > end:
        raise ValueError('start is after end')
    chosen = unit or implied_unit(start, end)
    if chosen in ('month', 'year'):
        return shift_months(start, end, 1 if chosen == 'month' else 12)
    days = 1 if chosen == 'day' else 7 if chosen == 'week' else (end - start).days + 1
    return start - timedelta(days=days), end - timedelta(days=days)


def month_compare(month, today):
    """What the Dashboard's MonthCompare adds up for 'YYYY-MM' on `today`: the current month days 1..N in both months (N = today's day, capped at the last day
    of the month before, so both sides have as many days); any other month, past or to come, the whole month against the whole month before."""
    year, number = int(month[:4]), int(month[5:])
    before_year, before_number = (year, number - 1) if number > 1 else (year - 1, 12)
    before_last = days_in_month(before_year, before_number)
    if f'{today:%Y-%m}' != month:
        return (date(year, number, 1), date(year, number, days_in_month(year, number))), (date(before_year, before_number, 1), date(before_year, before_number, before_last))
    last = min(today.day, before_last)
    return (date(year, number, 1), date(year, number, last)), (date(before_year, before_number, 1), date(before_year, before_number, last))


def ranges(start, end, unit, today):
    """(current, previous), each (first, last): the two periods compare_periods adds up. A whole calendar month follows the Dashboard (month_compare). Any other
    period that has not ended yet stops at today, so a week that is Wednesday so far meets Mon-Wed of the week before; one that is over, or still to come, is whole."""
    if unit == 'month' and start.day == 1 and end == date(start.year, start.month, days_in_month(start.year, start.month)):
        return month_compare(f'{start:%Y-%m}', today)
    if start <= today < end:
        end = today
    return (start, end), compare_range(start, end, unit)


class Args(BaseModel):
    model_config = ConfigDict(extra='forbid')
    start: date  # a Vietnam day, YYYY-MM-DD
    end: date  # included
    unit: Literal['day', 'week', 'month', 'year'] | None = None  # from period.py, never from the model
    categoryIds: list[ObjectIdText] = Field(default_factory=list, max_length=20)

    @model_validator(mode='after')
    def in_order(self):
        if self.start > self.end:
            raise ValueError('start is after end')
        return self


def flows(ctx, first, last, ids):
    """{income, expense} in whole dong over the days first..last, of the categories asked for or of all of them."""
    match = {**confirmed(ctx), 'occurredAt': {'$gte': day_start(first), '$lt': day_start(last + timedelta(days=1))}}
    if ids:
        match['categoryId'] = {'$in': ids}
    rows = ctx.db['transactions'].aggregate([{'$match': match}, {'$group': {'_id': '$type', 'total': {'$sum': '$amount'}}}], maxTimeMS=MAX_TIME_MS)
    totals = {row['_id']: round(row['total']) for row in rows}
    return {'income': totals.get('income', 0), 'expense': totals.get('expense', 0)}


def days_text(first, last):
    return f'{first:%d/%m/%Y}' if first == last else f'{first:%d/%m/%Y}–{last:%d/%m/%Y}'


def percent(change, before, language):
    """|change| / before as a percentage with one decimal, rounded half up with integers ("66,7", "25"; English "66.7")."""
    tenths = (2 * change * 1000 + before) // (2 * before)
    text = str(tenths // 10) + (f'{"," if language == "vi" else "."}{tenths % 10}' if tenths % 10 else '')
    return text + '%'


def change_text(flow, now, before, language):
    """How `now` differs from `before`: the difference and its percentage, or, when there was nothing before, a line that says so (no percentage)."""
    if language == 'vi':
        word = 'chi' if flow == 'expense' else 'thu'
        if now == before == 0:
            return f'cả hai kỳ đều không có khoản {word} nào'
        if before == 0:
            return f'kỳ trước không có khoản {word} nào'
        if now == before:
            return 'không đổi'
        change = now - before
        return f"{'tăng' if change > 0 else 'giảm'} {money(abs(change), language)} ({'+' if change > 0 else '-'}{percent(abs(change), before, language)})"
    noun = 'spending' if flow == 'expense' else 'income'
    if now == before == 0:
        return f'no {noun} in either period'
    if before == 0:
        return f'no {noun} in the period before'
    if now == before:
        return 'no change'
    change = now - before
    return f"{'up' if change > 0 else 'down'} {money(abs(change), language)} ({'+' if change > 0 else '-'}{percent(abs(change), before, language)})"


def handle(ctx, args):
    ids = own_ids(ctx, 'categories', args.categoryIds)
    rows = list(ctx.db['categories'].find({'userId': ctx.user_id, '_id': {'$in': ids}}, {'type': 1, 'name': 1, 'names': 1}, max_time_ms=MAX_TIME_MS)) if ids else []
    (first, last), (before_first, before_last) = ranges(args.start, args.end, args.unit, ctx.today)
    now, before = flows(ctx, first, last, ids), flows(ctx, before_first, before_last, ids)
    labels = LABELS.get(ctx.language, LABELS['vi'])
    named = ' · ' + ', '.join(category_name(row, ctx.language) for row in rows) if rows else ''
    shown = [flow for flow in ('expense', 'income') if not rows or any(row.get('type') == flow for row in rows)]
    vs = 'so với' if ctx.language == 'vi' else 'vs'
    facts = [{'id': flow, 'label': f"{labels[flow]}{named} {labels['versus']}",
              'display': f"{money(now[flow], ctx.language)} ({days_text(first, last)}) {vs} {money(before[flow], ctx.language)} ({days_text(before_first, before_last)}), "
                         f"{change_text(flow, now[flow], before[flow], ctx.language)}"} for flow in shown]
    return {'current': {'from': first.isoformat(), 'to': last.isoformat(), **now}, 'previous': {'from': before_first.isoformat(), 'to': before_last.isoformat(), **before}}, facts

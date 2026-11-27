# get_category_totals(start, end, type?, categoryIds?, top?): what the user's confirmed rows add up to per category over
# Vietnam calendar days (docs/02 §2.11.3). Asked for some categories, it answers for each of them (0 when nothing was spent);
# asked for none, it ranks the categories of `type` by total and keeps the first `top`.
from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..money import money
from .get_period_summary import day_start
from .registry import Limit
from .scope import MAX_TIME_MS, ObjectIdText, category_name, confirmed, own_ids

LABELS = {'vi': {'expense': 'Tổng chi', 'income': 'Tổng thu', 'other': 'Khác'}, 'en': {'expense': 'Total expense', 'income': 'Total income', 'other': 'Other'}}


class Args(BaseModel):
    model_config = ConfigDict(extra='forbid')
    start: date  # a Vietnam day, YYYY-MM-DD
    end: date  # included
    type: Literal['expense', 'income'] = 'expense'  # ignored when categoryIds are given: a category has its own type
    categoryIds: list[ObjectIdText] = Field(default_factory=list, max_length=20)
    top: Limit = 5

    @model_validator(mode='after')
    def in_order(self):
        if self.start > self.end:
            raise ValueError('start is after end')
        return self


def totals(ctx, args):
    """[(categoryId, total)] in whole dong, and the total of every category asked about: the ones given, else all of `type`."""
    ids = own_ids(ctx, 'categories', args.categoryIds)
    match = {**confirmed(ctx), 'occurredAt': {'$gte': day_start(args.start), '$lt': day_start(args.end + timedelta(days=1))}}
    match |= {'categoryId': {'$in': ids}} if ids else {'type': args.type}
    rows = ctx.db['transactions'].aggregate([{'$match': match}, {'$group': {'_id': '$categoryId', 'total': {'$sum': '$amount'}}}], maxTimeMS=MAX_TIME_MS)
    by_id = {row['_id']: round(row['total']) for row in rows}  # amounts are whole dong: Mongo may return them as doubles
    if ids:
        shown = [(one, by_id.get(one, 0)) for one in ids]
    else:
        shown = sorted(by_id.items(), key=lambda pair: (-pair[1], pair[0]))[:args.top]
    return shown, sum(by_id.values())


def handle(ctx, args):
    shown, everything = totals(ctx, args)
    names = {row['_id']: row for row in ctx.db['categories'].find(
        {'userId': ctx.user_id, '_id': {'$in': [one for one, _ in shown]}}, {'name': 1, 'names': 1}, max_time_ms=MAX_TIME_MS)}  # a deleted one too
    labels = LABELS.get(ctx.language, LABELS['vi'])
    facts = [{'id': str(one), 'label': category_name(names.get(one, {}), ctx.language) or labels['other'], 'display': money(total, ctx.language)}
             for one, total in shown]
    if not args.categoryIds:  # the total of all of them, so a month with nothing spent still answers "0"
        facts.append({'id': 'total', 'label': labels[args.type], 'display': money(everything, ctx.language)})
    return {'categories': [{'categoryId': str(one), 'total': total} for one, total in shown], 'total': everything}, facts

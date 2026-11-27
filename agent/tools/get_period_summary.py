# get_period_summary(start, end): income, expense and net of the user's confirmed rows over Vietnam calendar days
# (docs/02 §2.11.3). One aggregation, always scoped by the user (scope.confirmed) and limited in time.
from datetime import date, datetime, time as day_time, timedelta, timezone

from pydantic import BaseModel, ConfigDict, model_validator

from ..money import money
from .period import VN
from .scope import MAX_TIME_MS, confirmed

LABELS = {
    'vi': {'expense': 'Chi', 'income': 'Thu', 'net': 'Còn lại (thu − chi)'},
    'en': {'expense': 'Expense', 'income': 'Income', 'net': 'Net (income − expense)'},
}


class Args(BaseModel):
    model_config = ConfigDict(extra='forbid')
    start: date  # a Vietnam day, YYYY-MM-DD
    end: date  # included

    @model_validator(mode='after')
    def in_order(self):
        if self.start > self.end:
            raise ValueError('start is after end')
        return self


def day_start(day):
    """00:00 Vietnam time of `day`, as an aware UTC datetime (so no host time zone can move a row to another day)."""
    return datetime.combine(day, day_time(), tzinfo=VN).astimezone(timezone.utc)


def summarize(ctx, args):
    """{income, expense, net} in whole dong. The sum of nothing is 0, not an error."""
    match = {**confirmed(ctx), 'occurredAt': {'$gte': day_start(args.start), '$lt': day_start(args.end + timedelta(days=1))}}
    rows = ctx.db['transactions'].aggregate(
        [{'$match': match}, {'$group': {'_id': '$type', 'total': {'$sum': '$amount'}}}], maxTimeMS=MAX_TIME_MS)
    totals = {row['_id']: round(row['total']) for row in rows}  # amounts are whole dong: Mongo may return them as doubles
    income, expense = totals.get('income', 0), totals.get('expense', 0)
    return {'income': income, 'expense': expense, 'net': income - expense}


def handle(ctx, args):
    data = summarize(ctx, args)  # looked up here at call time, so a test can replace it
    labels = LABELS.get(ctx.language, LABELS['vi'])
    return data, [{'id': key, 'label': labels[key], 'display': money(data[key], ctx.language)} for key in ('expense', 'income', 'net')]

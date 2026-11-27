# list_transactions(start, end, type?, categoryIds?, walletIds?, order, limit ≤ 20): the user's confirmed rows over Vietnam days, newest or biggest first
# (docs/02 §2.11.3). "Biggest" sorts by value, not by date. At most 20 rows come back, however many are asked for.
from datetime import date, timedelta, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..money import money
from .get_period_summary import day_start
from .period import VN
from .registry import Limit
from .scope import MAX_TIME_MS, ObjectIdText, category_name, confirmed, own_ids

NOTE_CHARS = 60  # a note in a label is cut here (docs/02 §2.11.4 privacy rule)
TEXT = {'vi': {'none': 'Giao dịch', 'nothing': 'không có giao dịch nào'}, 'en': {'none': 'Transactions', 'nothing': 'no transactions'}}
SORT = {'biggest': [('amount', -1), ('occurredAt', -1), ('_id', -1)], 'latest': [('occurredAt', -1), ('_id', -1)]}


class Args(BaseModel):
    model_config = ConfigDict(extra='forbid')
    start: date  # a Vietnam day, YYYY-MM-DD
    end: date  # included
    type: Literal['expense', 'income'] | None = None  # ignored when categoryIds are given: a category has its own type
    categoryIds: list[ObjectIdText] = Field(default_factory=list, max_length=20)
    walletIds: list[ObjectIdText] = Field(default_factory=list, max_length=20)
    order: Literal['biggest', 'latest'] = 'latest'
    limit: Limit = 5

    @model_validator(mode='after')
    def in_order(self):
        if self.start > self.end:
            raise ValueError('start is after end')
        return self


def label(row, categories, language):
    """"15/11 · Mua sắm" or "21/11 · Đi lại · the note": the Vietnam day, the category and the note cut to 60 characters."""
    at = row['occurredAt'] if row['occurredAt'].tzinfo else row['occurredAt'].replace(tzinfo=timezone.utc)
    note = (row.get('note') or '').strip()
    note = note if len(note) <= NOTE_CHARS else note[:NOTE_CHARS - 1] + '…'
    return ' · '.join(part for part in (f'{at.astimezone(VN):%d/%m}', category_name(categories.get(row.get('categoryId'), {}), language), note) if part)


def handle(ctx, args):
    categories_asked, wallets_asked = own_ids(ctx, 'categories', args.categoryIds), own_ids(ctx, 'wallets', args.walletIds)
    match = {**confirmed(ctx), 'occurredAt': {'$gte': day_start(args.start), '$lt': day_start(args.end + timedelta(days=1))}}
    if categories_asked:
        match['categoryId'] = {'$in': categories_asked}
    elif args.type:
        match['type'] = args.type
    if wallets_asked:
        match['walletId'] = {'$in': wallets_asked}
    found = list(ctx.db['transactions'].find(match, {'amount': 1, 'type': 1, 'occurredAt': 1, 'categoryId': 1, 'note': 1}, max_time_ms=MAX_TIME_MS)
                 .sort(SORT[args.order]).limit(args.limit))
    categories = {row['_id']: row for row in ctx.db['categories'].find(
        {'userId': ctx.user_id, '_id': {'$in': [row.get('categoryId') for row in found]}}, {'name': 1, 'names': 1}, max_time_ms=MAX_TIME_MS)}  # a deleted one too
    text = TEXT.get(ctx.language, TEXT['vi'])
    facts = [{'id': str(row['_id']), 'label': label(row, categories, ctx.language), 'display': money(round(row['amount']), ctx.language)} for row in found]
    data = [{'id': str(row['_id']), 'type': row['type'], 'amount': round(row['amount']), 'occurredAt': row['occurredAt'].isoformat()} for row in found]
    return {'transactions': data}, facts or [{'id': 'none', 'label': text['none'], 'display': text['nothing']}]

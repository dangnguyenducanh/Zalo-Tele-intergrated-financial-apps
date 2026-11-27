# Plain helpers for the turn tests (T45): users and data in the throwaway database, the fixed clock, a request body.
import json
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

from bson import ObjectId

ROOT = Path(__file__).resolve().parents[2]
NOW = datetime(2026, 11, 25, 5, 0, tzinfo=timezone.utc)  # Wed 25/11/2026 12:00 in Vietnam
STATS = json.loads((ROOT / 'server' / 'test' / 'fixtures' / 'expected-stats.json').read_text(encoding='utf-8'))


class FakeChatModel:
    """Stands in for vLLM (docs/07 §7.9.2). A turn that routes `rules` must never call it, so any use fails the test."""

    calls = 0  # nothing may raise this above 0: touching any other attribute fails the test at once

    def __getattr__(self, name):
        raise AssertionError(f'a rules turn called the model ({name})')


def make_user(db, **fields):
    """A user row as Express stores it, with the fields the agent must never see."""
    user = {'_id': ObjectId(), 'email': 'an.private@example.com', 'passwordHash': '$2b$10$privatehashprivatehashprivate',
            'name': 'An Private', 'role': 'user', 'status': 'active', 'language': 'vi', 'assistantOn': True,
            'defaultWalletId': ObjectId(), 'createdAt': NOW} | fields
    db['users'].insert_one(user)
    return user['_id']


def seed_stats(db, user_id, scale=1):
    """The hand-computed November 2026 of server/test/fixtures/expected-stats.json for one user (amounts times `scale`)."""
    wallet = db['wallets'].insert_one({'userId': user_id, 'name': 'Cash', 'type': 'cash', 'deletedAt': None}).inserted_id
    names = {t['category'] for t in STATS['transactions']}
    categories = {name: db['categories'].insert_one({'userId': user_id, 'type': 'income' if name in ('Lương', 'Thưởng') else 'expense',
                                                     'names': {'vi': name, 'en': name}, 'keywords': [], 'deletedAt': None}).inserted_id
                  for name in sorted(names)}
    db['transactions'].insert_many([
        {'userId': user_id, 'walletId': wallet, 'categoryId': categories[t['category']], 'type': t['type'],
         'amount': t['amount'] * scale, 'occurredAt': datetime.fromisoformat(t['occurredAt'].replace('Z', '+00:00')),
         'status': t.get('status', 'confirmed'), 'deletedAt': NOW if t.get('deleted') else None, 'note': ''}
        for t in STATS['transactions']])
    return {'wallet': wallet, 'categories': categories}


def vn_day_sums(scale=1):
    """The fixture's confirmed rows added up by Vietnam calendar day: {'2026-11-20': {'income': 0, 'expense': 35000}, ...}.
    Worked out here from the raw rows with plain Python, so the tests do not lean on the code they check."""
    days = {}
    for t in STATS['transactions']:
        if t.get('status', 'confirmed') != 'confirmed' or t.get('deleted'):
            continue
        at = datetime.fromisoformat(t['occurredAt'].replace('Z', '+00:00')) + timedelta(hours=7)
        days.setdefault(at.date().isoformat(), {'income': 0, 'expense': 0})[t['type']] += t['amount'] * scale
    return days


def total_between(sums, first, last):
    """income, expense, net over the days first..last (ISO strings, both included)."""
    income = sum(v['income'] for d, v in sums.items() if first <= d <= last)
    expense = sum(v['expense'] for d, v in sums.items() if first <= d <= last)
    return {'income': income, 'expense': expense, 'net': income - expense}


def turn_body(user_id, **fields):
    """A /v1/turn body for a question on the web, the way Express sends it."""
    return {'trigger': 'chat', 'userId': str(user_id), 'channel': 'web', 'threadKey': 'web', 'requestId': 'req-' + secrets.token_hex(6),
            'text': 'tháng này thu bao nhiêu', 'language': 'vi', 'today': '2026-11-25'} | fields


def vi_money(amount):
    """What a Vietnamese reply shows for an amount, written out by hand: 1.100.000 ₫ (a no-break space before the sign)."""
    return ('-' if amount < 0 else '') + f'{abs(amount):,}'.replace(',', '.') + '\xa0₫'


def en_money(amount):
    return ('-' if amount < 0 else '') + '₫' + f'{abs(amount):,}'

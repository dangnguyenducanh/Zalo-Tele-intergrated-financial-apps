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


# ---- T46: wallets, a second set of rows, and the two helpers every turn test uses ----

def ask(client, auth, user, **fields):
    """POST /v1/turn for `user` with a body as turn_body writes it."""
    return client.post('/v1/turn', json=turn_body(user, **fields), headers=auth)


def turn_row(agent_db, user, request_id):
    return agent_db['agentTurns'].find_one({'userId': user, 'requestId': request_id})


def make_wallet(db, user_id, name, initial=0, aliases=(), archived=False, deleted=False):
    return db['wallets'].insert_one({'userId': user_id, 'name': name, 'type': 'ewallet', 'initialBalance': initial, 'aliases': list(aliases),
                                     'archived': archived, 'deletedAt': NOW if deleted else None, 'createdAt': NOW}).inserted_id


def seed_wallets(db, user_id):
    """MoMo (500.000 ₫ to start; +200.000 and -50.000 confirmed; a draft and a deleted row that do not count) = 650.000 ₫, and
    Tiền mặt, which has nothing of its own: 0. The wallets of `seed_stats` ('Cash', all the fixture's rows) are untouched.
    Returns {name: id}."""
    momo = make_wallet(db, user_id, 'MoMo', 500_000, aliases=['mm'])
    cash = make_wallet(db, user_id, 'Tiền mặt', 0, aliases=['tm'])
    rows = [('income', 200_000, 'confirmed', None), ('expense', 50_000, 'confirmed', None), ('expense', 70_000, 'draft', None), ('expense', 30_000, 'confirmed', NOW)]
    september = datetime(2026, 9, 15, 5, 0, tzinfo=timezone.utc)  # a balance has no period; this keeps November's figures the fixture's
    db['transactions'].insert_many([{'userId': user_id, 'walletId': momo, 'categoryId': ObjectId(), 'type': kind, 'amount': amount,
                                     'occurredAt': september, 'status': status, 'deletedAt': deleted, 'note': ''}
                                    for kind, amount, status, deleted in rows])
    return {'MoMo': momo, 'Tiền mặt': cash}


def fixture_balance(scale=1):
    """What the fixture's wallet holds, from the raw rows: every confirmed row that is not deleted, in any month (a balance has no
    period), income minus expense."""
    live = [t for t in STATS['transactions'] if t.get('status', 'confirmed') == 'confirmed' and not t.get('deleted')]
    return sum((t['amount'] if t['type'] == 'income' else -t['amount']) * scale for t in live)


# ---- T47: budgets, and the same figures worked out by day ----

def seed_budgets(db, user_id, categories, month='2026-11', scale=1):
    """The fixture's two budgets for `month`: overall 2.000.000 and Ăn uống 250.000 (spent 1.100.000 and 215.000 in November: 55 % and 86 %).
    `categories` is seed_stats(...)['categories']; amounts times `scale`."""
    for budget in STATS['budgets']:
        db['budgets'].insert_one({'userId': user_id, 'month': month, 'categoryId': categories[budget['category']] if budget['category'] else None,
                                  'limit': budget['limit'] * scale})

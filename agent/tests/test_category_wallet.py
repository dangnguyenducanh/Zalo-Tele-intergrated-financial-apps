# The two tools of T46 on a real mongod, as sochitieu_agent (docs/02 §2.11.3 "Tools", docs/04 §4.11 "Tool registry"):
# get_category_totals and get_wallet_balances. The figures are worked out here from the fixture's raw rows, not from the code.
import time
from datetime import date

from bson import ObjectId
from pymongo import MongoClient, monitoring

from agent.tools import default_registry
from agent.tools.registry import ToolContext
from agent.tools.scope import MAX_TIME_MS
from turn_helpers import NOW, STATS, en_money, fixture_balance, make_user, make_wallet, seed_stats, seed_wallets, vi_money


class Spy(monitoring.CommandListener):
    def __init__(self):
        self.commands = []

    def started(self, event):
        self.commands.append((event.command_name, event.command))

    def succeeded(self, event):
        pass

    def failed(self, event):
        pass


def call(mongo, db_name, user, tool, args, language='vi', spy=None):
    client = MongoClient(mongo.agent_uri, tz_aware=True, event_listeners=[spy] if spy else [])
    try:
        ctx = ToolContext(user_id=user, today=date(2026, 11, 25), language=language, deadline=time.monotonic() + 30, db=client[db_name])
        return default_registry().call(tool, args, {}, ctx)
    finally:
        client.close()


NOVEMBER = {'start': '2026-11-01', 'end': '2026-11-30'}
EXPENSE = {row['name']: row['total'] for row in STATS['expected']['byCategory']['expense']}  # Mua sắm 500k, Hoá đơn 300k, Ăn uống 215k, Đi lại 85k
INCOME = {row['name']: row['total'] for row in STATS['expected']['byCategory']['income']}


# ---- get_category_totals ----

def test_the_biggest_categories_of_a_month_are_the_fixtures_by_category_figures(mongo, world, agent_db):
    """TC-F14-67 With no category named, get_category_totals ranks the user's expense categories by total (biggest first), at most `top`, and ends with the total of all of them: the fixture's expected byCategory"""
    user = make_user(world)
    seed_stats(world, user)
    result = call(mongo, agent_db.name, user, 'get_category_totals', NOVEMBER)
    assert result.ok and [(f['label'], f['display']) for f in result.facts] == [
        ('Mua sắm', vi_money(500_000)), ('Hoá đơn', vi_money(300_000)), ('Ăn uống', vi_money(215_000)), ('Đi lại', vi_money(85_000)), ('Tổng chi', vi_money(1_100_000))]
    assert [(c['total']) for c in result.data['categories']] == sorted(EXPENSE.values(), reverse=True) and result.data['total'] == sum(EXPENSE.values())
    top2 = call(mongo, agent_db.name, user, 'get_category_totals', NOVEMBER | {'top': 2})
    assert [f['label'] for f in top2.facts] == ['Mua sắm', 'Hoá đơn', 'Tổng chi'] and top2.facts[-1]['display'] == vi_money(1_100_000)  # the total is of all of them
    assert call(mongo, agent_db.name, user, 'get_category_totals', NOVEMBER | {'top': 50}).args['top'] == 20  # clamped like every limit
    income = call(mongo, agent_db.name, user, 'get_category_totals', NOVEMBER | {'type': 'income'})
    assert [(f['label'], f['display']) for f in income.facts] == [('Lương', vi_money(15_000_000)), ('Thưởng', vi_money(2_000_000)), ('Tổng thu', vi_money(17_000_000))]
    assert [f['label'] for f in call(mongo, agent_db.name, user, 'get_category_totals', NOVEMBER, language='en').facts][-1] == 'Total expense'


def test_asked_for_categories_it_answers_each_one_even_with_nothing_spent(mongo, world, agent_db):
    """TC-F14-67 With categoryIds, each is answered in the order asked, a category with no row in the period shows 0, and the rows of another month are not added"""
    user = make_user(world)
    ids = seed_stats(world, user)['categories']
    asked = [str(ids['Ăn uống']), str(ids['Lương'])]
    result = call(mongo, agent_db.name, user, 'get_category_totals', NOVEMBER | {'categoryIds': asked})
    assert [(f['id'], f['label'], f['display']) for f in result.facts] == [(asked[0], 'Ăn uống', vi_money(215_000)), (asked[1], 'Lương', vi_money(15_000_000))]
    october = call(mongo, agent_db.name, user, 'get_category_totals', {'start': '2026-10-01', 'end': '2026-10-31', 'categoryIds': asked})
    assert [f['display'] for f in october.facts] == [vi_money(0), vi_money(15_000_000)]  # the 45.000 at 00:30 on 1/11 is November in Vietnam
    nothing = call(mongo, agent_db.name, user, 'get_category_totals', {'start': '2027-01-01', 'end': '2027-01-31'})
    assert nothing.ok and [(f['label'], f['display']) for f in nothing.facts] == [('Tổng chi', vi_money(0))]  # an answer, not a failure
    hand = sum(t['amount'] for t in STATS['transactions'] if t['category'] == 'Ăn uống' and t.get('status', 'confirmed') == 'confirmed' and not t.get('deleted')
               and '2026-10-31T17:00' <= t['occurredAt'][:16] < '2026-11-30T17:00')
    assert hand == 215_000


def test_another_users_or_a_deleted_category_id_is_refused_and_nothing_is_read(mongo, world, agent_db):
    """TC-F14-67 A category id that is not this user's own, or is deleted, fails the step (NotYours) before any transaction is read; another user's rows are never added"""
    a, b = make_user(world), make_user(world, email='b@example.com')
    mine, theirs = seed_stats(world, a)['categories'], seed_stats(world, b, scale=3)['categories']
    gone = world['categories'].insert_one({'userId': a, 'type': 'expense', 'names': {'vi': 'Cũ', 'en': 'Old'}, 'keywords': [], 'deletedAt': NOW}).inserted_id
    spy = Spy()
    for bad in ([str(theirs['Ăn uống'])], [str(mine['Ăn uống']), str(theirs['Ăn uống'])], [str(gone)], [str(ObjectId())]):
        refused = call(mongo, agent_db.name, a, 'get_category_totals', NOVEMBER | {'categoryIds': bad}, spy=spy)
        assert (refused.ok, refused.error, refused.facts) == (False, 'NotYours', [])
    assert not any(c.get('aggregate') == 'transactions' for _, c in spy.commands)  # no transaction was read for any of them
    assert [f['display'] for f in call(mongo, agent_db.name, a, 'get_category_totals', NOVEMBER | {'categoryIds': [str(mine['Ăn uống'])]}).facts] == [vi_money(215_000)]
    assert call(mongo, agent_db.name, a, 'get_category_totals', NOVEMBER | {'categoryIds': ['not-an-id']}).error == 'INVALID_ARGS'
    assert call(mongo, agent_db.name, a, 'get_category_totals', NOVEMBER | {'userId': str(b)}).dropped == ['userId']  # forbidden: dropped like for any tool


def test_the_category_query_has_the_user_confirmed_not_deleted_and_a_time_limit(mongo, world, agent_db):
    """TC-F14-67 get_category_totals' aggregation starts with userId, status confirmed, deletedAt null and the Vietnam-day bounds, and carries maxTimeMS 5000"""
    user = make_user(world)
    seed_stats(world, user)
    spy = Spy()
    call(mongo, agent_db.name, user, 'get_category_totals', NOVEMBER, spy=spy)
    [(_, command)] = [(n, c) for n, c in spy.commands if n == 'aggregate' and c['aggregate'] == 'transactions']
    match = command['pipeline'][0]['$match']
    assert match['userId'] == user and match['status'] == 'confirmed' and match['deletedAt'] is None and match['type'] == 'expense'
    assert command['maxTimeMS'] == MAX_TIME_MS == 5000 and match['occurredAt']['$gte'].tzinfo is not None
    reads = [(n, c.get('find') or c.get('aggregate') or c.get('count')) for n, c in spy.commands if n in ('find', 'aggregate', 'count')]
    assert {collection for _, collection in reads} <= {'transactions', 'categories'}


# ---- get_wallet_balances ----

def test_a_balance_is_the_opening_balance_plus_confirmed_income_minus_expense_with_no_period(mongo, world, agent_db):
    """TC-F14-67 Each wallet's balance is initialBalance + confirmed income - confirmed expense of any date; a draft and a deleted row do not count; archived and deleted wallets are not listed; the total is last"""
    user = make_user(world)
    seed_stats(world, user)  # the wallet 'Cash': the fixture's rows, 30.820.000 ₫ worked out from the raw rows
    seed_wallets(world, user)  # MoMo 650.000, Tiền mặt 0
    make_wallet(world, user, 'Ví cũ', 100_000, archived=True)
    make_wallet(world, user, 'Ví xoá', 100_000, deleted=True)
    result = call(mongo, agent_db.name, user, 'get_wallet_balances', {})
    assert fixture_balance() == 30_820_000
    assert [(f['label'], f['display']) for f in result.facts] == [
        ('Cash', vi_money(30_820_000)), ('MoMo', vi_money(650_000)), ('Tiền mặt', vi_money(0)), ('Tổng', vi_money(30_820_000 + 650_000))]
    assert all(set(f) == {'id', 'label', 'display'} for f in result.facts)
    assert [f['label'] for f in call(mongo, agent_db.name, user, 'get_wallet_balances', {}, language='en').facts][-1] == 'Total'


def test_asked_for_one_wallet_it_answers_that_one_and_an_archived_one_by_id_too(mongo, world, agent_db):
    """TC-F14-67 With walletIds only those wallets are shown (no total for one); an archived wallet asked for by id is shown; another user's wallet of the same name is never added"""
    a, b = make_user(world), make_user(world, email='b@example.com')
    wallets = seed_wallets(world, a)
    their_momo = make_wallet(world, b, 'MoMo', 9_000_000)
    old = make_wallet(world, a, 'Ví cũ', 100_000, archived=True)
    one = call(mongo, agent_db.name, a, 'get_wallet_balances', {'walletIds': [str(wallets['MoMo'])]})
    assert [(f['label'], f['display']) for f in one.facts] == [('MoMo', vi_money(650_000))]
    assert [(f['label'], f['display']) for f in call(mongo, agent_db.name, a, 'get_wallet_balances', {'walletIds': [str(old)]}).facts] == [('Ví cũ', vi_money(100_000))]
    two = call(mongo, agent_db.name, a, 'get_wallet_balances', {'walletIds': [str(wallets['MoMo']), str(wallets['Tiền mặt'])]})
    assert [f['display'] for f in two.facts] == [vi_money(650_000), vi_money(0), vi_money(650_000)]
    refused = call(mongo, agent_db.name, a, 'get_wallet_balances', {'walletIds': [str(their_momo)]})
    assert (refused.ok, refused.error) == (False, 'NotYours')
    assert vi_money(9_000_000) not in str([f['display'] for f in call(mongo, agent_db.name, a, 'get_wallet_balances', {}).facts])
    assert call(mongo, agent_db.name, b, 'get_wallet_balances', {}).facts[0]['display'] == vi_money(9_000_000)
    assert [f['display'] for f in call(mongo, agent_db.name, a, 'get_wallet_balances', {}, language='en').facts][:1] == [en_money(650_000)]


def test_a_credit_card_can_be_negative_and_a_user_with_no_wallet_still_gets_a_total(mongo, world, agent_db):
    """TC-F14-67 A balance below zero shows its minus; with no wallet at all the answer is the total 0, not a failure"""
    user, nobody = make_user(world), make_user(world, email='b@example.com')
    credit = make_wallet(world, user, 'Thẻ tín dụng', -2_000_000)
    world['transactions'].insert_one({'userId': user, 'walletId': credit, 'categoryId': ObjectId(), 'type': 'expense', 'amount': 500_000,
                                      'occurredAt': NOW, 'status': 'confirmed', 'deletedAt': None})
    assert [(f['label'], f['display']) for f in call(mongo, agent_db.name, user, 'get_wallet_balances', {}).facts] == [('Thẻ tín dụng', vi_money(-2_500_000))]
    empty = call(mongo, agent_db.name, nobody, 'get_wallet_balances', {})
    assert empty.ok and [(f['label'], f['display']) for f in empty.facts] == [('Tổng', vi_money(0))]


def test_the_wallet_query_has_the_user_confirmed_not_deleted_and_a_time_limit(mongo, world, agent_db):
    """TC-F14-67 get_wallet_balances reads wallets and transactions only, both with userId, the aggregation with confirmed and deletedAt null, every read with maxTimeMS 5000"""
    user = make_user(world)
    seed_wallets(world, user)
    spy = Spy()
    call(mongo, agent_db.name, user, 'get_wallet_balances', {}, spy=spy)
    reads = [(n, c) for n, c in spy.commands if n in ('find', 'aggregate')]
    assert {(c.get('find') or c.get('aggregate')) for _, c in reads} == {'wallets', 'transactions'}
    for name, command in reads:
        assert command['maxTimeMS'] == 5000
        first = command['filter'] if name == 'find' else command['pipeline'][0]['$match']
        assert first['userId'] == user and first['deletedAt'] is None
    aggregate = next(c for n, c in reads if n == 'aggregate')['pipeline'][0]['$match']
    assert aggregate['status'] == 'confirmed'

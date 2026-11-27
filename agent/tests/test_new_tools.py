# The five tools of T47 on a real mongod, as sochitieu_agent (docs/02 §2.11.3 "Tools", docs/07 §7.9.2): compare_periods, list_transactions,
# get_budgets, get_budget_pace and suggest_budgets. The figures are worked out here by hand or from the fixture's raw rows, never from the code.
import time
from datetime import date, datetime, timezone

from bson import ObjectId
from pymongo import MongoClient, monitoring

from agent.sync import tool_fields
from agent.tools import default_registry
from agent.tools.registry import ToolContext
from turn_helpers import NOW, STATS, en_money, make_user, make_wallet, seed_budgets, seed_stats, vi_money


class Spy(monitoring.CommandListener):
    def __init__(self):
        self.commands = []

    def started(self, event):
        self.commands.append((event.command_name, event.command))

    def succeeded(self, event):
        pass

    def failed(self, event):
        pass


def call(mongo, db_name, user, tool, args, language='vi', today=date(2026, 11, 25), spy=None):
    client = MongoClient(mongo.agent_uri, tz_aware=True, event_listeners=[spy] if spy else [])
    try:
        ctx = ToolContext(user_id=user, today=today, language=language, deadline=time.monotonic() + 30, db=client[db_name])
        return default_registry().call(tool, args, {}, ctx)
    finally:
        client.close()


def spend(db, user, category, amount, at, wallet=None, kind='expense', status='confirmed', deleted=False, note=''):
    """One transaction row at an instant (an ISO text with Z, UTC)."""
    return db['transactions'].insert_one({
        'userId': user, 'walletId': wallet or ObjectId(), 'categoryId': category, 'type': kind, 'amount': amount, 'note': note, 'status': status,
        'occurredAt': datetime.fromisoformat(at.replace('Z', '+00:00')), 'deletedAt': NOW if deleted else None}).inserted_id


def category(db, user, name, kind='expense', deleted=False):
    return db['categories'].insert_one({'userId': user, 'type': kind, 'names': {'vi': name, 'en': name}, 'keywords': [], 'deletedAt': NOW if deleted else None}).inserted_id


WEEK = {'start': '2026-11-23', 'end': '2026-11-29', 'unit': 'week'}


# ---- TC-F14-73: compare_periods ----

def test_the_week_so_far_is_compared_with_the_same_days_of_the_week_before(mongo, world, agent_db):
    """TC-F14-73 On Wed 25/11 the week 23-29/11 is read as 23-25/11 against 16-18/11 (the spec's example); the fixture has 300.000 on the 25th and nothing on 16-18/11 (its 700.000 that day is deleted), so there is no percentage and the line says there was no spending before"""
    user = make_user(world)
    seed_stats(world, user)
    result = call(mongo, agent_db.name, user, 'compare_periods', WEEK)
    assert result.ok and result.args == {'start': '2026-11-23', 'end': '2026-11-29', 'unit': 'week', 'categoryIds': []}
    assert result.data == {'current': {'from': '2026-11-23', 'to': '2026-11-25', 'income': 0, 'expense': 300_000},
                           'previous': {'from': '2026-11-16', 'to': '2026-11-18', 'income': 0, 'expense': 0}}
    assert [f['id'] for f in result.facts] == ['expense', 'income']
    assert result.facts[0]['label'] == 'Chi so với cùng kỳ trước'
    assert result.facts[0]['display'] == f"{vi_money(300_000)} (23/11/2026–25/11/2026) so với {vi_money(0)} (16/11/2026–18/11/2026), kỳ trước không có khoản chi nào"
    assert '%' not in result.facts[0]['display']  # no previous spending: no percentage
    assert result.facts[1]['display'] == f"{vi_money(0)} (23/11/2026–25/11/2026) so với {vi_money(0)} (16/11/2026–18/11/2026), cả hai kỳ đều không có khoản thu nào"


def test_the_change_is_said_in_money_and_one_decimal_of_percent_and_a_zero_before_has_no_percent(mongo, world, agent_db):
    """TC-F14-73 300.000 against 180.000 is up 120.000 (+66,7 %); against 400.000 down 100.000 (-25 %); against 300.000 no change; a period before with 0 has no percentage, in English too"""
    user = make_user(world)
    seed_stats(world, user)
    food = category(world, user, 'Cũ')
    spend(world, user, food, 180_000, '2026-11-17T05:00:00Z')
    up = call(mongo, agent_db.name, user, 'compare_periods', WEEK)
    assert up.facts[0]['display'] == f"{vi_money(300_000)} (23/11/2026–25/11/2026) so với {vi_money(180_000)} (16/11/2026–18/11/2026), tăng {vi_money(120_000)} (+66,7%)"
    assert up.data['previous']['expense'] == 180_000
    spend(world, user, food, 220_000, '2026-11-18T05:00:00Z')  # 400.000 before: the same week is now less
    down = call(mongo, agent_db.name, user, 'compare_periods', WEEK)
    assert down.facts[0]['display'].endswith(f"giảm {vi_money(100_000)} (-25%)")
    spend(world, user, food, 100_000, '2026-11-24T05:00:00Z')  # 400.000 now too
    assert call(mongo, agent_db.name, user, 'compare_periods', WEEK).facts[0]['display'].endswith('không đổi')
    english = call(mongo, agent_db.name, user, 'compare_periods', WEEK, language='en')
    assert english.facts[0]['label'] == 'Expense vs the period before'
    assert english.facts[0]['display'] == f"{en_money(400_000)} (23/11/2026–25/11/2026) vs {en_money(400_000)} (16/11/2026–18/11/2026), no change"
    assert english.facts[1]['display'].endswith('no income in either period')
    other = call(mongo, agent_db.name, user, 'compare_periods', {'start': '2026-11-24', 'end': '2026-11-24', 'unit': 'day'}, language='en')
    assert other.facts[0]['display'] == f"{en_money(100_000)} (24/11/2026) vs {en_money(0)} (23/11/2026), no spending in the period before"
    assert call(mongo, agent_db.name, user, 'compare_periods', {'start': '2026-11-25', 'end': '2026-11-25', 'unit': 'day'}, language='en').facts[0]['display'].endswith('up ₫200,000 (+200%)')


def test_the_current_month_is_compared_by_days_one_to_n_like_the_dashboard_and_a_past_month_whole(mongo, world, agent_db):
    """TC-F14-73 "tháng này" on 25/11 is 01-25/11 against 01-25/10 (the fixture's expense 1.100.000 against 440.000: up 660.000, +150 %); October as a whole month is 01-31/10 against 01-30/09; on 30/11 the 30th meets the 30th"""
    user = make_user(world)
    seed_stats(world, user)
    food = category(world, user, 'Cũ')
    spend(world, user, food, 440_000, '2026-10-10T05:00:00Z')
    november = call(mongo, agent_db.name, user, 'compare_periods', {'start': '2026-11-01', 'end': '2026-11-30', 'unit': 'month'})
    assert (november.data['current']['from'], november.data['current']['to'], november.data['previous']['from'], november.data['previous']['to']) == (
        '2026-11-01', '2026-11-25', '2026-10-01', '2026-10-25')
    assert (november.data['current']['expense'], november.data['current']['income'], november.data['previous']['expense']) == (1_100_000, 15_000_000, 440_000)  # the 2.000.000 bonus of the 30th is not yet
    assert november.facts[0]['display'].endswith(f"tăng {vi_money(660_000)} (+150%)")
    october = call(mongo, agent_db.name, user, 'compare_periods', {'start': '2026-10-01', 'end': '2026-10-31', 'unit': 'month'})
    assert (october.data['current']['to'], october.data['previous']['from'], october.data['previous']['to']) == ('2026-10-31', '2026-09-01', '2026-09-30')
    assert (october.data['current']['income'], october.data['current']['expense']) == (15_000_000, 440_000)  # the salary at 23:30 on 31/10 is October
    last_day = call(mongo, agent_db.name, user, 'compare_periods', {'start': '2026-11-01', 'end': '2026-11-30', 'unit': 'month'}, today=date(2026, 11, 30))
    assert (last_day.data['current']['to'], last_day.data['previous']['to']) == ('2026-11-30', '2026-10-30')
    assert last_day.data['current']['income'] == 17_000_000


def test_a_category_filter_compares_only_that_category_and_only_the_users_own(mongo, world, agent_db):
    """TC-F14-73 With categoryIds the two periods add up only those categories (the flow of their type is shown); another user's or a deleted category id fails the step before any transaction is read"""
    a, b = make_user(world), make_user(world, email='b@example.com')
    mine = seed_stats(world, a)['categories']
    theirs = seed_stats(world, b, scale=3)['categories']
    gone = category(world, a, 'Cũ', deleted=True)
    spend(world, a, mine['Ăn uống'], 90_000, '2026-11-17T05:00:00Z')
    quiet = call(mongo, agent_db.name, a, 'compare_periods', WEEK | {'categoryIds': [str(mine['Ăn uống'])]})
    assert quiet.ok and [f['id'] for f in quiet.facts] == ['expense']  # an expense category: its own flow only
    assert (quiet.data['current']['expense'], quiet.data['previous']['expense']) == (0, 90_000)  # this week none, the 17th has the extra 90.000
    bills = call(mongo, agent_db.name, a, 'compare_periods', WEEK | {'categoryIds': [str(mine['Hoá đơn'])]})
    assert (bills.data['current']['expense'], bills.data['previous']['expense']) == (300_000, 0)
    ate = call(mongo, agent_db.name, a, 'compare_periods', {'start': '2026-11-16', 'end': '2026-11-22', 'unit': 'week', 'categoryIds': [str(mine['Ăn uống'])]})
    assert (ate.data['current']['expense'], ate.data['previous']['expense']) == (15_000 + 35_000 + 90_000, 120_000)  # 19/11 23:59, 20/11 00:00 and the 17th; the 10th
    assert ate.facts[0]['label'] == 'Chi · Ăn uống so với cùng kỳ trước' and ate.facts[0]['display'].endswith(f"tăng {vi_money(20_000)} (+16,7%)")
    income = call(mongo, agent_db.name, a, 'compare_periods', {'start': '2026-11-01', 'end': '2026-11-30', 'unit': 'month', 'categoryIds': [str(mine['Lương'])]})
    assert [f['id'] for f in income.facts] == ['income'] and income.data['current']['income'] == 15_000_000
    spy = Spy()
    for bad in ([str(theirs['Ăn uống'])], [str(gone)], [str(ObjectId())]):
        refused = call(mongo, agent_db.name, a, 'compare_periods', WEEK | {'categoryIds': bad}, spy=spy)
        assert (refused.ok, refused.error, refused.facts) == (False, 'NotYours', [])
    assert not any(c.get('aggregate') == 'transactions' for _, c in spy.commands)
    assert call(mongo, agent_db.name, a, 'compare_periods', WEEK | {'unit': 'fortnight'}).error == 'INVALID_ARGS'
    assert call(mongo, agent_db.name, a, 'compare_periods', {'start': '2026-11-25', 'end': '2026-11-01'}).error == 'INVALID_ARGS'
    assert call(mongo, agent_db.name, a, 'compare_periods', WEEK | {'userId': str(b)}).dropped == ['userId']


def test_the_unit_is_for_period_py_to_pass_and_is_not_shown_to_the_model(mongo, world, agent_db):
    """TC-F14-73 The tool schema stored in agentTools has start, end and categoryIds but not `unit`: the model never sets it; without a unit the dates decide (Mon-Wed = a week)"""
    registry = default_registry()
    properties = tool_fields(registry.tools['compare_periods'])['parameters']['properties']
    assert set(properties) == {'start', 'end', 'categoryIds'} and 'unit' in registry.tools['compare_periods'].args.model_fields
    user = make_user(world)
    seed_stats(world, user)
    no_unit = call(mongo, agent_db.name, user, 'compare_periods', {'start': '2026-11-23', 'end': '2026-11-25'})
    assert (no_unit.data['previous']['from'], no_unit.data['previous']['to']) == ('2026-11-16', '2026-11-18')


# ---- TC-F14-74: list_transactions ----

NOVEMBER = {'start': '2026-11-01', 'end': '2026-11-30'}
BIGGEST = [('15/11 · Mua sắm', 500_000), ('25/11 · Hoá đơn', 300_000), ('10/11 · Ăn uống', 120_000), ('12/11 · Đi lại', 60_000), ('01/11 · Ăn uống', 45_000)]


def test_the_biggest_come_by_value_not_by_date_and_the_draft_and_the_deleted_row_never(mongo, world, agent_db):
    """TC-F14-74 order biggest sorts by amount, biggest first: November's top 5 expenses are 500.000, 300.000, 120.000, 60.000 and 45.000 (the draft 999.000 and the deleted 700.000 are not rows), each labelled with its Vietnam day and category"""
    user = make_user(world)
    seed_stats(world, user)
    result = call(mongo, agent_db.name, user, 'list_transactions', NOVEMBER | {'type': 'expense', 'order': 'biggest', 'limit': 5})
    assert result.ok and [(f['label'], f['display']) for f in result.facts] == [(label, vi_money(amount)) for label, amount in BIGGEST]
    assert [row['amount'] for row in result.data['transactions']] == [amount for _, amount in BIGGEST]
    expenses = sorted((t['amount'] for t in STATS['transactions'] if t['type'] == 'expense' and t.get('status', 'confirmed') == 'confirmed' and not t.get('deleted')
                       and '2026-10-31T17:00' <= t['occurredAt'][:16] < '2026-11-30T17:00'), reverse=True)
    assert [row['amount'] for row in result.data['transactions']] == expenses[:5]  # an independent sort of the raw rows
    latest = call(mongo, agent_db.name, user, 'list_transactions', NOVEMBER | {'type': 'expense', 'order': 'latest', 'limit': 3})
    assert [f['label'] for f in latest.facts] == ['25/11 · Hoá đơn', '20/11 · Ăn uống', '19/11 · Ăn uống']  # 23:59 on the 19th is still the 19th
    assert [f['display'] for f in latest.facts] == [vi_money(300_000), vi_money(35_000), vi_money(15_000)]
    assert all(f['id'] and ObjectId(f['id']) for f in result.facts)


def test_the_limit_is_at_most_20_and_at_least_1_and_the_default_is_5(mongo, world, agent_db):
    """TC-F14-74 limit 50 becomes 20, 0 and negative numbers are refused, no limit gives 5 rows; 30 rows with a limit of 20 give 20"""
    user = make_user(world)
    food = category(world, user, 'Ăn uống')
    for n in range(30):
        spend(world, user, food, 1_000 * (n + 1), f'2026-11-{(n % 25) + 1:02d}T05:00:00Z')
    big = call(mongo, agent_db.name, user, 'list_transactions', NOVEMBER | {'order': 'biggest', 'limit': 50})
    assert big.args['limit'] == 20 and len(big.facts) == 20 and big.facts[0]['display'] == vi_money(30_000) and big.facts[-1]['display'] == vi_money(11_000)
    assert call(mongo, agent_db.name, user, 'list_transactions', NOVEMBER | {'limit': 0}).error == 'INVALID_ARGS'
    assert call(mongo, agent_db.name, user, 'list_transactions', NOVEMBER | {'limit': -3}).error == 'INVALID_ARGS'
    assert len(call(mongo, agent_db.name, user, 'list_transactions', NOVEMBER).facts) == 5
    assert call(mongo, agent_db.name, user, 'list_transactions', NOVEMBER | {'order': 'random'}).error == 'INVALID_ARGS'


def test_the_filters_and_the_note_and_nothing_found_is_an_answer(mongo, world, agent_db):
    """TC-F14-74 type, categoryIds and walletIds narrow the rows (a category's own type wins over `type`); a note rides in the label cut to 60 characters; a period with nothing answers one line, not a failure"""
    user = make_user(world)
    ids = seed_stats(world, user)
    momo = make_wallet(world, user, 'MoMo')
    spend(world, user, ids['categories']['Đi lại'], 70_000, '2026-11-21T05:00:00Z', wallet=momo, note='x' * 80)
    by_wallet = call(mongo, agent_db.name, user, 'list_transactions', NOVEMBER | {'walletIds': [str(momo)], 'order': 'biggest'})
    assert [(f['label'], f['display']) for f in by_wallet.facts] == [('21/11 · Đi lại · ' + 'x' * 59 + '…', vi_money(70_000))]
    salary = call(mongo, agent_db.name, user, 'list_transactions', NOVEMBER | {'type': 'expense', 'categoryIds': [str(ids['categories']['Lương'])]})
    assert [f['display'] for f in salary.facts] == [vi_money(15_000_000)]  # Lương is income: the category decides, as in get_category_totals
    income = call(mongo, agent_db.name, user, 'list_transactions', NOVEMBER | {'type': 'income', 'order': 'biggest'})
    assert [f['display'] for f in income.facts] == [vi_money(15_000_000), vi_money(2_000_000)]
    empty = call(mongo, agent_db.name, user, 'list_transactions', {'start': '2027-01-01', 'end': '2027-01-31', 'order': 'biggest'})
    assert empty.ok and empty.data['transactions'] == [] and [(f['id'], f['label']) for f in empty.facts] == [('none', 'Giao dịch')]
    assert 'không có giao dịch nào' in empty.facts[0]['display']
    assert call(mongo, agent_db.name, user, 'list_transactions', {'start': '2027-01-01', 'end': '2027-01-31'}, language='en').facts[0]['display'] == 'no transactions'


def test_only_the_users_own_rows_and_ids_are_read_and_the_reads_are_limited_in_time(mongo, world, agent_db):
    """TC-F14-74 Another user's transactions never appear (a bigger amount on the same day included); another user's category or wallet id fails the step; every read has userId, status confirmed, deletedAt null and maxTimeMS"""
    a, b = make_user(world), make_user(world, email='b@example.com')
    mine = seed_stats(world, a)['categories']
    theirs = seed_stats(world, b, scale=9)
    spy = Spy()
    result = call(mongo, agent_db.name, a, 'list_transactions', NOVEMBER | {'order': 'biggest', 'type': 'expense'}, spy=spy)
    assert [f['display'] for f in result.facts][:2] == [vi_money(500_000), vi_money(300_000)]
    reads = [c for name, c in spy.commands if name == 'find' and c.get('find') == 'transactions']
    assert reads and all(r['filter']['userId'] == a and r['filter']['status'] == 'confirmed' and r['filter']['deletedAt'] is None and r.get('maxTimeMS') for r in reads)
    for bad in ({'categoryIds': [str(theirs['categories']['Ăn uống'])]}, {'walletIds': [str(theirs['wallet'])]}, {'categoryIds': [str(mine['Ăn uống']), str(ObjectId())]}):
        refused = call(mongo, agent_db.name, a, 'list_transactions', NOVEMBER | bad)
        assert (refused.ok, refused.error, refused.facts) == (False, 'NotYours', [])


# ---- TC-F14-75: get_budgets and get_budget_pace ----

def test_each_budget_says_what_is_left_and_the_overall_one_comes_first_then_the_fullest(mongo, world, agent_db):
    """TC-F14-75 The fixture's budgets: Tổng has 900.000 left of 2.000.000 (55 %), Ăn uống 35.000 of 250.000 (86 %); the overall one first, then by how full they are; the spent of the overall budget is all the month's expenses"""
    user = make_user(world)
    ids = seed_stats(world, user)['categories']
    seed_budgets(world, user, ids)
    world['budgets'].insert_one({'userId': user, 'month': '2026-11', 'categoryId': ids['Mua sắm'], 'limit': 1_000_000})  # 50 %: after Ăn uống
    result = call(mongo, agent_db.name, user, 'get_budgets', {'month': '2026-11'})
    assert result.ok and [(f['label'], f['display']) for f in result.facts] == [
        ('Ngân sách · Tổng', f"còn {vi_money(900_000)} (đã chi {vi_money(1_100_000)} / {vi_money(2_000_000)}, 55%)"),
        ('Ngân sách · Ăn uống', f"còn {vi_money(35_000)} (đã chi {vi_money(215_000)} / {vi_money(250_000)}, 86%)"),
        ('Ngân sách · Mua sắm', f"còn {vi_money(500_000)} (đã chi {vi_money(500_000)} / {vi_money(1_000_000)}, 50%)")]
    expected = {(b['category'], b['limit'], b['spent'], b['percent']) for b in STATS['expected']['budgets']}
    assert {(None, 2_000_000, 1_100_000, 55), ('Ăn uống', 250_000, 215_000, 86)} == expected
    assert [(b['name'], b['limit'], b['spent'], b['percent']) for b in result.data['budgets']][:2] == [('Tổng', 2_000_000, 1_100_000, 55), ('Ăn uống', 250_000, 215_000, 86)]
    english = call(mongo, agent_db.name, user, 'get_budgets', {'month': '2026-11'}, language='en')
    assert english.facts[0]['label'] == 'Budget · Overall' and english.facts[0]['display'] == f"{en_money(900_000)} left (spent {en_money(1_100_000)} of {en_money(2_000_000)}, 55%)"


def test_a_budget_at_or_over_its_limit_says_so_and_a_deleted_categorys_budget_is_left_out(mongo, world, agent_db):
    """TC-F14-75 Spent exactly the limit is "hết ngân sách", over it is "vượt X"; a budget of a deleted category, of another month or of another user is not listed; no budget at all answers one line"""
    a, b = make_user(world), make_user(world, email='b@example.com')
    ids = seed_stats(world, a)['categories']
    other = seed_stats(world, b)['categories']
    old = category(world, a, 'Cũ', deleted=True)
    for who, categories_of in ((a, ids), (b, other)):
        world['budgets'].insert_one({'userId': who, 'month': '2026-11', 'categoryId': categories_of['Hoá đơn'], 'limit': 300_000})
        world['budgets'].insert_one({'userId': who, 'month': '2026-11', 'categoryId': categories_of['Đi lại'], 'limit': 50_000})
    world['budgets'].insert_one({'userId': a, 'month': '2026-11', 'categoryId': old, 'limit': 1_000_000})
    world['budgets'].insert_one({'userId': a, 'month': '2026-10', 'categoryId': ids['Ăn uống'], 'limit': 1_000_000})
    result = call(mongo, agent_db.name, a, 'get_budgets', {'month': '2026-11'})
    assert [(f['label'], f['display']) for f in result.facts] == [
        ('Ngân sách · Đi lại', f"vượt {vi_money(35_000)} (đã chi {vi_money(85_000)} / {vi_money(50_000)}, 170%)"),
        ('Ngân sách · Hoá đơn', f"hết ngân sách (đã chi {vi_money(300_000)} / {vi_money(300_000)}, 100%)")]
    none = call(mongo, agent_db.name, a, 'get_budgets', {'month': '2026-09'})
    assert none.ok and [(f['id'], f['label'], f['display']) for f in none.facts] == [('none', 'Ngân sách', 'chưa đặt ngân sách cho tháng này')] and none.data['budgets'] == []
    assert call(mongo, agent_db.name, a, 'get_budgets', {'month': '2026-13'}).error == 'INVALID_ARGS'
    assert call(mongo, agent_db.name, a, 'get_budgets', {'month': '11/2026'}).error == 'INVALID_ARGS'


def test_a_category_named_answers_for_it_and_says_when_it_has_no_budget(mongo, world, agent_db):
    """TC-F14-75 categoryIds: only those budgets (not the overall one); a category with no budget this month is a line saying so; another user's category id fails the step"""
    a, b = make_user(world), make_user(world, email='b@example.com')
    ids = seed_stats(world, a)['categories']
    theirs = seed_stats(world, b)['categories']
    seed_budgets(world, a, ids)
    food = call(mongo, agent_db.name, a, 'get_budgets', {'month': '2026-11', 'categoryIds': [str(ids['Ăn uống'])]})
    assert [(f['label'], f['display']) for f in food.facts] == [('Ngân sách · Ăn uống', f"còn {vi_money(35_000)} (đã chi {vi_money(215_000)} / {vi_money(250_000)}, 86%)")]
    mixed = call(mongo, agent_db.name, a, 'get_budgets', {'month': '2026-11', 'categoryIds': [str(ids['Đi lại']), str(ids['Ăn uống'])]})
    assert [(f['label'], f['display']) for f in mixed.facts] == [
        ('Ngân sách · Ăn uống', f"còn {vi_money(35_000)} (đã chi {vi_money(215_000)} / {vi_money(250_000)}, 86%)"), ('Ngân sách · Đi lại', 'chưa đặt ngân sách cho tháng này')]
    assert call(mongo, agent_db.name, a, 'get_budgets', {'month': '2026-11', 'categoryIds': [str(theirs['Ăn uống'])]}).error == 'NotYours'


def test_the_pace_of_each_budget_on_the_25th_is_the_shared_rule_applied_to_its_spent_and_limit(mongo, world, agent_db):
    """TC-F14-75 On 25/11: Tổng 1.100.000 of 2.000.000 has 900.000 for 6 days, 150.000 a day, about 1.320.000 at the end and is never over; Ăn uống 215.000 of 250.000 has 5.833 a day, about 258.000, over on the 30th; the figures are in data too"""
    user = make_user(world)
    ids = seed_stats(world, user)['categories']
    seed_budgets(world, user, ids)
    result = call(mongo, agent_db.name, user, 'get_budget_pace', {'month': '2026-11'})
    assert result.ok and [(f['id'], f['label']) for f in result.facts] == [('overall', 'Dự báo · Tổng'), (str(ids['Ăn uống']), 'Dự báo · Ăn uống')]
    assert result.facts[0]['display'] == f"còn {vi_money(900_000)} cho 6 ngày → tối đa {vi_money(150_000)}/ngày; theo nhịp này cuối tháng ≈ {vi_money(1_320_000)}"
    assert result.facts[1]['display'] == f"còn {vi_money(35_000)} cho 6 ngày → tối đa {vi_money(5_833)}/ngày; theo nhịp này cuối tháng ≈ {vi_money(258_000)}, vượt khoảng 30/11"
    assert [b['pace'] for b in result.data['budgets']] == [{'daysLeft': 6, 'perDay': 150_000, 'projectedEnd': 1_320_000, 'overDay': None},
                                                          {'daysLeft': 6, 'perDay': 5_833, 'projectedEnd': 258_000, 'overDay': 30}]
    english = call(mongo, agent_db.name, user, 'get_budget_pace', {'month': '2026-11'}, language='en')
    assert english.facts[1]['label'] == 'Forecast · Ăn uống'
    assert english.facts[1]['display'] == (f"{en_money(35_000)} left for 6 days → at most {en_money(5_833)} a day; at this pace the month ends at about {en_money(258_000)}, over around Nov 30")


def test_there_is_no_pace_before_day_5_after_the_month_or_before_it_and_over_the_limit_has_no_allowance(mongo, world, agent_db):
    """TC-F14-75 No pace on day 4, for a past month and for a month to come (no facts, no failure); over the limit: no allowance, "đã vượt ngân sách" and the month-end figure; the A2 numbers of the spec on day 25 of a 30-day month"""
    user = make_user(world)
    ids = seed_stats(world, user)['categories']
    seed_budgets(world, user, ids)
    for today, month in ((date(2026, 11, 4), '2026-11'), (date(2026, 11, 25), '2026-10'), (date(2026, 11, 25), '2026-12')):
        world['budgets'].update_many({'userId': user}, {'$set': {'month': month}})
        quiet = call(mongo, agent_db.name, user, 'get_budget_pace', {'month': month}, today=today)
        assert quiet.ok and quiet.facts == [] and all(b['pace'] is None for b in quiet.data['budgets']), (today, month)
    world['budgets'].update_many({'userId': user}, {'$set': {'month': '2026-11'}})
    world['budgets'].update_one({'userId': user, 'categoryId': ids['Ăn uống']}, {'$set': {'limit': 200_000}})  # 215.000 spent of 200.000
    over = call(mongo, agent_db.name, user, 'get_budget_pace', {'month': '2026-11', 'categoryIds': [str(ids['Ăn uống'])]})
    assert [f['display'] for f in over.facts] == [f"đã vượt ngân sách; theo nhịp này cuối tháng ≈ {vi_money(258_000)}"]
    assert call(mongo, agent_db.name, user, 'get_budget_pace', {'month': '2026-11', 'categoryIds': [str(ids['Ăn uống'])]}, language='en').facts[0]['display'] == (
        f"over budget; at this pace the month ends at about {en_money(258_000)}")
    assert over.data['budgets'][0]['pace'] == {'daysLeft': 6, 'perDay': None, 'projectedEnd': 258_000, 'overDay': None}
    none = call(mongo, agent_db.name, user, 'get_budget_pace', {'month': '2026-09'})
    assert none.ok and none.facts == []


# ---- TC-F14-72: suggest_budgets ----

def test_the_suggestion_is_the_median_of_the_last_three_months_rounded_up_to_fifty_thousand(mongo, world, agent_db):
    """TC-F14-72 For December: Sep, Oct and Nov count. 100.000, 200.000, 300.000 gives 200.000; 480.000 in the middle gives 500.000; a category with 2 months (120.000 and 210.000, median 165.000) gets 200.000 and one with 1 month of 30.000 gets 50.000; the biggest suggestion first"""
    user = make_user(world)
    food, move, fun, gift = (category(world, user, name) for name in ('Ăn uống', 'Đi lại', 'Giải trí', 'Quà'))
    for month_at, amounts in (('2026-09-15', (520_000, 200_000, 120_000)), ('2026-10-15', (480_000, 300_000, 210_000)), ('2026-11-15', (400_000, 100_000, 0))):
        for cat, amount in zip((food, move, fun), amounts):
            if amount:
                spend(world, user, cat, amount, f'{month_at}T05:00:00Z')
    spend(world, user, gift, 30_000, '2026-10-20T05:00:00Z')
    result = call(mongo, agent_db.name, user, 'suggest_budgets', {'month': '2026-12'})
    assert result.ok and [(f['label'], f['display']) for f in result.facts] == [
        ('Gợi ý ngân sách tháng 12/2026 · Ăn uống', vi_money(500_000)), ('Gợi ý ngân sách tháng 12/2026 · Đi lại', vi_money(200_000)), ('Gợi ý ngân sách tháng 12/2026 · Giải trí', vi_money(200_000)),
        ('Gợi ý ngân sách tháng 12/2026 · Quà', vi_money(50_000))]
    assert [(s['suggested'], s['months']) for s in result.data['suggestions']] == [(500_000, 3), (200_000, 3), (200_000, 2), (50_000, 1)]
    assert result.data['basedOn'] == ['2026-09', '2026-10', '2026-11'] and result.data['month'] == '2026-12'
    assert [f['label'] for f in call(mongo, agent_db.name, user, 'suggest_budgets', {'month': '2026-12', 'top': 2}).facts] == ['Gợi ý ngân sách tháng 12/2026 · Ăn uống', 'Gợi ý ngân sách tháng 12/2026 · Đi lại']
    assert len(call(mongo, agent_db.name, user, 'suggest_budgets', {'month': '2026-12', 'top': 2}).data['suggestions']) == 4  # the data keeps all, for "Dùng gợi ý"
    assert call(mongo, agent_db.name, user, 'suggest_budgets', {'month': '2026-12', 'top': 99}).args['top'] == 20


def test_the_rounding_is_up_to_the_next_fifty_thousand_and_never_a_float(mongo, world, agent_db):
    """TC-F14-72 49.999 and 50.000 and 50.001 give 50.000, 50.000 and 100.000; two months of 100.000 and 1 (median 50.000,5) give 100.000; the median of two is exact (no float rounding)"""
    user = make_user(world)
    cats = {name: category(world, user, name) for name in ('A', 'B', 'C', 'D')}
    spend(world, user, cats['A'], 49_999, '2026-10-10T05:00:00Z')
    spend(world, user, cats['B'], 50_000, '2026-10-10T05:00:00Z')
    spend(world, user, cats['C'], 50_001, '2026-10-10T05:00:00Z')
    spend(world, user, cats['D'], 100_000, '2026-09-10T05:00:00Z')
    spend(world, user, cats['D'], 1, '2026-10-10T05:00:00Z')
    got = {s['name']: s['suggested'] for s in call(mongo, agent_db.name, user, 'suggest_budgets', {'month': '2026-11'}).data['suggestions']}
    assert got == {'A': 50_000, 'B': 50_000, 'C': 100_000, 'D': 100_000}


def test_only_the_three_months_before_it_count_with_vietnam_boundaries_and_only_confirmed_expenses_of_live_categories(mongo, world, agent_db):
    """TC-F14-72 For November: Aug, Sep, Oct. A row at 00:30 on 1/9 (still 31/8 in UTC) is September; at 23:59 on 31/10 October; 00:00 on 1/11 and the month itself are out; a draft, a deleted row, an income, another user's row and a deleted category are not counted"""
    a, b = make_user(world), make_user(world, email='b@example.com')
    food, income, old = category(world, a, 'Ăn uống'), category(world, a, 'Lương', 'income'), category(world, a, 'Cũ', deleted=True)
    theirs = category(world, b, 'Ăn uống')
    spend(world, a, food, 300_000, '2026-08-31T17:30:00Z')    # 00:30 on 1/9 in Vietnam: September
    spend(world, a, food, 650_000, '2026-10-31T16:59:00Z')    # 23:59 on 31/10: October
    spend(world, a, food, 900_000, '2026-10-31T17:00:00Z')    # 00:00 on 1/11: not in the window
    spend(world, a, food, 700_000, '2026-07-31T16:59:00Z')    # 23:59 on 31/7: July, before the window
    spend(world, a, food, 800_000, '2026-08-10T05:00:00Z', status='draft')
    spend(world, a, food, 800_000, '2026-08-10T05:00:00Z', deleted=True)
    spend(world, a, income, 5_000_000, '2026-09-10T05:00:00Z', kind='income')
    spend(world, a, old, 1_000_000, '2026-09-10T05:00:00Z')
    spend(world, b, theirs, 4_000_000, '2026-09-10T05:00:00Z')
    result = call(mongo, agent_db.name, a, 'suggest_budgets', {'month': '2026-11'})
    assert [(s['name'], s['suggested'], s['months']) for s in result.data['suggestions']] == [('Ăn uống', 500_000, 2)]  # (300.000 + 650.000) / 2 = 475.000 → 500.000
    assert result.data['basedOn'] == ['2026-08', '2026-09', '2026-10']
    january = call(mongo, agent_db.name, a, 'suggest_budgets', {'month': '2027-01'})
    assert january.data['basedOn'] == ['2026-10', '2026-11', '2026-12'] and [s['suggested'] for s in january.data['suggestions']] == [800_000]  # across the new year: Oct 650.000 and Nov 900.000, median 775.000


def test_with_no_spending_in_the_three_months_it_answers_one_line_and_in_english(mongo, world, agent_db):
    """TC-F14-72 A user with nothing to go on gets "chưa có chi tiêu ba tháng trước để gợi ý" and no suggestions, not a failure; English too; a bad month is refused"""
    user = make_user(world)
    seed_stats(world, user)  # all of it is November: not in the window of November
    result = call(mongo, agent_db.name, user, 'suggest_budgets', {'month': '2026-11'})
    assert result.ok and result.data['suggestions'] == [] and [(f['id'], f['label']) for f in result.facts] == [('none', 'Gợi ý ngân sách')]
    assert result.facts[0]['display'] == 'chưa có chi tiêu trong 3 tháng trước để gợi ý'
    assert call(mongo, agent_db.name, user, 'suggest_budgets', {'month': '2026-11'}, language='en').facts[0]['display'] == 'no spending in the 3 months before to go on'
    assert call(mongo, agent_db.name, user, 'suggest_budgets', {'month': '2026-00'}).error == 'INVALID_ARGS'


def test_every_new_tool_is_in_the_registry_as_a_read_with_its_collections():
    """TC-F14-73 The five tools are registered: read-only, with a timeout and the collections they read (docs/02 §2.11.3 tools table)"""
    registry = default_registry()
    wanted = {'compare_periods': {'transactions', 'categories'}, 'list_transactions': {'transactions', 'categories', 'wallets'}, 'get_budgets': {'budgets', 'transactions', 'categories'},
              'get_budget_pace': {'budgets', 'transactions'}, 'suggest_budgets': {'transactions', 'budgets'}}
    for name, collections in wanted.items():
        tool = registry.tools[name]
        assert tool.side_effect == 'read' and tool.timeout_ms > 0 and collections <= set(tool.collections), name
    assert {'userId', 'token', 'query'}.isdisjoint(set().union(*(set(registry.tools[name].args.model_fields) for name in wanted)))

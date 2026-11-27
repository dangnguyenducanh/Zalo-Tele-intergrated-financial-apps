# T47 end to end on a throwaway mongod: the five skills added to the first three make the 8 v1 pipeline skills, and every one answers through
# POST /v1/turn from MongoDB with no model (docs/02 §2.11.3 skill and tool tables, §2.11.8 "Rules answer on their own", "One comparison rule",
# "No data leaks between users"; docs/07 §7.9.3 *pipeline path*, *two users*). The figures are written out by hand from
# server/test/fixtures/expected-stats.json or summed from its raw rows, never taken from the code under test.
import re
from dataclasses import replace
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from agent import routing
from agent.skills import FOLDER, load_skills, read_skill
from agent.tools import default_registry
from agent.tools.period import count_in, period_in
from test_new_tools import call as run_tool
from test_new_tools import category, spend
from turn_helpers import NOW, FakeChatModel, ask, make_user, make_wallet, seed_budgets, seed_stats, total_between, turn_row, vi_money, vn_day_sums

SKILLS = load_skills(default_registry())
PIPELINE = ['ingress', 'load_context', 'rewrite_question', 'recall_memory', 'find_skills', 'decide', 'act', 'generate_answer', 'guard_output', 'suggest_followups',
            'save_turn']
SCHEDULED = ['ingress', 'load_context', 'decide', 'act', 'generate_answer', 'guard_output', 'suggest_followups', 'save_turn']
EIGHT = ['thu_chi_ky', 'tong_ket_tuan', 'tong_ket_thang', 'chi_theo_danh_muc', 'so_sanh_ky', 'top_khoan_chi', 'so_du_vi', 'ngan_sach_con_lai']


@pytest.fixture
def desk(turn_app, world, auth):
    """A user with the fixture's November, its two budgets (overall 2.000.000, Ăn uống 250.000) and the wallets MoMo (opening 650.000) and Tiền mặt (0)."""
    user = make_user(world)
    ids = seed_stats(world, user)
    seed_budgets(world, user, ids['categories'])
    wallets = {'MoMo': make_wallet(world, user, 'MoMo', 650_000, aliases=['mm']), 'Tiền mặt': make_wallet(world, user, 'Tiền mặt', 0, aliases=['tm'])}
    model = FakeChatModel()
    app = turn_app(chat_model=model, now=lambda: NOW)
    return SimpleNamespace(user=user, ids=ids['categories'], wallets=wallets, client=TestClient(app), model=model, auth=auth, make=turn_app, world=world)


def say(desk, text, who=None, **fields):
    return ask(desk.client, desk.auth, who or desk.user, text=text, **fields).json()


def shown(body):
    return [(fact['label'], fact['display']) for fact in body['facts']]


def pace_lines_of_the_25th(language='vi'):
    """The two pace lines of the fixture's budgets on Wed 25/11 (30-day month, day 25): worked out by hand. Overall 1.100.000 of 2.000.000: 900.000 for 6 days,
    150.000 a day, 1.320.000 at the end, never over. Ăn uống 215.000 of 250.000: 35.000 for 6 days, 5.833 a day, 258.000 at the end, over on the 30th."""
    return [('Dự báo · Tổng', f"còn {vi_money(900_000)} cho 6 ngày → tối đa {vi_money(150_000)}/ngày; theo nhịp này cuối tháng ≈ {vi_money(1_320_000)}"),
            ('Dự báo · Ăn uống', f"còn {vi_money(35_000)} cho 6 ngày → tối đa {vi_money(5_833)}/ngày; theo nhịp này cuối tháng ≈ {vi_money(258_000)}, vượt khoảng 30/11")]



def versus(now, before, now_range, before_range, flow):
    """The comparison line of one flow when the period before had nothing."""
    word = 'chi' if flow == 'expense' else 'thu'
    return f"{vi_money(now)} ({now_range}) so với {vi_money(before)} ({before_range}), kỳ trước không có khoản {word} nào"


# ---- TC-F14-76: the eight skills, one by one, from the fixture ----

CASES = [
    ('thu_chi_ky', 'hôm nay tiêu bao nhiêu?', ['get_period_summary'],
     [('Chi', vi_money(300_000)), ('Thu', vi_money(0)), ('Còn lại (thu − chi)', vi_money(-300_000))], 'hôm nay (25/11/2026)'),
    ('tong_ket_tuan', 'tổng kết tuần trước', ['get_period_summary', 'get_category_totals', 'compare_periods', 'get_budget_pace'],
     [('Chi', vi_money(50_000)), ('Thu', vi_money(0)), ('Còn lại (thu − chi)', vi_money(-50_000)), ('Ăn uống', vi_money(50_000)), ('Tổng chi', vi_money(50_000)),
      ('Chi so với cùng kỳ trước', f"{vi_money(50_000)} (16/11/2026–22/11/2026) so với {vi_money(705_000)} (09/11/2026–15/11/2026), giảm {vi_money(655_000)} (-92,9%)"),
      ('Thu so với cùng kỳ trước', f"{vi_money(0)} (16/11/2026–22/11/2026) so với {vi_money(0)} (09/11/2026–15/11/2026), cả hai kỳ đều không có khoản thu nào"),
      *pace_lines_of_the_25th()], 'tuần trước (16/11/2026–22/11/2026)'),
    ('tong_ket_thang', 'tổng kết tháng 10', ['get_period_summary', 'get_category_totals', 'get_budgets', 'suggest_budgets'],
     [('Chi', vi_money(0)), ('Thu', vi_money(15_000_000)), ('Còn lại (thu − chi)', vi_money(15_000_000)), ('Tổng chi', vi_money(0)),
      ('Ngân sách', 'chưa đặt ngân sách cho tháng này'), ('Gợi ý ngân sách', 'chưa có chi tiêu trong 3 tháng trước để gợi ý')], 'tháng 10/2026'),
    ('chi_theo_danh_muc', 'tháng này ăn uống hết bao nhiêu?', ['get_category_totals'], [('Ăn uống', vi_money(215_000))], 'tháng này (11/2026)'),
    ('so_sanh_ky', 'tháng này so với tháng trước?', ['compare_periods'],
     [('Chi so với cùng kỳ trước', versus(1_100_000, 0, '01/11/2026–25/11/2026', '01/10/2026–25/10/2026', 'expense')),
      ('Thu so với cùng kỳ trước', versus(15_000_000, 0, '01/11/2026–25/11/2026', '01/10/2026–25/10/2026', 'income'))], 'tháng này (11/2026)'),
    ('top_khoan_chi', '5 khoản chi lớn nhất tuần trước', ['list_transactions'],
     [('20/11 · Ăn uống', vi_money(35_000)), ('19/11 · Ăn uống', vi_money(15_000))], 'tuần trước (16/11/2026–22/11/2026)'),
    ('so_du_vi', 'momo còn bao nhiêu?', ['get_wallet_balances'], [('MoMo', vi_money(650_000))], 'Số dư hiện tại · MoMo'),
    ('ngan_sach_con_lai', 'ngân sách ăn uống còn bao nhiêu', ['get_budgets', 'get_budget_pace'],
     [('Ngân sách · Ăn uống', f"còn {vi_money(35_000)} (đã chi {vi_money(215_000)} / {vi_money(250_000)}, 86%)"), pace_lines_of_the_25th()[1]], 'tháng này (11/2026)'),
]


@pytest.mark.parametrize('code,text,tools,facts,period', CASES, ids=[case[0] for case in CASES])
def test_each_of_the_eight_skills_answers_from_the_fixture_by_rules_with_its_tools_and_follow_ups(desk, agent_db, code, text, tools, facts, period):
    """TC-F14-76 On Wed 25/11 each of the 8 v1 skills, asked its own question, finds itself as direct, runs its tools in order and answers the figures worked out by hand from the fixture, naming the period, with a source, its 2-3 follow-ups and 0 model calls"""
    body = say(desk, text, requestId='one')
    row = turn_row(agent_db, desk.user, 'one')
    assert (row['skill'], row['retrieval'], row['route'], row['guard']) == (code, 'direct', 'rules', 'pass')
    assert body['route'] == 'rules' and body['steps'] == PIPELINE and 'card' not in body and desk.model.calls == 0
    assert shown(body) == facts
    assert [(call['tool'], call['ok']) for call in row['toolCalls']] == [(tool, True) for tool in tools] == [(tool.name, True) for tool in SKILLS[code].tools]
    assert period in body['text'] and 'Nguồn' in body['text'] and body['sources'] and 2 <= len(body['followups']) <= 3
    assert body['followups'] == [chip['vi'] for chip in SKILLS[code].followups] and row['followups'] == body['followups']
    assert row['facts'] == body['facts'] and 'userId' not in str(row['toolCalls'])


def test_the_eight_skills_are_the_files_of_the_folder_and_all_enabled_pipeline_skills():
    """TC-F14-76 The skill folder holds exactly the 8 v1 skills of docs/02 §2.11.3, each a pipeline skill with the tools of the table (tong_ket_tuan also has compare_periods: decision D18)"""
    assert sorted(SKILLS) == sorted(EIGHT)
    assert all(skill.mode == 'pipeline' and skill.enabled for skill in SKILLS.values())
    assert {code: [tool.name for tool in skill.tools] for code, skill in SKILLS.items()} == {
        'thu_chi_ky': ['get_period_summary'],
        'tong_ket_tuan': ['get_period_summary', 'get_category_totals', 'compare_periods', 'get_budget_pace'],
        'tong_ket_thang': ['get_period_summary', 'get_category_totals', 'get_budgets', 'suggest_budgets'],
        'chi_theo_danh_muc': ['get_category_totals'], 'so_sanh_ky': ['compare_periods'], 'top_khoan_chi': ['list_transactions'],
        'so_du_vi': ['get_wallet_balances'], 'ngan_sach_con_lai': ['get_budgets', 'get_budget_pace']}


def test_the_figures_are_the_independent_sums_of_the_raw_rows_of_the_fixture(desk):
    """TC-F14-76 The summary lines of the week, last week, the month, October and yesterday equal the sums of the fixture's raw rows by Vietnam day (the draft, the deleted row and the rows that fall in the next month by Vietnam time are out)"""
    sums = vn_day_sums()
    for text, first, last in [('tổng kết tuần', '2026-11-23', '2026-11-29'), ('tổng kết tuần trước', '2026-11-16', '2026-11-22'), ('tổng kết tháng này', '2026-11-01', '2026-11-30'),
                              ('tổng kết tháng 10', '2026-10-01', '2026-10-31')]:
        body = say(desk, text)
        totals = total_between(sums, first, last)
        assert [f['display'] for f in body['facts'][:3]] == [vi_money(totals['expense']), vi_money(totals['income']), vi_money(totals['net'])], text
    month = say(desk, 'tổng kết tháng này')
    assert [f['display'] for f in month['facts'][:3]] == [vi_money(1_100_000), vi_money(17_000_000), vi_money(15_900_000)]  # the fixture's expected summary
    assert (total_between(sums, '2026-11-01', '2026-11-30')['expense'], total_between(sums, '2026-11-01', '2026-11-30')['income']) == (1_100_000, 17_000_000)
    categories = [(f['label'], f['display']) for f in month['facts'][3:8]]
    assert categories == [('Mua sắm', vi_money(500_000)), ('Hoá đơn', vi_money(300_000)), ('Ăn uống', vi_money(215_000)), ('Đi lại', vi_money(85_000)), ('Tổng chi', vi_money(1_100_000))]
    budgets = [(f['label'], f['display']) for f in month['facts'] if f['label'].startswith('Ngân sách ·')]
    assert budgets == [('Ngân sách · Tổng', f"còn {vi_money(900_000)} (đã chi {vi_money(1_100_000)} / {vi_money(2_000_000)}, 55%)"),
                       ('Ngân sách · Ăn uống', f"còn {vi_money(35_000)} (đã chi {vi_money(215_000)} / {vi_money(250_000)}, 86%)")]
    suggested = [(f['label'], f['display']) for f in month['facts'] if f['label'].startswith('Gợi ý ngân sách tháng')]
    assert suggested == [('Gợi ý ngân sách tháng 12/2026 · Mua sắm', vi_money(500_000)), ('Gợi ý ngân sách tháng 12/2026 · Hoá đơn', vi_money(300_000)),
                         ('Gợi ý ngân sách tháng 12/2026 · Ăn uống', vi_money(250_000)), ('Gợi ý ngân sách tháng 12/2026 · Đi lại', vi_money(100_000))]  # for December: November's totals, rounded up to 50.000


def test_the_monthly_report_suggests_budgets_for_the_month_after_the_one_it_reports(desk, agent_db):
    """TC-F14-76 tong_ket_thang for October asks get_budgets for 2026-10 and suggest_budgets for 2026-11; for November, 2026-11 and 2026-12"""
    say(desk, 'tổng kết tháng 10', requestId='oct')
    say(desk, 'tổng kết tháng này', requestId='nov')
    months = {rid: [(c['tool'], c['args']['month']) for c in turn_row(agent_db, desk.user, rid)['toolCalls'] if 'month' in c['args']] for rid in ('oct', 'nov')}
    assert months == {'oct': [('get_budgets', '2026-10'), ('suggest_budgets', '2026-11')], 'nov': [('get_budgets', '2026-11'), ('suggest_budgets', '2026-12')]}


def test_the_biggest_expenses_come_by_value_and_the_count_of_the_question_is_the_limit(desk, agent_db):
    """TC-F14-76 "top 3 khoản chi lớn nhất tháng này" lists 500.000, 300.000 and 120.000 (not the 3 newest); "khoản chi lớn nhất hôm qua" with nothing yesterday answers one line; 50 becomes 20 and the answer says so"""
    body = say(desk, 'top 3 khoản chi lớn nhất tháng này', requestId='top3')
    assert shown(body) == [('15/11 · Mua sắm', vi_money(500_000)), ('25/11 · Hoá đơn', vi_money(300_000)), ('10/11 · Ăn uống', vi_money(120_000))]
    assert turn_row(agent_db, desk.user, 'top3')['toolCalls'][0]['args'] == {'start': '2026-11-01', 'end': '2026-11-30', 'type': 'expense', 'order': 'biggest', 'limit': 3,
                                                                              'categoryIds': [], 'walletIds': []}
    assert len(say(desk, 'khoản chi lớn nhất tháng này')['facts']) == 5  # no count: the default
    empty = say(desk, 'khoản chi lớn nhất hôm qua')
    assert shown(empty) == [('Giao dịch', 'không có giao dịch nào')] and 'hôm qua (24/11/2026)' in empty['text'] and 'Mình chưa lấy được' not in empty['text']
    many = say(desk, '50 khoản chi lớn nhất tháng này', requestId='fifty')
    assert turn_row(agent_db, desk.user, 'fifty')['toolCalls'][0]['args']['limit'] == 20 and len(many['facts']) == 8  # 8 rows exist
    assert 'Bỏ qua điều kiện: 50 khoản (chỉ hiển thị tối đa 20)' in many['text']
    english = say(desk, 'biggest expenses yesterday', language='en')
    assert english['route'] == 'rules' and shown(english) == [('Transactions', 'no transactions')] and 'yesterday (24/11/2026)' in english['text']


# ---- TC-F14-77: the weekly report and the comparison rule (decision D18) ----

def test_the_weekly_report_on_wed_25_11_compares_23_to_25_with_16_to_18_and_names_monday_to_sunday(desk, agent_db):
    """TC-F14-77 "tổng kết tuần" on Wed 25/11: the period line says tuần này (23/11/2026–29/11/2026), Monday to Sunday; the comparison reads 23/11–25/11 against 16/11–18/11; 300.000 against nothing says there was no spending before and gives no percentage"""
    body = say(desk, 'tổng kết tuần', requestId='week')
    assert body['text'].splitlines()[0] == 'Tổng kết tuần này (23/11/2026–29/11/2026), tính các giao dịch đã xác nhận:'
    compare = [f for f in body['facts'] if f['label'].startswith('Chi so với')]
    assert [f['display'] for f in compare] == [versus(300_000, 0, '23/11/2026–25/11/2026', '16/11/2026–18/11/2026', 'expense')]
    assert '%' not in compare[0]['display']
    row = turn_row(agent_db, desk.user, 'week')
    call = next(c for c in row['toolCalls'] if c['tool'] == 'compare_periods')
    assert call['args'] == {'start': '2026-11-23', 'end': '2026-11-29', 'unit': 'week', 'categoryIds': []} and row['skill'] == 'tong_ket_tuan'
    assert [c['tool'] for c in row['toolCalls']] == ['get_period_summary', 'get_category_totals', 'compare_periods', 'get_budget_pace']
    assert [f['display'] for f in body['facts'][:3]] == [vi_money(300_000), vi_money(0), vi_money(-300_000)]  # the week's own figures: 300.000 spent on the 25th
    assert shown(body)[-2:] == pace_lines_of_the_25th()


def test_when_the_week_before_had_spending_the_change_and_percent_are_given(desk, world, agent_db):
    """TC-F14-77 With 180.000 on Tue 17/11 the same question says 300.000 against 180.000, up 120.000 (+66,7%); the weekly summary and the compare_periods tool agree on the shared rule"""
    spend(world, desk.user, category(world, desk.user, 'Cũ'), 180_000, '2026-11-17T05:00:00Z')
    body = say(desk, 'tổng kết tuần')
    line = next(f['display'] for f in body['facts'] if f['label'].startswith('Chi so với'))
    assert line == f"{vi_money(300_000)} (23/11/2026–25/11/2026) so với {vi_money(180_000)} (16/11/2026–18/11/2026), tăng {vi_money(120_000)} (+66,7%)"
    same = say(desk, 'tuần này so với tuần trước')
    assert next(f['display'] for f in same['facts'] if f['id'] == 'expense') == line


def test_the_command_and_the_sunday_report_say_the_same_thing_as_the_question(desk, agent_db):
    """TC-F14-77 /tuan (a command naming the skill) and the Sunday schedule turn run the skill with no search; on Sunday 29/11 the whole week 23-29/11 meets the whole week 16-22/11 (50.000 before: up 250.000, +500 %)"""
    command = say(desk, None, skill='tong_ket_tuan', requestId='cmd')
    assert shown(command) == shown(say(desk, 'tổng kết tuần', requestId='asked')) and command['steps'] == [s for s in PIPELINE if s != 'find_skills']
    sunday = ask(desk.client, desk.auth, desk.user, trigger='schedule', skill='tong_ket_tuan', text=None, today='2026-11-29', channel='telegram', threadKey='tg', requestId='sun').json()
    assert sunday['steps'] == SCHEDULED and sunday['route'] == 'rules' and 'tuần này (23/11/2026–29/11/2026)' in sunday['text']
    line = next(f['display'] for f in sunday['facts'] if f['label'].startswith('Chi so với'))
    assert line == f"{vi_money(300_000)} (23/11/2026–29/11/2026) so với {vi_money(50_000)} (16/11/2026–22/11/2026), tăng {vi_money(250_000)} (+500%)"
    assert turn_row(agent_db, desk.user, 'sun')['trigger'] == 'schedule' and desk.model.calls == 0


def test_the_month_report_for_a_past_month_is_whole_and_for_the_current_one_to_date(desk):
    """TC-F14-77 "tháng này so với tháng trước" on 25/11 is 01-25/11 against 01-25/10 as the Dashboard's MonthCompare; October as a whole meets September as a whole; the comparison names both ranges"""
    spend(desk.world, desk.user, category(desk.world, desk.user, 'Cũ'), 440_000, '2026-10-10T05:00:00Z')
    current = say(desk, 'tháng này so với tháng trước?')
    assert next(f['display'] for f in current['facts'] if f['id'] == 'expense') == (
        f"{vi_money(1_100_000)} (01/11/2026–25/11/2026) so với {vi_money(440_000)} (01/10/2026–25/10/2026), tăng {vi_money(660_000)} (+150%)")
    past = say(desk, 'tháng 10 so với tháng 9')
    assert next(f['display'] for f in past['facts'] if f['id'] == 'expense') == versus(440_000, 0, '01/10/2026–31/10/2026', '01/09/2026–30/09/2026', 'expense')
    assert 'So sánh tháng 10/2026 với kỳ liền trước' in past['text'] and 'Nguồn: So sánh cùng kỳ 10/2026' in past['text']


# ---- TC-F14-78: two users ----

MONEY = re.compile(r'(?<![\d.])-?\d{1,3}(?:\.\d{3})*\xa0₫')  # one whole amount as Vietnamese replies write it, never a piece of a bigger one


def amounts_in(*bodies):
    return {amount for body in bodies for amount in MONEY.findall(body['text'])}


def test_a_second_user_with_the_same_names_and_days_changes_no_number_in_any_reply_of_the_eight_skills(desk, world, auth, agent_db):
    """TC-F14-78 A second user with the same category and wallet names, the same days and other amounts (x7, budgets x7) asks the same questions as the first: no amount of either user is in the other's answers, each gets their own, and no tool call of one holds the other's id"""
    other = make_user(world, email='b@example.com')
    ids = seed_stats(world, other, scale=7)
    seed_budgets(world, other, ids['categories'], scale=7)
    make_wallet(world, other, 'MoMo', 4_550_000, aliases=['mm'])
    questions = ['hôm nay tiêu bao nhiêu?', 'tổng kết tuần', 'tổng kết tuần trước', 'tổng kết tháng này', 'tháng này ăn uống hết bao nhiêu?', 'tháng này so với tháng trước?',
                 '5 khoản chi lớn nhất tháng này', 'momo còn bao nhiêu', 'ngân sách ăn uống còn bao nhiêu', 'ngân sách còn lại']
    mine, theirs = [], []
    for number, text in enumerate(questions):
        mine.append(say(desk, text, requestId=f'a-{number}'))
        theirs.append(say(desk, text, who=other, requestId=f'b-{number}'))
    first_users = [215_000, 85_000, 500_000, 300_000, 1_100_000, 17_000_000, 15_900_000, 900_000, 250_000, 2_000_000, 35_000, 150_000, 5_833, 258_000, 1_320_000, 650_000, 120_000, 60_000]
    seconds = [amount * 7 for amount in first_users if amount != 650_000] + [4_550_000]
    assert amounts_in(*mine).isdisjoint({vi_money(a) for a in seconds}) and amounts_in(*theirs).isdisjoint({vi_money(a) for a in first_users})
    figures = dict(zip(questions, zip(mine, theirs)))
    assert [f['display'] for f in figures['tháng này ăn uống hết bao nhiêu?'][0]['facts']] == [vi_money(215_000)]
    assert [f['display'] for f in figures['tháng này ăn uống hết bao nhiêu?'][1]['facts']] == [vi_money(1_505_000)]
    assert [f['display'] for f in figures['momo còn bao nhiêu'][1]['facts']] == [vi_money(4_550_000)]
    assert figures['ngân sách còn lại'][1]['facts'][0]['display'] == f"còn {vi_money(6_300_000)} (đã chi {vi_money(7_700_000)} / {vi_money(14_000_000)}, 55%)"
    assert [f['display'] for f in figures['5 khoản chi lớn nhất tháng này'][1]['facts']][:2] == [vi_money(3_500_000), vi_money(2_100_000)]
    for number in range(len(questions)):
        assert turn_row(agent_db, desk.user, f'a-{number}')['route'] == 'rules' and turn_row(agent_db, other, f'b-{number}')['route'] == 'rules'
        assert str(other) not in str(turn_row(agent_db, desk.user, f'a-{number}')['toolCalls']) and str(desk.user) not in str(turn_row(agent_db, other, f'b-{number}')['toolCalls'])
    assert desk.model.calls == 0


def test_another_users_category_id_is_refused_by_every_new_tool_that_takes_one(mongo, desk, world, agent_db):
    """TC-F14-78 compare_periods, list_transactions, get_budgets and get_budget_pace given another user's category id (as a scripted model reply would) fail the step with NotYours and read nothing"""
    other = make_user(world, email='b@example.com')
    theirs = seed_stats(world, other)['categories']
    seed_budgets(world, other, theirs)
    for tool, args in [('get_budgets', {'month': '2026-11'}), ('get_budget_pace', {'month': '2026-11'}), ('compare_periods', {'start': '2026-11-01', 'end': '2026-11-30'}),
                       ('list_transactions', {'start': '2026-11-01', 'end': '2026-11-30'})]:
        refused = run_tool(mongo, agent_db.name, desk.user, tool, args | {'categoryIds': [str(theirs['Ăn uống'])]})
        assert (refused.ok, refused.error, refused.facts) == (False, 'NotYours', []), tool


# ---- TC-F14-79: routing the new skills, the words they read and the period they default to ----

def test_a_skill_with_anchored_triggers_wins_over_the_generic_pair_of_another_skill_and_two_anchors_ask_back(desk, agent_db):
    """TC-F14-79 "ngân sách ăn uống còn bao nhiêu" has the pair of chi_theo_danh_muc (a category and "bao nhiêu") and so_du_vi's trigger, but "ngân sách" is the budget skill's own word: direct. Two anchored skills in one question are not decided: an ask-back"""
    for number, (text, code) in enumerate([('ngân sách ăn uống còn bao nhiêu', 'ngan_sach_con_lai'), ('ngân sách còn bao nhiêu', 'ngan_sach_con_lai'),
                                           ('ăn uống tháng này so với tháng trước', 'so_sanh_ky'), ('tổng kết tuần trước tiêu bao nhiêu', 'tong_ket_tuan'),
                                           ('khoản chi lớn nhất tháng này', 'top_khoan_chi')]):
        body = say(desk, text, requestId=f'r-{number}')
        row = turn_row(agent_db, desk.user, f'r-{number}')
        assert (row['skill'], row['retrieval'], body['route']) == (code, 'direct', 'rules') and 'card' not in body, text
    both = say(desk, 'so sánh ngân sách tháng này với tháng trước', requestId='both')
    assert both['card']['kind'] == 'ask_back' and turn_row(agent_db, desk.user, 'both')['retrieval'] == 'choose'
    assert {o['skill'] for o in turn_row(agent_db, desk.user, 'both')['askBack']['options']} >= {'so_sanh_ky', 'ngan_sach_con_lai'}


def test_the_questions_of_the_first_three_skills_still_pick_their_own_skill(desk, agent_db):
    """TC-F14-79 Adding five skills moves none of the first three: "tháng này ăn uống hết bao nhiêu", "momo còn bao nhiêu", "hôm nay tiêu bao nhiêu", "số dư các ví", "chi theo danh mục tháng 10" and "tháng 10 thu bao nhiêu" still resolve directly to their skill"""
    for number, (text, code) in enumerate([('tháng này ăn uống hết bao nhiêu', 'chi_theo_danh_muc'), ('momo còn bao nhiêu', 'so_du_vi'), ('hôm nay tiêu bao nhiêu', 'thu_chi_ky'),
                                           ('số dư các ví', 'so_du_vi'), ('chi theo danh mục tháng 10', 'chi_theo_danh_muc'), ('tháng 10 thu bao nhiêu', 'thu_chi_ky')]):
        say(desk, text, requestId=f'old-{number}')
        row = turn_row(agent_db, desk.user, f'old-{number}')
        assert (row['skill'], row['retrieval']) == (code, 'direct'), text


def test_a_period_after_so_voi_is_the_baseline_and_not_the_period_asked_about():
    """TC-F14-79 "so với tháng trước" names the period to compare with, so the question's own period is the default month; "tháng này so với tháng trước" and "tuần này chi so với tuần trước" take the first phrase; English markers too"""
    wednesday = date(2026, 11, 25)
    got = {text: (period_in(text, wednesday).name if period_in(text, wednesday) else None) for text in
           ('so với tháng trước', 'ăn uống so với tháng trước thì sao', 'tháng này so với tháng trước', 'tuần này chi so với tuần trước', 'hôm nay so với hôm qua',
            'so sánh với tuần trước', 'tuần trước', 'compared to yesterday', 'vs yesterday', 'compare yesterday with the day before')}
    assert got == {'so với tháng trước': None, 'ăn uống so với tháng trước thì sao': None, 'tháng này so với tháng trước': 'this_month', 'tuần này chi so với tuần trước': 'this_week',
                   'hôm nay so với hôm qua': 'today', 'so sánh với tuần trước': None, 'tuần trước': 'last_week', 'compared to yesterday': None, 'vs yesterday': None,
                   'compare yesterday with the day before': 'yesterday'}


def test_the_count_of_a_top_n_or_n_khoan_phrase_is_read_and_nothing_else_is():
    """TC-F14-79 count_in gives the N of "top N" and "N khoản"; a bare number, a day count and a question with none give None"""
    assert [count_in(text) for text in ('5 khoản chi lớn nhất tuần trước', 'top 3 cafe', 'top 10 khoản', '50 khoản chi', 'ăn uống 5', '7 ngày qua', 'hôm nay', '', None)] == [
        5, 3, 10, 50, None, None, None, None, None]


def test_what_the_user_asked_without_naming_a_period_gets_the_skills_default(desk, agent_db):
    """TC-F14-79 "tổng kết tuần" with no period is this week, "tổng kết tháng" this month (or the month the request names); "ngân sách tuần này" has no week to give: the month's budgets with the week said to be skipped; "ngân sách tháng 10" is October's"""
    assert 'tuần này (23/11/2026–29/11/2026)' in say(desk, 'tổng kết tuần')['text']
    assert 'tháng này (11/2026)' in say(desk, 'tổng kết tháng')['text']
    september = say(desk, 'tổng kết tháng', month='2026-09')
    assert 'tháng 9/2026' in september['text'] and [f['display'] for f in september['facts'][:3]] == [vi_money(0)] * 3
    skipped = say(desk, 'ngân sách tuần này')
    assert 'Bỏ qua điều kiện: tuần này (23/11/2026–29/11/2026)' in skipped['text'] and 'Ngân sách tháng này (11/2026)' in skipped['text']
    assert [f['label'] for f in skipped['facts']][:3] == ['Ngân sách · Tổng', 'Ngân sách · Ăn uống', 'Dự báo · Tổng']
    october = say(desk, 'ngân sách tháng 10')
    assert shown(october) == [('Ngân sách', 'chưa đặt ngân sách cho tháng này')] and 'tháng 10/2026' in october['text'] and 'Bỏ qua' not in october['text']


def test_a_linked_row_no_tool_of_the_skill_takes_is_said_and_one_that_a_tool_takes_names_its_line(desk):
    """TC-F14-79 A wallet named in a budget question is said to be skipped (no budget tool takes a wallet); a category named in a comparison is used and the lines name it ("Chi · Ăn uống so với cùng kỳ trước")"""
    wallet = say(desk, 'ngân sách momo còn bao nhiêu')
    assert 'Bỏ qua điều kiện: ví MoMo' in wallet['text'] and wallet['facts'][0]['label'] == 'Ngân sách · Tổng'
    food = say(desk, 'ăn uống tháng này so với tháng trước')
    assert [f['label'] for f in food['facts']] == ['Chi · Ăn uống so với cùng kỳ trước'] and 'Bỏ qua' not in food['text'] and 'tháng này (11/2026) · Ăn uống' in food['text']
    assert food['facts'][0]['display'] == versus(215_000, 0, '01/11/2026–25/11/2026', '01/10/2026–25/10/2026', 'expense')


def test_anchored_and_default_period_are_read_from_the_skill_file_and_a_bad_value_stops_the_start(tmp_path):
    """TC-F14-79 `anchored: true` and `defaultPeriod: week` are read from the files; a defaultPeriod that is not week or month, or an anchored that is not a boolean, is a start-up error naming the file"""
    assert SKILLS['ngan_sach_con_lai'].anchored and not SKILLS['thu_chi_ky'].anchored and not SKILLS['chi_theo_danh_muc'].anchored
    assert SKILLS['tong_ket_tuan'].default_period == 'week' and SKILLS['tong_ket_thang'].default_period == 'month' and SKILLS['thu_chi_ky'].default_period == 'month'
    text = (FOLDER / 'tong_ket_tuan.yaml').read_text(encoding='utf-8')
    for broken, message in [(text.replace('defaultPeriod: week', 'defaultPeriod: fortnight'), 'defaultPeriod'), (text.replace('anchored: true', 'anchored: yes please'), 'anchored')]:
        assert broken != text
        bad = tmp_path / 'tong_ket_tuan.yaml'
        bad.write_text(broken, encoding='utf-8')
        with pytest.raises(ValueError, match=message):
            read_skill(bad, default_registry())


def test_the_ranking_puts_an_exact_trigger_before_an_anchored_one_before_a_decisive_pair():
    """TC-F14-79 routing.rank on skills built by hand: exactly one exact trigger wins first, then exactly one anchored skill, then exactly one decisive pair; two anchored skills decide nothing by their anchors"""
    base = SKILLS['thu_chi_ky']
    a = replace(base, code='a', triggers=['alpha'], pairs=[], anchored=True)
    b = replace(base, code='b', triggers=['beta'], pairs=[], anchored=True)
    c = replace(base, code='c', triggers=['chi'], pairs=[{'entity': 'category', 'phrases': ['bao nhiêu']}], anchored=False)
    d = replace(base, code='d', triggers=['alpha beta'], pairs=[], anchored=False)
    skills = {'a': a, 'b': b, 'c': c}
    vectors = {'a': [1.0, 0.0, 0.0, 0.0], 'b': [0.0, 1.0, 0.0, 0.0], 'c': [0.0, 0.0, 1.0, 0.0], 'd': [0.0, 0.0, 0.0, 1.0]}
    food = {'kind': 'category', 'id': 'x', 'name': 'Ăn uống'}
    prefers_c = [0.0, 0.0, 1.0, 0.0]
    retrieval, candidates = routing.rank('alpha ăn uống bao nhiêu', [food], skills, vectors, prefers_c)
    assert (retrieval, candidates[0]['code']) == ('direct', 'a')  # the anchor beats c's decisive pair, and c's vector
    assert routing.rank('ăn uống bao nhiêu', [food], skills, vectors, [1.0, 0.0, 0.0, 0.0])[:1] == ('direct',) and routing.rank('ăn uống bao nhiêu', [food], skills, vectors, [1.0, 0.0, 0.0, 0.0])[1][0]['code'] == 'c'
    assert routing.rank('alpha beta', [], skills, vectors, [1.0, 0.0, 0.0, 0.0])[0] == 'choose'  # two anchored: nobody decides
    retrieval, candidates = routing.rank('alpha beta', [], {**skills, 'd': d}, vectors, [1.0, 0.0, 0.0, 0.0])
    assert (retrieval, candidates[0]['code']) == ('direct', 'd')  # the whole question is d's trigger: exact comes before the anchors
    retrieval, candidates = routing.rank('chi', [], skills, vectors, [1.0, 0.0, 0.0, 0.0])
    assert (retrieval, candidates[0]['code']) == ('direct', 'c')


def test_the_ranking_of_the_first_three_skills_is_the_same_with_the_five_new_ones_in_the_set():
    """TC-F14-79 The five new skills match none of the words of these questions, so the verdict is the same as with the three skills alone: the same direct winner, or the same skills among the candidates of a choose"""
    three = {code: SKILLS[code] for code in ('thu_chi_ky', 'chi_theo_danh_muc', 'so_du_vi')}
    food = {'kind': 'category', 'id': 'x', 'name': 'Ăn uống'}
    wallet = {'kind': 'wallet', 'id': 'w', 'name': 'MoMo'}
    vectors = {code: [1.0 if n == i else 0.0 for n in range(9)] for i, code in enumerate(sorted(SKILLS))}
    near_nothing = [0.0] * 8 + [1.0]
    for text, entities in [('tháng này ăn uống hết bao nhiêu', [food]), ('momo còn bao nhiêu', [wallet]), ('hôm nay tiêu bao nhiêu', []), ('số dư tháng này tiêu bao nhiêu', [])]:
        with_three = routing.rank(text, entities, three, {code: vectors[code] for code in three}, near_nothing)
        with_eight = routing.rank(text, entities, SKILLS, vectors, near_nothing)
        assert with_three[0] == with_eight[0], text
        if with_three[0] == 'direct':
            assert with_three[1][0]['code'] == with_eight[1][0]['code'], text
        else:  # the order of two skills that both fit is for the vector to settle, and here it settles nothing: they are both there
            assert {'so_du_vi', 'thu_chi_ky'} <= {c['code'] for c in with_eight[1]}, text


def test_a_report_row_at_a_week_edge_in_vietnam_time_falls_in_the_right_week(desk, world):
    """TC-F14-79 Sun 22/11 23:59 +07 is in last week's report and Mon 23/11 00:00 +07 in this week's"""
    cat = category(world, desk.user, 'Cũ')
    spend(world, desk.user, cat, 11_000, '2026-11-22T16:59:00Z')  # Sun 23:59 +07
    spend(world, desk.user, cat, 22_000, '2026-11-22T17:00:00Z')  # Mon 00:00 +07
    assert say(desk, 'tổng kết tuần trước')['facts'][0]['display'] == vi_money(50_000 + 11_000)
    assert say(desk, 'tổng kết tuần')['facts'][0]['display'] == vi_money(300_000 + 22_000)

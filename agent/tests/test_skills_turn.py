# T46 end to end on a throwaway mongod: POST /v1/turn finds the skill by rules and embeddings, runs it with no model, or asks back
# with numbered options (docs/02 §2.11.3, docs/07 §7.9.3 *pipeline path*). The fake chat model fails the test on any use.
import logging
import re
from dataclasses import replace
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from bson import ObjectId
from fastapi.testclient import TestClient
from pymongo import monitoring

from agent import graph
from agent.embedder import FakeEmbedder
from agent.skills import load_skills
from agent.tools import default_registry
from turn_helpers import (NOW, STATS, FakeChatModel, ask, en_money, fixture_balance, make_user, make_wallet, seed_stats, seed_wallets, turn_row,
                          vi_money)

SKILLS = load_skills(default_registry())
FIND = ['ingress', 'load_context', 'rewrite_question', 'recall_memory', 'find_skills']
PIPELINE = [*FIND, 'decide', 'act', 'generate_answer', 'guard_output', 'suggest_followups', 'save_turn']
ASK_BACK = [*FIND, 'decide', 'generate_answer', 'guard_output', 'suggest_followups', 'save_turn']
HELP_TAIL = ['generate_answer', 'guard_output', 'suggest_followups', 'save_turn']
REPLY = [step for step in PIPELINE if step != 'find_skills']  # an ask-back reply skips the search, as a command does


@pytest.fixture
def rich(turn_app, world, auth):
    """A user with the fixture's November (wallet Cash, 30.820.000 ₫), MoMo 650.000 ₫ and Tiền mặt 0, a clock a test can move."""
    user = make_user(world)
    seed_stats(world, user)
    wallets = seed_wallets(world, user)
    clock, model = {'now': NOW}, FakeChatModel()
    app = turn_app(chat_model=model, now=lambda: clock['now'])
    return SimpleNamespace(user=user, wallets=wallets, app=app, client=TestClient(app), model=model, auth=auth, clock=clock, make=turn_app)


def say(world, text, **fields):
    return ask(world.client, world.auth, world.user, text=text, **fields).json()


def category_total(name, first, last):
    """What the fixture's confirmed rows of one category add up to over Vietnam days first..last, summed here from the raw rows."""
    total = 0
    for t in STATS['transactions']:
        if t['category'] != name or t.get('status', 'confirmed') != 'confirmed' or t.get('deleted'):
            continue
        day = (datetime.fromisoformat(t['occurredAt'].replace('Z', '+00:00')) + timedelta(hours=7)).date().isoformat()
        total += t['amount'] if first <= day <= last else 0
    return total


# ---- the skills' own examples resolve directly, with no model ----

EXAMPLES = [(code, example) for code in sorted(SKILLS) for example in SKILLS[code].examples]


@pytest.mark.parametrize('code,example', EXAMPLES)
def test_every_example_of_every_skill_resolves_directly_with_no_model_call(rich, agent_db, code, example):
    """TC-F14-69 Each example question of thu_chi_ky, chi_theo_danh_muc and so_du_vi is found as `direct` with its own skill, runs its tool and is answered by rules, 0 model calls"""
    body = say(rich, example, requestId='example')
    row = turn_row(agent_db, rich.user, 'example')
    assert (row['skill'], row['retrieval'], row['route'], row['guard']) == (code, 'direct', 'rules', 'pass'), example
    assert body['steps'] == PIPELINE and body['facts'] and 'card' not in body and rich.model.calls == 0
    assert [call['tool'] for call in row['toolCalls']] == [tool.name for tool in SKILLS[code].tools] and all(call['ok'] for call in row['toolCalls'])
    assert 2 <= len(body['followups']) <= 3 and 'Nguồn' in body['text']


@pytest.mark.parametrize('code', sorted(SKILLS))
def test_every_follow_up_chip_is_a_question_the_same_skill_answers_in_both_languages(rich, agent_db, code):
    """TC-F14-69 Each follow-up chip of each skill, sent back as a question in its own language, is answered by that skill by rules"""
    for language in ('vi', 'en'):
        for number, chip in enumerate(c[language] for c in SKILLS[code].followups):
            rid = f'chip-{language}-{number}'
            body = say(rich, chip, language=language, requestId=rid)
            row = turn_row(agent_db, rich.user, rid)
            assert (row['skill'], row['retrieval'], body['route']) == (code, 'direct', 'rules'), (language, chip)
    assert rich.model.calls == 0


# ---- chi_theo_danh_muc ----

def test_one_category_over_a_period_is_the_fixtures_total_with_its_period_and_filter_named(rich, agent_db):
    """TC-F14-68 "tháng này ăn uống hết bao nhiêu?" answers Ăn uống's 215.000 ₫ for 11/2026 from the tool, naming the period, the category and the filter, with its source and 2 follow-ups, and the row says what ran"""
    ids = {row['names']['vi']: row['_id'] for row in agent_db['categories'].find({'userId': rich.user})}
    body = say(rich, 'tháng này ăn uống hết bao nhiêu?', requestId='cat-1')
    assert body['route'] == 'rules' and body['steps'] == PIPELINE
    assert [(f['label'], f['display']) for f in body['facts']] == [('Ăn uống', vi_money(215_000))]
    assert vi_money(category_total('Ăn uống', '2026-11-01', '2026-11-30')) == vi_money(215_000)
    assert 'tháng này (11/2026)' in body['text'] and 'Ăn uống' in body['text'] and 'đã xác nhận' in body['text'] and 'Bỏ qua' not in body['text']
    assert body['sources'] == ['Giao dịch đã xác nhận 11/2026, theo danh mục'] and 'Nguồn' in body['text']
    assert len(body['followups']) == 2 and body['followups'][0] == 'Chi theo danh mục tháng trước'
    row = turn_row(agent_db, rich.user, 'cat-1')
    assert (row['skill'], row['retrieval']) == ('chi_theo_danh_muc', 'direct')
    assert [(c['tool'], c['ok']) for c in row['toolCalls']] == [('get_category_totals', True)]
    assert row['toolCalls'][0]['args'] == {'start': '2026-11-01', 'end': '2026-11-30', 'type': 'expense', 'categoryIds': [str(ids['Ăn uống'])], 'top': 5}
    assert 'userId' not in str(row['toolCalls'])
    assert say(rich, 'tuần trước đi lại hết bao nhiêu')['facts'][0]['display'] == vi_money(category_total('Đi lại', '2026-11-16', '2026-11-22')) == vi_money(0)
    assert say(rich, 'tháng này đi lại tiêu bao nhiêu')['facts'][0]['display'] == vi_money(85_000)


def test_with_no_category_named_the_biggest_ones_come_ranked_with_the_total(rich):
    """TC-F14-68 "chi theo danh mục tháng 10" and "...tháng này" list the top categories biggest first with the total of all, and a month with nothing answers 0, never a failure line"""
    body = say(rich, 'chi theo danh mục tháng này')
    assert [(f['label'], f['display']) for f in body['facts']] == [('Mua sắm', vi_money(500_000)), ('Hoá đơn', vi_money(300_000)), ('Ăn uống', vi_money(215_000)),
                                                                   ('Đi lại', vi_money(85_000)), ('Tổng chi', vi_money(1_100_000))]
    assert 'Mình chưa lấy được' not in body['text'] and 'tháng này (11/2026)' in body['text']
    october = say(rich, 'chi theo danh mục tháng 10')
    assert [(f['label'], f['display']) for f in october['facts']] == [('Tổng chi', vi_money(0))] and 'tháng 10/2026' in october['text']
    income = say(rich, 'tháng này lương bao nhiêu')  # an income category: its own total, whatever the skill's default type
    assert [(f['label'], f['display']) for f in income['facts']] == [('Lương', vi_money(15_000_000))]


def test_a_linked_row_the_skill_cannot_use_is_said_out_loud_not_dropped(rich, world, agent_db):
    """TC-F14-68 A wallet named in a category question, a category named to a command that takes none, and words that name two rows each add "Bỏ qua điều kiện: …" to the answer and change no figure"""
    wallet = say(rich, 'tháng này ăn uống hết bao nhiêu momo')
    assert [f['display'] for f in wallet['facts']] == [vi_money(215_000)] and 'Bỏ qua điều kiện: ví MoMo' in wallet['text']
    assert wallet['text'].index('Bỏ qua điều kiện') < wallet['text'].index('Nguồn')
    command = say(rich, 'ăn uống tháng 10', skill='thu_chi_ky')  # thu_chi_ky has no category argument
    assert [f['display'] for f in command['facts']] == [vi_money(0), vi_money(15_000_000), vi_money(15_000_000)] and 'Bỏ qua điều kiện: danh mục Ăn uống' in command['text']
    world['categories'].insert_one({'userId': rich.user, 'type': 'expense', 'names': {'vi': 'MoMo', 'en': 'MoMo'}, 'keywords': [], 'deletedAt': None})
    tie = say(rich, 'tháng này thu bao nhiêu momo', requestId='tie-1')
    assert [f['display'] for f in tie['facts']][2] == vi_money(15_900_000)  # thu_chi_ky ran, with neither MoMo
    assert 'Bỏ qua điều kiện: danh mục MoMo / ví MoMo (trùng tên, không đoán)' in tie['text']
    assert turn_row(agent_db, rich.user, 'tie-1')['skill'] == 'thu_chi_ky'
    plain = say(rich, 'tháng này thu bao nhiêu')
    assert 'Bỏ qua' not in plain['text']  # nothing named: nothing skipped
    unknown = say(rich, 'tháng này thu bao nhiêu từ thuê nhà')
    assert 'Bỏ qua' not in unknown['text']  # a word no row owns links nothing, so there is nothing to skip


def test_the_words_of_a_period_are_not_read_as_a_category(rich, world, agent_db):
    """TC-F14-60 A category whose keyword is "qua" (a gift) is not linked by "hôm qua" or "7 ngày qua"; "quà" typed as a word links it"""
    world['categories'].insert_one({'userId': rich.user, 'type': 'income', 'names': {'vi': 'Được tặng', 'en': 'Gifts'}, 'keywords': ['qua'], 'deletedAt': None})
    for text in ('hôm qua tiêu bao nhiêu', 'chi tiêu 7 ngày qua'):
        body = say(rich, text)
        assert body['route'] == 'rules' and 'Bỏ qua' not in body['text'] and body['facts'][0]['label'] == 'Chi', text
    gift = say(rich, 'tháng này quà bao nhiêu')
    assert [f['label'] for f in gift['facts']] == ['Được tặng'] and gift['facts'][0]['display'] == vi_money(0)


def test_in_english_the_names_the_money_and_the_filter_line_are_english(rich):
    """TC-F14-68 language en names the category and the period in English, formats money as ₫1,234 and says "Skipped conditions"."""
    body = say(rich, 'how much did I spend on an uong this month', language='en')
    assert body['route'] == 'rules' and [f['display'] for f in body['facts']] == [en_money(215_000)] and 'By category for this month (11/2026)' in body['text']
    assert 'Source' in body['text'] and 'Skipped' not in body['text']
    skipped = say(rich, 'how much did I spend on an uong this month momo', language='en')
    assert 'Skipped conditions: wallet MoMo' in skipped['text']


# ---- so_du_vi ----

def test_a_wallets_balance_is_what_the_wallet_holds_with_its_name_in_the_answer(rich, agent_db):
    """TC-F14-69 "momo còn bao nhiêu?" answers MoMo's 650.000 ₫, naming the wallet; "số dư các ví" lists every wallet and their total; the balance is the fixture's 30.820.000 ₫ for Cash"""
    one = say(rich, 'momo còn bao nhiêu?', requestId='bal-1')
    assert one['route'] == 'rules' and one['steps'] == PIPELINE and [(f['label'], f['display']) for f in one['facts']] == [('MoMo', vi_money(650_000))]
    assert 'Số dư hiện tại · MoMo' in one['text'] and 'Nguồn' in one['text'] and len(one['followups']) == 2 and 'Bỏ qua' not in one['text']
    row = turn_row(agent_db, rich.user, 'bal-1')
    assert (row['skill'], row['retrieval']) == ('so_du_vi', 'direct') and row['toolCalls'][0]['args'] == {'walletIds': [str(rich.wallets['MoMo'])]}
    every = say(rich, 'số dư các ví')
    assert [(f['label'], f['display']) for f in every['facts']] == [
        ('Cash', vi_money(fixture_balance())), ('MoMo', vi_money(650_000)), ('Tiền mặt', vi_money(0)), ('Tổng', vi_money(fixture_balance() + 650_000))]
    assert 'Số dư hiện tại,' in every['text'] and '·' not in every['text'].split('\n')[0]
    assert [f['display'] for f in say(rich, 'tm còn bao nhiêu')['facts']] == [vi_money(0)]  # an alias
    english = say(rich, 'how much is left in momo', language='en')
    assert [(f['label'], f['display']) for f in english['facts']] == [('MoMo', en_money(650_000))] and 'Current balance · MoMo' in english['text']


def test_a_period_named_for_a_balance_is_said_to_be_skipped_and_another_users_wallet_never_shows(rich, world, auth, agent_db):
    """TC-F14-69 "momo còn bao nhiêu tháng 10" answers the balance now and says the month was skipped; a second user's wallet with the same name and a bigger balance is not in this user's answer, and theirs is their own"""
    body = say(rich, 'momo còn bao nhiêu tháng 10')
    assert [f['display'] for f in body['facts']] == [vi_money(650_000)] and 'Bỏ qua điều kiện: tháng 10/2026' in body['text']
    other = make_user(world, email='b@example.com')
    make_wallet(world, other, 'MoMo', 9_000_000, aliases=['mm'])
    mine = say(rich, 'momo còn bao nhiêu', requestId='mine')
    theirs = ask(rich.client, auth, other, text='momo còn bao nhiêu', requestId='theirs').json()
    assert vi_money(9_000_000) not in mine['text'] and [f['display'] for f in theirs['facts']] == [vi_money(9_000_000)] and vi_money(650_000) not in theirs['text']
    assert [row['skill'] for row in agent_db['agentTurns'].find({'requestId': {'$in': ['mine', 'theirs']}})] == ['so_du_vi', 'so_du_vi']


def test_a_tool_that_fails_gives_the_failure_line_and_a_tool_with_nothing_to_add_does_not(rich, monkeypatch):
    """TC-F14-69 A failed get_wallet_balances is the "could not read your figures" line with no facts and no number, still answered by rules"""
    from agent.tools import get_wallet_balances

    monkeypatch.setattr(get_wallet_balances, 'balances', lambda ctx, args: 1 / 0)
    failed = say(rich, 'momo còn bao nhiêu')
    assert failed['facts'] == [] and 'chưa lấy được số liệu' in failed['text'] and failed['route'] == 'rules' and not any(c.isdigit() for c in failed['text'])


# ---- ask-back ----

CHOOSE = 'số dư tháng này tiêu bao nhiêu'  # so_du_vi by "số dư", thu_chi_ky by "tiêu" and "bao nhiêu": two skills fit, none decides


def test_when_two_skills_fit_and_the_model_is_off_the_turn_asks_back_with_numbered_options(rich, agent_db):
    """TC-F14-64 `choose` answers a numbered question, card {kind: ask_back, options: [{n, label}]} and askBack {question, options, expiresAt: now + 10 minutes} stored on the row, no tool run, no model call"""
    body = say(rich, CHOOSE, requestId='ask-1')
    assert body['route'] == 'rules' and body['steps'] == ASK_BACK and body['facts'] == [] and body['followups'] == [] and body['sources'] == []
    card = body['card']
    assert card['kind'] == 'ask_back' and [o['n'] for o in card['options']] == [1, 2, 3] and all(set(o) == {'n', 'label'} for o in card['options'])
    assert body['text'].splitlines()[0] == 'Bạn muốn hỏi ý nào?' and body['text'].splitlines()[-1] == 'Trả lời 1-3 trong 10 phút.'
    assert body['text'].splitlines()[1:4] == [f"{o['n']}. {o['label']}" for o in card['options']]
    row = turn_row(agent_db, rich.user, 'ask-1')
    assert (row['retrieval'], row['skill'], row['toolCalls'], row['facts'], row['route'], row['answer']) == ('choose', None, [], [], 'rules', body['text'])
    ask_back = row['askBack']
    assert ask_back['question'] == 'Bạn muốn hỏi ý nào?' and ask_back['expiresAt'] == NOW + timedelta(minutes=10) and ask_back['expiresAt'].tzinfo is not None
    assert [o['skill'] for o in ask_back['options']][:2] in (['thu_chi_ky', 'so_du_vi'], ['so_du_vi', 'thu_chi_ky']) and {o['skill'] for o in ask_back['options']} == set(SKILLS)
    assert [(o['n'], o['label']) for o in ask_back['options']] == [(o['n'], o['label']) for o in card['options']]
    first = ask_back['options'][0]
    assert first['period'] == {'start': '2026-11-01', 'end': '2026-11-30', 'unit': 'month', 'name': 'this_month', 'named': True} and first['categoryIds'] == first['walletIds'] == []
    assert 'tháng này (11/2026)' in first['label'] and rich.model.calls == 0
    assert set(body) == {'route', 'text', 'facts', 'sources', 'followups', 'steps', 'timingsMs', 'card'}  # askBack stays on the row: Express reads it there
    english = say(rich, 'balance of what I spend, bao nhiêu', language='en', requestId='ask-en')
    assert english['card']['kind'] == 'ask_back' and english['text'].splitlines()[0] == 'Which one do you mean?' and english['text'].splitlines()[-1] == 'Reply 1-3 within 10 minutes.'
    assert not any(ord(c) > 0x2100 and c not in '₫−' for c in ' '.join(o['label'] for o in english['card']['options']))  # English labels


def test_the_options_carry_the_linked_rows_and_a_tie_makes_no_link(rich, world, agent_db):
    """TC-F14-64 The ids of the categories and wallets the question named are carried in each option, in the user's own data; words that name two rows carry none"""
    body = say(rich, 'momo ăn uống số dư tiêu', requestId='ask-2')
    assert body['card']['kind'] == 'ask_back'  # a category with "tiêu" and a wallet with "số dư" both decide: nobody does
    cat = agent_db['categories'].find_one({'userId': rich.user, 'names.vi': 'Ăn uống'})['_id']
    row = turn_row(agent_db, rich.user, 'ask-2')
    for option in row['askBack']['options']:
        assert option['categoryIds'] == [str(cat)] and option['walletIds'] == [str(rich.wallets['MoMo'])] and 'MoMo' in option['label'] and 'Ăn uống' in option['label']
    world['categories'].insert_one({'userId': rich.user, 'type': 'expense', 'names': {'vi': 'MoMo', 'en': 'MoMo'}, 'keywords': [], 'deletedAt': None})
    tied = say(rich, 'momo số dư tiêu', requestId='ask-3')
    assert all(o['categoryIds'] == o['walletIds'] == [] for o in turn_row(agent_db, rich.user, 'ask-3')['askBack']['options']) and tied['card']['kind'] == 'ask_back'


def test_a_question_nothing_fits_gets_the_help_text_with_three_examples_one_per_skill(rich, agent_db):
    """TC-F14-64 `none` answers the help text with 3 example questions, each from a different skill, then the plain commands; no card, no askBack, no tool"""
    body = say(rich, 'xin chào bạn', requestId='none-1')
    lines = body['text'].splitlines()
    examples = [line[2:] for line in lines if line.startswith('- ')]
    assert body['route'] == 'rules' and body['steps'] == [*FIND, *HELP_TAIL] and 'card' not in body and body['facts'] == []
    assert len(examples) == 3 and {code for code in SKILLS for e in examples if e in SKILLS[code].examples} == set(SKILLS)
    assert lines[-1].startswith('Lệnh: /today')
    row = turn_row(agent_db, rich.user, 'none-1')
    assert (row['retrieval'], row['skill'], row['toolCalls'], row['askBack'], row['card']) == ('none', None, [], None, None)
    assert 'Commands' in say(rich, 'hello there', language='en')['text']


# ---- the reply: 1-3 within ten minutes ----

def reply_to(rich, number, minutes=5, **fields):
    rich.clock['now'] = NOW + timedelta(minutes=minutes)
    return say(rich, str(number), **fields)


def option_of(agent_db, user, request_id, skill):
    return next(o['n'] for o in turn_row(agent_db, user, request_id)['askBack']['options'] if o['skill'] == skill)


def test_a_reply_within_ten_minutes_runs_that_option_with_what_it_carries(rich, agent_db):
    """TC-F14-65 A bare 1-3 in the same thread runs the chosen option: the skill, the period and the entities of the first question, no search, no model; the row says what ran"""
    say(rich, CHOOSE, requestId='ask-1')
    embedded = len(rich.app.state.embedder.calls)
    for skill, expect in [('thu_chi_ky', [vi_money(1_100_000), vi_money(17_000_000), vi_money(15_900_000)]),
                          ('so_du_vi', [vi_money(fixture_balance()), vi_money(650_000), vi_money(0), vi_money(fixture_balance() + 650_000)]),
                          ('chi_theo_danh_muc', [vi_money(500_000), vi_money(300_000), vi_money(215_000), vi_money(85_000), vi_money(1_100_000)])]:
        number = option_of(agent_db, rich.user, 'ask-1', skill)
        body = reply_to(rich, number, requestId=f'reply-{skill}')
        assert body['route'] == 'rules' and body['steps'] == REPLY and [f['display'] for f in body['facts']] == expect, skill
        row = turn_row(agent_db, rich.user, f'reply-{skill}')
        assert (row['skill'], row['retrieval'], row['question'], row['standalone'], row['toolCalls'][0]['ok']) == (skill, 'direct', str(number), CHOOSE, True)
        assert row['askBack'] is None and row['card'] is None and 'card' not in body and 2 <= len(body['followups']) <= 3
    assert len(rich.app.state.embedder.calls) == embedded and rich.model.calls == 0  # a reply embeds nothing
    assert 'Bỏ qua điều kiện: tháng này (11/2026)' in turn_row(agent_db, rich.user, 'reply-so_du_vi')['answer']  # a balance has no period: said, not dropped
    assert 'tháng này (11/2026)' in turn_row(agent_db, rich.user, 'reply-thu_chi_ky')['answer']  # the period the question named is carried


def test_a_reply_runs_the_linked_category_and_wallet_the_question_named(rich, agent_db):
    """TC-F14-65 The option's category and wallet ids reach the tools: the reply to "momo ăn uống số dư tiêu" answers Ăn uống's total or MoMo's balance"""
    say(rich, 'momo ăn uống số dư tiêu', requestId='ask-2')
    by_category = reply_to(rich, option_of(agent_db, rich.user, 'ask-2', 'chi_theo_danh_muc'), requestId='r1')
    assert [(f['label'], f['display']) for f in by_category['facts']] == [('Ăn uống', vi_money(215_000))] and 'Bỏ qua điều kiện: ví MoMo' in by_category['text']
    by_wallet = reply_to(rich, option_of(agent_db, rich.user, 'ask-2', 'so_du_vi'), requestId='r2')
    assert [(f['label'], f['display']) for f in by_wallet['facts']] == [('MoMo', vi_money(650_000))] and 'Bỏ qua điều kiện: danh mục Ăn uống' in by_wallet['text']


def test_the_same_reply_can_be_sent_again_and_another_option_after_it(rich, agent_db):
    """TC-F14-65 The ask-back is a read: replying 1 and then 2 runs both, each under its own requestId, and the same requestId twice is a duplicate as ever"""
    say(rich, CHOOSE, requestId='ask-1')
    first = reply_to(rich, 1, requestId='one')
    second = reply_to(rich, 2, requestId='two')
    assert first['facts'] and second['facts'] and first['facts'] != second['facts']
    assert ask(rich.client, rich.auth, rich.user, text='1', requestId='one').status_code == 409


def test_ten_minutes_after_the_ask_back_it_has_expired_and_says_so(rich, agent_db):
    """TC-F14-65 At 9 minutes 59 seconds the reply runs; from 10 minutes it gets "Câu hỏi đã hết hạn, hãy hỏi lại", no tool, no search, no embedding, and the option is not run"""
    say(rich, CHOOSE, requestId='ask-1')
    rich.clock['now'] = NOW + timedelta(minutes=9, seconds=59)
    assert say(rich, '2', requestId='in-time')['facts']
    embedded = len(rich.app.state.embedder.calls)
    for number, delay in enumerate((timedelta(minutes=10), timedelta(minutes=11), timedelta(hours=5), timedelta(hours=23, minutes=59))):
        rich.clock['now'] = NOW + delay
        body = say(rich, '1', requestId=f'late-{number}', language='vi')
        assert body['route'] == 'rules' and body['text'] == 'Câu hỏi đã hết hạn, hãy hỏi lại' and body['facts'] == [] and 'card' not in body, delay
        assert body['steps'] == ['ingress', 'load_context', 'rewrite_question', 'recall_memory', *HELP_TAIL]
        assert turn_row(agent_db, rich.user, f'late-{number}')['toolCalls'] == []
    assert len(rich.app.state.embedder.calls) == embedded
    english = say(rich, '1', language='en', requestId='late-en')
    assert english['text'] == 'That question has expired, please ask it again'


def test_a_bare_digit_a_day_after_the_ask_back_lapsed_is_just_text(rich, agent_db):
    """TC-F14-65 More than 24 hours after the ask-back expired, a bare digit has no ask-back to answer and is searched like any text (here: nothing fits, the help text); so is a digit with no ask-back at all and a 4 or a 0"""
    say(rich, CHOOSE, requestId='ask-1')
    rich.clock['now'] = NOW + timedelta(minutes=10, hours=24, seconds=1)
    after = say(rich, '1', requestId='after-a-day')
    assert turn_row(agent_db, rich.user, 'after-a-day')['retrieval'] == 'none' and 'Mình trả lời được' in after['text'] and 'hết hạn' not in after['text']
    rich.clock['now'] = NOW + timedelta(minutes=1)
    for number, text in enumerate(('4', '0', '12', '1 2', '1.5')):
        body = say(rich, text, requestId=f'not-a-reply-{number}')
        assert 'hết hạn' not in body['text'] and 'steps' in body and 'find_skills' in body['steps'], text  # searched as text, not read as a reply
    fresh = say(rich, '2', requestId='no-ask-back', threadKey='another-thread')
    assert 'find_skills' in fresh['steps'] and fresh['facts'] == []


def test_the_reply_is_scoped_to_this_user_this_thread_and_this_channel_and_a_cleared_ask_back_is_gone(rich, world, auth, agent_db):
    """TC-F14-66 Another user's "1" in the same thread, the same user's "1" in another thread or channel, and a "1" after the drawer's "Xoá" run nothing of that ask-back; the user's own reply still works"""
    say(rich, CHOOSE, requestId='ask-1')
    other = make_user(world, email='b@example.com')
    seed_stats(world, other, scale=5)
    mine_before = agent_db['agentTurns'].count_documents({'userId': rich.user})
    theirs = ask(rich.client, auth, other, text='1', requestId='b-1').json()  # the same threadKey and channel, another person
    assert theirs['facts'] == [] and 'find_skills' in theirs['steps'] and turn_row(agent_db, other, 'b-1')['toolCalls'] == []
    assert vi_money(1_100_000) not in theirs['text'] and vi_money(5_500_000) not in theirs['text']
    for fields in ({'threadKey': 'another'}, {'channel': 'telegram', 'threadKey': 'web'}, {'channel': 'zalo'}):
        body = say(rich, '1', requestId='x-' + '-'.join(fields.values()), **fields)
        assert body['facts'] == [] and 'find_skills' in body['steps'], fields
    assert agent_db['agentTurns'].count_documents({'userId': rich.user}) == mine_before + 3
    agent_db['agentTurns'].update_one({'userId': rich.user, 'requestId': 'ask-1'}, {'$set': {'clearedAt': NOW}})
    cleared = say(rich, '1', requestId='after-xoa')
    assert cleared['facts'] == [] and 'find_skills' in cleared['steps']
    agent_db['agentTurns'].update_one({'userId': rich.user, 'requestId': 'ask-1'}, {'$set': {'clearedAt': None}})
    assert say(rich, '1', requestId='back-again')['facts']


@pytest.mark.parametrize('function,state,expected', [
    (graph.route_after_recall, {'skill': None, 'reply': {'kind': 'run'}}, 'decide'),  # an ask-back reply names its option: no search
    (graph.route_after_recall, {'skill': None, 'reply': {'kind': 'expired'}}, 'generate_answer'),
    (graph.route_after_recall, {'skill': None, 'reply': {'kind': 'invalid'}}, 'generate_answer'),
    (graph.route_after_recall, {'skill': None, 'reply': None}, 'find_skills'),
    (graph.route_after_recall, {'skill': 'thu_chi_ky', 'reply': None}, 'decide'),
    (graph.route_after_search, {'retrieval': 'choose'}, 'decide'),  # decide asks back (the model off) or lets the model pick (T63)
    (graph.route_after_decide, {'plan': [], 'card': {'kind': 'ask_back'}}, 'generate_answer'),  # an ask-back has nothing to run
])
def test_the_routes_of_an_ask_back(function, state, expected):
    """TC-F14-65 After the memory a reply that runs goes to decide, one that has expired or is gone to the answer, any other text to the search; a choose goes to decide and an ask-back from there to the answer"""
    assert function(state) == expected


LINE = re.compile(r'^request=[A-Za-z0-9:._-]+ node=\w+( status=\d+)?( ms=\d+)?( tool=\w+)?( guard=\w+)?( error=\w+)?$')


def test_the_log_lines_of_an_ask_back_a_reply_and_a_failed_embedder_hold_no_text_or_id(rich, world, caplog):
    """TC-F14-65 Every log line of these turns is request id, node, time and an error class: not the question, the options, a category or wallet name, an id or a figure"""
    caplog.set_level(logging.DEBUG)
    say(rich, 'momo ăn uống số dư tiêu', requestId='log-1')
    rich.clock['now'] = NOW + timedelta(minutes=1)
    say(rich, '1', requestId='log-2')
    rich.clock['now'] = NOW + timedelta(minutes=30)
    say(rich, '2', requestId='log-3')

    class Broken(FakeEmbedder):
        broken = False

        def encode(self, texts):
            if self.broken:
                raise RuntimeError('cannot embed ' + texts[0])
            return super().encode(texts)

    embedder = Broken()
    other = TestClient(rich.make(embedder=embedder))
    embedder.broken = True
    ask(other, rich.auth, rich.user, text='tiêu bao nhiêu ăn uống', requestId='log-4')
    lines = [r.getMessage() for r in caplog.records if r.name == 'uvicorn.error']
    assert lines and all(LINE.match(line) for line in lines), [line for line in lines if not LINE.match(line)]
    assert any('node=recall_memory error=RuntimeError' in line for line in lines) and any('node=find_skills' in line for line in lines)
    everything = ' '.join(r.getMessage() for r in caplog.records)
    for secret in ('momo', 'MoMo', 'ăn uống', 'Ăn uống', 'số dư', 'cannot embed', str(rich.user), str(rich.wallets['MoMo']), '650.000', '215.000'):
        assert secret not in everything, secret


class Spy(monitoring.CommandListener):
    active, seen = False, []

    def started(self, event):
        if Spy.active and event.command_name == 'find' and event.command.get('find') == 'agentTurns':
            Spy.seen.append(event.command['filter'])

    def succeeded(self, event):
        pass

    def failed(self, event):
        pass


monitoring.register(Spy())


def test_reading_an_ask_back_filters_by_user_and_thread_with_a_time_limit(rich, agent_db):
    """TC-F14-66 The query that finds the ask-back has userId, channel, threadKey, clearedAt null and askBack set, and carries maxTimeMS; a text that is not a bare digit never reads it"""
    say(rich, CHOOSE, requestId='ask-1')
    Spy.seen.clear()
    Spy.active = True
    try:
        say(rich, 'tháng này thu bao nhiêu', requestId='plain')
        plain = [f for f in Spy.seen if 'askBack' in f]
        say(rich, '1', requestId='digit')
        found = [f for f in Spy.seen if 'askBack' in f]
    finally:
        Spy.active = False
    assert plain == [] and len(found) == 1
    assert found[0]['userId'] == rich.user and found[0]['channel'] == 'web' and found[0]['threadKey'] == 'web' and found[0]['clearedAt'] is None
    assert found[0]['askBack'] == {'$ne': None}


def test_an_option_whose_category_or_wallet_was_deleted_is_not_run(rich, world, agent_db):
    """TC-F14-66 A deleted category or a deleted wallet that the option carries: "Lựa chọn này không còn dùng được nữa", no tool, nothing else changed; the same reply before the delete ran"""
    for number, (collection, field, value) in enumerate([('categories', 'names.vi', 'Ăn uống'), ('wallets', 'name', 'MoMo')]):
        thread = f'thread-{number}'
        say(rich, 'momo ăn uống số dư tiêu', requestId=f'ask-{number}', threadKey=thread)
        row = world[collection].find_one({'userId': rich.user, field: value})
        world[collection].update_one({'_id': row['_id']}, {'$set': {'deletedAt': NOW}})
        body = say(rich, str(option_of(agent_db, rich.user, f'ask-{number}', 'so_du_vi')), requestId=f'reply-{number}', threadKey=thread)
        assert body['text'] == ('Lựa chọn này không còn dùng được nữa (danh mục, ví hoặc kỹ năng đã đổi), bạn hỏi lại nhé.') and body['facts'] == [], collection
        assert body['steps'] == [*FIND[:4], *HELP_TAIL] and turn_row(agent_db, rich.user, f'reply-{number}')['toolCalls'] == []
        world[collection].update_one({'_id': row['_id']}, {'$set': {'deletedAt': None}})
        assert say(rich, '1', requestId=f'again-{number}', threadKey=thread)['facts']  # back as it was: it runs


def test_a_disabled_or_removed_skill_in_the_option_is_not_run(rich, agent_db):
    """TC-F14-66 After the ask-back the skill it offers is disabled (or taken out) at the next start: the reply says the choice no longer works instead of running it, and the other options still run"""
    say(rich, CHOOSE, requestId='ask-1')
    options = {o['skill']: o['n'] for o in turn_row(agent_db, rich.user, 'ask-1')['askBack']['options']}
    changed = {**SKILLS, 'so_du_vi': replace(SKILLS['so_du_vi'], enabled=False)}
    later = TestClient(rich.make(skills=changed, now=lambda: NOW + timedelta(minutes=2)))
    gone = ask(later, rich.auth, rich.user, text=str(options['so_du_vi']), requestId='gone').json()
    assert 'không còn dùng được' in gone['text'] and gone['facts'] == [] and turn_row(agent_db, rich.user, 'gone')['toolCalls'] == []
    assert ask(later, rich.auth, rich.user, text=str(options['thu_chi_ky']), requestId='kept').json()['facts']
    fewer = {code: skill for code, skill in SKILLS.items() if code != 'so_du_vi'}
    removed = TestClient(rich.make(skills=fewer, now=lambda: NOW + timedelta(minutes=2)))
    assert 'không còn dùng được' in ask(removed, rich.auth, rich.user, text=str(options['so_du_vi']), requestId='removed').json()['text']


def test_a_number_that_is_not_one_of_the_options_and_a_tampered_option_are_not_run(rich, agent_db):
    """TC-F14-66 With only 2 options a reply 3 is not one of them; an option whose period is not a period this service runs (inverted, more than 400 days, not a date) or whose ids are another user's is refused"""
    two = {code: skill for code, skill in SKILLS.items() if code != 'chi_theo_danh_muc'}
    client = TestClient(rich.make(skills=two, now=lambda: NOW))
    ask(client, rich.auth, rich.user, text=CHOOSE, requestId='ask-2', threadKey='two')
    assert len(turn_row(agent_db, rich.user, 'ask-2')['askBack']['options']) == 2
    assert 'không còn dùng được' in ask(client, rich.auth, rich.user, text='3', requestId='three', threadKey='two').json()['text']
    assert ask(client, rich.auth, rich.user, text='2', requestId='two-ok', threadKey='two').json()['facts']
    other = ObjectId()
    for number, change in enumerate([{'period.start': '2026-12-01', 'period.end': '2026-11-01'}, {'period.start': '2024-01-01'}, {'period.start': 'x'},
                                     {'period': None}, {'categoryIds': [str(other)]}, {'walletIds': [str(other)]}, {'skill': 'khong_co'}]):
        agent_db['agentTurns'].update_one({'userId': rich.user, 'requestId': 'ask-2'}, {'$set': {f'askBack.options.0.{k}': v for k, v in change.items()}})
        body = ask(client, rich.auth, rich.user, text='1', requestId=f'tamper-{number}', threadKey='two').json()
        assert 'không còn dùng được' in body['text'] and body['facts'] == [], change
        agent_db['agentTurns'].update_one({'userId': rich.user, 'requestId': 'ask-2'}, {'$set': {'askBack.options.0.period': {'start': '2026-11-01', 'end': '2026-11-30', 'unit': 'month', 'name': 'this_month', 'named': True},
                                                                                              'askBack.options.0.categoryIds': [], 'askBack.options.0.walletIds': [], 'askBack.options.0.skill': 'so_du_vi'}})


# ---- the vector half of the ranking, through the whole turn ----

class Scripted(FakeEmbedder):
    """The fake embedder, except that chosen texts get the vector it is told to give them."""

    def __init__(self, table):
        super().__init__()
        self.table = table

    def encode(self, texts):
        self.calls.append(list(texts))
        return [self.table.get(text) or self._vector(text) for text in texts]


def blend(vector, other, share):
    """A unit vector whose cosine with `vector` is about `share` (the rest of it points elsewhere)."""
    mixed = [share * a + (1 - share * share) ** 0.5 * b for a, b in zip(vector, other)]
    length = sum(x * x for x in mixed) ** 0.5
    return [x / length for x in mixed]


def test_with_no_word_match_a_near_vector_asks_back_and_a_far_one_gets_the_help_text(turn_app, world, auth, agent_db):
    """TC-F14-61 Through /v1/turn: the vector of the question 0.6 from a skill's text, with no trigger in it, asks back with that skill first; 0.3 from it is `none`; the model is never called either way"""
    user = make_user(world)
    seed_stats(world, user)
    fake = FakeEmbedder()
    skill_vector = fake.encode(['\n'.join([SKILLS['so_du_vi'].label_vi, SKILLS['so_du_vi'].label_en, SKILLS['so_du_vi'].description,
                                           *SKILLS['so_du_vi'].examples, *SKILLS['so_du_vi'].triggers])])[0]
    noise = fake.encode(['unrelated noise'])[0]
    near, far = 'tiền trong túi còn bao nhiêu nhỉ?'.replace('còn bao nhiêu', 'ra sao'), 'một câu khác hẳn về thời tiết'
    embedder = Scripted({near: blend(skill_vector, noise, 0.6), far: blend(skill_vector, noise, 0.3)})
    client = TestClient(turn_app(embedder=embedder))
    close = ask(client, auth, user, text=near, requestId='near').json()
    assert close['card']['kind'] == 'ask_back' and turn_row(agent_db, user, 'near')['askBack']['options'][0]['skill'] == 'so_du_vi'
    assert turn_row(agent_db, user, 'near')['retrieval'] == 'choose'
    distant = ask(client, auth, user, text=far, requestId='far').json()
    assert 'card' not in distant and turn_row(agent_db, user, 'far')['retrieval'] == 'none' and 'Mình trả lời được' in distant['text']


def test_a_disabled_skill_is_not_found_by_its_words_and_the_enabled_one_is(turn_app, world, auth, agent_db):
    """TC-F14-61 With so_du_vi disabled, "số dư các ví" is not found (the help text); with it enabled the same question is direct; a disabled skill is not one of the ask-back's options either"""
    user = make_user(world)
    seed_stats(world, user)
    off = TestClient(turn_app(skills={**SKILLS, 'so_du_vi': replace(SKILLS['so_du_vi'], enabled=False)}))
    body = ask(off, auth, user, text='số dư các ví', requestId='off').json()
    assert turn_row(agent_db, user, 'off')['retrieval'] == 'none' and body['facts'] == [] and turn_row(agent_db, user, 'off')['skill'] is None
    choose = ask(off, auth, user, text='số dư tháng này tiêu bao nhiêu', requestId='off-2').json()  # thu_chi_ky alone matches now: direct, no ask-back
    assert turn_row(agent_db, user, 'off-2')['skill'] == 'thu_chi_ky' and 'card' not in choose
    on = TestClient(turn_app())
    assert ask(on, auth, user, text='số dư các ví', requestId='on').json()['facts'] and turn_row(agent_db, user, 'on')['skill'] == 'so_du_vi'

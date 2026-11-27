# /v1/turn end to end on a throwaway mongod, as sochitieu_agent: the graph's paths for the first skill, thu_chi_ky
# (docs/02 §2.11.3, docs/07 §7.9.3 *pipeline path*, *two users*), the caps and the input guard of `ingress` (§2.11.4).
# The fake chat model fails the test on any use: these turns answer by rules, with no model (route: rules).
import json
import logging
import re
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from bson import ObjectId
from fastapi.testclient import TestClient
from pymongo import monitoring

from agent.skills import load_skills
from agent.tools import default_registry
from turn_helpers import NOW, STATS, FakeChatModel, en_money, make_user, seed_stats, total_between, turn_body, vi_money, vn_day_sums

PIPELINE = ['ingress', 'load_context', 'rewrite_question', 'recall_memory', 'find_skills', 'decide', 'act', 'generate_answer',
            'guard_output', 'suggest_followups', 'save_turn']
HELP_TAIL = ['generate_answer', 'guard_output', 'suggest_followups', 'save_turn']


def ask(client, auth, user, **fields):
    return client.post('/v1/turn', json=turn_body(user, **fields), headers=auth)


def turn_row(agent_db, user, request_id):
    return agent_db['agentTurns'].find_one({'userId': user, 'requestId': request_id})


@pytest.fixture
def seeded(turn_app, world, auth):
    """A user with the fixture's November 2026, an app over it and a client."""
    user = make_user(world)
    seed_stats(world, user)
    model = FakeChatModel()
    app = turn_app(chat_model=model)
    return SimpleNamespace(user=user, app=app, client=TestClient(app), model=model, auth=auth)


# ---- the first skill, by rules ----

def test_thu_chi_ky_answers_from_mongodb_with_no_model(seeded, agent_db):
    """TC-F14-41 "tháng này thu bao nhiêu" is answered by the rules, 0 model calls: the figures of expected-stats.json, the period and filter named, sources, follow-ups and one agentTurns row"""
    summary = STATS['expected']['summary']
    rid = 'web-41'
    response = ask(seeded.client, seeded.auth, seeded.user, text='tháng này thu bao nhiêu?', requestId=rid)
    assert response.status_code == 200
    body = response.json()
    assert body['route'] == 'rules' and body['steps'] == PIPELINE
    assert [t['node'] for t in body['timingsMs']] == PIPELINE and all(isinstance(t['ms'], int) for t in body['timingsMs'])
    for amount in (summary['expense'], summary['income'], summary['net']):  # 1.100.000, 17.000.000, 15.900.000
        assert vi_money(amount) in body['text']
    assert 'tháng này' in body['text'] and '11/2026' in body['text']  # the period
    assert 'đã xác nhận' in body['text']  # the filter
    assert [f['display'] for f in body['facts']] == [vi_money(summary['expense']), vi_money(summary['income']), vi_money(summary['net'])]
    assert body['sources'] and all('11/2026' in s for s in body['sources']) and 'Nguồn' in body['text']
    assert 2 <= len(body['followups']) <= 3 and all(isinstance(f, str) and f for f in body['followups'])
    assert 'action' not in body and 'card' not in body
    # No model. The embedder ran when the service started (the 3 skills, then the 3 tools) and once for this question (T46).
    assert seeded.model.calls == 0 and [len(call) for call in seeded.app.state.embedder.calls] == [3, 3, 1] and seeded.app.state.embedder.calls[-1] == ['tháng này thu bao nhiêu?']

    row = turn_row(agent_db, seeded.user, rid)
    assert agent_db['agentTurns'].count_documents({'userId': seeded.user}) == 1
    assert (row['channel'], row['threadKey'], row['trigger'], row['question']) == ('web', 'web', 'chat', 'tháng này thu bao nhiêu?')
    assert (row['skill'], row['retrieval'], row['route'], row['guard'], row['model']) == ('thu_chi_ky', 'direct', 'rules', 'pass', None)
    assert (row['promptTokens'], row['completionTokens'], row['command'], row['clearedAt']) == (0, 0, False, None)
    assert [c['tool'] for c in row['toolCalls']] == ['get_period_summary']
    assert row['toolCalls'][0]['args'] == {'start': '2026-11-01', 'end': '2026-11-30'} and row['toolCalls'][0]['ok'] is True
    assert isinstance(row['toolCalls'][0]['ms'], int) and 'userId' not in json.dumps(row['toolCalls'])
    assert (row['answer'], row['facts'], row['sources'], row['followups']) == (body['text'], body['facts'], body['sources'], body['followups'])
    assert row['steps'] == PIPELINE and [t['node'] for t in row['timingsMs']] == PIPELINE
    assert row['createdAt'].tzinfo is not None and row['createdAt'] == NOW


def test_every_follow_up_is_a_question_the_same_skill_answers(seeded, agent_db):
    """TC-F14-41 Each of the 2-3 follow-up chips, sent as a question, is answered by thu_chi_ky with no model"""
    chips = ask(seeded.client, seeded.auth, seeded.user, text='hôm nay tiêu bao nhiêu?').json()['followups']
    assert 2 <= len(chips) <= 3
    for number, chip in enumerate(chips):
        answer = ask(seeded.client, seeded.auth, seeded.user, text=chip, requestId=f'chip-{number}')
        assert answer.status_code == 200 and answer.json()['route'] == 'rules' and answer.json()['facts'], chip
        assert turn_row(agent_db, seeded.user, f'chip-{number}')['skill'] == 'thu_chi_ky'


@pytest.mark.parametrize('text,today,first,last', [
    ('hôm nay tiêu bao nhiêu', '2026-11-20', '2026-11-20', '2026-11-20'),  # 00:00 on the 20th in Vietnam, 17:00 UTC on the 19th
    ('hôm qua tiêu bao nhiêu', '2026-11-20', '2026-11-19', '2026-11-19'),  # 23:59 on the 19th
    ('hôm nay tiêu bao nhiêu', '2026-11-25', '2026-11-25', '2026-11-25'),
    ('hôm nay tiêu bao nhiêu', '2026-11-26', '2026-11-26', '2026-11-26'),  # a day with nothing: 0, not an error
    ('tuần này tiêu bao nhiêu', '2026-11-25', '2026-11-23', '2026-11-29'),
    ('tuần trước tiêu bao nhiêu', '2026-11-25', '2026-11-16', '2026-11-22'),
    ('tuần này tiêu bao nhiêu', '2026-11-22', '2026-11-16', '2026-11-22'),  # a Sunday is still the week that began on Monday
    ('tháng này tiêu bao nhiêu', '2026-11-25', '2026-11-01', '2026-11-30'),
    ('tháng trước thu bao nhiêu', '2026-11-25', '2026-10-01', '2026-10-31'),
    ('tháng 10 thu bao nhiêu', '2026-11-25', '2026-10-01', '2026-10-31'),
    ('tháng 12 năm 2026 tiêu bao nhiêu', '2026-11-25', '2026-12-01', '2026-12-31'),
    ('chi tiêu 7 ngày qua', '2026-11-25', '2026-11-19', '2026-11-25'),
    ('chi tiêu năm 2026', '2026-11-25', '2026-01-01', '2026-12-31'),
    ('thu bao nhiêu 20/11', '2026-11-25', '2026-11-20', '2026-11-20'),
])
def test_the_figures_are_the_rows_of_the_asked_days_added_up_by_hand(seeded, text, today, first, last):
    """TC-F14-41 For each period phrase the answer holds the fixture's rows of those Vietnam days, summed here from the raw rows"""
    want = total_between(vn_day_sums(), first, last)
    body = ask(seeded.client, seeded.auth, seeded.user, text=text, today=today).json()
    assert [f['display'] for f in body['facts']] == [vi_money(want['expense']), vi_money(want['income']), vi_money(want['net'])]
    for amount in want.values():
        assert vi_money(amount) in body['text']


def test_the_same_answer_in_english_and_the_default_month(seeded, agent_db):
    """TC-F14-41 language en gives English text with en money and en follow-ups; with no period phrase the request's month (else this month) is used"""
    body = ask(seeded.client, seeded.auth, seeded.user, text='how much did I earn? bao nhiêu', language='en', month='2026-10').json()
    assert body['route'] == 'rules' and 'Source' in body['text'] and 'confirmed' in body['text'] and 'October 2026' in body['text']
    assert [f['display'] for f in body['facts']] == [en_money(0), en_money(15_000_000), en_money(15_000_000)]
    assert [f['label'] for f in body['facts']] == ['Expense', 'Income', 'Net (income − expense)']
    assert body['followups'] == ['How much did I spend yesterday?', 'How much did I earn this month?']
    assert not any(ord(c) > 0x2100 and c not in '₫−' for c in body['text'])  # no Vietnamese-only symbol leaks into English
    plain = ask(seeded.client, seeded.auth, seeded.user, text='tiêu bao nhiêu', language='vi').json()  # no phrase, no month: this month
    assert 'tháng này' in plain['text'] and vi_money(1_100_000) in plain['text']
    assert ask(seeded.client, seeded.auth, seeded.user, text='tiêu bao nhiêu', month='2026-10').json()['facts'][0]['display'] == vi_money(0)


def test_the_skill_files_are_valid(turn_app):
    """TC-F14-41 Every skill file has both languages, 2-3 follow-ups, a template, tools the registry has, and a code that is its file name"""
    skills = load_skills(default_registry())
    assert 'thu_chi_ky' in skills
    skill = skills['thu_chi_ky']
    assert (skill.mode, skill.enabled, [t.name for t in skill.tools]) == ('pipeline', True, ['get_period_summary'])
    assert skill.max_steps == 4 and skill.examples and skill.triggers
    for code, one in skills.items():
        assert 2 <= len(one.followups) <= 3 and all(f['vi'] and f['en'] for f in one.followups), code
        assert one.label_vi and one.label_en and one.description, code
        for language in ('vi', 'en'):
            assert one.templates[language]['answer'] and one.templates[language]['sources'], (code, language)


# ---- commands: a skill is given ----

def test_a_command_skips_find_skills_may_have_no_text_and_is_marked_a_command(seeded, agent_db):
    """TC-F14-42 A chat turn with skill set goes to decide without find_skills, its text may be empty, and its row says command: true"""
    rid = 'cmd-1'
    body = ask(seeded.client, seeded.auth, seeded.user, skill='thu_chi_ky', text='', requestId=rid).json()
    assert body['route'] == 'rules' and 'find_skills' not in body['steps']
    assert body['steps'] == [s for s in PIPELINE if s != 'find_skills']
    assert vi_money(1_100_000) in body['text'] and 'tháng này' in body['text']  # the skill's default period
    row = turn_row(agent_db, seeded.user, rid)
    assert (row['command'], row['question'], row['skill'], row['retrieval']) == (True, None, 'thu_chi_ky', 'direct')
    with_text = ask(seeded.client, seeded.auth, seeded.user, skill='thu_chi_ky', text='tháng 10').json()  # a command's words still name a period
    assert vi_money(15_000_000) in with_text['text'] and with_text['facts'][1]['display'] == vi_money(15_000_000)


def test_over_the_cap_a_command_still_answers_and_free_text_gets_the_cap_line(seeded, agent_db):
    """TC-F14-42 With the web cap used up, a skill turn with empty text is answered and adds nothing to the count; free text gets the cap line and the plain commands, and no tool runs"""
    agent_db['agentTurns'].insert_many([{'userId': seeded.user, 'channel': 'web', 'threadKey': 'web', 'requestId': f'old-{i}', 'trigger': 'chat',
                                        'command': False, 'createdAt': NOW - timedelta(minutes=i)} for i in range(30)])
    capped = ask(seeded.client, seeded.auth, seeded.user, text='hôm nay tiêu bao nhiêu', requestId='free-1').json()
    assert capped['route'] == 'capped' and capped['facts'] == [] and '30' in capped['text'] and '/today' in capped['text'] and '/month' in capped['text']
    assert capped['steps'] == ['ingress', 'load_context', *HELP_TAIL]
    assert turn_row(agent_db, seeded.user, 'free-1')['toolCalls'] == []
    for i in range(5):  # commands never count: five of them and still the same answer
        command = ask(seeded.client, seeded.auth, seeded.user, skill='thu_chi_ky', text='', requestId=f'cmd-{i}').json()
        assert command['route'] == 'rules' and vi_money(1_100_000) in command['text']
    assert ask(seeded.client, seeded.auth, seeded.user, text='hôm nay tiêu bao nhiêu', requestId='free-2').json()['route'] == 'capped'


def test_an_unknown_disabled_or_agent_mode_skill_gets_help_text(turn_app, world, auth, agent_db):
    """TC-F14-42 A skill that is unknown, disabled or not a pipeline skill gets the help text with example questions, runs no tool and is still a command turn"""
    base = load_skills(default_registry())['thu_chi_ky']
    user = make_user(world)
    seed_stats(world, user)
    skills = {'thu_chi_ky': base, 'disabled_one': replace(base, code='disabled_one', enabled=False), 'agent_one': replace(base, code='agent_one', mode='agent')}
    client = TestClient(turn_app(skills=skills))
    for code in ('khong_co_skill', 'disabled_one', 'agent_one'):
        rid = f'help-{code}'
        body = ask(client, auth, user, skill=code, text='', requestId=rid).json()
        assert body['route'] == 'rules' and body['facts'] == [] and body['followups'] == []
        assert body['steps'] == ['ingress', 'load_context', 'rewrite_question', 'recall_memory', 'decide', *HELP_TAIL]  # decide found nothing to run
        assert '/today' in body['text'] and 'hôm nay tiêu bao nhiêu' in body['text'] and not re.search(r'\d{4,}', body['text'])
        row = turn_row(agent_db, user, rid)
        assert (row['toolCalls'], row['command'], row['skill']) == ([], True, None)
    # The disabled skill is not found by words either: it is never a candidate.
    body = ask(client, auth, user, text='hôm nay tiêu bao nhiêu').json()
    assert body['route'] == 'rules' and body['facts'] and body['steps'] == PIPELINE


def test_text_no_skill_fits_gets_help_text_with_three_examples_at_most(seeded, agent_db):
    """TC-F14-42 retrieval none (no skill matches the words) answers the help text, skips decide and act, and lists only questions an enabled skill can answer"""
    body = ask(seeded.client, seeded.auth, seeded.user, text='xin chào bạn', requestId='none-1').json()
    assert body['route'] == 'rules' and body['facts'] == []
    assert body['steps'] == ['ingress', 'load_context', 'rewrite_question', 'recall_memory', 'find_skills', *HELP_TAIL]
    row = turn_row(agent_db, seeded.user, 'none-1')
    assert (row['retrieval'], row['skill'], row['toolCalls']) == ('none', None, [])
    examples = [line[2:] for line in body['text'].splitlines() if line.startswith('- ')]
    assert len(examples) == 3 and all(any(example in skill.examples for skill in load_skills(default_registry()).values()) for example in examples)  # three, each an example of an enabled skill
    english = ask(seeded.client, seeded.auth, seeded.user, text='hello there', language='en').json()
    assert 'Commands' in english['text'] and '/today' in english['text']


# ---- ingress: input guard and daily cap ----

def test_ingress_cleans_the_text_and_answers_a_too_long_or_empty_one_without_running_anything(seeded, agent_db):
    """TC-F14-43 Control characters are stripped and the text stored in NFC; 500 characters pass, 501 and an empty text are answered with no tool call"""
    dirty = 'tháng\x00 này\x07 thu\nbao\tnhiêu\x1b?'  # decomposed accents, control characters, a newline and a tab
    body = ask(seeded.client, seeded.auth, seeded.user, text=dirty, requestId='clean-1').json()
    assert body['route'] == 'rules' and body['facts']
    assert turn_row(agent_db, seeded.user, 'clean-1')['question'] == 'tháng này thu bao nhiêu?'
    padded = 'tháng này thu bao nhiêu ' + 'x' * (500 - len('tháng này thu bao nhiêu '))
    assert len(padded) == 500
    assert ask(seeded.client, seeded.auth, seeded.user, text=padded, requestId='len-500').json()['route'] == 'rules'
    assert turn_row(agent_db, seeded.user, 'len-500')['question'] == padded
    assert ask(seeded.client, seeded.auth, seeded.user, text=padded + 'x', requestId='len-501').json()['route'] == 'rules'
    long_row = turn_row(agent_db, seeded.user, 'len-501')
    assert (long_row['question'], long_row['toolCalls'], long_row['facts']) == (None, [], [])
    assert '500' in long_row['answer'] and long_row['steps'] == ['ingress', 'load_context', *HELP_TAIL]
    controls = padded + '\x00' * 40  # control characters do not count towards the 500
    assert turn_row(agent_db, seeded.user, 'len-500')['question'] and ask(seeded.client, seeded.auth, seeded.user, text=controls, requestId='len-ctrl').json()['facts']
    for number, text in enumerate(('', '   \n\t ', None, '\x00\x01')):
        rid = f'empty-{number}'
        body = ask(seeded.client, seeded.auth, seeded.user, text=text, requestId=rid).json()
        assert body['facts'] == [] and body['steps'] == ['ingress', 'load_context', *HELP_TAIL] and '/today' in body['text']
        assert turn_row(agent_db, seeded.user, rid)['question'] is None


CAPS = {'web': 30, 'telegram': 20, 'zalo': 10, 'whatsapp': 5}


@pytest.mark.parametrize('channel,cap', list(CAPS.items()))
def test_the_daily_cap_counts_chat_rows_of_this_user_and_channel_in_the_vietnam_day(seeded, agent_db, channel, cap):
    """TC-F14-43 The cap-th question is answered and the next one is capped; rows from yesterday, other channels, other users, other triggers and commands do not count; cleared rows do"""
    rows = lambda n, **fields: [{'userId': seeded.user, 'channel': channel, 'threadKey': 't', 'trigger': 'chat', 'command': False,
                                 'requestId': f'{fields.get("tag", "r")}-{channel}-{i}', 'createdAt': NOW - timedelta(minutes=i + 1)} | fields for i in range(n)]
    start_of_vn_day = datetime(2026, 11, 24, 17, 0, tzinfo=timezone.utc)  # 00:00 on 25/11 in Vietnam
    agent_db['agentTurns'].insert_many(
        rows(cap - 3)  # counted
        + rows(1, tag='cleared', clearedAt=NOW)  # "Xoá" hides the thread, the count stays
        + rows(1, tag='first-second', createdAt=start_of_vn_day)  # the first instant of today counts
        + rows(1, tag='lastnight', createdAt=start_of_vn_day - timedelta(milliseconds=1))  # not today
        + rows(3, tag='sched', trigger='schedule') + rows(3, tag='conf', trigger='confirm') + rows(3, tag='cmd', command=True)
        + rows(3, tag='elsewhere', channel='web' if channel != 'web' else 'telegram')
        + rows(3, tag='someone', userId=ObjectId()))
    # cap - 3 + cleared + first instant = cap - 1 counted rows: one more is allowed
    assert ask(seeded.client, seeded.auth, seeded.user, text='hôm nay tiêu bao nhiêu', channel=channel, threadKey='t', requestId='the-last').json()['route'] == 'rules'
    over = ask(seeded.client, seeded.auth, seeded.user, text='hôm nay tiêu bao nhiêu', channel=channel, threadKey='t', requestId='one-too-many').json()
    assert over['route'] == 'capped' and str(cap) in over['text'] and '/today' in over['text'] and over['facts'] == []
    row = turn_row(agent_db, seeded.user, 'one-too-many')
    assert (row['route'], row['toolCalls'], row['skill']) == ('capped', [], None)
    english = ask(seeded.client, seeded.auth, seeded.user, text='hello', channel=channel, threadKey='t', language='en', requestId='en-cap').json()
    assert english['route'] == 'capped' and str(cap) in english['text'] and 'Commands' in english['text']
    # a confirm, a schedule turn and a command are never capped
    assert ask(seeded.client, seeded.auth, seeded.user, skill='thu_chi_ky', text='', channel=channel, threadKey='t').json()['route'] == 'rules'
    assert ask(seeded.client, seeded.auth, seeded.user, trigger='schedule', skill='thu_chi_ky', text=None, channel=channel, threadKey='t').json()['route'] == 'rules'


def test_the_cap_day_changes_at_vietnam_midnight(turn_app, world, auth, agent_db):
    """TC-F14-43 The same 30 rows cap the web at 23:59 Vietnam time and stop counting at 00:00"""
    user = make_user(world)
    agent_db['agentTurns'].insert_many([{'userId': user, 'channel': 'web', 'threadKey': 'web', 'trigger': 'chat', 'command': False, 'requestId': f'r{i}',
                                        'createdAt': datetime(2026, 11, 25, 16, 0, tzinfo=timezone.utc)} for i in range(30)])  # 23:00 on 25/11 Vietnam
    for hour, minute, route in ((16, 59, 'capped'), (17, 0, 'rules')):  # 23:59 and 00:00 (26/11) in Vietnam
        now = datetime(2026, 11, 25, hour, minute, tzinfo=timezone.utc)
        client = TestClient(turn_app(now=lambda now=now: now))
        assert ask(client, auth, user, text='hôm nay tiêu bao nhiêu', requestId=f'at-{hour}-{minute}').json()['route'] == route


# ---- two users ----

def test_two_users_with_the_same_names_and_days_never_see_each_others_numbers(turn_app, world, auth, agent_db):
    """TC-F14-44 A second user with the same category and wallet names and rows on the same days, other amounts: no figure of one is in the other's answer, thread, history or row"""
    a, b = make_user(world), make_user(world, email='b@example.com', language='en')
    seed_stats(world, a)
    seed_stats(world, b, scale=7)  # 7.700.000 ₫ and 119.000.000 ₫ instead
    app = turn_app()
    client = TestClient(app)
    first = ask(client, auth, a, text='tháng này thu bao nhiêu', requestId='same-id', threadKey='web').json()
    second = ask(client, auth, b, text='tháng này thu bao nhiêu', requestId='same-id', threadKey='web')  # the same ids are fine for another user
    assert second.status_code == 200
    mine, theirs = first['text'], second.json()['text']
    assert vi_money(17_000_000) in mine and vi_money(7_700_000) not in mine
    assert vi_money(119_000_000) in theirs and vi_money(7_700_000) in theirs and vi_money(17_000_000) not in theirs and vi_money(1_100_000) not in theirs
    for user in (a, b):
        assert agent_db['agentTurns'].count_documents({'userId': user, 'requestId': 'same-id'}) == 1
    # What load_context carries into a turn: the user's own thread only, with the same threadKey for both.
    from agent.graph import new_state

    from agent.schemas import TurnRequest

    state_b = app.state.graph.invoke(new_state(TurnRequest(**turn_body(b, text='còn tháng trước thu bao nhiêu')), 'turn-b', app.state.deps))
    assert [turn['question'] for turn in state_b['history']] == ['tháng này thu bao nhiêu']  # B's own previous turn, never A's
    assert all(vi_money(17_000_000) not in turn['answer'] for turn in state_b['history'])
    assert state_b['categories'] and all(c['_id'] != x['_id'] for c in state_b['categories'] for x in
                                         app.state.graph.invoke(new_state(TurnRequest(**turn_body(a)), 'turn-a', app.state.deps))['categories'])


def test_a_confirm_naming_another_users_action_finds_nothing(turn_app, world, auth, agent_db):
    """TC-F14-44 A confirm with the id of another user's pendingActions row gets the "no longer valid" line, never that action's summary"""
    a, b = make_user(world), make_user(world, email='b@example.com')
    action = world['pendingActions'].insert_one({'userId': a, 'kind': 'set_budget', 'args': {}, 'summary': 'Đặt ngân sách Ăn uống 3.000.000 ₫', 'status': 'done',
                                                'expiresAt': NOW + timedelta(minutes=5)}).inserted_id
    client = TestClient(turn_app())
    mine = ask(client, auth, a, trigger='confirm', actionId=str(action), text=None, requestId='c-a').json()
    assert 'Đặt ngân sách Ăn uống 3.000.000' in mine['text'] and mine['steps'] == ['ingress', 'load_context', 'act', *HELP_TAIL]
    theirs = ask(client, auth, b, trigger='confirm', actionId=str(action), text=None, requestId='c-b').json()
    assert 'Đặt ngân sách' not in theirs['text'] and 'hết hạn' in theirs['text'] and theirs['steps'] == ['ingress', 'load_context', *HELP_TAIL]


# ---- what never reaches the agent: D15, and what the logs hold ----

class Spy(monitoring.CommandListener):
    active = False
    seen = []

    def started(self, event):
        if Spy.active:
            Spy.seen.append((event.command_name, event.command.get(event.command_name)))

    def succeeded(self, event):
        pass

    def failed(self, event):
        pass


monitoring.register(Spy())


def test_no_email_name_or_hash_reaches_the_state_the_logs_or_the_row(turn_app, world, auth, agent_db, caplog):
    """TC-F14-45 For a user with an e-mail, a name and a password hash, the state, the log lines and the agentTurns row hold none of them, and the users collection is never queried"""
    user = make_user(world, assistantOn=False)
    seed_stats(world, user)
    app = turn_app()
    from agent.graph import new_state
    from agent.schemas import TurnRequest

    caplog.set_level(logging.DEBUG)
    Spy.seen.clear()
    Spy.active = True
    try:
        state = app.state.graph.invoke(new_state(TurnRequest(**turn_body(user, requestId='d15')), 'turn-d15', app.state.deps))
    finally:
        Spy.active = False
    private = ['an.private@example.com', 'privatehash', 'An Private', 'role', 'defaultWalletId', 'sessions']
    dumped = json.dumps(state, default=str, ensure_ascii=False)
    row = json.dumps(turn_row(agent_db, user, 'd15'), default=str, ensure_ascii=False)
    logs = ' '.join(record.getMessage() for record in caplog.records)
    for value in private[:3]:
        assert value not in dumped and value not in row and value not in logs, value
    assert state['user'] == {'language': 'vi', 'assistantOn': False}  # the view's fields and nothing else
    touched = {collection for _, collection in Spy.seen if isinstance(collection, str)}
    assert 'users' not in touched and 'usersForAgent' in touched and 'transactions' in touched


LINE = re.compile(r'^request=[A-Za-z0-9:._-]+ node=\w+( status=\d+)?( ms=\d+)?( tool=\w+)?( guard=\w+)?( error=\w+)?$')


def test_log_lines_hold_only_the_request_id_the_node_timings_and_error_classes(turn_app, world, auth, agent_db, caplog, monkeypatch):
    """TC-F14-45 During a turn (and a turn whose tool fails) every log line is request id, node, time and an error class: no text, figure, amount, id or e-mail"""
    user = make_user(world)
    seed_stats(world, user)
    client = TestClient(turn_app())
    caplog.set_level(logging.DEBUG)
    text = 'phở 45k hôm nay tiêu bao nhiêu 0912345678 an.private@example.com'
    response = client.post('/v1/turn', json=turn_body(user, text=text), headers=auth | {'X-Request-Id': 'telegram:123:456'})
    assert response.status_code == 200 and response.headers['x-request-id'] == 'telegram:123:456'
    from agent.tools import get_period_summary

    def boom(ctx, args):
        raise ValueError('cà phê 45k, the note the user typed')

    monkeypatch.setattr(get_period_summary, 'summarize', boom)
    failed = client.post('/v1/turn', json=turn_body(user, text='tháng này thu bao nhiêu'), headers=auth)
    assert failed.status_code == 200 and failed.json()['route'] == 'rules' and failed.json()['facts'] == []  # a failed tool is a template answer
    lines = [r.getMessage() for r in caplog.records if r.name == 'uvicorn.error']
    assert lines and all(LINE.match(line) for line in lines), [line for line in lines if not LINE.match(line)]
    nodes = {line.split(' node=')[1].split()[0] for line in lines}
    assert set(PIPELINE) <= nodes and 'request=telegram:123:456' in lines[0] and any('error=ValueError' in line for line in lines)
    everything = ' '.join(lines) + ' '.join(r.getMessage() for r in caplog.records)
    for secret in ('phở', '45k', '0912345678', 'an.private', 'cà phê', 'thu bao nhiêu', str(user), '17.000.000', '1.100.000', 'tháng này'):
        assert secret not in everything, secret

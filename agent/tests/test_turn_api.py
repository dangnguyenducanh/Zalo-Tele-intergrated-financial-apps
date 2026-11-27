# POST /v1/turn as a client sees it (docs/04 §4.11 "Agent service API", docs/07 §7.9.3 "Agent API"): who may call it, which
# bodies it refuses, what a repeated requestId does, what a full queue does, and the routing functions of the graph.
import threading
import time

import pytest
from fastapi.testclient import TestClient

from agent import graph
from agent.tools import get_period_summary
from agent.turn_queue import TurnQueue
from turn_helpers import make_user, seed_stats, turn_body


@pytest.fixture
def user(world):
    user = make_user(world)
    seed_stats(world, user)
    return user


def test_turn_needs_the_bearer_secret_and_a_valid_body(turn_app, user, auth, agent_db):
    """TC-F14-46 /v1/turn answers 401 with no or a wrong secret and 422 VALIDATION_ERROR for a body missing userId, channel, requestId or today, or holding a bad value, and writes no row for either"""
    client = TestClient(turn_app())
    body = turn_body(user)
    for headers in ({}, {'Authorization': 'Bearer wrong'}, {'Authorization': auth['Authorization'].replace('Bearer', 'Basic')}):
        response = client.post('/v1/turn', json=body, headers=headers)
        assert (response.status_code, response.json()['error']['code']) == (401, 'UNAUTHENTICATED')
    bad_values = {'trigger': 'shout', 'userId': 'not-an-id', 'channel': 'fax', 'threadKey': '', 'requestId': '', 'language': 'fr',
                  'today': '25/11/2026', 'month': '2026-13', 'actionId': 'x', 'allowLlm': 'maybe', 'extra': 1}
    for field in ('userId', 'channel', 'requestId', 'today', 'trigger', 'threadKey', 'language'):
        assert client.post('/v1/turn', json={k: v for k, v in body.items() if k != field}, headers=auth).status_code == 422, field
    for field, value in bad_values.items():
        refused = client.post('/v1/turn', json=body | {field: value}, headers=auth)
        assert refused.status_code == 422 and refused.json()['error']['code'] == 'VALIDATION_ERROR', field
    secret_text = 'a private question ' * 1200  # over the 20000-character body limit: refused, and never echoed back
    refused = client.post('/v1/turn', json=body | {'text': secret_text}, headers=auth)
    assert refused.status_code == 422 and 'private question' not in refused.text
    assert client.post('/v1/turn', content='not json', headers=auth | {'Content-Type': 'application/json'}).status_code == 422
    assert agent_db['agentTurns'].count_documents({}) == 0
    ok = client.post('/v1/turn', json=body | {'month': '2026-10', 'allowLlm': True}, headers=auth)  # month and allowLlm are accepted
    assert ok.status_code == 200 and set(ok.json()) == {'route', 'text', 'facts', 'sources', 'followups', 'steps', 'timingsMs'}


def test_the_same_request_id_twice_is_one_row_and_a_409(turn_app, user, auth, agent_db, monkeypatch):
    """TC-F14-47 A redelivered requestId gets 409 DUPLICATE and runs nothing, also while the first is still running; the first answer and its one agentTurns row stand"""
    app = turn_app()
    client = TestClient(app)
    first = client.post('/v1/turn', json=turn_body(user, requestId='once', text='tháng này thu bao nhiêu'), headers=auth)
    second = client.post('/v1/turn', json=turn_body(user, requestId='once', text='hôm nay tiêu bao nhiêu'), headers=auth)
    assert first.status_code == 200 and (second.status_code, second.json()['error']['code']) == (409, 'DUPLICATE')
    assert agent_db['agentTurns'].count_documents({'userId': user, 'requestId': 'once'}) == 1
    assert agent_db['agentTurns'].find_one({'userId': user, 'requestId': 'once'})['answer'] == first.json()['text']
    # The double click: the second arrives while the first is inside its tool. It is refused at ingress, so the tool runs once.
    gate, calls, original = threading.Event(), [], get_period_summary.summarize

    def slow(ctx, args):
        calls.append(args)
        gate.wait(10)
        return original(ctx, args)

    monkeypatch.setattr(get_period_summary, 'summarize', slow)
    answers = []
    runner = threading.Thread(target=lambda: answers.append(client.post('/v1/turn', json=turn_body(user, requestId='click'), headers=auth)))
    runner.start()
    while not calls:
        time.sleep(0.01)
    assert client.post('/v1/turn', json=turn_body(user, requestId='click'), headers=auth).status_code == 409
    gate.set()
    runner.join(10)
    assert answers[0].status_code == 200 and len(calls) == 1
    assert agent_db['agentTurns'].count_documents({'userId': user, 'requestId': 'click'}) == 1


def test_a_crash_leaves_no_row_that_would_turn_the_redelivery_into_a_duplicate(turn_app, user, auth, agent_db, monkeypatch):
    """TC-F14-47 When a node raises, the caller gets 500 INTERNAL with no detail, the half-written row is removed, and the same requestId can be sent again"""
    client = TestClient(turn_app())
    monkeypatch.setattr(graph.texts, 'help_text', lambda *args: 1 / 0)
    crashed = client.post('/v1/turn', json=turn_body(user, requestId='crash', text='xin chào'), headers=auth)
    assert (crashed.status_code, crashed.json()['error']['code']) == (500, 'INTERNAL') and 'ZeroDivision' not in crashed.text
    assert agent_db['agentTurns'].count_documents({'requestId': 'crash'}) == 0
    monkeypatch.undo()
    assert client.post('/v1/turn', json=turn_body(user, requestId='crash', text='xin chào'), headers=auth).status_code == 200


def test_a_full_queue_answers_agent_busy_at_once_and_writes_nothing(turn_app, user, auth, agent_db, monkeypatch):
    """TC-F14-48 With every slot running and every waiting place taken, the next request gets 503 AGENT_BUSY immediately with no row; the ones inside are all answered once the slow tool is released"""
    assert TurnQueue().limit == 24  # 8 running and 16 waiting, the numbers of docs/02 §2.11.4; the test below scales them down
    app = turn_app(queue=TurnQueue(running=2, waiting=2))
    client = TestClient(app)
    gate, original = threading.Event(), get_period_summary.summarize
    monkeypatch.setattr(get_period_summary, 'summarize', lambda ctx, args: (gate.wait(10), original(ctx, args))[1])
    answers = []
    threads = [threading.Thread(target=lambda n=n: answers.append(client.post('/v1/turn', json=turn_body(user, requestId=f'in-{n}'), headers=auth)))
               for n in range(4)]
    for thread in threads:
        thread.start()
    deadline = time.monotonic() + 10
    while app.state.queue.inside < 4 and time.monotonic() < deadline:
        time.sleep(0.01)
    assert app.state.queue.inside == 4
    started = time.monotonic()
    busy = client.post('/v1/turn', json=turn_body(user, requestId='one-too-many'), headers=auth)
    assert (busy.status_code, busy.json()['error']['code']) == (503, 'AGENT_BUSY') and time.monotonic() - started < 1
    assert agent_db['agentTurns'].count_documents({'requestId': 'one-too-many'}) == 0
    gate.set()
    for thread in threads:
        thread.join(10)
    assert sorted(response.status_code for response in answers) == [200] * 4
    assert app.state.queue.inside == 0
    assert client.post('/v1/turn', json=turn_body(user, requestId='after'), headers=auth).status_code == 200  # the queue is free again


# ---- the routing functions of the graph: pure functions of the state, one table each (docs/04 §4.11) ----

DONE, DECLINED = {'status': 'done', 'summary': 's'}, {'status': 'cancelled'}


@pytest.mark.parametrize('state,expected', [
    ({'blocked': 'capped', 'trigger': 'chat'}, 'generate_answer'),
    ({'blocked': 'too_long', 'trigger': 'chat'}, 'generate_answer'),
    ({'blocked': 'empty', 'trigger': 'chat'}, 'generate_answer'),
    ({'blocked': None, 'trigger': 'chat'}, 'rewrite_question'),
    ({'blocked': None, 'trigger': 'schedule'}, 'decide'),
    ({'blocked': None, 'trigger': 'event'}, 'decide'),
    ({'blocked': None, 'trigger': 'confirm', 'pendingAction': DONE}, 'act'),
    ({'blocked': None, 'trigger': 'confirm', 'pendingAction': DECLINED}, 'generate_answer'),
    ({'blocked': None, 'trigger': 'confirm', 'pendingAction': None}, 'generate_answer'),
])
def test_route_after_context(state, expected):
    """TC-F14-49 A blocked turn goes to the answer, chat to rewrite_question, schedule and event to decide, a confirm on a done action to act and on any other to the answer"""
    assert graph.route_after_context(state) == expected


@pytest.mark.parametrize('function,state,expected', [
    (graph.route_after_recall, {'skill': 'thu_chi_ky'}, 'decide'),  # a command names its skill: find_skills is skipped
    (graph.route_after_recall, {'skill': None}, 'find_skills'),
    (graph.route_after_search, {'retrieval': 'direct'}, 'decide'),
    (graph.route_after_search, {'retrieval': 'choose'}, 'decide'),
    (graph.route_after_search, {'retrieval': 'none'}, 'generate_answer'),
    (graph.route_after_decide, {'plan': [{'tool': 'get_period_summary'}]}, 'act'),
    (graph.route_after_decide, {'plan': []}, 'generate_answer'),
])
def test_the_other_routes(function, state, expected):
    """TC-F14-49 After the memory a skill given skips the search; after the search anything found goes to decide and nothing to the answer; decide goes to act only with a tool to run"""
    assert function(state) == expected

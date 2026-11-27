# What the service does when it starts and when it reads memory (docs/02 §2.11.4 "Embedding space", docs/03 §3.7, docs/07
# §7.9.2 *re-embedding*): the skill files and the tool registry go to `agentSkills` and `agentTools` with their embeddings,
# a row is embedded again only when the SHA-256 of its text changed, and `recall_memory` reads the user's own memory rows.
import hashlib
import logging
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from agent.app import create_app
from agent.config import Settings
from agent.embedder import DIMENSIONS, FakeEmbedder
from agent.graph import new_state
from agent.schemas import TurnRequest
from agent.skills import load_skills
from agent.tools import default_registry
from conftest import SECRET
from turn_helpers import NOW, make_user, turn_body

SKILLS = load_skills(default_registry())


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def embedded_text(skill):
    """What docs/02 says a skill's embedding is made of, written out here and not taken from sync.py."""
    return '\n'.join([skill.label_vi, skill.label_en, skill.description, *skill.examples, *skill.triggers])


# ---- the sync ----

def test_the_start_copies_skills_and_tools_to_mongodb_with_their_embeddings(turn_app, agent_db):
    """TC-F14-62 When the service starts, each skill file is a system row (userId null) in agentSkills and each tool a row in agentTools, each with a 1024-number embedding and the SHA-256 of its text"""
    app = turn_app()
    fake = FakeEmbedder()
    rows = {row['code']: row for row in agent_db['agentSkills'].find()}
    assert sorted(rows) == sorted(SKILLS) == ['chi_theo_danh_muc', 'ngan_sach_con_lai', 'so_du_vi', 'so_sanh_ky', 'thu_chi_ky', 'tong_ket_thang', 'tong_ket_tuan', 'top_khoan_chi']
    for code, skill in SKILLS.items():
        row = rows[code]
        assert row['userId'] is None and (row['mode'], row['enabled'], row['version'], row['maxSteps']) == ('pipeline', True, 1, 4)
        assert (row['labelVi'], row['labelEn'], row['description'], row['examples'], row['triggers']) == (skill.label_vi, skill.label_en, skill.description, skill.examples, skill.triggers)
        assert [t['name'] for t in row['tools']] == [t.name for t in skill.tools] and row['followups'] == skill.followups
        assert len(row['embedding']) == DIMENSIONS and row['embedHash'] == sha(embedded_text(skill))
        assert row['embedding'] == fake.encode([embedded_text(skill)])[0]
        assert app.state.deps.vectors[code] == row['embedding']  # what find_skills searches, in memory
    tools = {row['name']: row for row in agent_db['agentTools'].find()}
    assert sorted(tools) == ['compare_periods', 'get_budget_pace', 'get_budgets', 'get_category_totals', 'get_period_summary', 'get_wallet_balances', 'list_transactions', 'suggest_budgets']
    for name, row in tools.items():
        assert row['sideEffect'] == 'read' and row['timeoutMs'] == 5000 and row['enabled'] is True and row['description']
        assert row['embedHash'] == sha(f"{name}: {row['description']}") and len(row['embedding']) == DIMENSIONS
        assert not {'userId', 'token', 'query'} & set(row['parameters']['properties'])  # what the model may see
    assert tools['get_category_totals']['collections'] == ['transactions', 'categories'] and 'start' in tools['get_period_summary']['parameters']['properties']


def test_a_second_start_embeds_nothing_and_a_changed_row_alone_is_embedded_again(turn_app, agent_db):
    """TC-F14-62 Starting twice with the same files embeds nothing the second time; after one skill's examples change, only that skill is embedded (one text), its hash and vector change and no other row is rewritten with a new embedding"""
    app = turn_app()
    embedder = app.state.embedder
    assert [len(call) for call in embedder.calls] == [8, 8]  # the first start: the eight skills in one call, the eight tools in another
    before = {row['code']: row for row in agent_db['agentSkills'].find()}
    assert app.state.sync() == {'skills': 0, 'tools': 0} and len(embedder.calls) == 2
    assert agent_db['agentSkills'].count_documents({}) == 8 == agent_db['agentSkills'].count_documents({'userId': None})  # an upsert, not an insert
    assert agent_db['agentTools'].count_documents({}) == 8

    changed = {**SKILLS, 'so_du_vi': replace(SKILLS['so_du_vi'], examples=['ví nào còn nhiều tiền nhất?'])}
    second = turn_app(skills=changed, embedder=FakeEmbedder())
    assert second.state.embedder.calls == [[embedded_text(changed['so_du_vi'])]]  # one text; the tools did not change
    after = {row['code']: row for row in agent_db['agentSkills'].find()}
    assert after['so_du_vi']['embedHash'] != before['so_du_vi']['embedHash'] and after['so_du_vi']['embedding'] != before['so_du_vi']['embedding']
    assert after['so_du_vi']['examples'] == ['ví nào còn nhiều tiền nhất?']
    for code in ('thu_chi_ky', 'chi_theo_danh_muc'):
        assert after[code]['embedding'] == before[code]['embedding'] and after[code]['embedHash'] == before[code]['embedHash']
    assert second.state.deps.vectors['so_du_vi'] == after['so_du_vi']['embedding']


def test_a_field_that_is_not_embedded_is_updated_without_embedding(turn_app, agent_db):
    """TC-F14-62 Changing a skill's follow-ups or its enabled flag rewrites the row but embeds nothing: the embedded text is names, description, examples and triggers only"""
    turn_app()
    changed = {**SKILLS, 'thu_chi_ky': replace(SKILLS['thu_chi_ky'], enabled=False, version=2, max_steps=3)}
    second = turn_app(skills=changed, embedder=FakeEmbedder())
    assert second.state.embedder.calls == []
    row = agent_db['agentSkills'].find_one({'code': 'thu_chi_ky'})
    assert (row['enabled'], row['version'], row['maxSteps']) == (False, 2, 3)


def test_a_skill_taken_out_of_the_files_stays_in_the_collection_switched_off(turn_app, agent_db):
    """TC-F14-62 A row whose file is gone is not deleted (the agent role may, the docs say never) but is switched off, and is not in memory for find_skills"""
    turn_app()
    fewer = {code: skill for code, skill in SKILLS.items() if code != 'so_du_vi'}
    second = turn_app(skills=fewer, embedder=FakeEmbedder())
    assert agent_db['agentSkills'].find_one({'code': 'so_du_vi'})['enabled'] is False
    assert agent_db['agentSkills'].find_one({'code': 'thu_chi_ky'})['enabled'] is True
    assert sorted(second.state.deps.vectors) == sorted(code for code in SKILLS if code != 'so_du_vi') and second.state.embedder.calls == []


def test_the_service_runs_the_sync_when_it_starts_and_stops_if_it_cannot(mongo, world, agent_db):
    """TC-F14-62 The start of the service (the lifespan) runs the sync before anything is served; an embedder that fails stops the start instead of leaving skills without vectors"""
    settings = Settings(agent_secret=SECRET, mongodb_uri_agent=mongo.agent_uri)
    app = create_app(settings, FakeEmbedder(), now=lambda: NOW)
    assert agent_db['agentSkills'].count_documents({}) == 0 and app.state.deps.vectors == {}  # creating the app does not touch the database
    with TestClient(app) as client:
        assert agent_db['agentSkills'].count_documents({}) == len(SKILLS) and sorted(app.state.deps.vectors) == sorted(SKILLS)
        assert client.get('/health').status_code == 200

    class Broken(FakeEmbedder):
        def encode(self, texts):
            raise RuntimeError('no GPU')

    world['agentSkills'].delete_many({})  # rows that are up to date need no embedding: start from nothing
    failing = create_app(settings, Broken(), now=lambda: NOW)
    with pytest.raises(RuntimeError), TestClient(failing):
        pass
    for made in (app, failing):
        made.state.mongo.close()


def test_the_sync_writes_one_log_line_in_the_log_shape(turn_app, caplog):
    """TC-F14-62 The start writes `request=start node=sync ms=…` and nothing else: no skill text, no vector"""
    caplog.set_level(logging.INFO)
    turn_app()
    lines = [r.getMessage() for r in caplog.records if r.name == 'uvicorn.error']
    assert len(lines) == 1 and lines[0].startswith('request=start node=sync ms=') and all(len(line) < 60 for line in lines)


# ---- recall_memory ----

def memory(db, user, text, vector, **fields):
    return db['agentMemory'].insert_one({'userId': user, 'text': text, 'kind': 'alias', 'source': 'a7_tap', 'embedding': vector, 'embedHash': sha(text),
                                         'createdAt': NOW, 'lastUsedAt': None, **fields}).inserted_id


def run(app, user, **fields):
    return app.state.graph.invoke(new_state(TurnRequest(**turn_body(user, **fields)), 'turn-memory', app.state.deps))


def test_recall_memory_reads_this_users_rows_at_a_cosine_of_point_six_or_more(turn_app, world, agent_db):
    """TC-F14-63 The question is embedded once; this user's memory rows at cosine >= 0.6 come back best first and get lastUsedAt; a far row, another user's row and a row with no vector do not"""
    user, other = make_user(world), make_user(world, email='b@example.com')
    fake = FakeEmbedder()
    question = 'cafe hôm nay'
    near = fake.encode([question])[0]
    just_over = [0.6 * a + 0.8 * b for a, b in zip(near, fake.encode(['another text'])[0])]  # cosine with `near` is 0.6 (the two are about orthogonal)
    far = fake.encode(['một câu khác hẳn'])[0]
    best = memory(world, user, 'cafe → Ăn uống', near)
    second = memory(world, user, 'ví chính là MoMo', just_over)
    memory(world, user, 'xăng → Đi lại', far)
    memory(world, user, 'no vector yet', None)
    memory(world, other, 'cafe → Giải trí', near)  # the same vector, someone else's
    app = turn_app()
    state = run(app, user, text=question)
    assert [m['text'] for m in state['memories']] == ['cafe → Ăn uống', 'ví chính là MoMo'] and state['memories'][0]['score'] == 1.0
    assert 0.55 < state['memories'][1]['score'] < 0.65
    assert app.state.embedder.calls[-1] == [question] and sum(call == [question] for call in app.state.embedder.calls) == 1  # once
    used = {row['text']: row['lastUsedAt'] for row in agent_db['agentMemory'].find({'userId': user})}
    assert used['cafe → Ăn uống'] == NOW and used['ví chính là MoMo'] == NOW and used['xăng → Đi lại'] is None
    assert agent_db['agentMemory'].find_one({'userId': other})['lastUsedAt'] is None  # never read for this user
    assert state['queryVector'] == near  # kept for find_skills: it is not embedded a second time


def test_a_command_an_ask_back_reply_and_a_question_with_no_memory_embed_as_they_should(turn_app, world):
    """TC-F14-63 A turn that names its skill embeds nothing; a user with no memory still gets the question embedded once for the search; an embedder that fails leaves the rules to answer by words"""
    user = make_user(world)
    app = turn_app()
    sync_calls = len(app.state.embedder.calls)
    assert run(app, user, skill='thu_chi_ky', text='')['queryVector'] is None and len(app.state.embedder.calls) == sync_calls
    state = run(app, user, text='tiêu bao nhiêu')
    assert state['memories'] == [] and len(app.state.embedder.calls) == sync_calls + 1 and state['retrieval'] == 'direct'

    class Broken(FakeEmbedder):
        broken = False

        def encode(self, texts):
            if self.broken:
                raise RuntimeError('the GPU is gone: ' + texts[0])
            return super().encode(texts)

    embedder = Broken()
    working = turn_app(embedder=embedder)
    embedder.broken = True
    state = run(working, user, text='tiêu bao nhiêu')
    assert state['queryVector'] is None and state['memories'] == []
    assert (state['retrieval'], state['skillCode']) == ('direct', 'thu_chi_ky')  # words alone are enough for a trigger
    assert run(working, user, text='xin chào bạn')['retrieval'] == 'none'

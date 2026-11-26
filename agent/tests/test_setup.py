# python -m agent.setup (docs/06 §6.13, D14 and D15): collections, indexes and the usersForAgent view, made with the
# app user because the agent's own role cannot create them. The mongod fixture is in conftest.py.
import subprocess
import sys
from pathlib import Path

import pytest

from agent.setup import USERS_VIEW, main

ROOT = Path(__file__).resolve().parents[2]
DAY = 24 * 60 * 60
# What docs/03 §3.7 says, written out here and not read back from the code under test.
# (keys, unique, expireAfterSeconds)
EXPECTED = {
    'agentSkills': {(('code', 1), ('userId', 1), True, None)},
    'agentTools': {(('name', 1), True, None)},
    'agentTurns': {(('userId', 1), ('requestId', 1), True, None), (('userId', 1), ('createdAt', -1), False, None),
                   (('createdAt', 1), False, 30 * DAY)},
    'agentMemory': {(('userId', 1), ('text', 1), True, None)},
    'agentCategoryVectors': {(('userId', 1), ('categoryId', 1), True, None)},
    'receiptReads': {(('userId', 1), ('createdAt', -1), False, None), (('createdAt', 1), False, 90 * DAY)},
    'pendingActions': {(('expiresAt', 1), False, 600)},
}


def indexes(db, collection):
    """The indexes of a collection except _id, as (keys..., unique, ttl) so the test reads like the spec."""
    return {(*[tuple(k) for k in info['key']], info.get('unique', False), info.get('expireAfterSeconds'))
            for name, info in db[collection].index_information().items() if name != '_id_'}


def test_setup_creates_collections_indexes_and_the_view(mongo, db):
    """TC-F14-10 agent.setup creates the agent collections, pendingActions, their unique and TTL indexes and the usersForAgent view"""
    assert main([], {'MONGODB_URI': mongo.app_uri}) == 0
    assert set(EXPECTED) <= set(db.list_collection_names())
    for collection, expected in EXPECTED.items():
        assert indexes(db, collection) == expected, collection
    [view] = db.list_collections(filter={'name': USERS_VIEW})
    assert view['type'] == 'view'
    assert view['options'] == {'viewOn': 'users', 'pipeline': [{'$project': {'_id': 1, 'language': 1, 'assistantOn': 1}}]}


def test_setup_runs_again_without_change_and_heals_a_wider_view(mongo, db):
    """TC-F14-11 A second setup run succeeds and changes nothing, and puts back a usersForAgent view that shows too much"""
    assert main([], {'MONGODB_URI': mongo.app_uri}) == 0
    db['agentTurns'].insert_one({'userId': 1, 'requestId': 'r1', 'createdAt': 1})
    before = {c: db[c].index_information() for c in EXPECTED}
    assert main([], {'MONGODB_URI': mongo.app_uri}) == 0
    assert {c: db[c].index_information() for c in EXPECTED} == before
    assert db['agentTurns'].count_documents({}) == 1  # the data is untouched

    # A later card, or someone by hand, left a view that shows the password hash: the next run rewrites it.
    db.drop_collection(USERS_VIEW)
    db.create_collection(USERS_VIEW, viewOn='users', pipeline=[{'$project': {'email': 1, 'passwordHash': 1}}])
    assert main([], {'MONGODB_URI': mongo.app_uri}) == 0
    [view] = db.list_collections(filter={'name': USERS_VIEW})
    assert view['options']['pipeline'] == [{'$project': {'_id': 1, 'language': 1, 'assistantOn': 1}}]

    # Not a view: a plain collection of that name stops setup instead of being dropped.
    db.drop_collection(USERS_VIEW)
    db.create_collection(USERS_VIEW)
    with pytest.raises(SystemExit, match='not a view'):
        main([], {'MONGODB_URI': mongo.app_uri})


def test_setup_command_line(mongo, db, capsys):
    """TC-F14-12 agent.setup answers --help and a bad option with the usage, and a missing or wrong user with one line"""
    with pytest.raises(SystemExit) as exit_:
        main(['--help'])
    assert exit_.value.code == 0 and 'usage: python -m agent.setup' in capsys.readouterr().out
    with pytest.raises(SystemExit) as exit_:
        main(['--bogus'])
    assert exit_.value.code == 2 and 'usage: python -m agent.setup' in capsys.readouterr().err
    done = subprocess.run([sys.executable, '-m', 'agent.setup', '--help'], cwd=ROOT, capture_output=True, text=True)
    assert done.returncode == 0 and done.stdout.startswith('usage: python -m agent.setup') and 'Traceback' not in done.stderr

    assert main([], {}) == 1
    assert 'MONGODB_URI is not set' in capsys.readouterr().err
    assert main([], {'MONGODB_URI': 'mongodb://127.0.0.1:1'}) == 1  # no database name
    assert 'database name' in capsys.readouterr().err
    # The agent's own user cannot create anything: setup says to use the app user and does not print its password.
    assert main([], {'MONGODB_URI': mongo.agent_uri}) == 1
    message = capsys.readouterr().err
    assert 'needs the app user' in message and mongo.agent_uri.split(':')[2].split('@')[0] not in message
    assert 'agentTurns' not in db.list_collection_names()

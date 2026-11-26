# The MongoDB role of the agent (docs/03 §3.7, docs/06 §6.13; role.json is the one definition) on a mongod with auth.
# `db` is the database as the app user, Express's user, sees it; `agent_db` as sochitieu_agent sees it.
from datetime import datetime

import pytest
from bson import ObjectId
from pymongo.errors import DuplicateKeyError, OperationFailure

from agent.setup import USERS_VIEW, main

APP_DATA = ['categories', 'wallets', 'transactions', 'budgets']
OWN = ['agentSkills', 'agentTools', 'agentTurns', 'agentMemory', 'agentCategoryVectors', 'receiptReads']
# Express's collections that the agent has no right on at all, `users` first (it holds the password hashes).
HIDDEN = ['users', 'sessions', 'chatLinks', 'linkCodes', 'emailCodes', 'notices', 'channelUsage', 'appSettings']
USER = {'_id': ObjectId(), 'email': 'an@example.com', 'passwordHash': '$2b$10$abcdefghijklmnopqrstuv', 'name': 'An',
        'role': 'admin', 'status': 'active', 'language': 'vi', 'theme': 'dark', 'assistantOn': True,
        'defaultWalletId': ObjectId(), 'sessionsRevokedAt': datetime(2026, 11, 25), 'createdAt': datetime(2026, 11, 1)}


@pytest.fixture
def ready(mongo, db):
    """The database as setup leaves it, with a user and one row in every collection of the app."""
    assert main([], {'MONGODB_URI': mongo.app_uri}) == 0
    db['users'].insert_one(USER)
    for name in APP_DATA + HIDDEN[1:]:
        db[name].insert_one({'_id': 'row', 'userId': USER['_id'], 'name': 'secret row'})


def refused(action):
    with pytest.raises(OperationFailure) as error:
        action()
    assert error.value.code == 13  # Unauthorized


@pytest.mark.parametrize('name', APP_DATA)
def test_agent_reads_app_data_but_cannot_change_it(ready, db, agent_db, name):
    """TC-F14-10 sochitieu_agent can find in categories, wallets, transactions and budgets, and every insert, update, delete, index or drop is refused"""
    assert agent_db[name].find_one({'_id': 'row'})['name'] == 'secret row'
    assert agent_db[name].count_documents({}) == 1
    assert list(agent_db[name].aggregate([{'$match': {'userId': USER['_id']}}]))  # the tools aggregate
    refused(lambda: agent_db[name].insert_one({'userId': USER['_id'], 'amount': 10**12}))
    refused(lambda: agent_db[name].update_one({'_id': 'row'}, {'$set': {'name': 'changed'}}))
    refused(lambda: agent_db[name].delete_one({'_id': 'row'}))
    refused(lambda: agent_db[name].create_index('name'))  # D14: no index right either
    refused(lambda: agent_db.drop_collection(name))
    refused(lambda: list(agent_db[name].aggregate([{'$out': name}])))
    refused(lambda: list(agent_db['wallets' if name != 'wallets' else 'budgets'].aggregate([{'$merge': {'into': name}}])))
    assert db[name].find_one({'_id': 'row'})['name'] == 'secret row'


@pytest.mark.parametrize('name', OWN + ['pendingActions'])
def test_agent_writes_only_its_own_collections(ready, db, agent_db, name):
    """TC-F14-10 sochitieu_agent can insert, find and update in agent* collections and pendingActions, but cannot create an index or drop one"""
    row = {'userId': USER['_id'], 'requestId': 'r1', 'createdAt': datetime.now(), 'expiresAt': datetime.now(), 'name': 'x'}
    agent_db[name].insert_one(row | {'_id': 'mine'})
    agent_db[name].update_one({'_id': 'mine'}, {'$set': {'name': 'y'}})
    assert agent_db[name].find_one({'_id': 'mine'})['name'] == 'y'
    if name == 'pendingActions':
        refused(lambda: agent_db[name].delete_one({'_id': 'mine'}))  # the TTL index removes them, the agent never does
    else:
        assert agent_db[name].delete_one({'_id': 'mine'}).deleted_count == 1
    refused(lambda: agent_db[name].create_index('name'))
    refused(lambda: agent_db[name].drop_indexes())
    refused(lambda: agent_db.drop_collection(name))
    refused(lambda: agent_db.create_collection('somethingElse'))
    # The unique index setup made still guards it: a redelivered request is one turn (docs/03 §3.7 agentTurns).
    if name == 'agentTurns':
        agent_db[name].insert_one({'userId': USER['_id'], 'requestId': 'dup'})
        with pytest.raises(DuplicateKeyError):
            agent_db[name].insert_one({'userId': USER['_id'], 'requestId': 'dup'})


@pytest.mark.parametrize('name', HIDDEN)
def test_agent_cannot_touch_users_sessions_or_any_other_express_collection(ready, agent_db, name):
    """TC-F14-11 find on users, sessions, chatLinks, linkCodes, emailCodes, notices, channelUsage and appSettings is unauthorized"""
    refused(lambda: agent_db[name].find_one())
    refused(lambda: agent_db[name].count_documents({}))
    refused(lambda: list(agent_db[name].aggregate([{'$match': {}}])))
    refused(lambda: agent_db[name].insert_one({'x': 1}))
    refused(lambda: agent_db[name].update_one({}, {'$set': {'x': 1}}))
    refused(lambda: agent_db[name].delete_one({}))


def test_no_way_round_the_view_to_the_users_collection(ready, agent_db):
    """TC-F14-11 A $lookup or a $unionWith into users, from an allowed collection or from the view, is unauthorized too"""
    into_users = [{'$lookup': {'from': 'users', 'localField': 'userId', 'foreignField': '_id', 'as': 'u'}}]
    union_users = [{'$unionWith': 'users'}]
    for source in ('transactions', 'categories', USERS_VIEW, 'agentTurns'):
        refused(lambda: list(agent_db[source].aggregate(into_users)))
        refused(lambda: list(agent_db[source].aggregate(union_users)))
    # and the same two moves into another collection the role does not list
    refused(lambda: list(agent_db['transactions'].aggregate([{'$lookup': {'from': 'sessions', 'pipeline': [], 'as': 's'}}])))


def test_users_for_agent_shows_only_id_language_and_assistant_switch(ready, db, agent_db):
    """TC-F14-12 For a user with an e-mail and a password hash, usersForAgent returns only _id, language and assistantOn"""
    db['users'].insert_one({'_id': 'plain', 'email': 'b@example.com', 'passwordHash': 'x', 'language': 'en'})
    seen = {row['_id']: row for row in agent_db[USERS_VIEW].find()}
    assert seen[USER['_id']] == {'_id': USER['_id'], 'language': 'vi', 'assistantOn': True}
    assert seen['plain'] == {'_id': 'plain', 'language': 'en'}  # a field the user does not have is simply absent
    assert agent_db[USERS_VIEW].find_one({'_id': USER['_id']}) == seen[USER['_id']]
    assert list(agent_db[USERS_VIEW].aggregate([{'$match': {'language': 'vi'}}, {'$project': {'email': 1}}])) == [
        {'_id': USER['_id']}]  # a filter or projection can only narrow it: email is not in the view
    refused(lambda: agent_db[USERS_VIEW].insert_one({'language': 'vi'}))  # and the view is read-only
    refused(lambda: agent_db[USERS_VIEW].update_one({}, {'$set': {'language': 'en'}}))

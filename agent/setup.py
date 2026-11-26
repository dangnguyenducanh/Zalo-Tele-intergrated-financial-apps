# python -m agent.setup: creates what the agent service needs in MongoDB (docs/06 §6.13, decisions D14 and D15).
#
# Run it with the APP user's MONGODB_URI, not the agent's: the agent's role (role.json) can find, insert, update and
# remove, but cannot create a collection, an index or a view, and the service creates none when it starts. So run it
# once at go-live and again after any card that changes an agent index or the usersForAgent view. Running it twice
# is safe: what exists and matches is left alone, a view with another definition is dropped and made again.
import argparse
import os
import sys

from pymongo import IndexModel, MongoClient
from pymongo.errors import ConfigurationError, OperationFailure, PyMongoError

DAY = 24 * 60 * 60

# The indexes of docs/03 §3.7. A TTL index must be on one field, so each TTL has its own entry.
INDEXES = {
    'agentSkills': [IndexModel([('code', 1), ('userId', 1)], unique=True)],
    'agentTools': [IndexModel([('name', 1)], unique=True)],
    'agentTurns': [
        IndexModel([('userId', 1), ('requestId', 1)], unique=True),
        IndexModel([('userId', 1), ('createdAt', -1)]),
        IndexModel([('createdAt', 1)], expireAfterSeconds=30 * DAY),
    ],
    'agentMemory': [IndexModel([('userId', 1), ('text', 1)], unique=True)],
    'agentCategoryVectors': [IndexModel([('userId', 1), ('categoryId', 1)], unique=True)],
    'receiptReads': [
        IndexModel([('userId', 1), ('createdAt', -1)]),
        IndexModel([('createdAt', 1)], expireAfterSeconds=90 * DAY),
    ],
    'pendingActions': [IndexModel([('expiresAt', 1)], expireAfterSeconds=10 * 60)],
}

# D15: the agent never reads password hashes. A role cannot limit the fields of a collection, so it gets no right on
# `users` at all and reads this view, which keeps `_id` and two fields.
USERS_VIEW = 'usersForAgent'
USERS_VIEW_PIPELINE = [{'$project': {'_id': 1, 'language': 1, 'assistantOn': 1}}]


def setup(db):
    for collection, indexes in INDEXES.items():
        db[collection].create_indexes(indexes)  # creates the collection too; the same index again changes nothing
    wanted = {'viewOn': 'users', 'pipeline': USERS_VIEW_PIPELINE}
    existing = next(iter(db.list_collections(filter={'name': USERS_VIEW})), None)
    if existing is None:
        db.create_collection(USERS_VIEW, **wanted)
    elif existing.get('type') != 'view':
        raise SystemExit(f'{USERS_VIEW} exists but is a collection, not a view: rename or drop it first')
    elif existing['options'] != wanted:  # drop and create: the app user's readWrite role has no collMod
        db.drop_collection(USERS_VIEW)
        db.create_collection(USERS_VIEW, **wanted)


def main(argv=None, env=os.environ):
    parser = argparse.ArgumentParser(
        prog='python -m agent.setup',
        description='Create the agent collections, their indexes and the usersForAgent view. Needs MONGODB_URI '
        '(the app user, as in server/.env) in the environment; MONGODB_DB overrides the database name in it.',
    )
    parser.parse_args(argv)
    uri = env.get('MONGODB_URI')
    if not uri:
        print('MONGODB_URI is not set: run this with the app user\'s connection string', file=sys.stderr)
        return 1
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=5000)
        db = client[env['MONGODB_DB']] if env.get('MONGODB_DB') else client.get_default_database()
        setup(db)
    except ConfigurationError:  # not echoed: the URI holds the password
        print('MONGODB_URI must be a MongoDB connection string with a database name (or set MONGODB_DB)', file=sys.stderr)
        return 1
    except PyMongoError as exc:
        detail = exc.details.get('errmsg') if isinstance(exc, OperationFailure) and exc.details else None
        hint = ' (setup needs the app user, readWrite on the database, not sochitieu_agent)' if getattr(exc, 'code', None) == 13 else ''
        print(f'setup failed: {type(exc).__name__}: {detail or exc}{hint}', file=sys.stderr)
        return 1
    print(f'{db.name}: {len(INDEXES)} agent collections with their indexes, view {USERS_VIEW}')
    return 0


if __name__ == '__main__':
    sys.exit(main())

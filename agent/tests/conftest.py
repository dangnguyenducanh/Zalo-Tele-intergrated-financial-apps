# Shared test setup for the agent service (docs/07 §7.9): hermetic by default, one throw-away mongod with auth,
# and the hook that lets tools/test-report match a test to its case ID.
import ipaddress
import json
import os
import secrets
import shutil
import socket
import subprocess
import time
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlunsplit

import pytest
from pymongo import MongoClient

from agent.app import create_app
from agent.config import Settings
from agent.embedder import FakeEmbedder

ROOT = Path(__file__).resolve().parents[2]
SECRET = 'test-agent-secret-' + 'a' * 32
DB = 'finance_agent_test'


def mongo_uri(user, password, host, database=''):
    # Built, not written out: the repo's secret scan (TC-NF-05) rejects a connection string with a password in any file.
    return urlunsplit(('mongodb', f'{user}:{password}@{host}', f'/{database}', 'authSource=admin', ''))


def pytest_itemcollected(item):
    """JUnit test names must start with the case ID (tools/test-report matches on it, docs/07), and a Python function
    name cannot hold "TC-F14-04". So a test whose docstring starts with a case ID is reported under that line."""
    first = (getattr(item, 'obj', None).__doc__ or '').strip().split('\n')[0]
    if first.startswith('TC-'):
        callspec = getattr(item, 'callspec', None)
        item._nodeid = f'{item.parent.nodeid}::{first.replace("::", ":")}' + (f' [{callspec.id}]' if callspec else '')


def is_local(host):
    try:
        return host == 'localhost' or ipaddress.ip_address(host).is_loopback
    except ValueError:  # a name other than localhost
        return False


@pytest.fixture(autouse=True)
def hermetic(monkeypatch):
    """No weights downloaded, no vLLM, no other machine (docs/07 §7.9.8, BUG-002): a test that tries fails."""
    monkeypatch.setenv('HF_HUB_OFFLINE', '1')
    monkeypatch.delenv('VLLM_BASE_URL', raising=False)
    connect, getaddrinfo = socket.socket.connect, socket.getaddrinfo

    def local_connect(self, address):
        if isinstance(address, tuple) and not is_local(address[0]):  # a str is a unix socket path
            raise OSError(f'tests may not reach {address[0]}')
        return connect(self, address)

    def local_getaddrinfo(host, *args, **kwargs):
        if host not in (None, '') and not is_local(host):
            raise socket.gaierror(f'tests may not look up {host}')
        return getaddrinfo(host, *args, **kwargs)

    monkeypatch.setattr(socket.socket, 'connect', local_connect)
    monkeypatch.setattr(socket, 'getaddrinfo', local_getaddrinfo)


@pytest.fixture
def settings():
    return Settings(agent_secret=SECRET, mongodb_uri_agent=mongo_uri('agent', 'PASTE_pw', '127.0.0.1:1', 'finance'))


@pytest.fixture
def auth(settings):
    return {'Authorization': f'Bearer {settings.agent_secret}'}


@pytest.fixture
def make_app(settings):
    """create_app with the fake embedder; returns the app so a test can add a route of its own to it."""
    return lambda: create_app(settings, FakeEmbedder())


# ---- a real mongod with authentication, the binary mongodb-memory-server already downloaded ----

def mongod_binary():
    if os.environ.get('MONGOD_BINARY'):
        return os.environ['MONGOD_BINARY']
    # Ask mongodb-memory-server itself, so the cache folder (home, node_modules or MONGOMS_DOWNLOAD_DIR) is its call.
    # In CI `npm test` has just downloaded it; on a fresh machine this downloads it once.
    node = shutil.which('node')
    if node:
        done = subprocess.run(
            [node, '--input-type=module', '-e',
             "import { MongoBinary } from 'mongodb-memory-server'; console.log(await MongoBinary.getPath())"],
            cwd=ROOT, capture_output=True, text=True, timeout=300)
        path = done.stdout.strip().splitlines()[-1] if done.returncode == 0 and done.stdout.strip() else ''
        if path and Path(path).is_file():
            return path
    return shutil.which('mongod') or pytest.fail(
        'No mongod found. Run `npm ci` (it brings mongodb-memory-server), or set MONGOD_BINARY.')


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


@pytest.fixture(scope='session')
def mongo(tmp_path_factory):
    """mongod --auth on a free port, with the users of docs/06 §6.2 and §6.13: a root user to manage it, the app user
    (readWrite on the database, as Express has it) and sochitieu_agent with the role defined in agent/role.json."""
    folder = tmp_path_factory.mktemp('mongod')
    port = free_port()
    log = (folder / 'mongod.log').open('w')
    proc = subprocess.Popen(
        [mongod_binary(), '--auth', '--dbpath', str(folder), '--port', str(port), '--bind_ip', '127.0.0.1',
         '--nounixsocket', '--wiredTigerCacheSizeGB', '0.25'], stdout=log, stderr=log)
    try:
        host = f'127.0.0.1:{port}'
        first = MongoClient(host, serverSelectionTimeoutMS=500)
        for _ in range(100):
            try:
                first.admin.command('ping')
                break
            except Exception:
                if proc.poll() is not None:
                    pytest.fail(f'mongod exited: {(folder / "mongod.log").read_text()[-500:]}')
                time.sleep(0.2)
        passwords = {name: secrets.token_hex(8) for name in ('root', 'finance_app', 'sochitieu_agent')}
        first.admin.command('createUser', 'root', pwd=passwords['root'], roles=[{'role': 'root', 'db': 'admin'}])
        first.close()
        root = MongoClient(mongo_uri('root', passwords['root'], host))
        definition = json.loads((ROOT / 'agent' / 'role.json').read_text())
        root.admin.command(
            'createRole', definition['role'], roles=[],
            privileges=[{'resource': {'db': DB, 'collection': c}, 'actions': p['actions']}
                        for p in definition['privileges'] for c in p['collections']])
        root.admin.command('createUser', 'finance_app', pwd=passwords['finance_app'],
                           roles=[{'role': 'readWrite', 'db': DB}])
        root.admin.command('createUser', 'sochitieu_agent', pwd=passwords['sochitieu_agent'],
                           roles=[{'role': definition['role'], 'db': 'admin'}])

        def uri(user):
            return mongo_uri(user, passwords[user], host, DB)

        yield SimpleNamespace(root=root, app_uri=uri('finance_app'), agent_uri=uri('sochitieu_agent'), role=definition)
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        log.close()


@pytest.fixture
def db(mongo):
    """The test database, empty, as the app user sees it (Express's view of it)."""
    mongo.root.drop_database(DB)
    client = MongoClient(mongo.app_uri)
    yield client[DB]
    client.close()


@pytest.fixture
def agent_db(mongo):
    """The same database as sochitieu_agent sees it."""
    client = MongoClient(mongo.agent_uri)
    yield client[DB]
    client.close()

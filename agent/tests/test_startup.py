# The service must not run open or half-configured (docs/06 §6.13: "refuses to start without AGENT_SECRET or
# MONGODB_URI_AGENT"). These tests start the real uvicorn process, as the Dockerfile does.
import os
import socket
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SECRET = 'a-real-looking-secret-' + 'b' * 32
URI = 'mongodb://sochitieu_agent:hunter2-password@127.0.0.1:1/finance'


def start(env):
    """Run `uvicorn agent.app:create_app --factory` with exactly this environment; returns (exit code, output, port)."""
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
    done = subprocess.run(
        [sys.executable, '-m', 'uvicorn', 'agent.app:create_app', '--factory', '--port', str(port)],
        cwd=ROOT, env={'PATH': os.environ['PATH'], 'HF_HUB_OFFLINE': '1', **env}, capture_output=True, text=True, timeout=60)
    return done.returncode, done.stdout + done.stderr, port


@pytest.mark.parametrize('env,names', [
    ({}, ['AGENT_SECRET', 'MONGODB_URI_AGENT']),
    ({'MONGODB_URI_AGENT': URI}, ['AGENT_SECRET']),
    ({'AGENT_SECRET': SECRET}, ['MONGODB_URI_AGENT']),
    ({'AGENT_SECRET': '   ', 'MONGODB_URI_AGENT': URI}, ['AGENT_SECRET']),
    ({'AGENT_SECRET': SECRET, 'MONGODB_URI_AGENT': ''}, ['MONGODB_URI_AGENT']),
    ({'AGENT_SECRET': SECRET, 'MONGODB_URI_AGENT': 'hunter2-password is not a uri'}, ['MONGODB_URI_AGENT']),
])
def test_refuses_to_start_without_its_secret_or_database(env, names):
    """TC-F14-03 The service exits without AGENT_SECRET or MONGODB_URI_AGENT (or with a URI that is none), and listens on nothing"""
    code, output, port = start(env)
    assert code != 0
    assert 'ConfigError' in output and all(name in output for name in names)
    for value in ('hunter2-password', SECRET, 'sochitieu_agent'):
        assert value not in output  # the message names variables, never what they hold
    with socket.socket() as s:
        assert s.connect_ex(('127.0.0.1', port)) != 0


def test_refuses_to_start_while_a_model_is_not_pinned():
    """TC-F14-03 With both variables set the service still exits while models.lock holds a placeholder, never an unpinned model"""
    lock = (ROOT / 'agent' / 'models.lock').read_text()
    if 'PIN_AT_SETUP' not in lock:
        pytest.skip('models.lock is pinned: the service would load bge-m3 here')
    code, output, _ = start({'AGENT_SECRET': SECRET, 'MONGODB_URI_AGENT': URI})
    assert code != 0 and 'models.lock has no commit hash for BAAI/bge-m3' in output

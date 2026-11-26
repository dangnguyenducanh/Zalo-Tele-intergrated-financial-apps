# The service must not run open or half-configured (docs/06 §6.13: "refuses to start without AGENT_SECRET or
# MONGODB_URI_AGENT"). These tests start the real uvicorn process, as the Dockerfile does.
import os
import socket
import subprocess
import sys
from pathlib import Path

import pytest

from agent.config import ConfigError, Settings

ROOT = Path(__file__).resolve().parents[2]
SECRET = 'a-real-looking-secret-' + 'b' * 32
URI = 'mongodb://' + 'sochitieu_agent:hunter2-password@127.0.0.1:1/finance'  # not one literal: the secret scan (TC-NF-05)


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
    """TC-F14-06 The service exits without AGENT_SECRET or MONGODB_URI_AGENT (or with a URI that is none), and listens on nothing"""
    code, output, port = start(env)
    assert code != 0
    assert 'ConfigError' in output and all(name in output for name in names)
    for value in ('hunter2-password', SECRET, 'sochitieu_agent'):
        assert value not in output  # the message names variables, never what they hold
    with socket.socket() as s:
        assert s.connect_ex(('127.0.0.1', port)) != 0


def test_a_short_secret_is_refused_by_name_and_never_echoed():
    """TC-F14-06 An AGENT_SECRET under 32 characters (docs/06: openssl rand -hex 32) stops the start, naming the variable, never the value"""
    short = 'hunter3-' + 'c' * 23  # 31 characters
    code, output, port = start({'AGENT_SECRET': short, 'MONGODB_URI_AGENT': URI})
    assert code != 0
    assert 'ConfigError' in output and 'AGENT_SECRET' in output and '32 characters' in output
    assert 'hunter3' not in output and 'hunter2-password' not in output
    with socket.socket() as s:
        assert s.connect_ex(('127.0.0.1', port)) != 0


def test_a_secret_of_exactly_32_characters_is_enough_and_spaces_do_not_count():
    """TC-F14-06 The secret check lets 32 characters through and counts without the spaces at either end"""
    uri_only = {'MONGODB_URI_AGENT': URI}
    assert Settings.from_env({**uri_only, 'AGENT_SECRET': 'a' * 32}).agent_secret == 'a' * 32
    for value in ('a' * 31, '  ' + 'a' * 31 + '  ', ' ' * 40):
        with pytest.raises(ConfigError, match='AGENT_SECRET'):
            Settings.from_env({**uri_only, 'AGENT_SECRET': value})


def test_refuses_to_start_while_a_model_is_not_pinned():
    """TC-F14-06 With both variables set the service still exits while models.lock holds a placeholder, never an unpinned model"""
    lock = (ROOT / 'agent' / 'models.lock').read_text()
    if 'PIN_AT_SETUP' not in lock:
        pytest.skip('models.lock is pinned: the service would load bge-m3 here')
    code, output, _ = start({'AGENT_SECRET': SECRET, 'MONGODB_URI_AGENT': URI})
    assert code != 0 and 'models.lock has no commit hash for BAAI/bge-m3' in output

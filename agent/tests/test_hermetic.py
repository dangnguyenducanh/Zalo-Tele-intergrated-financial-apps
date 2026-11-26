# What lets CI run these tests with no GPU, no model and no network (docs/07 §7.9.8), and how a test reaches the report.
import os
import re
import socket
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def test_a_test_cannot_reach_another_host_or_download_weights():
    """TC-F14-14 With HF_HUB_OFFLINE=1 and no VLLM_BASE_URL, a test that connects or looks up another host fails"""
    assert os.environ['HF_HUB_OFFLINE'] == '1' and 'VLLM_BASE_URL' not in os.environ
    with socket.socket() as other, pytest.raises(OSError, match='may not reach 1.1.1.1'):
        other.connect(('1.1.1.1', 80))
    with pytest.raises(socket.gaierror, match='may not look up huggingface.co'):
        socket.create_connection(('huggingface.co', 443), timeout=1)
    with socket.socket() as server:  # this machine is fine: the test mongod and the TestClient need it
        server.bind(('127.0.0.1', 0))
        server.listen()
        socket.create_connection(server.getsockname(), timeout=1).close()


def test_junit_name_starts_with_the_case_id(tmp_path):
    """TC-F14-13 pytest's JUnit file names a test by the case ID in its docstring, which tools/test-report matches on"""
    report = tmp_path / 'junit.xml'
    done = subprocess.run(
        [sys.executable, '-m', 'pytest', 'agent/tests/junit_sample.py', '-c', 'agent/pytest.ini', f'--junitxml={report}'],
        cwd=ROOT, capture_output=True, text=True)
    assert done.returncode == 0, done.stdout
    names = re.findall(r'<testcase classname="[^"]*" name="([^"]*)"', report.read_text())
    assert names == [
        'TC-F14-90 A docstring that starts with a case ID names the JUnit test',
        'TC-F14-91 Each parameter keeps its case ID, and says which one it is [one]',
        'TC-F14-91 Each parameter keeps its case ID, and says which one it is [two]',
        'test_without_a_case_id',
    ]

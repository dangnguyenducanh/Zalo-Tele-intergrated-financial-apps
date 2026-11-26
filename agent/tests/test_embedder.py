# The embedder interface (docs/01 §1.9 "Embedding space"): a fake for tests and a bge-m3 loader that is pinned and lazy.
import math
import re
import subprocess
import sys
import types
from pathlib import Path

import pytest

from agent.embedder import DIMENSIONS, LOCK, BgeM3Embedder, FakeEmbedder, pinned_revision

HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'


def test_fake_embedder_gives_fixed_unit_vectors():
    """TC-F14-09 The fake embedder maps a text to the same 1024-number unit vector every time"""
    fake = FakeEmbedder()
    a, b = fake.encode(['cà phê', 'phở'])
    assert len(a) == DIMENSIONS == 1024 and math.isclose(sum(x * x for x in a), 1.0, rel_tol=1e-9)
    assert fake.encode(['cà phê'])[0] == a and a != b
    assert fake.calls == [['cà phê', 'phở'], ['cà phê']]  # a test can count the calls


def test_bge_loader_is_lazy_pinned_and_normalised(monkeypatch, tmp_path):
    """TC-F14-09 The bge-m3 loader imports sentence-transformers only when it loads, at the models.lock hash"""
    # Importing the module must not import the package: CI never installs it.
    script = 'import sys, agent.embedder; assert "sentence_transformers" not in sys.modules; assert "torch" not in sys.modules'
    assert subprocess.run([sys.executable, '-c', script], cwd=Path(__file__).resolve().parents[2]).returncode == 0

    lock = tmp_path / 'models.lock'
    lock.write_text(f'# comment\nBAAI/bge-m3={HASH}\nQwen/Qwen3.5-2B=PIN_AT_SETUP\n')
    assert pinned_revision('BAAI/bge-m3', lock) == HASH
    for model in ('Qwen/Qwen3.5-2B', 'someone/else'):  # a placeholder, and a model that is not listed
        with pytest.raises(ValueError):
            pinned_revision(model, lock)

    loaded = []

    class SentenceTransformer:
        def __init__(self, *args, **kwargs):
            loaded.append((args, kwargs))

        def encode(self, texts, **kwargs):
            loaded.append(('encode', texts, kwargs))
            return types.SimpleNamespace(tolist=lambda: [[0.6, 0.8] for _ in texts])

    monkeypatch.setitem(sys.modules, 'sentence_transformers', types.SimpleNamespace(SentenceTransformer=SentenceTransformer))
    embedder = BgeM3Embedder('BAAI/bge-m3', pinned_revision('BAAI/bge-m3', lock))
    assert embedder.encode(['x']) == [[0.6, 0.8]]
    assert loaded == [(('BAAI/bge-m3',), {'revision': HASH}), ('encode', ['x'], {'normalize_embeddings': True})]


def test_committed_models_lock_lists_both_models():
    """TC-F14-09 models.lock has a line for each model, a placeholder until go-live and a 40-character hash after"""
    values = dict(line.split('=', 1) for line in LOCK.read_text().splitlines() if line.strip() and not line.startswith('#'))
    assert set(values) == {'BAAI/bge-m3', 'Qwen/Qwen3.5-2B'}
    assert all(v == 'PIN_AT_SETUP' or re.fullmatch(r'[0-9a-f]{40}', v) for v in values.values())

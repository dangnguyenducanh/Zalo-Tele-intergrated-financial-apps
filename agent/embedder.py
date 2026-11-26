# The embedder behind find_skills, recall_memory and the categorizer (docs/01 §1.9 "Embedding space"):
# BAAI/bge-m3, 1024 numbers per text, normalised so cosine similarity is a dot product.
import hashlib
import math
import random
import re
from pathlib import Path
from typing import Protocol

DIMENSIONS = 1024
LOCK = Path(__file__).with_name('models.lock')


class Embedder(Protocol):
    def encode(self, texts: list[str]) -> list[list[float]]: ...


class FakeEmbedder:
    """For tests: a text always gives the same unit vector and two texts give different ones. Loads nothing."""

    def __init__(self):
        self.calls: list[list[str]] = []

    def encode(self, texts):
        self.calls.append(list(texts))
        return [self._vector(text) for text in texts]

    @staticmethod
    def _vector(text):
        rng = random.Random(hashlib.sha256(text.encode()).digest())
        vector = [rng.gauss(0, 1) for _ in range(DIMENSIONS)]
        length = math.sqrt(sum(x * x for x in vector))
        return [x / length for x in vector]


def pinned_revision(model, lock=LOCK):
    """The commit hash models.lock holds for `model`. A placeholder or a missing line is an error, never `main`."""
    for line in lock.read_text().splitlines():
        name, _, revision = line.partition('=')
        if name.strip() == model:
            revision = revision.strip()
            if re.fullmatch(r'[0-9a-f]{40}', revision):
                return revision
            raise ValueError(f'models.lock has no commit hash for {model} yet (docs/06 §6.13: record it at setup)')
    raise ValueError(f'{model} is not pinned in models.lock')


class BgeM3Embedder:
    def __init__(self, model, revision):
        # Imported here, not at the top: CI and the tests never install sentence-transformers or torch.
        from sentence_transformers import SentenceTransformer

        self._model = SentenceTransformer(model, revision=revision)

    def encode(self, texts):
        return self._model.encode(texts, normalize_embeddings=True).tolist()


def load_embedder(settings):
    return BgeM3Embedder(settings.embed_model, pinned_revision(settings.embed_model))

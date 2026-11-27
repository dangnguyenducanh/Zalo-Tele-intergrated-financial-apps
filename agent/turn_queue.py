# The queue in front of the graph (docs/02 §2.11.4 "Concurrency", docs/04 §4.11): vLLM runs 8 sequences at once, so at
# most 8 turns run and 16 more wait; the next one is refused at once with 503 AGENT_BUSY, before anything is written.
import threading
from contextlib import contextmanager


class Busy(Exception):
    """The queue is full."""


class TurnQueue:
    def __init__(self, running=8, waiting=16):
        self.slots = threading.Semaphore(running)
        self.limit = running + waiting
        self.inside = 0  # running and waiting
        self.lock = threading.Lock()

    @contextmanager
    def slot(self):
        with self.lock:
            if self.inside >= self.limit:
                raise Busy
            self.inside += 1
        try:
            with self.slots:
                yield
        finally:
            with self.lock:
                self.inside -= 1

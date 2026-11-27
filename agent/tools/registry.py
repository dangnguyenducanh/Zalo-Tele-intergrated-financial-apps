# The tool registry (docs/04 §4.11 "Tool registry"): the one place that turns the model's (or a skill's) arguments into a
# handler call. The model can never choose whose data is read: userId, token and query are dropped, a skill's preset wins,
# the arguments are checked by pydantic, the handler runs under a time limit and a failure is a step, never a crash.
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import dataclass, field
from datetime import date
from typing import Annotated, Any, Callable

from bson import ObjectId
from pydantic import AfterValidator, BaseModel, Field, ValidationError

FORBIDDEN_ARGS = frozenset({'userId', 'token', 'query'})
MAX_LIMIT = 20
Limit = Annotated[int, Field(ge=1), AfterValidator(lambda n: min(n, MAX_LIMIT))]  # 0 is refused, 50 becomes 20

# A handler that outlives its timeout cannot be killed; it keeps its thread until its own query limit (maxTimeMS) ends it.
# ponytail: one shared pool; a per-tool pool if a slow tool ever starves the others.
POOL = ThreadPoolExecutor(max_workers=16, thread_name_prefix='tool')


@dataclass(frozen=True)
class ToolContext:
    """What a handler gets from the request instead of from the model: the user, the Vietnam date, the reply language,
    the time the turn has left (a time.monotonic() value) and the database."""
    user_id: ObjectId
    today: date
    language: str
    deadline: float
    db: Any


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    args: type[BaseModel]
    handler: Callable  # (ctx, args) → (data dict, facts list)
    timeout_ms: int = 5000
    side_effect: str = 'read'
    collections: tuple = ()
    hidden: tuple = ()  # arguments the skill's code fills and the model must never see (compare_periods' `unit`): left out of the stored schema


@dataclass
class ToolResult:
    ok: bool
    error: str | None = None  # an error CLASS (TIMEOUT, INVALID_ARGS, ValueError…), never a message: it may hold the user's text
    data: dict = field(default_factory=dict)
    facts: list = field(default_factory=list)
    dropped: list = field(default_factory=list)  # forbidden arguments that were removed, sorted
    args: dict = field(default_factory=dict)  # the arguments after presets and validation, as stored in agentTurns.toolCalls
    ms: int = 0


class ToolRegistry:
    def __init__(self):
        self.tools = {}

    def add(self, tool):
        self.tools[tool.name] = tool

    def call(self, name, llm_args, preset, ctx):
        started = time.monotonic()
        merged = {**(llm_args or {}), **(preset or {})}  # the preset is applied last, so it wins
        dropped = sorted(FORBIDDEN_ARGS & merged.keys())
        merged = {key: value for key, value in merged.items() if key not in FORBIDDEN_ARGS}

        def done(error=None, data=None, facts=None, args=merged):
            return ToolResult(error is None, error, data or {}, facts or [], dropped, args, round((time.monotonic() - started) * 1000))

        tool = self.tools.get(name)
        if tool is None:
            return done('UNKNOWN_TOOL')
        left = ctx.deadline - time.monotonic()
        if left <= 0:
            return done('DEADLINE')
        try:
            args = tool.args(**merged)
        except (ValidationError, TypeError):
            return done('INVALID_ARGS')
        clean = args.model_dump(mode='json')
        try:
            data, facts = POOL.submit(tool.handler, ctx, args).result(timeout=min(tool.timeout_ms / 1000, left))
        except FutureTimeout:
            return done('TIMEOUT', args=clean)
        except Exception as exc:  # the class only: the message may hold the user's text
            return done(type(exc).__name__, args=clean)
        return done(data=data, facts=facts, args=clean)

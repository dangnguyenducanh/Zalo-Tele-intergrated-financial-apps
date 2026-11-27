# The agent service's HTTP shell (docs/04 §4.11 "Agent service API"): /health without auth, a bearer check on
# every other path (so on all of /v1/), for http and websocket alike, Express's error shape, and a log line that holds
# ids and error classes only.
# POST /v1/turn (T45) runs the question engine of graph.py behind the queue of turn_queue.py; /v1/receipt and
# /v1/categorize arrive with the next cards. All of them inherit the bearer check, the error shape and the log line.
# When the service starts (the lifespan below) sync.py copies the skills and tools to MongoDB and embeds the new ones.
import hashlib
import http
import logging
import re
import sys
import time
import uuid
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from hmac import compare_digest

from bson import ObjectId
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException
from pymongo import MongoClient
from starlette.websockets import WebSocketClose

from .config import Settings
from .embedder import load_embedder
from .graph import Deps, Duplicate, build_graph, new_state
from .schemas import TurnRequest
from .skills import load_skills
from .sync import sync
from .tools import default_registry
from .turn_queue import Busy, TurnQueue

log = logging.getLogger('uvicorn.error')  # the container log; uvicorn's own access log is off (Dockerfile)
REQUEST_ID = re.compile(r'[A-Za-z0-9:._-]{1,128}')  # Express sends the chat reference <platform>:<chatId>:<messageId>


def error_response(status, code, message, details=None):
    """Express's error shape (docs/04 §4.5): { error: { code, message, details? } }."""
    body = {'code': code, 'message': message}
    if details:
        body['details'] = details
    return JSONResponse({'error': body}, status_code=status)


def same_secret(received, expected):
    """Constant time. Both sides are hashed first, so the length of the secret is not leaked and non-ASCII is fine."""
    if not received or not expected:
        return False
    return compare_digest(hashlib.sha256(received.encode()).digest(), hashlib.sha256(expected.encode()).digest())


def bearer_token(headers):
    scheme, _, token = headers.get('authorization', '').partition(' ')
    return token if scheme == 'Bearer' else None


class RequireSecret:
    """Only /health is open. Everything else needs the secret, also a path no route owns yet, so a route added later
    cannot be forgotten and the tunnel never shows a 404 to a stranger. Pure ASGI, not @app.middleware('http'), because
    that one never sees a websocket: a websocket route would otherwise be open."""

    def __init__(self, app, secret):
        self.app, self.secret = app, secret

    async def __call__(self, scope, receive, send):
        # A "lifespan" scope (start and stop of the server) is neither: it has no path and goes straight through.
        guarded = scope['type'] in ('http', 'websocket') and scope['path'] != '/health'
        if guarded and not same_secret(bearer_token(Headers(scope=scope)), self.secret):
            if scope['type'] == 'websocket':
                await WebSocketClose(1008)(scope, receive, send)  # refused before the handshake: the client sees a 403
            else:
                await error_response(401, 'UNAUTHENTICATED', 'Bad or missing agent secret')(scope, receive, send)
            return
        await self.app(scope, receive, send)


def gpu_free_mb():
    # torch is loaded only by the real embedder on the GPU host: look, never import it just for this. None = unknown.
    torch = sys.modules.get('torch')
    try:
        return torch.cuda.mem_get_info()[0] // 2**20 if torch and torch.cuda.is_available() else None
    except Exception:
        return None


def create_app(settings=None, embedder=None, *, now=None, chat_model=None, skills=None, queue=None):
    """The service. The keyword arguments are for tests: a fixed clock, a fake chat model, other skills, a smaller queue."""
    settings = settings or Settings.from_env()  # raises ConfigError: the service refuses to start
    embedder = embedder or load_embedder(settings)  # the real one loads bge-m3 here, so it is loaded when we answer
    # pymongo's own DEBUG log writes every command and reply (the user's question, the ids, the amounts): keep it off even
    # when someone turns DEBUG on for the rest. Our logs hold ids, node names, times and error classes only.
    logging.getLogger('pymongo').setLevel(logging.WARNING)
    registry = default_registry()
    skills = skills if skills is not None else load_skills(registry)  # a skill file that is wrong stops the start
    mongo = MongoClient(settings.mongodb_uri_agent, tz_aware=True)  # aware datetimes: no host time zone can move a day
    deps = Deps(db=mongo.get_default_database(), skills=skills, registry=registry, now=now or (lambda: datetime.now(timezone.utc)),
                embedder=embedder, chat_model=chat_model)
    graph = build_graph(deps)
    queue = queue or TurnQueue()

    @asynccontextmanager
    async def lifespan(app):
        sync(deps)  # nothing is served until it is done; a database or an embedder that fails stops the start
        yield
        mongo.close()

    # No /docs, /redoc or /openapi.json: the tunnel would show them without a secret.
    app = FastAPI(title='sochitieu-agent', docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.settings, app.state.embedder, app.state.mongo = settings, embedder, mongo
    app.state.deps, app.state.graph, app.state.queue = deps, graph, queue
    app.state.sync = lambda: sync(deps)  # what the lifespan runs: tests that do not enter it call this

    # Added first, so it sits inside the logger below (the last one added is the outermost): a 401 is logged too.
    app.add_middleware(RequireSecret, secret=settings.agent_secret)

    @app.middleware('http')
    async def log_and_hide_errors(request: Request, call_next):
        request_id = request.headers.get('x-request-id', '')
        request_id = request_id if REQUEST_ID.fullmatch(request_id) else uuid.uuid4().hex
        request.state.request_id = request_id  # the turn's log lines carry it too
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception as exc:  # a bug: say nothing about it to the caller, log the class only
            log.error('request=%s node=http error=%s', request_id, type(exc).__name__)
            response = error_response(500, 'INTERNAL', 'Internal server error')
        response.headers['X-Request-Id'] = request_id
        log.info('request=%s node=http status=%s ms=%d', request_id, response.status_code,
                 (time.perf_counter() - started) * 1000)
        return response

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        code = {404: 'NOT_FOUND', 405: 'METHOD_NOT_ALLOWED'}.get(exc.status_code, 'BAD_REQUEST')
        message = (f'Route {request.method} {request.url.path} not found' if exc.status_code == 404
                   else http.HTTPStatus(exc.status_code).phrase)
        return error_response(exc.status_code, code, message)

    @app.exception_handler(RequestValidationError)
    async def invalid_input(request: Request, exc: RequestValidationError):
        # Path and rule only: the value that failed may be the user's text.
        details = [{'path': '.'.join(str(part) for part in e['loc'][1:]), 'issue': e['type']} for e in exc.errors()]
        return error_response(422, 'VALIDATION_ERROR', 'Invalid input', details)

    @app.post('/v1/turn')
    def turn(body: TurnRequest, request: Request):
        # A plain `def`: FastAPI runs it in a thread, so pymongo and the graph never block the event loop.
        started = time.monotonic()
        try:
            with queue.slot():
                state = graph.invoke(new_state(body, request.state.request_id, deps, started))
        except Busy:
            return error_response(503, 'AGENT_BUSY', 'The assistant is busy, try again in a moment')
        except Duplicate:
            return error_response(409, 'DUPLICATE', 'This request was already answered')
        except Exception:
            # A crash after ingress leaves a row with no answer, and the redelivery would then be refused as a duplicate.
            with suppress(Exception):
                deps.db['agentTurns'].delete_one({'userId': ObjectId(body.userId), 'requestId': body.requestId, 'answer': None})
            raise
        reply = {'route': state['route'], 'text': state['answer'], 'facts': state['facts'], 'sources': state['sources'],
                 'followups': state['followups'], 'steps': state['steps'], 'timingsMs': state['timingsMs']}
        return reply | {key: state[key] for key in ('action', 'card') if state[key]}

    @app.get('/health')
    def health():
        # vLLM arrives with T63, so it is "down" until then. No user data and no secret here, ever.
        return {'vllm': 'down', 'embedder': 'ok', 'model': settings.llm_model, 'gpuFreeMb': gpu_free_mb()}

    return app

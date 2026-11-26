# The agent service's HTTP shell (docs/04 §4.11 "Agent service API"): /health without auth, a bearer check on
# every other path (so on all of /v1/), Express's error shape, and a log line that holds ids and error classes only.
# The question engine (/v1/turn, /v1/receipt, /v1/categorize) arrives with the next cards and inherits all of this.
import hashlib
import http
import logging
import re
import sys
import time
import uuid
from hmac import compare_digest

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from .config import Settings
from .embedder import load_embedder

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


def bearer_token(request):
    scheme, _, token = request.headers.get('authorization', '').partition(' ')
    return token if scheme == 'Bearer' else None


def gpu_free_mb():
    # torch is loaded only by the real embedder on the GPU host: look, never import it just for this. None = unknown.
    torch = sys.modules.get('torch')
    try:
        return torch.cuda.mem_get_info()[0] // 2**20 if torch and torch.cuda.is_available() else None
    except Exception:
        return None


def create_app(settings=None, embedder=None):
    settings = settings or Settings.from_env()  # raises ConfigError: the service refuses to start
    embedder = embedder or load_embedder(settings)  # the real one loads bge-m3 here, so it is loaded when we answer
    # No /docs, /redoc or /openapi.json: the tunnel would show them without a secret.
    app = FastAPI(title='sochitieu-agent', docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    app.state.embedder = embedder

    @app.middleware('http')
    async def guard_and_log(request: Request, call_next):
        request_id = request.headers.get('x-request-id', '')
        request_id = request_id if REQUEST_ID.fullmatch(request_id) else uuid.uuid4().hex
        started = time.perf_counter()
        # Only /health is open. Everything else needs the secret, also a path no route owns yet, so a route added
        # under /v1/ later cannot be forgotten and the tunnel never shows a 404 to a stranger.
        if request.scope['path'] != '/health' and not same_secret(bearer_token(request), settings.agent_secret):
            response = error_response(401, 'UNAUTHENTICATED', 'Bad or missing agent secret')
        else:
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

    @app.get('/health')
    def health():
        # vLLM arrives with T63, so it is "down" until then. No user data and no secret here, ever.
        return {'vllm': 'down', 'embedder': 'ok', 'model': settings.llm_model, 'gpuFreeMb': gpu_free_mb()}

    return app

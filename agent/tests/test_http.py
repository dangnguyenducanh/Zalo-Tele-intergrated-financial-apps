# The HTTP shell of docs/04 §4.11: /health, the bearer check, Express's error shape and what the logs hold.
import logging
import sys
from types import SimpleNamespace

import pytest
from fastapi import WebSocket
from fastapi.testclient import TestClient
from pydantic import BaseModel
from starlette.websockets import WebSocketDisconnect

import agent.app


def test_health_needs_no_secret_and_shows_nothing_else(make_app, monkeypatch):
    """TC-F14-04 GET /health answers without a secret with only vllm, embedder, model and gpuFreeMb"""
    client = TestClient(make_app())
    response = client.get('/health')
    assert response.status_code == 200
    assert response.json() == {'vllm': 'down', 'embedder': 'ok', 'model': 'qwen3.5-2b', 'gpuFreeMb': None}
    assert client.get('/health', headers={'Authorization': 'Bearer wrong'}).json() == response.json()
    # On the GPU host torch is loaded and reports the free memory; a broken torch means "unknown", not a 500.
    torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True, mem_get_info=lambda: (5 * 2**30, 48 * 2**30)))
    monkeypatch.setitem(sys.modules, 'torch', torch)
    assert client.get('/health').json()['gpuFreeMb'] == 5120
    torch.cuda.mem_get_info = lambda: 1 / 0
    assert client.get('/health').json()['gpuFreeMb'] is None


def bad_headers(secret):
    return [
        {},
        {'Authorization': 'Bearer wrong'},
        {'Authorization': 'Bearer '},
        {'Authorization': 'Bearer'},
        {'Authorization': 'Basic ' + secret},
        {'Authorization': secret},
        {'Authorization': 'Bearer ' + secret + 'x'},  # the secret and one more character
        {'Authorization': 'Bearer ' + secret[:-1]},  # the secret less one character
        {'Authorization': b'Bearer \xc3\xa9'},  # bytes that are not ASCII
    ]


@pytest.mark.parametrize('method,path', [
    ('POST', '/v1/turn'), ('POST', '/v1/receipt'), ('POST', '/v1/categorize'), ('GET', '/v1'), ('GET', '/v1/a/b'),
    ('GET', '/docs'), ('GET', '/openapi.json'), ('GET', '/'),
])
def test_every_path_but_health_needs_the_bearer(make_app, auth, settings, method, path):
    """TC-F14-05 A missing or wrong bearer is 401 on /v1/* and on every other path except /health"""
    client = TestClient(make_app())
    for headers in bad_headers(settings.agent_secret):
        response = client.request(method, path, headers=headers, content=b'not json')  # 401 comes before the body
        assert response.status_code == 401, headers
        assert response.json() == {'error': {'code': 'UNAUTHENTICATED', 'message': 'Bad or missing agent secret'}}
    # With the secret the check passes. No route is there yet (the next cards add them), and the API docs are off.
    response = client.request(method, path, headers=auth)
    assert response.status_code in (404, 405) and response.json()['error']['code'] in ('NOT_FOUND', 'METHOD_NOT_ALLOWED')


def test_a_websocket_route_needs_the_bearer_too(make_app, auth, settings):
    """TC-F14-05 A websocket route is refused without the bearer, as an http route is: the guard sees both kinds of connection"""
    app = make_app()
    reached = []

    @app.websocket('/v1/test-socket')
    async def socket(websocket: WebSocket):
        reached.append('connected')
        await websocket.accept()
        await websocket.send_text('hello')
        await websocket.close()

    client = TestClient(app)
    for headers in ({}, {'Authorization': 'Bearer wrong'}, {'Authorization': 'Basic ' + settings.agent_secret},
                    {'Authorization': 'Bearer ' + settings.agent_secret + 'x'}):
        with pytest.raises(WebSocketDisconnect) as refused:
            with client.websocket_connect('/v1/test-socket', headers=headers):
                pass
        assert refused.value.code == 1008, headers  # refused before the handshake: the route never ran
        assert reached == [], headers
    with client.websocket_connect('/v1/test-socket', headers=auth) as socket_with_secret:  # the secret opens it
        assert socket_with_secret.receive_text() == 'hello'
    assert reached == ['connected']


def test_the_secret_is_compared_in_constant_time(make_app, auth, monkeypatch):
    """TC-F14-05 The comparison uses hmac.compare_digest on equal-length digests, so length and content do not leak"""
    seen, real = [], agent.app.compare_digest
    monkeypatch.setattr(agent.app, 'compare_digest', lambda a, b: seen.append((len(a), len(b))) or real(a, b))
    client = TestClient(make_app())
    client.get('/v1/x', headers=auth)
    client.get('/v1/x', headers={'Authorization': 'Bearer short'})
    client.get('/v1/x', headers={'Authorization': 'Bearer ' + 'long' * 100})
    assert seen == [(32, 32)] * 3


def test_errors_use_express_shape(make_app, auth):
    """TC-F14-07 404, 405, 422 and 500 answer { error: { code, message, details? } } and a 500 hides the cause"""

    class Body(BaseModel):
        amount: int

    app = make_app()

    @app.post('/v1/test-body-typed')
    def typed(body: Body):
        return {'ok': True}

    @app.get('/v1/test-boom')
    def boom():
        raise RuntimeError('cà phê 45k, the user\'s note')

    client = TestClient(app, raise_server_exceptions=False)
    missing = client.get('/v1/nothing', headers=auth)
    assert (missing.status_code, missing.json()) == (
        404, {'error': {'code': 'NOT_FOUND', 'message': 'Route GET /v1/nothing not found'}})
    wrong_method = client.put('/health')
    assert (wrong_method.status_code, wrong_method.json()['error']['code']) == (405, 'METHOD_NOT_ALLOWED')
    invalid = client.post('/v1/test-body-typed', json={'amount': 'phở 45k'}, headers=auth)
    assert invalid.status_code == 422
    assert invalid.json() == {'error': {'code': 'VALIDATION_ERROR', 'message': 'Invalid input',
                                        'details': [{'path': 'amount', 'issue': 'int_parsing'}]}}
    assert 'phở' not in invalid.text  # the rejected value is never echoed
    failed = client.get('/v1/test-boom', headers=auth)
    assert (failed.status_code, failed.json()) == (500, {'error': {'code': 'INTERNAL', 'message': 'Internal server error'}})
    assert failed.headers['x-request-id']


def test_logs_hold_ids_and_error_classes_only(make_app, auth, settings, caplog):
    """TC-F14-08 A log line holds the request id, the node and an error class, never text, figures or the secret"""
    app = make_app()

    @app.post('/v1/test-boom')
    def boom():
        raise RuntimeError('cà phê 45k and ' + settings.mongodb_uri_agent)

    caplog.set_level(logging.INFO, logger='uvicorn.error')
    client = TestClient(app, raise_server_exceptions=False)
    ok = client.get('/health', headers={'X-Request-Id': 'telegram:123:456'})
    client.post('/v1/test-boom?note=cà+phê+45k', json={'text': 'phở 45k'}, headers={**auth, 'X-Request-Id': 'a b ' * 30})
    client.post('/v1/test-boom', headers={'Authorization': 'Bearer wrong-secret-value'})
    assert ok.headers['x-request-id'] == 'telegram:123:456'  # an id Express sent is kept
    lines = [r.getMessage() for r in caplog.records if r.name == 'uvicorn.error']
    assert len(lines) == 4  # the 500 logs its class, then its request line; the 401 logs its request line
    for line in lines:
        assert line.split()[0].startswith('request=') and ' node=http ' in line
        assert line.endswith(('error=RuntimeError',)) or ' status=' in line
    everything = ' '.join(lines)
    assert settings.agent_secret not in repr(settings) and settings.mongodb_uri_agent not in repr(settings)
    for secret in ('phở', 'cà phê', '45k', 'wrong-secret-value', settings.agent_secret, settings.mongodb_uri_agent, 'PASTE_pw'):
        assert secret not in everything
    assert 'request=telegram:123:456 node=http status=200' in everything
    assert 'a b' not in everything  # an id that is not made of id characters is replaced

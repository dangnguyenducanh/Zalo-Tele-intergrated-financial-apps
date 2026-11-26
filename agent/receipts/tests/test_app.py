# The HTTP contract of docs/04 §4.8, the one server/src/services/receipts.js calls, with a fake model: no GPU, no
# network. Any request to another address fails the test (BUG-002).
import asyncio
import base64
import io
import json
import logging
import random
import struct
import tempfile

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import MAX_UPLOAD, create_app

KEY = 'test-receipt-key'
VLLM = 'http://vllm.test/v1'


def photo(fmt='JPEG', size=(60, 80), noise=False, exif_rotated=False):
    if noise:
        image = Image.frombytes('RGB', size, random.Random(1).randbytes(size[0] * size[1] * 3))
    else:
        image = Image.new('RGB', size, 'white')
    out, extra = io.BytesIO(), {}
    if exif_rotated:
        exif = Image.Exif()
        exif[274] = 6  # the camera was turned: show rotated 90°
        extra['exif'] = exif.tobytes()
    image.save(out, fmt, **extra)
    return out.getvalue()


GOOD = {
    'receipt': {'merchant': ' CỬA HÀNG THỬ ', 'address': '1 Đường Thử', 'date': 'Ngày: 4/5/2024',
                'items': [{'name': 'Bánh mì', 'quantity': 2, 'unit_price': 20000, 'amount': 40000},
                          {'name': 'Sữa', 'quantity': None, 'unit_price': None, 'amount': 23000},
                          {'name': '', 'quantity': 1, 'unit_price': 1, 'amount': 1},
                          {'name': 'Điểm trừ', 'quantity': 1, 'unit_price': -5, 'amount': -5}],
                'total_payable': 63000},
    'lines': {'lines': [{'label': 'Tổng cộng', 'amount': 63000}, {'label': 'Tiền mặt', 'amount': 100000}]},
    'transcript': {'text_lines': ['CỬA HÀNG THỬ', 'Tổng cộng 63.000', 'Tiền mặt 100.000']},
    'numbers': {'numbers': ['63.000', '100.000']},
}
TORN = {
    'receipt': {'merchant': 'CỬA HÀNG THỬ', 'address': None, 'date': None, 'total_payable': 53000,
                'items': [{'name': 'A', 'quantity': 1, 'unit_price': 20000, 'amount': 20000},
                          {'name': 'B', 'quantity': 1, 'unit_price': 33000, 'amount': 33000}]},
    'lines': {'lines': [{'label': 'TỔNG CỘNG:', 'amount': 53000}]},
    'transcript': {'text_lines': ['20.000', '33.000', 'TỔNG CỘNG:']},
    'numbers': {'numbers': ['20.000', '33.000']},
}


class FakeModel:
    """Stands in for vLLM: answers each guided-JSON task by its schema name and records the requests."""

    def __init__(self, answers=GOOD):
        self.answers = dict(answers)
        self.calls = []
        self.error = None  # an exception to raise, or an int status to answer
        self.delay = 0
        self.models = ['qwen3.5-2b']

    async def __call__(self, request):
        url = str(request.url)
        assert url.startswith(VLLM + '/'), f'unexpected request to {url}'
        if isinstance(self.error, Exception):
            raise self.error
        if self.error:
            return httpx.Response(self.error, json={'error': 'boom'})
        if url.endswith('/models'):
            return httpx.Response(200, json={'data': [{'id': name} for name in self.models]})
        await asyncio.sleep(self.delay)
        body = json.loads(request.content)
        self.calls.append(body)
        answer = self.answers[body['response_format']['json_schema']['name']]
        content = answer if isinstance(answer, str) else json.dumps(answer, ensure_ascii=False)
        return httpx.Response(200, json={'choices': [{'message': {'content': content}, 'finish_reason': 'stop'}]})

    def tasks(self):
        return sorted(call['response_format']['json_schema']['name'] for call in self.calls)


@pytest.fixture
def model():
    return FakeModel()


@pytest.fixture
def client(model):
    with TestClient(create_app(api_key=KEY, vllm_url=VLLM, transport=httpx.MockTransport(model))) as c:
        yield c


def analyze(client, data, key=KEY, content_type='image/jpeg', field='image'):
    headers = {} if key is None else {'X-KIE-Key': key}
    return client.post('/analyze', headers=headers, files={field: ('receipt.jpg', data, content_type)})


@pytest.mark.parametrize('key', [None, '', 'wrong-key', KEY + 'x', 'khoá-sai'.encode()],
                         ids=['missing', 'empty', 'wrong', 'longer', 'not ASCII'])
def test_auth(client, model, key):
    """TC-F10-27 a missing or wrong X-KIE-Key is 401 and never reaches the model"""
    res = analyze(client, photo(), key=key)
    assert res.status_code == 401
    assert model.calls == []


def test_auth_comes_before_the_body(client):
    """TC-F10-27 an unauthorised caller is refused before the upload is read"""
    assert analyze(client, b'\xff\xd8\xff' + bytes(MAX_UPLOAD * 2), key='wrong').status_code == 401


def test_service_refuses_to_start_without_a_key(monkeypatch):
    """TC-F10-27 without KIE_API_KEY the service does not start, so it never runs open"""
    monkeypatch.delenv('KIE_API_KEY', raising=False)
    with pytest.raises(RuntimeError, match='KIE_API_KEY'):
        create_app(vllm_url=VLLM)


def test_answer_shape(client, model):
    """TC-F10-29 200 answers the shape the app reads: fields, line_items, reconciliation, timings_ms"""
    res = analyze(client, photo())
    assert res.status_code == 200
    body = res.json()
    assert body['fields'] == {'total': '63000', 'merchant': 'CỬA HÀNG THỬ', 'address': '1 Đường Thử', 'date': '04/05/2024'}
    assert body['line_items'] == [{'name': 'Bánh mì', 'quantity': 2, 'unit_price': 20000, 'amount': 40000},
                                  {'name': 'Sữa', 'quantity': 1, 'unit_price': None, 'amount': 23000}]
    assert body['reconciliation'] == {'is_math_consistent': True}
    assert body['timings_ms'] and all(isinstance(ms, int) and ms >= 0 for ms in body['timings_ms'].values())
    assert model.tasks() == ['lines', 'receipt', 'transcript']  # printed on the first re-read: no second one


def test_the_foot_of_the_receipt_is_not_a_line_item(client, model):
    """TC-F10-29 the total, cash and change rows the model lists among the items are dropped; real items stay"""
    item = lambda name, amount: {'name': name, 'quantity': 1, 'unit_price': None, 'amount': amount}  # noqa: E731
    model.answers['receipt'] = {**GOOD['receipt'], 'items': [
        item('Combo tiết kiệm', 40000), item('Thuốc giảm đau', 23000), item('Tổng cộng', 63000), item('Tiền khách đưa', 100000),
        item('Tiền phải trả lại', 37000), item('Tiền mặt', 100000), item('Total', 63000)]}
    body = analyze(client, photo()).json()
    assert [row['name'] for row in body['line_items']] == ['Combo tiết kiệm', 'Thuốc giảm đau']
    assert body['reconciliation'] == {'is_math_consistent': True}


def test_png(client):
    """TC-F10-29 a PNG is read too, and sent to the model as a PNG"""
    assert analyze(client, photo('PNG'), content_type='image/png').status_code == 200


def sent_image(call):
    url = call['messages'][0]['content'][0]['image_url']['url']
    header, data = url.split(',', 1)
    return header, base64.b64decode(data)


def test_model_request(client, model):
    """TC-F10-29 every call is non-thinking, temperature 0, JSON-schema guided, with the photo as sent"""
    data = photo()
    assert analyze(client, data).status_code == 200
    for call in model.calls:
        assert call['model'] == 'qwen3.5-2b' and call['temperature'] == 0
        assert call['chat_template_kwargs'] == {'enable_thinking': False}
        assert call['response_format']['type'] == 'json_schema' and call['response_format']['json_schema']['schema']
        assert sent_image(call) == ('data:image/jpeg;base64', data)


@pytest.mark.parametrize('options, size', [
    ({'size': (400, 300), 'exif_rotated': True}, (300, 400)),
    ({'size': (4000, 1000)}, (2048, 512)),
], ids=['EXIF turned', 'larger than 2048 px'])
def test_photo_is_turned_upright_and_shrunk(client, model, options, size):
    """TC-F10-29 a phone photo is turned by its EXIF flag and a huge one shrunk before the model sees it (BUG-037)"""
    assert analyze(client, photo(**options)).status_code == 200
    assert Image.open(io.BytesIO(sent_image(model.calls[0])[1])).size == size


def test_torn(client, model):
    """TC-F10-26 an invented total that no re-read shows is answered as total "" (BUG-036)"""
    model.answers = TORN
    body = analyze(client, photo()).json()
    assert body['fields']['total'] == ''
    assert body['reconciliation'] == {'is_math_consistent': False}
    assert [item['amount'] for item in body['line_items']] == [20000, 33000]
    assert model.tasks() == ['lines', 'numbers', 'receipt', 'transcript']


def test_goods_subtotal_relabelled_as_the_total(client, model):
    """TC-F10-26 a goods subtotal the line copy relabels as the total gives total "", with no second re-read (BUG-036)"""
    model.answers = {**GOOD, 'lines': {'lines': [{'label': 'TỔNG TIỀN:', 'amount': 63000}]},
                     'transcript': {'text_lines': ['Tổng tiền hàng:', '63.000']}}
    assert analyze(client, photo()).json()['fields']['total'] == ''
    assert 'numbers' not in model.tasks()


def test_second_reread_confirms_a_total_the_first_one_missed(client, model):
    """TC-F10-26 a printed total the line-by-line re-read skipped is confirmed by the number list"""
    model.answers = {**GOOD, 'transcript': {'text_lines': ['Tổng cộng :', 'Tiền mặt']}}
    assert analyze(client, photo()).json()['fields']['total'] == '63000'


def test_unreadable_reread_never_confirms(client, model):
    """TC-F10-26 re-reads the model answers badly confirm nothing, so no total is presented (BUG-036)"""
    model.answers = {**GOOD, 'transcript': '{"text_lines": ["116.0', 'numbers': 'not json'}
    res = analyze(client, photo())
    assert res.status_code == 200 and res.json()['fields']['total'] == ''


def test_no_total_printed(client, model):
    """TC-F10-29 no total anywhere → total "" and no second re-read"""
    model.answers = {**GOOD, 'receipt': {**GOOD['receipt'], 'total_payable': None}, 'lines': {'lines': []}}
    assert analyze(client, photo()).json()['fields']['total'] == ''
    assert 'numbers' not in model.tasks()


@pytest.mark.parametrize('data, content_type, status', [
    (b'\xff\xd8\xff\xe0 not really a jpeg', 'image/jpeg', 400),
    (photo()[:200], 'image/jpeg', 400),
    (b'%PDF-1.7 fake', 'image/jpeg', 415),
    (photo('GIF'), 'image/gif', 415),
    (b'', 'image/jpeg', 415),
    (b'\xff\xd8\xff' + bytes(MAX_UPLOAD), 'image/jpeg', 413),
    (photo('PNG', size=(9000, 9000)), 'image/png', 413),
], ids=['broken', 'cut off', 'pdf', 'gif', 'empty', 'over 10 MB', '81 megapixels'])
def test_bad_uploads(client, model, data, content_type, status):
    """TC-F10-28 unreadable → 400, too large → 413, not JPEG or PNG → 415, and the model is not called"""
    assert analyze(client, data, content_type=content_type).status_code == status
    assert model.calls == []


def turned_with_bad_exif(tag, kind, value):
    """A 400 x 300 JPEG with orientation 6 and one more EXIF tag stored with the wrong type."""
    entries = [(274, 3, 1, struct.pack('<HH', 6, 0)), (tag, kind, 4 if kind == 2 else 1, value)]
    ifd = struct.pack('<H', len(entries)) + b''.join(struct.pack('<HHI4s', *entry) for entry in entries) + bytes(4)
    out = io.BytesIO()
    Image.new('RGB', (400, 300), 'white').save(out, 'JPEG', exif=b'Exif\0\0II*\0' + struct.pack('<I', 8) + ifd)
    return out.getvalue()


@pytest.mark.parametrize('tag, kind, value', [
    (282, 2, b'abc\0'),  # XResolution as text
    (256, 2, b'abc\0'),  # ImageWidth as text
    (282, 9, struct.pack('<i', -5)),  # XResolution as a negative number
], ids=['text resolution', 'text width', 'negative resolution'])
def test_turned_photo_with_bad_exif(client, model, tag, kind, value):
    """TC-F10-28 a turned photo with an ill-typed EXIF tag is read upright, not answered with a 500"""
    assert analyze(client, turned_with_bad_exif(tag, kind, value)).status_code == 200
    sent = Image.open(io.BytesIO(sent_image(model.calls[0])[1]))
    assert sent.size == (300, 400)
    assert sent.getexif().get(274, 1) == 1  # nothing left for the model's side to turn a second time


@pytest.mark.parametrize('orientation, corner', [(2, (1, 0)), (3, (1, 1)), (4, (0, 1)), (5, (0, 0)), (6, (1, 0)),
                                                 (7, (1, 1)), (8, (0, 1))])
def test_every_exif_orientation(client, model, orientation, corner):
    """TC-F10-29 each of the seven EXIF turns puts the stored top-left corner where the camera says (BUG-037)"""
    image = Image.new('RGB', (64, 48), 'white')
    image.paste((255, 0, 0), (0, 0, 16, 16))
    exif, out = Image.Exif(), io.BytesIO()
    exif[274] = orientation
    image.save(out, 'JPEG', exif=exif.tobytes(), quality=95)
    assert analyze(client, out.getvalue()).status_code == 200
    sent = Image.open(io.BytesIO(sent_image(model.calls[0])[1])).convert('RGB')
    assert sent.size == ((48, 64) if orientation >= 5 else (64, 48))
    x, y = corner
    red, green, _ = sent.getpixel((x * (sent.width - 9) + 4, y * (sent.height - 9) + 4))
    assert red > 200 and green < 60


def test_missing_image_field(client):
    """TC-F10-28 no "image" file in the form, or no form at all, is 400"""
    assert analyze(client, photo(), field='photo').status_code == 400
    assert client.post('/analyze', headers={'X-KIE-Key': KEY}, data={'image': 'text'}).status_code == 400
    assert client.post('/analyze', headers={'X-KIE-Key': KEY}, content=b'x').status_code == 400
    broken = {'X-KIE-Key': KEY, 'Content-Type': 'multipart/form-data; boundary=x'}
    assert client.post('/analyze', headers=broken, content=b'garbage').status_code == 400


def test_endless_chunked_upload_is_cut_off(client):
    """TC-F10-28 an upload without a Content-Length is cut off at the limit with 413"""
    def chunks():
        yield b'--x\r\nContent-Disposition: form-data; name="image"; filename="a.jpg"\r\n\r\n'
        for _ in range(MAX_UPLOAD // 1_000_000 + 5):
            yield bytes(1_000_000)

    headers = {'X-KIE-Key': KEY, 'Content-Type': 'multipart/form-data; boundary=x'}
    assert client.post('/analyze', headers=headers, content=chunks()).status_code == 413


@pytest.mark.parametrize('failure, status', [
    (httpx.ConnectError('refused'), 503),
    (httpx.ReadTimeout('slow'), 504),
    (500, 502),
], ids=['down', 'timeout', 'error answer'])
def test_model_down(client, model, failure, status):
    """TC-F10-30 a model that is down, slow or failing is a 5xx, so the app says the reader is unavailable"""
    model.error = failure
    assert analyze(client, photo()).status_code == status


@pytest.mark.parametrize('answer', ['not json', {'merchant': 'x'}, '{"merchant": "A", "items": [{"name": "A", "amount": 1'],
                         ids=['not JSON', 'wrong shape', 'cut off'])
def test_a_direct_read_the_model_answers_badly_reads_nothing(client, model, answer):
    """TC-F10-30 a page the direct read cannot make sense of (an id and date sheet with no money lines) answers total "", not 502"""
    model.answers = {**GOOD, 'receipt': answer, 'lines': {'lines': []}}
    res = analyze(client, photo())
    assert res.status_code == 200
    assert res.json()['fields'] == {'total': '', 'merchant': '', 'address': '', 'date': ''}
    assert res.json()['line_items'] == []


def test_a_bad_direct_read_does_not_hide_the_copied_total(client, model):
    """TC-F10-30 the copy and the re-read still give the total when only the direct read is unreadable"""
    model.answers = {**GOOD, 'receipt': 'not json'}
    assert analyze(client, photo()).json()['fields']['total'] == '63000'


@pytest.mark.parametrize('task, answer', [('lines', '{"lines": [{"label": "Tổng')], ids=['cut off line copy'])
def test_bad_model_answer(client, model, task, answer):
    """TC-F10-30 a line copy the model answers badly is 502, never a half-read total"""
    model.answers = {**GOOD, task: answer}
    assert analyze(client, photo()).status_code == 502


def test_read_has_a_time_budget(model):
    """TC-F10-30 a read that takes too long answers 504, well before the app's 120 s timeout"""
    model.delay = 1
    app = create_app(api_key=KEY, vllm_url=VLLM, transport=httpx.MockTransport(model), read_budget=0.05)
    with TestClient(app) as c:
        assert analyze(c, photo()).status_code == 504


def test_health(client, model):
    """TC-F10-30 /health is 200 only when the service can reach the model"""
    assert client.get('/health').status_code == 200
    model.models = ['another-model']
    assert client.get('/health').status_code == 503
    model.models = ['qwen3.5-2b']
    model.error = 500
    assert client.get('/health').status_code == 503
    model.error = httpx.ConnectError('refused')
    assert client.get('/health').status_code == 503


def test_photo_never_reaches_the_disk(client, monkeypatch):
    """TC-F10-31 a photo over 1 MB stays in memory: no temporary file is ever opened for it"""
    def no_disk(self):
        raise AssertionError('the upload was written to a temporary file on disk')

    monkeypatch.setattr(tempfile.SpooledTemporaryFile, 'rollover', no_disk)
    data = photo('PNG', size=(900, 900), noise=True)
    assert len(data) > 2_000_000
    assert analyze(client, data, content_type='image/png').status_code == 200


def test_logs_hold_no_key_photo_or_content(client, model, caplog):
    """TC-F10-31 the logs hold no key, no image bytes and nothing read from the receipt"""
    data = photo()
    with caplog.at_level(logging.DEBUG):
        assert analyze(client, data).status_code == 200
        model.answers = {**GOOD, 'lines': 'CỬA HÀNG THỬ is not JSON'}
        assert analyze(client, data).status_code == 502
        assert analyze(client, data, key='a-wrong-secret').status_code == 401
    for secret in (KEY, 'a-wrong-secret', base64.b64encode(data).decode()[:40], 'CỬA HÀNG THỬ', '63000'):
        assert secret not in caplog.text, secret

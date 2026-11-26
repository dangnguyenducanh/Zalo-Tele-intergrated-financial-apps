# The Qwen receipt service: the same HTTP contract as the KIE service, so the app keeps calling KIE_URL and switching
# is only a matter of which service listens on KIE's port (docs/04 §4.8, runbook in docs/06 §6.6).
# The photo stays in memory: it is never written to disk and never logged.
import asyncio
import base64
import hmac
import io
import logging
import os
import warnings

from fastapi import FastAPI, HTTPException, Request
from PIL import Image
from starlette.formparsers import MultiPartException, MultiPartParser

from reader import read_receipt
from vllm_client import BadAnswer, ModelUnavailable, Vllm

MAX_UPLOAD = 10 * 1024 * 1024  # bytes, KIE's limit (the app itself accepts 4.5 MB)
MAX_BODY = MAX_UPLOAD + 64 * 1024  # the photo plus the multipart wrapping
MAX_PIXELS = 40_000_000
MAX_SIDE = 2048  # a larger photo is shrunk: its image tokens would not fit the model's 16k window
READ_BUDGET_S = 90  # the app gives up after 120 s
FORMATS = {b'\xff\xd8\xff': ('JPEG', 'image/jpeg'), b'\x89PNG\r\n\x1a\n': ('PNG', 'image/png')}
# The turn that stands a photo upright, by EXIF orientation (tag 274). Not ImageOps.exif_transpose: it also rewrites
# the EXIF block, and raises on another tag of the wrong type.
UPRIGHT = {2: Image.Transpose.FLIP_LEFT_RIGHT, 3: Image.Transpose.ROTATE_180, 4: Image.Transpose.FLIP_TOP_BOTTOM,
           5: Image.Transpose.TRANSPOSE, 6: Image.Transpose.ROTATE_270, 7: Image.Transpose.TRANSVERSE,
           8: Image.Transpose.ROTATE_90}

log = logging.getLogger('uvicorn.error')  # shown in the container log


class InMemoryParser(MultiPartParser):
    spool_max_size = MAX_BODY  # Starlette's default moves a file over 1 MB into a temporary file on disk


async def upload(request):
    """The bytes of multipart field "image", read into memory and cut off at the size limit."""
    if not request.headers.get('content-type', '').startswith('multipart/form-data'):
        raise HTTPException(400, 'Send the photo as multipart/form-data field "image"')

    async def capped():
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_BODY:
                raise HTTPException(413, 'The image is too large')
            yield chunk

    try:
        form = await InMemoryParser(request.headers, capped(), max_files=1, max_fields=5).parse()
    except (MultiPartException, ValueError, KeyError):  # KeyError: no boundary
        raise HTTPException(400, 'The upload is not valid multipart/form-data') from None
    image = form.get('image')
    if not hasattr(image, 'read'):
        raise HTTPException(400, 'Send the photo as multipart/form-data field "image"')
    data = await image.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, 'The image is too large')
    return data


def to_data_url(data):
    """The photo as the model gets it: checked, upright and at most MAX_SIDE; otherwise the bytes as uploaded."""
    kind = next((known for magic, known in FORMATS.items() if data.startswith(magic)), None)
    if not kind:
        raise HTTPException(415, 'Only JPEG and PNG images are supported')
    fmt, mime = kind
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', Image.DecompressionBombWarning)  # MAX_PIXELS below is stricter
            image = Image.open(io.BytesIO(data), formats=[fmt])
        if image.width * image.height > MAX_PIXELS:
            raise HTTPException(413, 'The image has too many pixels')
        image.load()  # a broken or cut-off file fails here
        turn = UPRIGHT.get(image.getexif().get(274, 1))
        if turn is not None or max(image.size) > MAX_SIDE:
            upright = image.convert('RGB')
            if turn is not None:
                upright = upright.transpose(turn)
            upright.thumbnail((MAX_SIDE, MAX_SIDE))
            out = io.BytesIO()
            upright.save(out, 'JPEG', quality=92)
            data, mime = out.getvalue(), 'image/jpeg'
    except Image.DecompressionBombError:
        raise HTTPException(413, 'The image has too many pixels') from None
    except (OSError, SyntaxError, ValueError):
        raise HTTPException(400, 'The image cannot be read') from None
    return f'data:{mime};base64,{base64.b64encode(data).decode()}'


def create_app(api_key=None, vllm_url=None, transport=None, read_budget=READ_BUDGET_S):
    """uvicorn runs this factory; the arguments are only for the tests (a fake model instead of vLLM)."""
    api_key = api_key or os.environ.get('KIE_API_KEY')
    if not api_key:
        raise RuntimeError('KIE_API_KEY is not set: the service does not run without a key')
    model = Vllm(vllm_url or os.environ.get('VLLM_URL') or 'http://127.0.0.1:8300/v1', transport)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.get('/health')
    async def health():
        if not await model.healthy():
            raise HTTPException(503, 'The model is not reachable')
        return {'status': 'ok'}

    @app.post('/analyze')
    async def analyze(request: Request):
        # Checked before the body is read; compare_digest takes as long for a near miss as for a wild guess.
        if not hmac.compare_digest(request.headers.get('x-kie-key', '').encode('latin-1'), api_key.encode()):
            raise HTTPException(401, 'Wrong or missing X-KIE-Key')
        image_url = await asyncio.to_thread(to_data_url, await upload(request))
        try:
            async with asyncio.timeout(read_budget):
                result = await read_receipt(model, image_url)
        except TimeoutError:
            log.warning('receipt: the model did not answer in time')
            raise HTTPException(504, 'The model did not answer in time') from None
        except ModelUnavailable as err:
            log.warning('receipt: the model is unreachable (%s)', err)
            raise HTTPException(503, 'The model is not reachable') from None
        except BadAnswer as err:
            log.warning('receipt: bad answer from the model (%s)', err)
            raise HTTPException(502, 'The model answered badly') from None
        log.info('receipt: total %s, timings %s', 'read' if result['fields']['total'] else 'not found', result['timings_ms'])
        return result

    return app

# The vLLM client (OpenAI-compatible API) and the four things we ask the model about one receipt photo. Every call
# is non-thinking, temperature 0 and guided by a JSON schema; the answer is validated again with pydantic.
import httpx
from pydantic import BaseModel, Field

MODEL = 'qwen3.5-2b'  # the served name; the weights and revision are pinned in compose.yaml (docs/06 §6.13)


class ModelUnavailable(Exception):
    """vLLM cannot be reached."""


class BadAnswer(Exception):
    """vLLM answered with an error, or with something other than the asked JSON."""


class NotTheAskedJson(BadAnswer):
    """vLLM answered 200, but the content is not the asked JSON (cut off, or not the schema)."""


class Item(BaseModel):
    name: str
    quantity: float | None
    unit_price: int | None
    amount: int


class Receipt(BaseModel):
    """1. The direct read."""
    merchant: str | None
    address: str | None
    date: str | None
    items: list[Item] = Field(max_length=60)
    total_payable: int | None


class MoneyLine(BaseModel):
    label: str
    amount: int


class Lines(BaseModel):
    """2. The line copy: every printed money line with its label."""
    lines: list[MoneyLine] = Field(max_length=60)


class Transcript(BaseModel):
    """3. A verbatim re-read, which shows what is really printed."""
    text_lines: list[str] = Field(max_length=80)

    @property
    def texts(self):
        return self.text_lines


class Numbers(BaseModel):
    """4. A second verbatim re-read, numbers only, for a total the first one did not show."""
    numbers: list[str] = Field(max_length=80)

    @property
    def texts(self):
        return self.numbers


TASKS = {
    'receipt': (Receipt, 3000,
        'Đây là ảnh hoá đơn/phiếu của Việt Nam (có thể bị xoay ngang hoặc rách). Read the receipt photo: the shop name, '
        'its address, the date as printed and the line items. '
        'total_payable = số tiền cuối cùng khách phải trả, after VAT and discounts (labels such as "Tổng cộng tiền thanh toán", '
        '"Tiền cần thanh toán", "Khách phải trả", "Số tiền"). Never use invoice or voucher numbers, dates, years, phone numbers, '
        'tax codes, cash handed over or change. If the total is not visible (torn or cut off), set total_payable to null. '
        'items = the line items you can read, with quantity, unit price and line amount. All amounts are VND integers.'),
    # No label words are named here ("subtotal, VAT, cash…"): a 2B model echoes the words of its prompt as labels and shifts
    # the printed amounts onto them (it named the cash "amount to pay"). It copies the labels as printed instead.
    'lines': (Lines, 3000,
        'Read this Vietnamese receipt photo (it may be sideways or torn). Copy every printed line that has a money amount, '
        'top to bottom, with its label exactly as printed (keep Vietnamese words) and the amount as a VND integer. '
        'Do not add or compute any line that is not printed.'),
    'transcript': (Transcript, 2000,
        'Transcribe all the printed text in this photo, line by line, top to bottom, exactly as printed. Do not translate, '
        'summarize, complete cut-off words or add numbers. Stop where the paper ends.'),
    'numbers': (Numbers, 1500,
        'List every number printed on this receipt, top to bottom, exactly as the characters appear on the paper (keep '
        'dots and commas). Only copy what you can see; never add or compute numbers.'),
}


class Vllm:
    def __init__(self, base_url, transport=None):
        self.http = httpx.AsyncClient(base_url=base_url.rstrip('/') + '/', timeout=60, transport=transport, trust_env=False)

    async def healthy(self):
        try:
            res = await self.http.get('models', timeout=5)
            return res.status_code == 200 and any(m.get('id') == MODEL for m in res.json()['data'])
        except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
            return False

    async def ask(self, task, image_url):
        """Asks one of TASKS about the photo and returns the validated answer."""
        schema, max_tokens, prompt = TASKS[task]
        body = {
            'model': MODEL, 'temperature': 0, 'max_tokens': max_tokens,
            'chat_template_kwargs': {'enable_thinking': False},
            'response_format': {'type': 'json_schema',
                                'json_schema': {'name': task, 'schema': schema.model_json_schema(), 'strict': True}},
            'messages': [{'role': 'user', 'content': [
                {'type': 'image_url', 'image_url': {'url': image_url}}, {'type': 'text', 'text': prompt}]}],
        }
        try:
            res = await self.http.post('chat/completions', json=body)
        except httpx.TimeoutException:
            raise TimeoutError from None
        except httpx.HTTPError as err:
            raise ModelUnavailable(type(err).__name__) from None
        # The messages below never quote the answer: it holds what is on the receipt, which must not reach a log.
        if res.status_code != 200:
            raise BadAnswer(f'{task}: vLLM answered {res.status_code}')
        try:
            return schema.model_validate_json(res.json()['choices'][0]['message']['content'])
        except (ValueError, KeyError, IndexError, TypeError) as err:  # pydantic's ValidationError is a ValueError
            raise NotTheAskedJson(f'{task}: {type(err).__name__}') from None

# The reading method on recorded model answers (no GPU): the direct read, the line copy and the verbatim re-read are the
# real model's answers for the synthetic receipts of the PR #124 review, shortened to the foot. Synthetic content only.
import asyncio
import json
import pathlib

import pytest

from reader import read_receipt
from vllm_client import TASKS

# The 28 receipts of the PR #124 round-2 review on which the reader of head 8f79cc7 answered the cash handed over as the
# total: the model echoed the words of its own prompt as labels ("amount to pay", "cash") and shifted the printed amounts
# onto them. Each has the right total.
ECHOED = json.loads((pathlib.Path(__file__).parent / 'echoed_copies.json').read_text(encoding='utf-8'))


class RecordedModel:
    """Answers each task from the recording."""

    def __init__(self, case):
        self.answers = {
            'receipt': {'merchant': None, 'address': None, 'date': None, 'items': [], 'total_payable': case['direct']},
            'lines': {'lines': case['lines']},
            'transcript': {'text_lines': case['reread']},
            'numbers': {'numbers': case['numbers']},
        }

    async def ask(self, task, image_url):
        return TASKS[task][0].model_validate(self.answers[task])


@pytest.mark.parametrize('case', ECHOED, ids=[case['case'] for case in ECHOED])
def test_a_recorded_echoed_copy_never_gives_the_cash_as_the_total(case):
    """TC-F10-24 on the 28 recorded copies that returned the cash handed over, the reader gives the right total or none (PR #124 round 2)"""
    total = asyncio.run(read_receipt(RecordedModel(case), 'data:'))['fields']['total']
    assert total in (str(case['expected']), ''), f"{total} is not {case['expected']}"


def test_half_of_the_recorded_echoed_copies_are_still_read_right():
    """TC-F10-24 the reader gives the right total, not only none, on about half of the recorded echoed copies: the direct read and the copy agree on it (PR #124 round 4)"""
    right = sum(asyncio.run(read_receipt(RecordedModel(case), 'data:'))['fields']['total'] == str(case['expected']) for case in ECHOED)
    assert right >= 14, right  # 15 of 28 (18 under the rules of round 3, which let the re-read and the cash pick a total)

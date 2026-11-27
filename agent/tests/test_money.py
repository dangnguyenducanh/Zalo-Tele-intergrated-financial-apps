# Money in a reply is formatted as Express formats it (server/src/bot/core.js money()): one fixture, two test stacks.
import json
from pathlib import Path

import pytest

from agent.money import money

FIXTURE = json.loads((Path(__file__).resolve().parents[2] / 'shared' / 'fixtures' / 'money.json').read_text(encoding='utf-8'))


@pytest.mark.parametrize('row', FIXTURE['rows'], ids=lambda row: str(row['amount']))
def test_money_reads_like_express(row):
    """TC-F14-37 money() gives the text of every row of shared/fixtures/money.json, in Vietnamese and in English"""
    assert money(row['amount'], 'vi') == row['vi']
    assert money(row['amount'], 'en') == row['en']


def test_money_takes_whole_dong_only():
    """TC-F14-37 A float, a boolean or a text is refused, so a total that is not an exact integer never reaches a reply"""
    for bad in (1.5, 1100000.0, True, '45000', None):
        with pytest.raises(TypeError):
            money(bad, 'vi')
    assert money(10**13, 'en') == '₫10,000,000,000,000'

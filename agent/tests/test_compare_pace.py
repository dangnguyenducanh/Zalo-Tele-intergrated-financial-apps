# The two number rules that Express and the agent service share (docs/02 §2.11.2, §2.11.3 "Number rules", docs/07 §7.9.2 *same days*,
# *pace*): the period before a period, and the budget pace. pytest reads the very files that vitest reads, so the Dashboard, /dubao and
# the assistant cannot disagree: shared/fixtures/compare-range.json and shared/fixtures/pace.json.
import json
from datetime import date
from pathlib import Path

import pytest

from agent.tools import period as period_rules
from agent.tools.compare_periods import compare_range, month_compare, ranges
from agent.tools.get_budget_pace import PACE_FROM_DAY, pace

FIXTURES = Path(__file__).resolve().parents[2] / 'shared' / 'fixtures'
COMPARE = json.loads((FIXTURES / 'compare-range.json').read_text(encoding='utf-8'))
PACE = json.loads((FIXTURES / 'pace.json').read_text(encoding='utf-8'))


def day(text):
    return date.fromisoformat(text)


def span(first, last):
    return {'from': first.isoformat(), 'to': last.isoformat()}


# ---- TC-F14-70: the period before a period ----

@pytest.mark.parametrize('row', COMPARE['compareRange'], ids=lambda row: row['name'])
def test_every_row_of_the_shared_compare_fixture_gives_its_previous_range(row):
    """TC-F14-70 compare_range on every row of shared/fixtures/compare-range.json (with the row's unit, or none) gives the row's previous range, as compareRange() in Express does"""
    assert span(*compare_range(day(row['from']), day(row['to']), row['unit'])) == row['previous']


def test_the_weekly_example_of_the_spec_is_in_the_fixture_and_in_the_rule():
    """TC-F14-70 Mon 23 to Wed 25/11 goes to Mon 16 to Wed 18/11, 01-25/11 to 01-25/10 and 01-31/10 to 01-30/09 (docs/02 §2.11.3 number rules)"""
    assert compare_range(date(2026, 11, 23), date(2026, 11, 25)) == (date(2026, 11, 16), date(2026, 11, 18))
    assert compare_range(date(2026, 11, 1), date(2026, 11, 25)) == (date(2026, 10, 1), date(2026, 10, 25))
    assert compare_range(date(2026, 10, 1), date(2026, 10, 31)) == (date(2026, 9, 1), date(2026, 9, 30))


def test_compare_range_takes_only_dates_in_order_and_a_known_unit():
    """TC-F14-70 A from after to and an unknown unit are refused (ValueError, the RangeError of the Express side); None means no unit"""
    with pytest.raises(ValueError):
        compare_range(date(2026, 11, 25), date(2026, 11, 24))
    with pytest.raises(ValueError):
        compare_range(date(2026, 11, 24), date(2026, 11, 25), 'fortnight')
    assert compare_range(date(2026, 11, 25), date(2026, 11, 25), None) == (date(2026, 11, 24), date(2026, 11, 24))


DATES_ARE_ENOUGH = [row for row in COMPARE['monthCompare'] if row.get('compareRangeAgrees') is not False]
DATES_ARE_NOT = [row for row in COMPARE['monthCompare'] if row.get('compareRangeAgrees') is False]


@pytest.mark.parametrize('row', COMPARE['monthCompare'], ids=lambda row: row['name'])
def test_month_compare_gives_the_dashboards_ranges_for_every_row(row):
    """TC-F14-70 month_compare(month, today) gives the Dashboard's MonthCompare ranges of every row: days 1..N of both months for the current month, the whole month against the whole month before for any other"""
    current, previous = month_compare(row['month'], day(row['today']))
    assert (span(*current), span(*previous)) == (row['current'], row['previous'])


@pytest.mark.parametrize('row', DATES_ARE_ENOUGH, ids=lambda row: row['name'])
def test_where_the_dates_say_it_all_compare_range_with_the_unit_month_is_the_same(row):
    """TC-F14-70 On the rows where dates alone are enough, compare_range(current, 'month') is the Dashboard's previous range"""
    assert span(*compare_range(day(row['current']['from']), day(row['current']['to']), 'month')) == row['previous']


@pytest.mark.parametrize('row', DATES_ARE_NOT, ids=lambda row: row['name'])
def test_where_the_dates_are_not_enough_the_month_rule_is_what_the_agent_uses(row):
    """TC-F14-70 On the last day of a month shorter than its predecessor compare_range sees a whole month and goes back to the whole month before; ranges() (what compare_periods runs) keeps the Dashboard's days 1..N instead"""
    first, last = day(row['current']['from']), day(row['current']['to'])
    assert span(*compare_range(first, last, 'month')) != row['previous']
    current, previous = ranges(first, last, 'month', day(row['today']))
    assert (span(*current), span(*previous)) == (row['current'], row['previous'])


def test_a_period_that_has_not_ended_is_compared_by_the_days_gone_and_a_finished_one_whole():
    """TC-F14-70 ranges(): a week or a year that contains today stops at today on both sides; a past or future one is whole; a month follows the Dashboard; a count of days shifts by its own length"""
    today = date(2026, 11, 25)
    this_week = ranges(date(2026, 11, 23), date(2026, 11, 29), 'week', today)
    assert (span(*this_week[0]), span(*this_week[1])) == ({'from': '2026-11-23', 'to': '2026-11-25'}, {'from': '2026-11-16', 'to': '2026-11-18'})
    last_week = ranges(date(2026, 11, 16), date(2026, 11, 22), 'week', today)
    assert (last_week[0], last_week[1]) == ((date(2026, 11, 16), date(2026, 11, 22)), (date(2026, 11, 9), date(2026, 11, 15)))
    next_week = ranges(date(2026, 11, 30), date(2026, 12, 6), 'week', today)
    assert next_week[1] == (date(2026, 11, 23), date(2026, 11, 29))  # still to come: whole against whole
    this_year = ranges(date(2026, 1, 1), date(2026, 12, 31), 'year', today)
    assert (this_year[0], this_year[1]) == ((date(2026, 1, 1), date(2026, 11, 25)), (date(2025, 1, 1), date(2025, 11, 25)))
    assert ranges(today, today, 'day', today)[1] == (date(2026, 11, 24), date(2026, 11, 24))
    assert ranges(date(2026, 11, 19), today, None, today)[1] == (date(2026, 11, 12), date(2026, 11, 18))  # "7 ngày qua": shifted by its own 7 days
    month = ranges(date(2026, 11, 1), date(2026, 11, 30), 'month', today)
    assert (span(*month[0]), span(*month[1])) == ({'from': '2026-11-01', 'to': '2026-11-25'}, {'from': '2026-10-01', 'to': '2026-10-25'})
    past = ranges(date(2026, 10, 1), date(2026, 10, 31), 'month', today)
    assert (past[0], past[1]) == ((date(2026, 10, 1), date(2026, 10, 31)), (date(2026, 9, 1), date(2026, 9, 30)))
    leap = ranges(date(2024, 3, 1), date(2024, 3, 31), 'month', date(2024, 3, 31))
    assert (leap[0], leap[1]) == ((date(2024, 3, 1), date(2024, 3, 29)), (date(2024, 2, 1), date(2024, 2, 29)))


def test_the_unit_of_a_period_is_the_one_period_py_passes_and_a_weekend_goes_back_a_week():
    """TC-F14-70 period.py passes the unit: day, week, month and year as they are; a weekend (a Saturday and a Sunday) as a week; a count of days (7 ngày qua) none"""
    today = date(2026, 11, 25)
    got = {text: period_rules.unit_of(period_rules.period_in(text, today)) for text in
           ('hôm nay', 'hôm qua', 'tuần này', 'tuần trước', 'tháng này', 'tháng 10', 'năm 2025', '20/11', 'cuối tuần', '7 ngày qua')}
    assert got == {'hôm nay': 'day', 'hôm qua': 'day', 'tuần này': 'week', 'tuần trước': 'week', 'tháng này': 'month', 'tháng 10': 'month', 'năm 2025': 'year',
                   '20/11': 'day', 'cuối tuần': 'week', '7 ngày qua': None}
    weekend = period_rules.period_in('cuối tuần', today)
    assert (weekend.start, weekend.end) == (date(2026, 11, 21), date(2026, 11, 22))
    assert ranges(weekend.start, weekend.end, period_rules.unit_of(weekend), today)[1] == (date(2026, 11, 14), date(2026, 11, 15))


# ---- TC-F14-71: the pace ----

@pytest.mark.parametrize('row', PACE['pace'], ids=lambda row: row['name'])
def test_every_row_of_the_shared_pace_fixture_gives_its_pace(row):
    """TC-F14-71 pace() on every row of shared/fixtures/pace.json gives the row's figures (or nothing before day 5), as pace() in services/budgets.js does"""
    assert pace(**{'spent': row['input']['spent'], 'limit': row['input']['limit'], 'day': row['input']['day'], 'days_in_month': row['input']['daysInMonth']}) == row['pace']


def test_the_a2_example_and_the_edges_of_the_pace_are_the_ones_of_the_spec():
    """TC-F14-71 7.100.000 of 8.000.000 on day 25 of 30 is 900.000 for 6 days, 150.000 a day, about 8.520.000 at month end and over on the 29th; nothing before day 5; over the limit has no allowance and never a negative number"""
    assert PACE_FROM_DAY == 5
    assert pace(7_100_000, 8_000_000, 25, 30) == {'daysLeft': 6, 'perDay': 150_000, 'projectedEnd': 8_520_000, 'overDay': 29}
    assert pace(7_100_000, 8_000_000, 4, 30) is None and pace(7_100_000, 8_000_000, 5, 30) is not None
    assert pace(9_000_000, 8_000_000, 25, 30)['perDay'] is None
    for days_in_month in (28, 29, 30, 31):
        for today in range(PACE_FROM_DAY, days_in_month + 1):
            for spent in (0, 1, 99, 1_000_000, 7_999_999, 8_000_000, 8_000_001, 12_345_678):
                row = pace(spent, 8_000_000, today, days_in_month)
                assert all(isinstance(n, int) and n >= 0 for n in row.values() if n is not None) and (row['perDay'] is None) == (spent >= 8_000_000)
                assert row['overDay'] is None or today < row['overDay'] <= days_in_month

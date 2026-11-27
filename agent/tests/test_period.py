# period.py: what a time phrase means on a given day (docs/02 §2.11.3, docs/07 §7.9.2 "period rules"). Its phrase rules
# are the ones of Express's bot/period.js, so both read shared/fixtures/period.json.
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from agent.tools.period import bounds, default_period, find_period, period_in, words_of

FIXTURE = json.loads((Path(__file__).resolve().parents[2] / 'shared' / 'fixtures' / 'period.json').read_text(encoding='utf-8'))
VN = timezone(timedelta(hours=7))
WEDNESDAY = date(2026, 11, 25)


@pytest.mark.parametrize('row', FIXTURE['phrases'], ids=lambda row: row['name'])
def test_phrases_are_found_as_express_finds_them(row):
    """TC-F14-34 Time words and counts are found the same way as in Express for every row of shared/fixtures/period.json"""
    found = find_period(words_of(row['text']))
    assert {'found': found.phrases, 'rest': found.rest} == {'found': row['found'], 'rest': row['rest']}


def test_the_indexes_of_a_phrase_are_the_words_it_took():
    """TC-F14-34 The word positions a phrase took are reported, so an amount next to a period is still free"""
    found = find_period(words_of('chi tiêu 7 ngày qua 50'))
    assert sorted(found.indexes) == [2, 3, 4]  # "7 ngày qua"; "chi", "tiêu" and the amount "50" are free
    assert find_period(words_of('')).phrases == [] and words_of(None) == [] and words_of('+lương 15tr') == ['lương', '15tr']


@pytest.mark.parametrize('row', FIXTURE['ranges'], ids=lambda row: row['name'])
def test_a_phrase_means_a_range_on_a_given_day(row):
    """TC-F14-35 Every row of the ranges in shared/fixtures/period.json: the first period phrase becomes { from, to, unit } on `today`"""
    period = period_in(row['text'], date.fromisoformat(row['today']))
    got = None if period is None else {'from': period.start.isoformat(), 'to': period.end.isoformat(), 'unit': period.unit}
    assert got == row['period']


def test_with_no_phrase_the_period_is_the_month_asked_for_else_this_month():
    """TC-F14-35 default_period is the month of `today`, or the month the request names (month: YYYY-MM)"""
    this = default_period(WEDNESDAY)
    assert (this.start, this.end, this.unit, this.name) == (date(2026, 11, 1), date(2026, 11, 30), 'month', 'this_month')
    september = default_period(WEDNESDAY, '2026-09')
    assert (september.start, september.end, september.unit) == (date(2026, 9, 1), date(2026, 9, 30), 'month')
    assert default_period(WEDNESDAY, '2026-11').name == 'this_month'  # the current month is "tháng này", whoever asked
    leap = default_period(date(2028, 3, 1), '2028-02')
    assert leap.end == date(2028, 2, 29)


def test_the_first_period_phrase_that_exists_counts():
    """TC-F14-35 A date that does not exist is skipped and the next period phrase of the text is used"""
    period = period_in('31/02 hôm qua', WEDNESDAY)
    assert (period.start, period.name) == (date(2026, 11, 24), 'yesterday')
    assert period_in('5 khoản top 3', WEDNESDAY) is None


def inside(span, moment):
    return span[0] <= moment < span[1]


def test_a_week_is_monday_to_sunday_and_a_day_ends_at_midnight_in_vietnam():
    """TC-F14-36 Sunday 22/11 23:59 +07 is last week, Monday 23/11 00:00 +07 is this week, 30/11 23:30 +07 is in November"""
    this_week = bounds(period_in('tuần này', WEDNESDAY))
    last_week = bounds(period_in('tuần trước', WEDNESDAY))
    november = bounds(period_in('tháng 11', WEDNESDAY))
    sunday, monday = datetime(2026, 11, 22, 23, 59, tzinfo=VN), datetime(2026, 11, 23, 0, 0, tzinfo=VN)
    assert inside(last_week, sunday) and not inside(this_week, sunday)
    assert inside(this_week, monday) and not inside(last_week, monday)
    assert inside(november, datetime(2026, 11, 30, 23, 30, tzinfo=VN))
    assert inside(november, datetime(2026, 11, 1, 0, 0, tzinfo=VN)) and not inside(november, datetime(2026, 10, 31, 23, 59, tzinfo=VN))
    assert not inside(november, datetime(2026, 12, 1, 0, 0, tzinfo=VN))
    # Aware datetimes in UTC, [start, end): Monday 00:00 in Vietnam is Sunday 17:00 UTC.
    assert this_week == (datetime(2026, 11, 22, 17, 0, tzinfo=timezone.utc), datetime(2026, 11, 29, 17, 0, tzinfo=timezone.utc))
    assert all(moment.tzinfo is not None for moment in this_week)


def test_one_day_is_from_midnight_to_midnight_in_vietnam():
    """TC-F14-36 hôm nay covers 00:00 to 23:59:59.999 +07, a month-end 23:59 row stays in its day, and the next 00:00 is the next day"""
    today = bounds(period_in('hôm nay', date(2026, 11, 19)))
    assert inside(today, datetime(2026, 11, 19, 23, 59, 59, 999000, tzinfo=VN))
    assert not inside(today, datetime(2026, 11, 20, 0, 0, tzinfo=VN)) and not inside(today, datetime(2026, 11, 18, 23, 59, 59, tzinfo=VN))
    # The same instant seen in UTC: 16:59 UTC on the 19th is 23:59 in Vietnam, 17:00 UTC is already the 20th.
    assert inside(today, datetime(2026, 11, 19, 16, 59, tzinfo=timezone.utc)) and not inside(today, datetime(2026, 11, 19, 17, 0, tzinfo=timezone.utc))

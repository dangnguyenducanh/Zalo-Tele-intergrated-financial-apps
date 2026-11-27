# What a time phrase means on a given day (docs/02 §2.11.3 "period.py", docs/07 §7.9.2 "period rules").
# The phrase rules are a port of server/src/bot/period.js and both read shared/fixtures/period.json; what a phrase
# means against `today` (weeks Monday-Sunday, days in Asia/Ho_Chi_Minh) is in the same file under "ranges".
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

VN = timezone(timedelta(hours=7))  # Vietnam has no daylight saving: a fixed offset is the whole rule
UNIT_WORD = re.compile(r'(k|nghin|ngan|ng|tr|trieu|m|d|vnd)')  # a money unit written apart from its number: "45 k"
AFTER_DAYS = ('qua', 'truoc', 'nay')  # "7 ngày qua", "7 ngày trước", "7 ngày nay"
WORD_PHRASES = [
    ('day', ('hom', 'nay')), ('day', ('hom', 'qua')), ('day', ('hqua',)), ('day', ('yesterday',)),
    ('week', ('tuan', 'nay')), ('week', ('tuan', 'truoc')), ('week', ('cuoi', 'tuan')),
    ('month', ('thang', 'nay')), ('month', ('thang', 'truoc')),
]


def normalize(text):
    """Lower case without Vietnamese accents, for matching only: "Phở Đà Lạt" → "pho da lat"."""
    text = unicodedata.normalize('NFD', str(text or '').lower())
    return ' '.join(re.sub('[̀-ͯ]', '', text).replace('đ', 'd').split())


def words_of(line):
    """"+lương 15tr" → ['lương', '15tr']: the words of a line as typed, without the income marker."""
    return str(line or '').strip().removeprefix('+').split()


def to_key(word):
    """"Phở," → "pho": a word without accents and without punctuation around it."""
    return re.sub(r'^[^a-z0-9]+|[^a-z0-9]+$', '', normalize(word))


def plain(keys, i, shape='[0-9]+'):
    """The number at keys[i] when it is only digits of the given shape and no money unit follows it; else None."""
    if i < len(keys) and re.fullmatch(shape, keys[i]) and not (i + 1 < len(keys) and UNIT_WORD.fullmatch(keys[i + 1])):
        return int(keys[i])
    return None


def within(n, low, high):
    return n is not None and low <= n <= high


def has_accent(word):
    """"ngày" written with its accent, in either Unicode form: "ngay" alone is "at once"."""
    word = unicodedata.normalize('NFC', word).lower()
    return word.strip(''.join(c for c in set(word) if not c.isalnum())) == 'ngày'


def phrase_at(words, keys, i):
    """The phrase that starts at words[i]: (kind, length), or None."""
    def number(offset, shape='[0-9]+'):
        return plain(keys, i + offset, shape)

    def key(offset):
        return keys[i + offset] if i + offset < len(keys) else None

    if i == 0 and keys[0] == 'top' and within(number(1, '[0-9]{1,3}'), 1, 999):
        return 'top', 2
    if within(number(0, '[0-9]{1,3}'), 1, 366) and key(1) == 'ngay':
        follows = key(2) in AFTER_DAYS
        if follows or has_accent(words[i + 1]):
            return 'days', 3 if follows else 2
    if within(number(0, '[0-9]{1,2}'), 1, 50) and key(1) == 'khoan':
        return 'items', 2
    if keys[i] == 'thang' and within(number(1, '[0-9]{1,2}'), 1, 12):
        with_year = key(2) == 'nam' and within(plain(keys, i + 3, '[0-9]{4}'), 1900, 2099)
        return 'month', 4 if with_year else 2
    if keys[i] == 'thang' and within(number(1, '[0-9]{4}'), 2000, 2099):
        return 'year', 2
    if keys[i] == 'nam' and within(number(1, '[0-9]{4}'), 1900, 2099):
        return 'year', 2
    found = re.fullmatch(r'([0-9]{1,2})/([0-9]{1,2})(?:/[0-9]{4})?', keys[i])
    if found and within(int(found[1]), 1, 31) and within(int(found[2]), 1, 12):
        return 'date', 1
    for kind, sequence in WORD_PHRASES:
        if all(key(n) == word for n, word in enumerate(sequence)):
            return kind, len(sequence)
    return None


@dataclass
class PeriodSearch:
    phrases: list = field(default_factory=list)  # [{'kind', 'text'}], the words as typed
    indexes: set = field(default_factory=set)  # the positions of every word a phrase took
    rest: str = ''  # the other words, joined by one space


def find_period(words):
    """The phrases in a line's words, left to right."""
    keys = [to_key(word) for word in words]
    found = PeriodSearch()
    i = 0
    while i < len(words):
        phrase = phrase_at(words, keys, i)
        if phrase is None:
            i += 1
            continue
        kind, length = phrase
        found.phrases.append({'kind': kind, 'text': ' '.join(words[i:i + length])})
        found.indexes.update(range(i, i + length))
        i += length
    found.rest = ' '.join(word for n, word in enumerate(words) if n not in found.indexes)
    return found


@dataclass(frozen=True)
class Period:
    """Vietnam calendar days, both ends included. `unit` is day, week, month, year or days (a count that is no calendar
    unit); `name` says which phrase made it, so a reply can say "tháng này" or "hôm qua"."""
    start: date
    end: date
    unit: str
    name: str


def month_period(year, month, name):
    first = date(year, month, 1)
    return Period(first, (first.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1), 'month', name)


def monday(day):
    return day - timedelta(days=day.weekday())


def default_period(today, month=None):
    """The period of a question that names none: the month the request asks for ('YYYY-MM'), else this month."""
    year, number = (int(part) for part in month.split('-')) if month else (today.year, today.month)
    return month_period(year, number, 'this_month' if (year, number) == (today.year, today.month) else 'month')


def meaning(kind, text, today):
    """What one phrase stands for on `today`, or None for a date that does not exist (31/02)."""
    keys = [to_key(word) for word in text.split()]
    if kind == 'day':
        if keys == ['hom', 'nay']:
            return Period(today, today, 'day', 'today')
        yesterday = today - timedelta(days=1)  # hôm qua, hqua, yesterday
        return Period(yesterday, yesterday, 'day', 'yesterday')
    if kind == 'week':
        if keys == ['cuoi', 'tuan']:  # the latest Saturday-Sunday whose Saturday is not after today
            saturday = monday(today) + timedelta(days=5)
            saturday -= timedelta(days=7) if saturday > today else timedelta(0)
            return Period(saturday, saturday + timedelta(days=1), 'days', 'weekend')
        this = monday(today)
        first = this if keys[1] == 'nay' else this - timedelta(days=7)
        return Period(first, first + timedelta(days=6), 'week', 'this_week' if keys[1] == 'nay' else 'last_week')
    if kind == 'month':
        if keys[1] in ('nay', 'truoc'):
            this = month_period(today.year, today.month, 'this_month')
            if keys[1] == 'nay':
                return this
            before = this.start - timedelta(days=1)
            return month_period(before.year, before.month, 'last_month')
        number = int(keys[1])
        year = int(keys[3]) if len(keys) == 4 else today.year - (number > today.month)
        return month_period(year, number, 'month')
    if kind == 'year':
        year = int(keys[1])
        return Period(date(year, 1, 1), date(year, 12, 31), 'year', 'year')
    if kind == 'days':
        return Period(today - timedelta(days=int(keys[0]) - 1), today, 'days', 'days')
    if kind == 'date':
        day, month, *given = (int(part) for part in keys[0].split('/'))
        year = given[0] if given else today.year - ((month, day) > (today.month, today.day))
        try:
            return Period(date(year, month, day), date(year, month, day), 'day', 'date')
        except ValueError:
            return None
    return None  # items and top are counts, not periods


BASELINE = (('so', 'sanh', 'voi'), ('so', 'voi'), ('compared', 'to'), ('compare', 'to'), ('compare', 'with'), ('versus',), ('vs',))  # "so với tháng trước": the period to compare WITH


def phrase_starts(found):
    """Where each phrase of a PeriodSearch begins (an index into the words): a phrase takes the next words of `indexes` in order."""
    taken, starts, at = sorted(found.indexes), [], 0
    for phrase in found.phrases:
        starts.append(taken[at])
        at += len(phrase['text'].split())
    return starts


def period_in(text, today):
    """The period the first period phrase of `text` means on `today`, or None. A date that does not exist is skipped, and so is a phrase
    that follows "so với" (or "vs", "compared to"): it names what the question compares with, not what it asks about."""
    words = words_of(text)
    keys, found = [to_key(word) for word in words], find_period(words)
    for phrase, first in zip(found.phrases, phrase_starts(found)):
        if any(tuple(keys[max(first - len(marker), 0):first]) == marker for marker in BASELINE):
            continue
        period = meaning(phrase['kind'], phrase['text'], today)
        if period:
            return period
    return None


def count_in(text):
    """The N of the first "top N" or "N khoản" in a question ("5 khoản chi lớn nhất tuần trước" → 5), else None."""
    for phrase in find_period(words_of(text)).phrases:
        if phrase['kind'] in ('top', 'items'):
            return int(re.search(r'[0-9]+', phrase['text'])[0])
    return None


def week_period(today):
    """This week, Monday to Sunday: what "tổng kết tuần" means when the question names no period."""
    return meaning('week', 'tuần này', today)


def unit_of(period):
    """The unit compare_periods is told (the model never sets it): day, week, month or year as the period is; a weekend goes back by a
    week; a count of days (7 ngày qua) has none, so the dates decide."""
    return 'week' if period.name == 'weekend' else period.unit if period.unit in ('day', 'week', 'month', 'year') else None


def bounds(period):
    """[start, end) as aware UTC datetimes: Vietnam midnight of the first day to Vietnam midnight after the last."""
    first = datetime(period.start.year, period.start.month, period.start.day, tzinfo=VN)
    after = period.end + timedelta(days=1)
    return first.astimezone(timezone.utc), datetime(after.year, after.month, after.day, tzinfo=VN).astimezone(timezone.utc)

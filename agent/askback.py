# The ask-back (docs/02 §2.11.3 "Routing", docs/03 §3.7 `agentTurns.askBack`): when several skills fit and the model is off,
# the answer is a numbered list; the user's next message, a bare 1-3 in the same thread within 10 minutes, runs that option.
#
# Where it lives: on the turn that asked, as `askBack {question, options, expiresAt}`. Each option carries what to run:
# the skill, the ids of the categories and wallets the question named, and the period. Reading it filters by user and
# thread, and everything it carries is checked again before anything runs (the rows may have changed in ten minutes).
import re
from datetime import date, timedelta

from .tools.period import Period
from . import texts
from .tools.scope import MAX_TIME_MS, category_name

LIFETIME = timedelta(minutes=10)
EXPIRED_AFTER = timedelta(hours=24)  # a bare 1-3 up to a day after an ask-back lapsed still gets the "expired" line
MAX_DAYS = 400  # the longest period a carried slot may name (the typed query's limit, docs/02 §2.11.3)
DIGIT = re.compile(r'[1-3]')  # the text is already cleaned: no spaces around it


def period_dict(period, named):
    return {'start': period.start.isoformat(), 'end': period.end.isoformat(), 'unit': period.unit, 'name': period.name, 'named': named}


def build(state, deps):
    """(card, askBack) for the top candidates of a `choose`: what Express shows and what the turn row keeps."""
    language, skills, period = state['language'], deps.skills, state['period']
    options = []
    for number, candidate in enumerate(state['candidates'][:3], 1):
        skill = skills[candidate['code']]
        label = ' · '.join([skill.label_vi if language == 'vi' else skill.label_en, *(entity['name'] for entity in state['entities']),
                            *([texts.describe(period, language)] if state['periodNamed'] else [])])
        options.append({'n': number, 'label': label, 'skill': skill.code,
                        'categoryIds': [e['id'] for e in state['entities'] if e['kind'] == 'category'],
                        'walletIds': [e['id'] for e in state['entities'] if e['kind'] == 'wallet'],
                        'period': period_dict(period, state['periodNamed'])})
    ask = {'question': texts.ask_which(language), 'options': options, 'expiresAt': deps.now() + LIFETIME}
    return {'kind': 'ask_back', 'options': [{'n': o['n'], 'label': o['label']} for o in options]}, ask


def read_period(raw):
    """The Period an option carries, or None when it is not a period this service would run."""
    try:
        start, end = date.fromisoformat(raw['start']), date.fromisoformat(raw['end'])
        if start > end or (end - start).days >= MAX_DAYS or not isinstance(raw['unit'], str) or not isinstance(raw['name'], str):
            return None
        return Period(start, end, raw['unit'], raw['name'])
    except (KeyError, TypeError, ValueError):
        return None


def read_reply(state, deps):
    """None unless the text is a bare 1-3 and this thread's last ask-back is under 24 hours old. Otherwise {kind, ...}:
    `run` (with the question, the skill, the period and the entities to run, all checked again), `expired` (its ten
    minutes are over) or `invalid` (it is open but something it carries is gone or the number is not one of its options)."""
    match = DIGIT.fullmatch(state['text'] or '')
    if not match:
        return None
    now = deps.now()
    row = deps.db['agentTurns'].find_one(
        {'userId': state['userId'], 'channel': state['channel'], 'threadKey': state['threadKey'], 'clearedAt': None,
         'askBack': {'$ne': None}, 'askBack.expiresAt': {'$gte': now - EXPIRED_AFTER}},
        {'askBack': 1, 'standalone': 1, 'question': 1}, sort=[('createdAt', -1)], max_time_ms=MAX_TIME_MS)
    if row is None:
        return None
    ask = row['askBack']
    if ask['expiresAt'] <= now:
        return {'kind': 'expired'}
    option = next((o for o in ask['options'] if o['n'] == int(match.group())), None)
    skill = deps.skills.get(option['skill']) if option else None
    mine = {'category': {str(c['_id']): c for c in state['categories']}, 'wallet': {str(w['_id']): w for w in state['wallets']}}
    ids = [('category', i) for i in (option or {}).get('categoryIds', [])] + [('wallet', i) for i in (option or {}).get('walletIds', [])]
    period = read_period(option['period']) if option else None
    if not skill or not skill.enabled or skill.mode != 'pipeline' or period is None or any(i not in mine[kind] for kind, i in ids):
        return {'kind': 'invalid'}
    entities = [{'kind': kind, 'id': i, 'name': category_name(mine[kind][i], state['language']) if kind == 'category' else mine[kind][i]['name'],
                 'type': mine[kind][i].get('type')} for kind, i in ids]
    return {'kind': 'run', 'question': row.get('standalone') or row.get('question'), 'skill': skill.code, 'period': period,
            'named': bool(option['period'].get('named')), 'entities': entities}

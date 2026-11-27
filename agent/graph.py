# The turn graph (docs/02 §2.11.3, docs/04 §4.11 "The graph"): one compiled LangGraph StateGraph that every
# POST /v1/turn runs through.
#
#   ingress → load_context ─┬─ chat ─→ rewrite_question → recall_memory → find_skills ─┐
#                           ├─ schedule / event ───────────────────────────→ decide ←──┘ (a skill given: find_skills skipped)
#                           ├─ confirm ─→ act
#                           └─ blocked / declined / expired ─→ generate_answer
#      decide → act → generate_answer → guard_output → suggest_followups → save_turn
#
# No model yet (T63): guard_output passes template text (nothing the model wrote reaches it), and `decide` runs pipeline
# skills; when several skills fit (`choose`) it asks back with numbered options instead (askback.py). A bare 1-3 that
# answers an ask-back skips the search and goes straight to `decide` with what the option carries (routing.py ranks, lexicon.py
# links, sync.py embeds the skills at start). Every node: the state in, a partial state out, one log line with the turn id,
# node and time and nothing else.
import logging
import time
import unicodedata
from dataclasses import dataclass, field
from datetime import timezone
from itertools import zip_longest
from typing import Any, Callable, TypedDict

from bson import ObjectId
from langgraph.graph import END, START, StateGraph
from pymongo.errors import DuplicateKeyError

from . import askback, lexicon, routing, texts
from .routing import cosine
from .tools.period import VN, count_in, default_period, find_period, period_in, unit_of, week_period, words_of
from .tools.registry import MAX_LIMIT, ToolContext
from .tools.scope import MAX_TIME_MS

log = logging.getLogger('uvicorn.error')  # the container log (see app.py): ids, node names, times and error classes only
CAPS = {'web': 30, 'telegram': 20, 'zalo': 10, 'whatsapp': 5}  # chat questions per user per Vietnam day (docs/02 §2.11.4)
BUDGET_SECONDS = {'web': 40}  # the time a turn has: 40 s on the web, 25 s in chat
HISTORY = 6  # the turns of this thread that load_context carries (short-term memory)
MEMORY_COSINE = 0.6  # a memory row this close to the question is recalled (docs/02 §2.11.3 `recall_memory`)
MEMORY_LIMIT = 5
ACCEPTS = {'category': 'categoryIds', 'wallet': 'walletIds'}  # the tool argument that carries each kind of linked entity


class Duplicate(Exception):
    """The same requestId for this user arrived twice: the answer to the first one stands (409 DUPLICATE)."""


class TurnState(TypedDict, total=False):
    turnId: str  # the id the log lines carry
    userId: ObjectId  # only ever from the request
    channel: str
    threadKey: str
    requestId: str
    trigger: str
    text: str | None  # the question as sent; ingress replaces it with the cleaned one
    actionId: ObjectId | None
    skill: str | None  # a command's skill, or the skill a scheduled message names
    language: str
    today: Any  # the Vietnam date
    month: str | None
    allowLlm: bool
    deadline: float  # time.monotonic() value
    command: bool  # a chat turn with a skill given: it does not count against the daily limit
    blocked: str | None  # capped | too_long | empty
    user: dict | None
    categories: list
    wallets: list
    history: list
    pendingAction: dict | None
    standalone: str | None
    period: Any
    periodNamed: bool  # the words named the period (else it is the default month)
    count: int | None  # the N of "top N" or "N khoản" in the question
    entities: list  # the user's own categories and wallets the words named: {kind, id, name, type?}
    ties: list  # words that name more than one row: {phrase, entities}; linked to none
    reply: dict | None  # a bare 1-3 that answers an ask-back: {kind: run|expired|invalid, ...}
    queryVector: list | None  # the question's embedding, made once (recall_memory), used by find_skills
    memories: list
    candidates: list
    retrieval: str  # direct | choose | none
    skillCode: str | None
    askBack: dict | None  # {question, options, expiresAt}: stored on the turn's row for Express and for a reply
    filters: list  # the linked entities the skill's tools took
    skipped: list  # conditions of the question the skill could not use, in words
    plan: list
    toolCalls: list
    facts: list
    answer: str
    sources: list
    action: dict | None
    card: dict | None
    followups: list
    route: str  # rules | capped
    guard: str
    steps: list
    timingsMs: list


@dataclass
class Deps:
    """What the nodes use: the database, the skills and tools, the clock and (from T46 and T63) the embedder and model."""
    db: Any
    skills: dict
    registry: Any
    now: Callable
    embedder: Any = None
    chat_model: Any = None
    vectors: dict = field(default_factory=dict)  # {skill code: embedding}, filled by sync.py when the service starts


def new_state(request, turn_id, deps, started=None):
    """The first state of a turn, from a TurnRequest. `started` is when the request arrived (its time budget runs from there)."""
    started = started if started is not None else time.monotonic()
    return TurnState(
        turnId=turn_id, userId=ObjectId(request.userId), channel=request.channel, threadKey=request.threadKey, requestId=request.requestId,
        trigger=request.trigger, text=request.text, actionId=ObjectId(request.actionId) if request.actionId else None, skill=request.skill,
        language=request.language, today=request.today, month=request.month, allowLlm=request.allowLlm,
        deadline=started + BUDGET_SECONDS.get(request.channel, 25), command=False, blocked=None, user=None, categories=[], wallets=[],
        history=[], pendingAction=None, standalone=None, period=None, periodNamed=False, count=None, entities=[], ties=[], reply=None, queryVector=None,
        memories=[], candidates=[], retrieval='none', skillCode=None, askBack=None, filters=[], skipped=[], plan=[], toolCalls=[], facts=[], answer='', sources=[], action=None, card=None, followups=[], route='rules',
        guard='pass', steps=[], timingsMs=[])


# ---- helpers ----

def clean_text(text):
    """NFC, control characters out (a tab or newline becomes a space), runs of spaces folded; None when nothing is left."""
    text = unicodedata.normalize('NFC', text or '')
    text = ''.join(' ' if ch in '\t\n\r' else ch for ch in text if ch in '\t\n\r' or unicodedata.category(ch) != 'Cc')
    return ' '.join(text.split()) or None


def day_start(now):
    """00:00 today, Vietnam time, as an aware UTC datetime."""
    local = now.astimezone(VN)
    return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)


def pipeline_skills(deps):
    """The skills this turn may run: enabled, and pipeline ones (agent mode needs the model, which arrives with T63)."""
    return {code: skill for code, skill in deps.skills.items() if skill.enabled and skill.mode == 'pipeline'}


# ---- nodes ----

def ingress(state, deps):
    """Input guard (docs/02 §2.11.3): clean the text, insert the turn's row (unique per user and requestId: a repeat is a
    duplicate), then check the length and the daily cap. The row goes in first, so a double click runs once."""
    text = clean_text(state['text']) if state['trigger'] == 'chat' else None
    command = state['trigger'] == 'chat' and bool(state['skill'])
    too_long = text is not None and len(text) > texts.MAX_TEXT
    now = deps.now()
    row = {'userId': state['userId'], 'channel': state['channel'], 'threadKey': state['threadKey'], 'requestId': state['requestId'],
           'trigger': state['trigger'], 'command': command, 'question': None if too_long else text, 'standalone': None, 'skill': None,
           'retrieval': 'none', 'toolCalls': [], 'facts': [], 'sources': [], 'followups': [], 'card': None, 'askBack': None, 'actionId': state['actionId'],
           'answer': None, 'route': None, 'guard': None, 'model': None, 'promptTokens': 0, 'completionTokens': 0, 'steps': [],
           'timingsMs': [], 'clearedAt': None, 'createdAt': now}
    try:
        deps.db['agentTurns'].insert_one(row)
    except DuplicateKeyError:
        raise Duplicate from None
    blocked = None
    if state['trigger'] == 'chat' and not command:
        # The row above counts itself, so over the cap means more than the cap. Commands never count and are never blocked (D16).
        used = deps.db['agentTurns'].count_documents(
            {'userId': state['userId'], 'channel': state['channel'], 'trigger': 'chat', 'command': {'$ne': True}, 'createdAt': {'$gte': day_start(now)}},
            maxTimeMS=MAX_TIME_MS)
        # ponytail: two turns racing at cap-1 can both pass, because count and insert are not one step; fine for a GPU guard
        blocked = 'capped' if used > CAPS[state['channel']] else 'too_long' if too_long else 'empty' if text is None else None
    elif too_long:
        blocked = 'too_long'
    return {'text': None if too_long else text, 'command': command, 'blocked': blocked}


def load_context(state, deps):
    """The user (only through the usersForAgent view: D15), their categories and wallets, this thread's last turns and the
    pending action a confirm points at. Every query has the user's id and a time limit."""
    uid, db = state['userId'], deps.db
    user = db['usersForAgent'].find_one({'_id': uid}, {'language': 1, 'assistantOn': 1}, max_time_ms=MAX_TIME_MS) or {}
    categories = list(db['categories'].find({'userId': uid, 'deletedAt': None}, {'type': 1, 'name': 1, 'names': 1, 'keywords': 1}, max_time_ms=MAX_TIME_MS))
    wallets = list(db['wallets'].find({'userId': uid, 'deletedAt': None}, {'name': 1, 'type': 1, 'aliases': 1}, max_time_ms=MAX_TIME_MS))
    thread = {'userId': uid, 'channel': state['channel'], 'threadKey': state['threadKey'], 'clearedAt': None,
              'requestId': {'$ne': state['requestId']}, 'answer': {'$ne': None}}
    recent = db['agentTurns'].find(thread, {'question': 1, 'answer': 1, 'skill': 1}, max_time_ms=MAX_TIME_MS).sort('createdAt', -1).limit(HISTORY)
    pending = None
    if state['trigger'] == 'confirm' and state['actionId']:
        pending = db['pendingActions'].find_one({'_id': state['actionId'], 'userId': uid}, {'status': 1, 'summary': 1}, max_time_ms=MAX_TIME_MS)
    return {'user': {'language': user.get('language', state['language']), 'assistantOn': user.get('assistantOn', True)},
            'categories': categories, 'wallets': wallets, 'history': list(recent)[::-1], 'pendingAction': pending}


def rewrite_question(state, deps):
    """The question as the rules read it: the period its words name (else this month, or the month the request names) and
    the user's own categories and wallets its words name. A bare 1-3 that answers this thread's ask-back is read as that
    option instead, unless the turn is a command (it names its skill, so its text is never a reply). Turning a follow-up
    into a full question comes with T50."""
    reply = None if state['skill'] else askback.read_reply(state, deps)
    if reply and reply['kind'] == 'run':
        return {'standalone': reply['question'], 'period': reply['period'], 'periodNamed': reply['named'], 'entities': reply['entities'],
                'skillCode': reply['skill'], 'retrieval': 'direct', 'reply': reply, 'count': count_in(reply['question'])}
    named = period_in(state['text'], state['today'])
    entities, ties = lexicon.link(find_period(words_of(state['text'])).rest, state['categories'], state['wallets'], state['language'])
    return {'standalone': state['text'], 'period': named or default_period(state['today'], state['month']), 'periodNamed': named is not None,
            'count': count_in(state['text']), 'entities': entities, 'ties': ties, 'reply': reply}


def recall_memory(state, deps):
    """Embeds the question once and reads the user's long-term memory rows close to it (cosine >= 0.6, at most 5, and their
    `lastUsedAt` is set). The vector stays in the state for find_skills. A command or an ask-back reply has no search, so
    it embeds nothing. If the embedder fails the rules still answer: find_skills then ranks by words alone."""
    if state['skill'] or state['reply'] or not state['standalone'] or deps.embedder is None:
        return {'memories': [], 'queryVector': None}
    try:
        vector = deps.embedder.encode([state['standalone']])[0]
    except Exception as exc:  # the class only: the message may hold the user's text
        log.error('request=%s node=recall_memory error=%s', state['turnId'], type(exc).__name__)
        return {'memories': [], 'queryVector': None}
    rows = deps.db['agentMemory'].find({'userId': state['userId']}, {'text': 1, 'embedding': 1}, max_time_ms=MAX_TIME_MS)  # at most 200 a user
    close = sorted(((cosine(vector, row['embedding']), row) for row in rows if row.get('embedding')), key=lambda pair: -pair[0])
    close = [(score, row) for score, row in close if score >= MEMORY_COSINE][:MEMORY_LIMIT]
    if close:
        deps.db['agentMemory'].update_many({'userId': state['userId'], '_id': {'$in': [row['_id'] for _, row in close]}}, {'$set': {'lastUsedAt': deps.now()}})
    return {'queryVector': vector, 'memories': [{'text': row['text'], 'score': round(score, 3)} for score, row in close]}


def find_skills(state, deps):
    """The hybrid search of routing.py over the enabled pipeline skills: the top 3 with scores, and `direct`, `choose` or `none`."""
    retrieval, candidates = routing.rank(state['standalone'] or '', state['entities'], pipeline_skills(deps), deps.vectors, state['queryVector'])
    return {'candidates': candidates, 'retrieval': retrieval, 'skillCode': candidates[0]['code'] if retrieval == 'direct' else None}


def add_months(month, shift):
    """'2026-11' + 1 → '2026-12', '2026-12' + 1 → '2027-01'."""
    year, number = divmod(int(month[:4]) * 12 + int(month[5:]) - 1 + shift, 12)
    return f'{year:04d}-{number + 1:02d}'


def plan_skill(skill, state, deps):
    """(plan, used, skipped, period): the skill's tool calls with the arguments each tool takes (its period and the unit period.py knows it by, the month,
    the count of a "top N", the linked categories and wallets), the linked entities some tool took, the conditions of the question no tool can use, in
    words (a linked entity, a named period, words that name two rows, a count over the limit: said in the answer, never dropped silently), and the period
    the answer is about (a month-only skill answers for a month, so a named week gives way to the month asked for, or this one)."""
    takes = [set(deps.registry.tools[tool.name].args.model_fields) for tool in skill.tools]
    uses = lambda argument: any(argument in fields for fields in takes)
    language, period, today = state['language'], state['period'], state['today']
    used = [entity for entity in state['entities'] if uses(ACCEPTS[entity['kind']])]
    skipped = [texts.entity_label(entity, language) for entity in state['entities'] if entity not in used]
    skipped += [texts.tie_label(tie['entities'], language) for tie in state['ties']]
    if state['periodNamed'] and not (uses('start') or (uses('month') and period.unit == 'month')):
        skipped.append(texts.describe(period, language))
        period = default_period(today, state['month']) if uses('month') else period
    if state['count'] and state['count'] > MAX_LIMIT and uses('limit'):
        skipped.append(texts.capped_count(state['count'], MAX_LIMIT, language))
    values = {'start': period.start.isoformat(), 'end': period.end.isoformat(), 'unit': unit_of(period), 'limit': state['count'],
              'month': f'{period.start:%Y-%m}' if period.unit == 'month' else f'{today:%Y-%m}'}  # a week or a day: the pace and the budgets are of today's month
    plan = []
    for tool, fields in zip(skill.tools, takes):
        args = {key: value for key, value in values.items() if key in fields and value is not None}
        if 'month' in args and tool.month_shift:
            args['month'] = add_months(args['month'], tool.month_shift)
        for kind, argument in ACCEPTS.items():
            ids = [entity['id'] for entity in used if entity['kind'] == kind]
            if argument in fields and ids:
                args[argument] = ids
        plan.append({'tool': tool.name, 'args': args, 'preset': tool.preset})
    return plan, used, skipped, period


def decide(state, deps):
    """A pipeline skill runs its tools in order with no model. The skill is the one find_skills chose, the one an ask-back
    reply picked, or the one the request names (a command, a scheduled message); one that is unknown, disabled or not a
    pipeline skill runs nothing. When several skills fit (`choose`) and no model may pick, the turn asks back (T63: the model picks).
    A question that names no period gets the skill's own: this week for the weekly report, else the month the request asks for or this one."""
    code = state['skillCode'] or state['skill']
    if state['retrieval'] == 'choose' and not code:
        card, ask = askback.build(state, deps)
        return {'card': card, 'askBack': ask, 'plan': []}
    skill = pipeline_skills(deps).get(code)
    if skill is None:
        return {'skillCode': None, 'retrieval': 'none', 'plan': []}
    if state['periodNamed']:
        period = state['period']
    elif skill.default_period == 'week':
        period = week_period(state['today'])
    else:
        period = state['period'] or default_period(state['today'], state['month'])
    plan, used, skipped, period = plan_skill(skill, {**state, 'period': period}, deps)
    return {'skillCode': skill.code, 'retrieval': 'direct', 'period': period, 'plan': plan, 'filters': used, 'skipped': skipped}


def act(state, deps):
    """Run the planned tools through the registry. A failed tool is a step with ok: false, never a crash. (A confirm has
    no tool to run: Express did the write before it called us.)"""
    context = ToolContext(user_id=state['userId'], today=state['today'], language=state['language'], deadline=state['deadline'], db=deps.db)
    calls, facts = [], []
    for step in state['plan']:
        result = deps.registry.call(step['tool'], step['args'], step['preset'], context)
        call = {'tool': step['tool'], 'args': result.args, 'ok': result.ok, 'ms': result.ms}
        if result.error:
            call['error'] = result.error
        calls.append(call)
        facts += result.facts
        extra = f' error={result.error}' if result.error else ''
        log.info('request=%s node=act ms=%d tool=%s%s', state['turnId'], result.ms, step['tool'], extra)
        if result.dropped:
            log.info('request=%s node=act tool=%s guard=dropped_args', state['turnId'], step['tool'])
    return {'toolCalls': calls, 'facts': facts if all(c['ok'] for c in calls) else []}


def generate_answer(state, deps):
    """The reply, from a template: the skill's for a skill that ran, the numbered question of an ask-back, a fixed line for
    everything else."""
    language, blocked, pending, reply = state['language'], state['blocked'], state['pendingAction'], state['reply']
    skill = deps.skills.get(state['skillCode'])
    if blocked == 'capped':
        return {'answer': texts.cap_line(CAPS[state['channel']], language), 'route': 'capped', 'facts': [], 'sources': []}
    if blocked == 'too_long':
        return {'answer': texts.too_long(language), 'facts': [], 'sources': []}
    if reply and reply['kind'] != 'run':  # a bare 1-3 whose ask-back ran out, or carries something that is gone
        line = texts.ask_back_expired(language) if reply['kind'] == 'expired' else texts.ask_back_gone(language)
        return {'answer': line, 'facts': [], 'sources': []}
    if state['trigger'] == 'confirm':
        done = (pending or {}).get('status') == 'done'
        return {'answer': texts.done(pending.get('summary'), language) if done else texts.expired(language), 'facts': [], 'sources': []}
    if state['card']:
        return {'answer': texts.ask_back(state['askBack']['question'], state['askBack']['options'], language), 'facts': [], 'sources': []}
    if skill and any(not call['ok'] for call in state['toolCalls']):
        return {'answer': texts.failed(language), 'facts': [], 'sources': []}
    if skill and state['facts']:
        template, period = skill.templates[language], state['period']
        facts = '\n'.join(f"- {fact['label']}: {fact['display']}" for fact in state['facts'])
        sources = [template['sources'].format(range=texts.span(period))]
        filters = ' · ' + ', '.join(entity['name'] for entity in state['filters']) if state['filters'] else ''
        answer = template['answer'].format(period=texts.describe(period, language), facts=facts, filter=filters)
        skipped = [texts.skipped(state['skipped'], language)] if state['skipped'] else []
        return {'answer': '\n'.join([answer, *skipped, f'{texts.SOURCE[language]}: {"; ".join(sources)}']), 'sources': sources}
    examples = [example for row in zip_longest(*(one.examples for one in pipeline_skills(deps).values())) for example in row if example]
    return {'answer': texts.help_text(examples, language), 'facts': [], 'sources': []}


def guard_output(state, deps):
    """Nothing the model wrote reaches the answer yet (templates only), so the guard has nothing to refuse. The model's
    text and its digit, verdict and id checks arrive with T63."""
    log.info('request=%s node=guard_output guard=pass', state['turnId'])
    return {'guard': 'pass'}


def suggest_followups(state, deps):
    skill = deps.skills.get(state['skillCode'])
    chips = [chip[state['language']] for chip in skill.followups] if skill and state['facts'] else []
    return {'followups': chips}


def save_turn(state, deps):
    """Complete the row that ingress inserted: the answer and everything that led to it."""
    done = {'standalone': state['standalone'], 'skill': state['skillCode'], 'retrieval': state['retrieval'], 'toolCalls': state['toolCalls'],
            'facts': state['facts'], 'sources': state['sources'], 'followups': state['followups'], 'card': state['card'],
            'askBack': state['askBack'], 'answer': state['answer'], 'route': state['route'], 'guard': state['guard'], 'steps': state['steps'], 'timingsMs': state['timingsMs']}
    deps.db['agentTurns'].update_one({'userId': state['userId'], 'requestId': state['requestId']}, {'$set': done})
    return {}


# ---- routing: pure functions of the state, one unit test each ----

def route_after_context(state):
    if state['blocked']:
        return 'generate_answer'
    if state['trigger'] == 'chat':
        return 'rewrite_question'
    if state['trigger'] == 'confirm':
        return 'act' if (state['pendingAction'] or {}).get('status') == 'done' else 'generate_answer'
    return 'decide'  # schedule and event name their skill


def route_after_recall(state):
    kind = (state.get('reply') or {}).get('kind')
    if kind in ('expired', 'invalid'):
        return 'generate_answer'  # the ask-back a bare 1-3 answers has run out or carries something that is gone
    return 'decide' if state['skill'] or kind == 'run' else 'find_skills'  # a command names its skill, an ask-back reply its option: no search


def route_after_search(state):
    return 'generate_answer' if state['retrieval'] == 'none' else 'decide'  # T63: none goes to hoi_tu_do when the model is on


def route_after_decide(state):
    return 'act' if state['plan'] else 'generate_answer'


NODES = [ingress, load_context, rewrite_question, recall_memory, find_skills, decide, act, generate_answer, guard_output, suggest_followups, save_turn]


def traced(fn, deps):
    """Wrap a node: record it in `steps`, time it, log one line (turn id, node, time). The node sees its own step, so
    save_turn stores the whole list; its own time cannot be known before the write, so the stored row shows 0 for it."""
    name = fn.__name__

    def run(state):
        started = time.perf_counter()
        seen = {**state, 'steps': [*state['steps'], name], 'timingsMs': [*state['timingsMs'], {'node': name, 'ms': 0}]}
        update = fn(seen, deps)
        ms = round((time.perf_counter() - started) * 1000)
        log.info('request=%s node=%s ms=%d', state['turnId'], name, ms)
        return {**update, 'steps': seen['steps'], 'timingsMs': [*state['timingsMs'], {'node': name, 'ms': ms}]}

    run.__name__ = name
    return run


def build_graph(deps):
    graph = StateGraph(TurnState)
    for fn in NODES:
        graph.add_node(fn.__name__, traced(fn, deps))
    graph.add_edge(START, 'ingress')
    graph.add_edge('ingress', 'load_context')
    graph.add_conditional_edges('load_context', route_after_context, ['rewrite_question', 'decide', 'act', 'generate_answer'])
    graph.add_edge('rewrite_question', 'recall_memory')
    graph.add_conditional_edges('recall_memory', route_after_recall, ['find_skills', 'decide', 'generate_answer'])
    graph.add_conditional_edges('find_skills', route_after_search, ['decide', 'generate_answer'])
    graph.add_conditional_edges('decide', route_after_decide, ['act', 'generate_answer'])
    graph.add_edge('act', 'generate_answer')
    graph.add_edge('generate_answer', 'guard_output')
    graph.add_edge('guard_output', 'suggest_followups')
    graph.add_edge('suggest_followups', 'save_turn')
    graph.add_edge('save_turn', END)
    return graph.compile()

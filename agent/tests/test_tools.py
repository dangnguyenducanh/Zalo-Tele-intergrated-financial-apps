# The tool registry (docs/04 §4.11 "Tool registry") and the first tool, get_period_summary (docs/02 §2.11.3).
import time
from datetime import date

from bson import ObjectId
from pydantic import BaseModel, ConfigDict
from pymongo import MongoClient, monitoring

from agent.tools.period import bounds, period_in
from agent.tools.registry import FORBIDDEN_ARGS, Limit, Tool, ToolContext, ToolRegistry
from agent.tools.scope import MAX_TIME_MS
from turn_helpers import make_user, seed_stats, vn_day_sums

USER = ObjectId()


class EchoArgs(BaseModel):
    model_config = ConfigDict(extra='forbid')
    text: str
    limit: Limit = 5


def context(**fields):
    return ToolContext(**({'user_id': USER, 'today': date(2026, 11, 25), 'language': 'vi', 'deadline': time.monotonic() + 30, 'db': None} | fields))


def echo_registry(seen, timeout_ms=1000, handler=None):
    def handle(ctx, args):
        seen.append((ctx, args))
        return {'echo': args.text, 'limit': args.limit}, []

    registry = ToolRegistry()
    registry.add(Tool(name='echo', description='returns its text', args=EchoArgs, handler=handler or handle, timeout_ms=timeout_ms))
    return registry


def test_forbidden_arguments_are_dropped_and_a_preset_always_wins():
    """TC-F14-39 userId, token and query from the model are dropped and reported, and a skill's preset beats the model's value"""
    assert FORBIDDEN_ARGS == {'userId', 'token', 'query'}
    seen = []
    registry = echo_registry(seen)
    ctx = context()
    result = registry.call('echo', {'text': 'from the model', 'userId': 'someone-else', 'token': 't', 'query': {'$ne': None}},
                           {'text': 'from the skill'}, ctx)
    assert result.ok and result.error is None
    assert result.dropped == ['query', 'token', 'userId']
    [(handler_ctx, args)] = seen
    assert args.text == 'from the skill'  # the preset won
    assert set(args.model_dump()) == {'text', 'limit'}  # nothing of what was dropped reached the handler
    assert handler_ctx.user_id == USER  # the only userId a handler sees is the one the request gave
    assert result.args == {'text': 'from the skill', 'limit': 5}  # what is stored in agentTurns.toolCalls: no userId in it


def test_an_extra_field_and_a_bad_value_are_refused_and_a_limit_is_clamped():
    """TC-F14-39 A field the tool does not declare is refused, limit 50 becomes 20, and limit 0 is refused"""
    seen = []
    registry = echo_registry(seen)
    ctx = context()
    refused = registry.call('echo', {'text': 'x', 'bogus': 1}, {}, ctx)
    assert (refused.ok, refused.error) == (False, 'INVALID_ARGS') and seen == []
    assert registry.call('echo', {'limit': 3}, {}, ctx).error == 'INVALID_ARGS'  # text is missing
    assert registry.call('echo', {'text': 'x', 'limit': 0}, {}, ctx).error == 'INVALID_ARGS'
    clamped = registry.call('echo', {'text': 'x', 'limit': 50}, {}, ctx)
    assert clamped.ok and clamped.data['limit'] == 20 and clamped.args['limit'] == 20
    assert registry.call('echo', {'text': 'x', 'limit': 20}, {}, ctx).data['limit'] == 20


def test_a_slow_a_failing_and_an_unknown_tool_is_a_failed_step_never_a_crash():
    """TC-F14-39 A tool that is too slow, raises, is unknown or is called after the deadline gives ok: false with an error class and no message"""
    def slow(ctx, args):
        time.sleep(0.6)
        return {}, []

    def broken(ctx, args):
        raise ValueError('cà phê 45k and the note the user typed')

    ctx = context()
    started = time.monotonic()
    late = echo_registry([], timeout_ms=50, handler=slow).call('echo', {'text': 'x'}, {}, ctx)
    assert (late.ok, late.error) == (False, 'TIMEOUT') and time.monotonic() - started < 0.5  # answered at the timeout, not after the sleep
    failed = echo_registry([], handler=broken).call('echo', {'text': 'x'}, {}, ctx)
    assert (failed.ok, failed.error) == (False, 'ValueError')  # the class, never the message: it may hold the user's text
    assert 'cà phê' not in repr(failed)
    assert echo_registry([]).call('nope', {}, {}, ctx).error == 'UNKNOWN_TOOL'
    seen = []
    expired = echo_registry(seen).call('echo', {'text': 'x'}, {}, context(deadline=time.monotonic() - 1))
    assert (expired.ok, expired.error) == (False, 'DEADLINE') and seen == []  # no time left: the handler is not even called


# ---- get_period_summary on a real mongod, as sochitieu_agent ----

class Spy(monitoring.CommandListener):
    def __init__(self):
        self.commands = []

    def started(self, event):
        self.commands.append((event.command_name, event.command))

    def succeeded(self, event):
        pass

    def failed(self, event):
        pass


def summary(agent_uri, db_name, user, period_text, today=date(2026, 11, 25), spy=None, language='vi'):
    from agent.tools import default_registry

    client = MongoClient(agent_uri, tz_aware=True, event_listeners=[spy] if spy else [])
    try:
        ctx = ToolContext(user_id=user, today=today, language=language, deadline=time.monotonic() + 30, db=client[db_name])
        period = period_in(period_text, today)
        return default_registry().call('get_period_summary', {'start': period.start.isoformat(), 'end': period.end.isoformat()}, {}, ctx)
    finally:
        client.close()


def test_the_summary_counts_only_this_users_confirmed_rows_and_nothing_deleted(mongo, world, agent_db):
    """TC-F14-40 get_period_summary adds the user's confirmed, not deleted rows of the days asked for, and no other user's, draft or deleted row"""
    a, b = make_user(world), make_user(world, email='b@example.com')
    seed_stats(world, a)
    seed_stats(world, b, scale=3)  # same days, other amounts
    november = summary(mongo.agent_uri, agent_db.name, a, 'tháng 11')
    # The fixture's own expected.summary: income 17,000,000, expense 1,100,000 (the draft, the deleted row and the rows of
    # 31/10 23:30 and 1/12 00:10 Vietnam time are not in it).
    assert november.ok and november.data == {'income': 17_000_000, 'expense': 1_100_000, 'net': 15_900_000}
    assert summary(mongo.agent_uri, agent_db.name, b, 'tháng 11').data == {'income': 51_000_000, 'expense': 3_300_000, 'net': 47_700_000}
    assert summary(mongo.agent_uri, agent_db.name, ObjectId(), 'tháng 11').data == {'income': 0, 'expense': 0, 'net': 0}  # nobody's: zero, not an error
    assert all(isinstance(value, int) for value in november.data.values())


def test_the_summary_follows_vietnam_midnight_at_every_edge(mongo, world, agent_db):
    """TC-F14-40 Rows at 23:59 and 00:00 Vietnam time fall on the right day, week and month, with the days summed from the raw fixture rows"""
    user = make_user(world)
    seed_stats(world, user)
    sums = vn_day_sums()
    for text, today in [('hôm nay', date(2026, 11, 19)), ('hôm nay', date(2026, 11, 20)), ('hôm qua', date(2026, 11, 20)),
                        ('hôm nay', date(2026, 11, 1)), ('hôm nay', date(2026, 11, 30)), ('hôm nay', date(2026, 12, 1)),
                        ('hôm qua', date(2026, 12, 1)), ('hôm nay', date(2026, 11, 21))]:
        period = period_in(text, today)
        want = vn_day_sums()[period.start.isoformat()] if period.start.isoformat() in sums else {'income': 0, 'expense': 0}
        got = summary(mongo.agent_uri, agent_db.name, user, text, today).data
        assert (got['income'], got['expense']) == (want['income'], want['expense']), (text, today)
    # Sunday 22/11 and Monday 23/11 are two different weeks; 30/11 23:59 and 1/12 00:10 two different months.
    assert summary(mongo.agent_uri, agent_db.name, user, 'tuần trước').data['expense'] == 50_000  # 16-22/11: 15,000 + 35,000
    assert summary(mongo.agent_uri, agent_db.name, user, 'tuần này').data['expense'] == 300_000  # 23-29/11: the 25th
    assert summary(mongo.agent_uri, agent_db.name, user, 'tháng 10').data == {'income': 15_000_000, 'expense': 0, 'net': 15_000_000}
    assert summary(mongo.agent_uri, agent_db.name, user, 'tháng 12 năm 2026').data == {'income': 0, 'expense': 80_000, 'net': -80_000}


def test_every_query_has_the_user_confirmed_not_deleted_and_a_time_limit(mongo, world, agent_db):
    """TC-F14-40 The aggregation starts with userId, status confirmed and deletedAt null, carries maxTimeMS 5000 and reads only transactions"""
    user = make_user(world)
    seed_stats(world, user)
    spy = Spy()
    summary(mongo.agent_uri, agent_db.name, user, 'tháng 11', spy=spy)
    reads = [(name, command) for name, command in spy.commands if name in ('aggregate', 'find', 'count')]
    assert len(reads) == 1
    name, command = reads[0]
    assert (name, command['aggregate']) == ('aggregate', 'transactions') and MAX_TIME_MS == 5000 == command['maxTimeMS']
    match = command['pipeline'][0]['$match']
    assert match['userId'] == user and match['status'] == 'confirmed' and match['deletedAt'] is None
    start, end = bounds(period_in('tháng 11', date(2026, 11, 25)))
    assert (match['occurredAt']['$gte'], match['occurredAt']['$lt']) == (start, end)
    assert start.tzinfo is not None  # aware datetimes, so no host time zone can shift a day


def test_the_facts_carry_a_label_and_the_text_money_shows_in_the_reply_language(mongo, world, agent_db):
    """TC-F14-40 Each figure is a fact { id, label, display } with display formatted as Express formats it, in vi and en"""
    user = make_user(world)
    seed_stats(world, user)
    vi = summary(mongo.agent_uri, agent_db.name, user, 'tháng 11', language='vi')
    assert [(f['id'], f['display']) for f in vi.facts] == [('expense', '1.100.000\xa0₫'), ('income', '17.000.000\xa0₫'), ('net', '15.900.000\xa0₫')]
    assert all(set(f) == {'id', 'label', 'display'} and f['label'] for f in vi.facts)
    en = summary(mongo.agent_uri, agent_db.name, user, 'tháng 11', language='en')
    assert [(f['id'], f['display']) for f in en.facts] == [('expense', '₫1,100,000'), ('income', '₫17,000,000'), ('net', '₫15,900,000')]
    assert [f['label'] for f in vi.facts] != [f['label'] for f in en.facts]

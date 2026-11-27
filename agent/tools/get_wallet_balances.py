# get_wallet_balances(walletIds?): the current balance of each of the user's wallets, as services/wallets.js works it out:
# the opening balance plus every confirmed income minus every confirmed expense, with no date limit (docs/02 §2.11.3).
from pydantic import BaseModel, ConfigDict, Field

from ..money import money
from .scope import MAX_TIME_MS, ObjectIdText, confirmed, own_ids

TOTAL = {'vi': 'Tổng', 'en': 'Total'}


class Args(BaseModel):
    model_config = ConfigDict(extra='forbid')
    walletIds: list[ObjectIdText] = Field(default_factory=list, max_length=20)  # none: every wallet that is not archived


def balances(ctx, args):
    """[(wallet row, balance)] in the order the web lists them. A wallet asked for by id is shown even if it is archived."""
    ids = own_ids(ctx, 'wallets', args.walletIds)
    match = {'userId': ctx.user_id, 'deletedAt': None} | ({'_id': {'$in': ids}} if ids else {'archived': {'$ne': True}})
    wallets = list(ctx.db['wallets'].find(match, {'name': 1, 'initialBalance': 1}, max_time_ms=MAX_TIME_MS).sort([('createdAt', 1), ('_id', 1)]))
    rows = ctx.db['transactions'].aggregate([
        {'$match': {**confirmed(ctx), 'walletId': {'$in': [wallet['_id'] for wallet in wallets]}}},
        {'$group': {'_id': '$walletId', 'net': {'$sum': {'$cond': [{'$eq': ['$type', 'income']}, '$amount', {'$multiply': ['$amount', -1]}]}}}}],
        maxTimeMS=MAX_TIME_MS)
    net = {row['_id']: round(row['net']) for row in rows}
    return [(wallet, round(wallet.get('initialBalance', 0)) + net.get(wallet['_id'], 0)) for wallet in wallets]


def handle(ctx, args):
    found = balances(ctx, args)
    facts = [{'id': str(wallet['_id']), 'label': wallet['name'], 'display': money(balance, ctx.language)} for wallet, balance in found]
    total = sum(balance for _, balance in found)
    if len(found) != 1:  # one wallet is its own total; none or several get one, so there is always something to say
        facts.append({'id': 'total', 'label': TOTAL.get(ctx.language, TOTAL['vi']), 'display': money(total, ctx.language)})
    return {'wallets': [{'walletId': str(wallet['_id']), 'balance': balance} for wallet, balance in found], 'total': total}, facts

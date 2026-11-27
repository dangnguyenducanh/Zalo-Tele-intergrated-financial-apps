# What every tool query has in common (docs/04 §4.11 "Tool registry"): the user from the request, confirmed rows only,
# soft-deleted rows out, and a time limit. A tool builds its filter from here, so none can forget a part of it.
from typing import Annotated

from bson import ObjectId
from pydantic import StringConstraints

MAX_TIME_MS = 5000
ObjectIdText = Annotated[str, StringConstraints(pattern=r'^[0-9a-f]{24}$')]  # an id the way a tool argument carries it


class NotYours(Exception):
    """An id in a tool's arguments is not one of this user's own, live rows. The step fails; nothing is read."""


def confirmed(ctx):
    """The base filter of a read on `transactions`. `deletedAt: None` also matches a row that has no such field."""
    return {'userId': ctx.user_id, 'status': 'confirmed', 'deletedAt': None}


def own_ids(ctx, collection, ids):
    """The ids as ObjectIds, once every one is a live row of this user in `collection` (categories or wallets)."""
    wanted = [ObjectId(one) for one in dict.fromkeys(ids)]  # no duplicates, the order given
    if wanted:
        found = ctx.db[collection].count_documents({'userId': ctx.user_id, 'deletedAt': None, '_id': {'$in': wanted}}, maxTimeMS=MAX_TIME_MS)
        if found != len(wanted):
            raise NotYours
    return wanted


def category_name(category, language):
    """The name the user sees: their own, else the default in their language (as services/stats.js byCategory names it)."""
    names = category.get('names') or {}
    return category.get('name') or names.get(language) or names.get('vi') or ''

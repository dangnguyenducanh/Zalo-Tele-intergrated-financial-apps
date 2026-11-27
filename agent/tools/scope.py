# What every tool query has in common (docs/04 §4.11 "Tool registry"): the user from the request, confirmed rows only,
# soft-deleted rows out, and a time limit. A tool builds its filter from here, so none can forget a part of it.
MAX_TIME_MS = 5000


def confirmed(ctx):
    """The base filter of a read on `transactions`. `deletedAt: None` also matches a row that has no such field."""
    return {'userId': ctx.user_id, 'status': 'confirmed', 'deletedAt': None}

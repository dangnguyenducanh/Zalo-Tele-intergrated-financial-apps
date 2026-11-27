# The tools of the agent service (docs/02 §2.11.3 "Tools"). `default_registry()` holds every tool that is built.
from . import get_category_totals, get_period_summary, get_wallet_balances
from .registry import Tool, ToolRegistry


def default_registry():
    registry = ToolRegistry()
    registry.add(Tool(
        name='get_period_summary', description='Income, expense and net of the confirmed transactions over a period (start, end: local days).',
        args=get_period_summary.Args, handler=get_period_summary.handle, collections=('transactions',)))
    registry.add(Tool(
        name='get_category_totals',
        description='Totals per category over a period (start, end: local days): the categories asked for, or the biggest ones of a type.',
        args=get_category_totals.Args, handler=get_category_totals.handle, collections=('transactions', 'categories')))
    registry.add(Tool(
        name='get_wallet_balances', description='The current balance of each wallet, or of the wallets asked for.',
        args=get_wallet_balances.Args, handler=get_wallet_balances.handle, collections=('wallets', 'transactions')))
    return registry

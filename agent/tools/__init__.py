# The tools of the agent service (docs/02 §2.11.3 "Tools"). `default_registry()` holds every tool that is built.
from . import compare_periods, get_budget_pace, get_budgets, get_category_totals, get_period_summary, get_wallet_balances, list_transactions, suggest_budgets
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
    registry.add(Tool(
        name='compare_periods', description='Income and expense of a period against the period one calendar unit before it (start, end: local days; categoryIds?).',
        args=compare_periods.Args, handler=compare_periods.handle, collections=('transactions', 'categories'), hidden=('unit',)))
    registry.add(Tool(
        name='list_transactions', description='The confirmed transactions over a period (start, end), newest or biggest first, at most 20 (type?, categoryIds?, walletIds?, order, limit).',
        args=list_transactions.Args, handler=list_transactions.handle, collections=('transactions', 'categories', 'wallets')))
    registry.add(Tool(
        name='get_budgets', description='The budgets of a month with what is spent and what is left (month: YYYY-MM; categoryIds?).',
        args=get_budgets.Args, handler=get_budgets.handle, collections=('budgets', 'transactions', 'categories')))
    registry.add(Tool(
        name='get_budget_pace', description='What is left to spend each day and the month-end projection for each budget of the current month (month: YYYY-MM; categoryIds?).',
        args=get_budget_pace.Args, handler=get_budget_pace.handle, collections=('budgets', 'transactions')))
    registry.add(Tool(
        name='suggest_budgets', description='A limit for each expense category of a month: the median of its totals over the 3 months before, rounded up to 50.000 ₫ (month: YYYY-MM).',
        args=suggest_budgets.Args, handler=suggest_budgets.handle, collections=('transactions', 'budgets', 'categories')))
    return registry

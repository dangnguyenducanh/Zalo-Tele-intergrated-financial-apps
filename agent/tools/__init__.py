# The tools of the agent service (docs/02 §2.11.3 "Tools"). `default_registry()` holds every tool that is built.
from . import get_period_summary
from .registry import Tool, ToolRegistry


def default_registry():
    registry = ToolRegistry()
    registry.add(Tool(
        name='get_period_summary', description='Income, expense and net of the confirmed transactions over a period (start, end: local days).',
        args=get_period_summary.Args, handler=get_period_summary.handle, collections=('transactions',)))
    return registry

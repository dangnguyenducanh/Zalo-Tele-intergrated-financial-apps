# JUnit test names must start with the case ID (tools/test-report matches on it, docs/07), and a Python function
# name cannot hold "TC-F10-23". So a test whose docstring starts with a case ID is reported under that line.
def pytest_itemcollected(item):
    first = (getattr(item, 'obj', None).__doc__ or '').strip().split('\n')[0]
    if first.startswith('TC-'):
        callspec = getattr(item, 'callspec', None)
        item._nodeid = f'{item.parent.nodeid}::{first}' + (f' [{callspec.id}]' if callspec else '')

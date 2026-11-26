# Not collected by a normal run (the name has no test_ prefix): test_hermetic.py runs it on purpose and reads the JUnit
# file it writes, to prove that the case ID of a docstring becomes the start of the test's JUnit name.
import pytest


def test_with_a_case_id():
    """TC-F14-90 A docstring that starts with a case ID names the JUnit test
    and the second line stays out of the name"""


@pytest.mark.parametrize('kind', ['one', 'two'])
def test_parametrized(kind):
    """TC-F14-91 Each parameter keeps its case ID, and says which one it is"""


def test_without_a_case_id():
    """A helper test with no case ID keeps its function name"""

"""Logging of errors WITHOUT personal data.

An exception can carry values of the data it was working on (psycopg2 writes "Failing row contains (...)" with the whole row, a
validation error can repeat an address, a traceback shows local lines). Nothing like that may reach the logs or a response: only the
TYPE of the error and the NAME of the function where it happened. Use these two functions everywhere; a test
(test_no_raw_errors_in_logs.py) fails when a file logs an error in the raw.
"""
import logging
import sys

_logger = logging.getLogger("thundbalance.errors")


def safe_error(error):
    """The only thing of an error that may be written anywhere: its type name ("UniqueViolation", "TimeoutError"...)."""
    return type(error).__name__ if error is not None else "unknown"


def log_error(error, op=None, logger=None, level=logging.ERROR):
    """Writes "op=<function> error=<type>". `op` is the name of the calling function unless given."""
    if op is None:
        try:
            op = sys._getframe(1).f_code.co_name
        except (AttributeError, ValueError):
            op = "unknown"
    (logger or _logger).log(level, "op=%s error=%s", op, safe_error(error))

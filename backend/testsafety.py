"""Safety net for the database tests: they insert and delete rows, so they must
never run against the real (production) database. If DATABASE_URL points
anywhere but this computer, the test is skipped instead of touching it."""
import os
import unittest
from urllib.parse import urlparse

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", ""}


def require_local_database():
    url = os.getenv("DATABASE_URL")
    if not url:
        return                      # database.py then uses the local development one
    host = (urlparse(url).hostname or "").lower()
    if host not in LOCAL_HOSTS:
        raise unittest.SkipTest(
            "DATABASE_URL points to a remote database; these tests write to the database "
            "and only run against a local one (unset DATABASE_URL to use localhost)."
        )

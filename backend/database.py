import os
import threading
import time
from contextlib import contextmanager

import psycopg2

DATABASE_URL = os.getenv("DATABASE_URL")

# A connection that cannot be opened in this many seconds fails with a clear
# error instead of leaving the request hanging.
CONNECT_TIMEOUT = 10


def _connect():
    if DATABASE_URL:
        return psycopg2.connect(DATABASE_URL, connect_timeout=CONNECT_TIMEOUT)

    return psycopg2.connect(
        host="localhost",
        database="thundbalance",
        user="postgres",
        password=os.getenv("DB_PASSWORD", "123456"),  # local development only
        connect_timeout=CONNECT_TIMEOUT,
    )


def get_connection():
    return _connect()


# ---------------------------------------------------------------------------
# Reusable connections for the hot, read-only endpoints (the times offered on
# a date). Opening a connection to a remote database costs about a second
# (TCP + TLS + login), several times the cost of the query itself, so a few
# idle connections are kept and handed out again. Everything that writes keeps
# using get_connection() above, exactly as before.
# ---------------------------------------------------------------------------
IDLE_MAX = 3
IDLE_SECONDS = 240   # older idle connections are dropped: the server may have closed them

_idle = []           # [(connection, last_used)]
_idle_lock = threading.Lock()


def _discard(connection):
    try:
        connection.close()
    except Exception:  # noqa: BLE001
        pass


def _drop_idle():
    with _idle_lock:
        items = list(_idle)
        _idle.clear()
    for connection, _ in items:
        _discard(connection)


@contextmanager
def read_connection(fresh=False):
    """Yields (connection, reused). The connection goes back to the pool when
    the block ends normally; after an error it is closed."""
    connection = None
    reused = False
    if not fresh:
        now = time.time()
        with _idle_lock:
            while _idle:
                candidate, used = _idle.pop()
                if candidate.closed or now - used > IDLE_SECONDS:
                    _discard(candidate)
                    continue
                connection, reused = candidate, True
                break
    if connection is None:
        connection = _connect()
    ok = False
    try:
        yield connection, reused
        ok = True
    finally:
        keep = False
        if ok and not connection.closed:
            try:
                connection.rollback()   # ends the read-only transaction
                with _idle_lock:
                    if len(_idle) < IDLE_MAX:
                        _idle.append((connection, time.time()))
                        keep = True
            except Exception:  # noqa: BLE001
                keep = False
        if not keep:
            _discard(connection)


def run_read(work, label=""):
    """work(cursor) -> value, on a reused connection. A stale pooled connection
    (closed by the server while idle) is replaced and the work runs once more;
    a query that exceeded its time limit is not repeated. Prints one timing
    line (no personal data) so slow requests can be seen in the logs."""
    last_error = None
    for attempt in range(2):
        started = time.perf_counter()
        try:
            with read_connection(fresh=attempt > 0) as (connection, reused):
                connected = time.perf_counter()
                cursor = connection.cursor()
                try:
                    value = work(cursor)
                finally:
                    cursor.close()
                done = time.perf_counter()
            print(
                f"timing db label={label or '-'} connection={'reused' if reused else 'new'} "
                f"connect={(connected - started) * 1000:.0f}ms query={(done - connected) * 1000:.0f}ms",
                flush=True,
            )
            return value
        except psycopg2.errors.QueryCanceled:
            raise
        except (psycopg2.OperationalError, psycopg2.InterfaceError) as error:
            last_error = error
            _drop_idle()
    raise last_error

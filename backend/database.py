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
        # keepalives: an idle socket is probed, so a connection the server dropped is noticed instead of hanging
        return psycopg2.connect(DATABASE_URL, connect_timeout=CONNECT_TIMEOUT, keepalives=1, keepalives_idle=30,
                                keepalives_interval=10, keepalives_count=3)

    return psycopg2.connect(
        host="localhost",
        database="thundbalance",
        user="postgres",
        password=os.getenv("DB_PASSWORD", "123456"),  # local development only
        connect_timeout=CONNECT_TIMEOUT,
    )


def get_connection():
    """A connection for the caller to use and close() as always. Opening one to a remote database costs about a second
    (TCP + TLS + login), and most requests open several, so close() hands the connection back to a small pool and the
    next call reuses it. See PooledConnection."""
    raw = _checkout()
    return PooledConnection(raw if raw is not None else _connect())


# ---------------------------------------------------------------------------
# Reusable connections for the hot, read-only endpoints (the times offered on
# a date). Opening a connection to a remote database costs about a second
# (TCP + TLS + login), several times the cost of the query itself, so a few
# idle connections are kept and handed out again. Everything that writes keeps
# using get_connection() above, exactly as before.
# ---------------------------------------------------------------------------
IDLE_MAX = 4
IDLE_SECONDS = 240   # older idle connections are dropped: the server may have closed them
CHECK_AFTER = 15     # a connection idle for longer than this is tested with SELECT 1 before it is handed out

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


def _checkout():
    """An idle connection that still works, or None. One idle for a while is tested first (a managed database closes
    quiet connections); a dead one is thrown away."""
    while True:
        with _idle_lock:
            if not _idle:
                return None
            candidate, used = _idle.pop()
        now = time.time()
        if candidate.closed or now - used > IDLE_SECONDS:
            _discard(candidate)
            continue
        if now - used > CHECK_AFTER:
            try:
                cursor = candidate.cursor()
                try:
                    cursor.execute("SELECT 1")
                finally:
                    cursor.close()
                candidate.rollback()
            except Exception:  # noqa: BLE001
                _discard(candidate)
                continue
        return candidate


def _release(connection):
    """Back to the pool (after ending whatever transaction was open), or closed when the pool is full or it is broken."""
    keep = False
    if not connection.closed:
        try:
            connection.rollback()
            with _idle_lock:
                if len(_idle) < IDLE_MAX:
                    _idle.append((connection, time.time()))
                    keep = True
        except Exception:  # noqa: BLE001
            keep = False
    if not keep:
        _discard(connection)


class PooledConnection:
    """What get_connection() returns. It behaves like the psycopg2 connection (cursor, commit, rollback, `with`...), but
    close() gives the connection back to the pool instead of closing it. Closing twice does nothing, and a connection
    that was handed back can not be used any more (it may already belong to somebody else)."""

    def __init__(self, raw):
        object.__setattr__(self, "_raw", raw)
        object.__setattr__(self, "_open", True)

    def __getattr__(self, name):
        if not object.__getattribute__(self, "_open"):
            raise psycopg2.InterfaceError("connection already closed")
        return getattr(object.__getattribute__(self, "_raw"), name)

    def __setattr__(self, name, value):
        setattr(object.__getattribute__(self, "_raw"), name, value)

    @property
    def closed(self):
        return (not object.__getattribute__(self, "_open")) or bool(object.__getattribute__(self, "_raw").closed)

    def close(self):
        if not object.__getattribute__(self, "_open"):
            return
        object.__setattr__(self, "_open", False)
        _release(object.__getattribute__(self, "_raw"))

    def __enter__(self):
        object.__getattribute__(self, "_raw").__enter__()
        return self

    def __exit__(self, *exc):
        return object.__getattribute__(self, "_raw").__exit__(*exc)


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

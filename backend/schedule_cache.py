"""Short-lived memory cache for the times offered on a date.

The times only change when a session or trial is created, approved or
cancelled, or a trainer's hours change, so a minute of memory removes most of
the database round trips. It is dropped completely by invalidate(), which
main.py calls after every successful write request, so a booking made through
the site is never hidden behind a stale entry. The booking itself validates
the slot again when it is saved, whatever this cache says.
"""
import os
import threading
import time

TTL_SECONDS = float(os.getenv("SCHEDULE_CACHE_SECONDS", "60"))
MAX_ENTRIES = 128

_store = {}            # key -> (expires_at, value)
_gates = {}            # key -> Lock (one computation per key at a time)
_lock = threading.Lock()
_generation = 0        # bumped by invalidate(): an older computation is not stored


def get_or_set(key, compute):
    """(value, from_cache). Concurrent requests for the same key share one
    computation."""
    with _lock:
        hit = _store.get(key)
        if hit and hit[0] > time.monotonic():
            return hit[1], True
        gate = _gates.setdefault(key, threading.Lock())
    with gate:
        with _lock:
            hit = _store.get(key)
            if hit and hit[0] > time.monotonic():
                return hit[1], True
            generation = _generation
        value = compute()
        with _lock:
            if generation == _generation and TTL_SECONDS > 0:
                _store[key] = (time.monotonic() + TTL_SECONDS, value)
                if len(_store) > MAX_ENTRIES:
                    now = time.monotonic()
                    for stale in [k for k, (expires, _) in _store.items() if expires <= now] or [next(iter(_store))]:
                        _store.pop(stale, None)
        return value, False


def invalidate():
    global _generation
    with _lock:
        _generation += 1
        _store.clear()

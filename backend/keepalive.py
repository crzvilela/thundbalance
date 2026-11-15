"""Keeps the server awake by itself (Render free plan): one thread that, every 10 minutes, asks for the server's OWN public /health.

A request that arrives through the public address counts as traffic for Render, so the service does not fall asleep after 15 minutes of
silence. It only starts when Render says where the service lives (RENDER_EXTERNAL_URL) and the environment is not development; KEEP_ALIVE=off
switches it off. Every error is swallowed and nothing is logged but the fact that it started. It cannot wake a service that is already asleep:
for that, see docs/RENDER_KEEP_AWAKE.md.
"""
import logging
import os
import threading
import time
import urllib.request

logger = logging.getLogger("thundbalance.keepalive")
INTERVAL_SECONDS = 600
TIMEOUT_SECONDS = 10
_lock = threading.Lock()
_started = False


def enabled(environ=None):
    env = os.environ if environ is None else environ
    if env.get("KEEP_ALIVE", "").strip().lower() in ("off", "false", "0", "no"):
        return False
    url = env.get("RENDER_EXTERNAL_URL", "").strip()
    if not url.startswith("https://"):
        return False
    mode = (env.get("ENVIRONMENT") or env.get("ENV") or "").strip().lower()
    return mode not in ("dev", "development", "local", "test")


def ping(url, opener=urllib.request.urlopen):
    """One request to /health; True when it answered. Never raises."""
    try:
        opener(urllib.request.Request(url.rstrip("/") + "/health", headers={"User-Agent": "thundbalance-keepalive"}), timeout=TIMEOUT_SECONDS).close()
        return True
    except Exception:  # noqa: BLE001
        return False


def start(environ=None, sleep=time.sleep, opener=urllib.request.urlopen, loop=True):
    """Starts the thread once (a second call does nothing). Returns True when it started."""
    global _started
    env = os.environ if environ is None else environ
    with _lock:
        if _started or not enabled(env):
            return False
        _started = True
    url = env.get("RENDER_EXTERNAL_URL", "").strip()

    def run():
        while True:
            sleep(INTERVAL_SECONDS)
            ping(url, opener)
            if not loop:
                return

    threading.Thread(target=run, name="keep-alive", daemon=True).start()
    logger.info("keep-alive started")
    return True


def reset():
    """(tests)"""
    global _started
    _started = False

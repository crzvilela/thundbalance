"""Anti-robot challenge (proof of work): self-hosted, no cookies, no third party, nothing about the visitor leaves the server.

How it works
  1. GET /challenge: the server picks a random number N (0..max) and answers {id, salt, challenge = SHA-256(salt + N), max, iat, exp, sig}.
     `sig` is an HMAC of the other fields with a secret key only the server knows, so a challenge cannot be forged or changed.
  2. The browser finds N by trying 0, 1, 2... (a few hundred milliseconds, in the background, while the person fills the form) and sends
     the whole challenge plus `number` in the field `challenge` of the form (base64 of a JSON).
  3. The server checks the signature, the expiry, that SHA-256(salt + number) is the challenge, and that the id was never used.
     The id is then stored until it expires: every solution works ONCE.

The public forms that create something (POST /trial-sessions, POST /contact-messages, and POST /users when the profile is new) ask for it
with `check_and_use()`. Login, password recovery and the direct Firebase registration do not go through this backend and are not touched.

The secret key: CHALLENGE_HMAC_KEY (or ALTCHA_HMAC_KEY) from the environment; if there is none, a strong random one is generated on the
first start and kept in the table app_secrets. It is never written to a log and no route returns it.

Difficulty: `max` is CHALLENGE_BASE_MAX (about 100 000 tries on average 50 000: a fraction of a second on a phone) and doubles for every
10 challenges the same IP asked for in 10 minutes (up to CHALLENGE_MAX_STEPS doublings); beyond CHALLENGE_HARD_LIMIT it answers 429.
"""
import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import threading
import time

from fastapi import HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool

import response_models
import web_safety
from database import get_connection

logger = logging.getLogger("thundbalance.challenge")

TTL_SECONDS = web_safety.env_int("CHALLENGE_TTL_SECONDS", 600)               # valid for 10 minutes (the page renews it silently before)
MIN_FILL_SECONDS = web_safety.env_int("CHALLENGE_MIN_FILL_SECONDS", 2, minimum=0)    # sent sooner than this after it was issued: wait and try again
BASE_MAX = web_safety.env_int("CHALLENGE_BASE_MAX", 100_000, minimum=10)
MAX_STEPS = web_safety.env_int("CHALLENGE_MAX_STEPS", 4, minimum=0)
STEP_EVERY = web_safety.env_int("CHALLENGE_STEP_EVERY", 10)
HARD_LIMIT = web_safety.env_int("CHALLENGE_HARD_LIMIT", 120)                  # challenges per IP in the window
WINDOW_SECONDS = web_safety.env_int("CHALLENGE_WINDOW_SECONDS", 600)

issue_limit = web_safety.SharedRateLimit("challenge", limit=10 ** 9, window_seconds=WINDOW_SECONDS)   # only used to count (hit)

_key = None
_key_lock = threading.Lock()
_memory_used = {}                       # id -> exp, when the database does not answer
_calls = 0


def _tests_switch_off():
    """CHALLENGE_ENFORCE=0 switches the check off for the test suite, and ONLY when the database is on this very computer: against a
    remote (production) database the variable is ignored, so a wrong setting can never open the forms to robots."""
    if os.getenv("CHALLENGE_ENFORCE", "").strip() != "0":
        return False
    from urllib.parse import urlparse
    url = os.getenv("DATABASE_URL")
    return not url or (urlparse(url).hostname or "").lower() in {"localhost", "127.0.0.1", "::1", ""}


_enforced = not _tests_switch_off()


# --------------------------------------------------------------------------------------------------------------------------- secret
def ensure_tables():
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("CREATE TABLE IF NOT EXISTS app_secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW())")
        cursor.execute("CREATE TABLE IF NOT EXISTS challenge_used (id TEXT PRIMARY KEY, exp BIGINT NOT NULL)")
        cursor.execute("CREATE INDEX IF NOT EXISTS challenge_used_exp ON challenge_used (exp)")
        cursor.execute("DELETE FROM challenge_used WHERE exp < %s", (int(time.time()) - 60,))
        conn.commit()
    finally:
        conn.close()


def secret_key():
    """The HMAC key as bytes: the environment first, else the one kept in app_secrets (created on first use, race-free)."""
    global _key
    if _key:
        return _key
    with _key_lock:
        if _key:
            return _key
        configured = (os.getenv("CHALLENGE_HMAC_KEY") or os.getenv("ALTCHA_HMAC_KEY") or "").strip()
        if len(configured) >= 16:
            _key = configured.encode()
            return _key
        try:
            ensure_tables()
            conn = get_connection()
            try:
                cursor = conn.cursor()
                cursor.execute("INSERT INTO app_secrets (name, value) VALUES ('challenge_hmac_key', %s) ON CONFLICT (name) DO NOTHING", (secrets.token_hex(32),))
                cursor.execute("SELECT value FROM app_secrets WHERE name = 'challenge_hmac_key'")
                _key = cursor.fetchone()[0].encode()
                conn.commit()
            finally:
                conn.close()
        except Exception as error:  # noqa: BLE001
            # without a database the key lives in memory: challenges then only work inside this process (it is a refusal, never a hole)
            logger.warning("challenge key kept in memory: %s", type(error).__name__)
            _key = secrets.token_hex(32).encode()
        return _key


def _sign(parts):
    return hmac.new(secret_key(), ".".join(str(part) for part in parts).encode(), hashlib.sha256).hexdigest()


# --------------------------------------------------------------------------------------------------------------------------- issue
def difficulty(count):
    """`max` for the count-th challenge this IP asked for in the window: it doubles for every STEP_EVERY of them."""
    return BASE_MAX * (2 ** min(MAX_STEPS, max(0, (count - 1) // STEP_EVERY)))


def issue(count=1, now=None):
    now = int(now if now is not None else time.time())
    maximum = difficulty(count)
    challenge_id = secrets.token_hex(12)
    salt = secrets.token_hex(12)
    number = secrets.randbelow(maximum + 1)
    answer = hashlib.sha256(f"{salt}{number}".encode()).hexdigest()
    exp = now + TTL_SECONDS
    return {"id": challenge_id, "salt": salt, "challenge": answer, "max": maximum, "iat": now, "exp": exp,
            "sig": _sign((challenge_id, salt, answer, maximum, now, exp)), "algorithm": "SHA-256"}


# --------------------------------------------------------------------------------------------------------------------------- verify
def failed(reason):
    """400 with the stable code the site recognises. `reason` only says what to do next (the site asks for a new challenge)."""
    return HTTPException(status_code=400, detail={"code": "challenge_failed", "reason": reason,
                                                   "message": "Verification failed. Please try again. / La verificación ha fallado. Inténtalo de nuevo."})


def _decode(payload):
    if isinstance(payload, dict):
        data = payload
    else:
        try:
            raw = str(payload or "")
            if len(raw) > 2000:
                return None
            data = json.loads(base64.b64decode(raw + "=" * (-len(raw) % 4), altchars=b"-_", validate=False))
        except Exception:  # noqa: BLE001
            return None
    return data if isinstance(data, dict) else None


def verify(payload, now=None):
    """Checks signature, expiry and solution WITHOUT using it up. Returns the challenge's data, or raises challenge_failed."""
    now = int(now if now is not None else time.time())
    data = _decode(payload)
    if not data:
        raise failed("missing")
    try:
        challenge_id, salt, answer = str(data["id"]), str(data["salt"]), str(data["challenge"])
        maximum, iat, exp, number = int(data["max"]), int(data["iat"]), int(data["exp"]), int(data["number"])
        signature = str(data["sig"])
    except (KeyError, TypeError, ValueError):
        raise failed("invalid") from None
    if not hmac.compare_digest(_sign((challenge_id, salt, answer, maximum, iat, exp)), signature):
        raise failed("invalid")
    if exp < now:
        raise failed("expired")
    if not 0 <= number <= maximum or not hmac.compare_digest(hashlib.sha256(f"{salt}{number}".encode()).hexdigest(), answer):
        raise failed("invalid")
    if now - iat < MIN_FILL_SECONDS:
        raise failed("too_fast")                    # nobody fills a form in under two seconds: the same solution is good a moment later
    return {"id": challenge_id, "exp": exp}


def _use(challenge_id, exp):
    """True the first time an id is seen, False after (atomic: the primary key decides)."""
    global _calls
    _calls += 1
    try:
        conn = get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("INSERT INTO challenge_used (id, exp) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING", (challenge_id, exp))
            first = cursor.rowcount == 1
            if _calls % 25 == 0:                                       # periodic clean-up of what can no longer be used anyway
                cursor.execute("DELETE FROM challenge_used WHERE exp < %s", (int(time.time()) - 60,))
            conn.commit()
            return first
        finally:
            conn.close()
    except Exception as error:  # noqa: BLE001
        logger.warning("challenge ids kept in memory: %s", type(error).__name__)
        with _key_lock:
            for stale in [name for name, until in _memory_used.items() if until < time.time()]:
                _memory_used.pop(stale, None)
            if challenge_id in _memory_used:
                return False
            _memory_used[challenge_id] = exp
            return True


def check_and_use(payload, now=None):
    """The one call the forms make: valid, not expired, not used before -> it is used up. Otherwise 400 challenge_failed."""
    if not _enforced:
        return
    found = verify(payload, now)
    if not _use(found["id"], found["exp"]):
        raise failed("used")


# --------------------------------------------------------------------------------------------------------------------------- routes
def register_challenge_routes(app):
    @app.on_event("startup")
    def _startup():
        ensure_tables()
        secret_key()

    @app.get("/challenge", response_model=response_models.ChallengeOut)
    async def new_challenge(request: Request, response: Response):
        ip = web_safety.get_client_ip(request)
        count = await run_in_threadpool(issue_limit.hit, ip)
        if count > HARD_LIMIT:
            raise HTTPException(status_code=429, detail="Too many requests. Please try again later.", headers={"Retry-After": str(WINDOW_SECONDS)})
        response.headers["Cache-Control"] = "no-store"
        return await run_in_threadpool(issue, count)

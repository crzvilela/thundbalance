"""Our own error monitoring: no external service, no account, no personal data.

WHAT IS KEPT (table `app_errors`, ONE row per kind of error, repeated occurrences only raise `count` and `last_seen`):
  where it came from (backend | frontend), the TYPE of the error, the function, the file and the line, the PATTERN of the route
  ("/admin/clients/{client_id}", never the address with ids or tokens), the answer code, the release of the site, a short message
  that went through `scrub` (e-mails, long tokens, phone numbers, "Failing row contains (...)", addresses and query strings removed).
WHAT IS NEVER KEPT: bodies, headers, tokens, e-mails, names, phones, query strings, values of variables, stack traces.

SAFETY: recording happens OFF the request path (one background worker), every failure of the monitoring is swallowed, and the
site works exactly the same if the monitoring is broken. Expected noise (401 403 404 422 429, the client going away) is ignored.

LIMITS: 500 distinct kinds of error at most (the oldest RESOLVED go first; when none can go, new ones are ignored in silence) and
resolved ones are deleted after 30 days (the daily job of data_retention.py).

ALERTS (e-mail to the team, TEAM_NOTIFICATION_EMAILS, Spanish, only error types, places and counts; MONITOR_EMAILS=off switches them off):
  * at most ONE daily summary, only with the kinds of error that are new since the last one (nothing new = no e-mail);
  * an immediate alert only for a SPIKE: more than 20 answers 5xx in 10 minutes, at most one every 6 hours.
"""
import hashlib
import logging
import os
import re
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor

from database import get_connection

logger = logging.getLogger("thundbalance.monitor")

MAX_FINGERPRINTS = 500
RESOLVED_DAYS = 30
SPIKE_LIMIT = 20
SPIKE_WINDOW_SECONDS = 600
SPIKE_GAP_SECONDS = 6 * 3600
IGNORED_STATUS = {401, 403, 404, 422, 429}
IGNORED_TYPES = {"CancelledError", "ClientDisconnect", "ConnectionResetError", "BrokenPipeError", "ConnectionAbortedError"}
STATUSES = ("new", "seen", "resolved")
LAST_DIGEST_KEY = "monitor_last_digest"
LAST_SPIKE_KEY = "monitor_last_spike"

_worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="monitor")
_spikes = deque()
_spike_lock = threading.Lock()
_last_spike_alert = 0.0
_ready = False


# ------------------------------------------------------------------------------------------------------------------ cleaning
_EMAIL = re.compile(r"[\w.+'-]+@[\w-]+(?:\.[\w-]+)+")
_JWT = re.compile(r"eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*")
_URL = re.compile(r"https?://[^\s\"')>]+")
_ROW = re.compile(r"Failing row contains \(.*?\)", re.S)
_DETAIL = re.compile(r"(DETAIL|Key)\s*[:(].*", re.S)
_PHONE = re.compile(r"(?<![\w.])\+?\d[\d\s().-]{7,}\d(?![\w])")
_TOKEN = re.compile(r"\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{24,}\b|\b[A-Za-z0-9_-]{40,}\b")
_NUMBER_IN_QUOTES = re.compile(r"'[^']{1,80}'")


def scrub(text, limit=200):
    """A message that is safe to keep: no e-mail, token, phone number, address, query string, row of the database or quoted value."""
    value = str(text or "")
    value = _ROW.sub("Failing row contains (...)", value)
    value = _DETAIL.sub(r"\1: ...", value)
    value = _JWT.sub("<token>", value)
    value = _EMAIL.sub("<email>", value)
    value = _URL.sub("<url>", value)
    value = _PHONE.sub("<phone>", value)
    value = _TOKEN.sub("<token>", value)
    value = _NUMBER_IN_QUOTES.sub("'<value>'", value)
    value = " ".join(value.split())
    return value[:limit]


def fingerprint(source, error_type, where, line, route, message=""):
    raw = "|".join(str(part) for part in (source, error_type, where, line, route, message))
    return hashlib.sha1(raw.encode("utf-8", "ignore")).hexdigest()


def release():
    """The version of the site that is running (the first characters of the commit Render builds from)."""
    return (os.getenv("RENDER_GIT_COMMIT") or os.getenv("RELEASE") or "dev")[:12]


# ----------------------------------------------------------------------------------------------------------------- the table
def ensure_schema():
    """Idempotent."""
    global _ready
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS app_errors (
                id SERIAL PRIMARY KEY,
                fingerprint TEXT UNIQUE NOT NULL,
                source TEXT NOT NULL,
                error_type TEXT NOT NULL,
                function TEXT,
                file TEXT,
                line INTEGER,
                route_pattern TEXT,
                status_code INTEGER,
                release TEXT,
                message TEXT,
                count INTEGER NOT NULL DEFAULT 1,
                first_seen TIMESTAMP NOT NULL DEFAULT NOW(),
                last_seen TIMESTAMP NOT NULL DEFAULT NOW(),
                status TEXT NOT NULL DEFAULT 'new'
            )
            """
        )
        cursor.execute("CREATE INDEX IF NOT EXISTS app_errors_last_seen_idx ON app_errors (last_seen)")
        cursor.execute("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        conn.commit()
        _ready = True
    finally:
        cursor.close()
        conn.close()


def _store(event):
    """Writes one event (runs in the background worker). Never raises."""
    try:
        if not _ready:
            ensure_schema()
        conn = get_connection()
        cursor = conn.cursor()
        try:
            print_key = fingerprint(event["source"], event["error_type"], event.get("file") or event.get("message") or "", event.get("line") or 0, event.get("route_pattern") or "", event.get("message") if event["source"] == "frontend" else "")
            cursor.execute(
                "UPDATE app_errors SET count = count + 1, last_seen = NOW(), status = CASE WHEN status = 'resolved' THEN 'new' ELSE status END "
                "WHERE fingerprint = %s RETURNING id", (print_key,))
            if cursor.fetchone() is None:
                cursor.execute("SELECT COUNT(*) FROM app_errors")
                if cursor.fetchone()[0] >= MAX_FINGERPRINTS:
                    cursor.execute("DELETE FROM app_errors WHERE id = (SELECT id FROM app_errors WHERE status = 'resolved' ORDER BY last_seen LIMIT 1) RETURNING id")
                    if cursor.fetchone() is None:
                        conn.rollback()
                        return                                          # full of unresolved kinds: new ones are ignored in silence
                cursor.execute(
                    "INSERT INTO app_errors (fingerprint, source, error_type, function, file, line, route_pattern, status_code, release, message) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT (fingerprint) DO UPDATE SET count = app_errors.count + 1, last_seen = NOW()",
                    (print_key, event["source"], event["error_type"][:80], (event.get("function") or "")[:120], (event.get("file") or "")[:120],
                     event.get("line") or 0, (event.get("route_pattern") or "")[:120], event.get("status_code"), (event.get("release") or release())[:40],
                     scrub(event.get("message"), 200)))
            conn.commit()
        finally:
            cursor.close()
            conn.close()
    except Exception as error:  # noqa: BLE001 - the monitoring must never cause a problem
        logger.warning("op=store error=%s", type(error).__name__)


def record(event):
    """Queues an event. Returns at once and never raises."""
    try:
        event = {**event, "message": scrub(event.get("message"), 200)}              # cleaned BEFORE it is used for anything
        _worker.submit(_store, event)
    except Exception:  # noqa: BLE001
        pass


# ----------------------------------------------------------------------------------------------------------- from the backend
def _where(exc):
    """(function, file, line) of the innermost frame that belongs to this project."""
    here = os.path.dirname(os.path.abspath(__file__))
    tb, found = exc.__traceback__, (None, None, None)
    while tb is not None:
        code = tb.tb_frame.f_code
        path = os.path.abspath(code.co_filename)
        if path.startswith(here) and os.sep + "test_" not in path:
            found = (code.co_name, os.path.relpath(path, here).replace(os.sep, "/"), tb.tb_lineno)
        tb = tb.tb_next
    return found


def route_pattern(request):
    try:
        route = request.scope.get("route")
        return getattr(route, "path", None) or "unmatched"
    except Exception:  # noqa: BLE001
        return "unmatched"


def record_exception(request, exc, status_code=500):
    """Called by the global handler. Never raises, never blocks."""
    try:
        error_type = type(exc).__name__
        if error_type in IGNORED_TYPES or status_code in IGNORED_STATUS:
            return
        function, file, line = _where(exc)
        record({"source": "backend", "error_type": error_type, "function": function, "file": file, "line": line,
                "route_pattern": f"{request.method} {route_pattern(request)}", "status_code": status_code, "release": release(), "message": ""})
        if status_code >= 500:
            note_5xx()
    except Exception:  # noqa: BLE001
        pass


def record_http_error(request, status_code, error_type="HTTPException"):
    """A 5xx answered on purpose (502, 503...): recorded without any traceback."""
    try:
        if status_code < 500:
            return
        record({"source": "backend", "error_type": error_type, "function": "", "file": "", "line": 0,
                "route_pattern": f"{request.method} {route_pattern(request)}", "status_code": status_code, "release": release(), "message": f"HTTP {status_code}"})
        note_5xx()
    except Exception:  # noqa: BLE001
        pass


# ----------------------------------------------------------------------------------------------------------------- the alerts
def monitor_emails_on():
    return os.getenv("MONITOR_EMAILS", "").strip().lower() not in ("off", "false", "0", "no")


def note_5xx(now=None):
    """Counts an answer 5xx; the immediate alert only for a spike. Never raises."""
    global _last_spike_alert
    try:
        moment = time.time() if now is None else now
        with _spike_lock:
            _spikes.append(moment)
            while _spikes and moment - _spikes[0] > SPIKE_WINDOW_SECONDS:
                _spikes.popleft()
            spike = len(_spikes) > SPIKE_LIMIT and moment - _last_spike_alert >= SPIKE_GAP_SECONDS
            count = len(_spikes)
            if spike:
                _last_spike_alert = moment
        if spike and monitor_emails_on():
            _worker.submit(_send_spike, count)
        return spike
    except Exception:  # noqa: BLE001
        return False


def reset_spikes():
    """(tests)"""
    global _last_spike_alert
    with _spike_lock:
        _spikes.clear()
        _last_spike_alert = 0.0


def _send(subject_html):
    from emails import team_emails
    from emails.transport import send_email
    subject, html, text = subject_html
    send_email(team_emails(), subject, html, text, kind="monitor", lang="es")


def _send_spike(count):
    try:
        from emails.monitor_emails import spike_email
        _send(spike_email(count, SPIKE_WINDOW_SECONDS // 60, top_errors(5)))
    except Exception as error:  # noqa: BLE001
        logger.warning("op=spike_email error=%s", type(error).__name__)


def top_errors(limit=5):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT source, error_type, file, line, route_pattern, count FROM app_errors WHERE last_seen > NOW() - INTERVAL '1 hour' ORDER BY count DESC LIMIT %s", (limit,))
        return [{"source": r[0], "error_type": r[1], "where": f"{r[2] or ''}:{r[3]}" if r[2] else (r[4] or ""), "route": r[4], "count": r[5]} for r in cursor.fetchall()]
    finally:
        cursor.close()
        conn.close()


def daily_summary(now=None):
    """Sends the daily summary of the kinds of error that are NEW since the last one. Returns the number of kinds reported (0 = nothing sent)."""
    if not _ready:
        ensure_schema()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT value FROM app_settings WHERE key = %s", (LAST_DIGEST_KEY,))
        row = cursor.fetchone()
        since = row[0] if row else None
        if since:
            cursor.execute("SELECT source, error_type, file, line, route_pattern, count FROM app_errors WHERE first_seen > %s::timestamp ORDER BY count DESC LIMIT 50", (since,))
        else:
            cursor.execute("SELECT source, error_type, file, line, route_pattern, count FROM app_errors WHERE first_seen > NOW() - INTERVAL '1 day' ORDER BY count DESC LIMIT 50")
        items = [{"source": r[0], "error_type": r[1], "where": f"{r[2]}:{r[3]}" if r[2] else (r[4] or ""), "route": r[4], "count": r[5]} for r in cursor.fetchall()]
        cursor.execute("INSERT INTO app_settings (key, value) VALUES (%s, NOW()::text) ON CONFLICT (key) DO UPDATE SET value = NOW()::text", (LAST_DIGEST_KEY,))
        conn.commit()
    finally:
        cursor.close()
        conn.close()
    if items and monitor_emails_on():
        from emails.monitor_emails import digest_email
        _send(digest_email(items))
    return len(items) if monitor_emails_on() else 0


def cleanup():
    """Daily: resolved errors older than 30 days are deleted; above the cap the oldest resolved ones go. Returns the number deleted."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM app_errors WHERE status = 'resolved' AND last_seen < NOW() - make_interval(days => %s)", (RESOLVED_DAYS,))
        removed = cursor.rowcount
        cursor.execute("DELETE FROM app_errors WHERE id IN (SELECT id FROM app_errors WHERE status = 'resolved' ORDER BY last_seen "
                       "LIMIT GREATEST((SELECT COUNT(*) FROM app_errors) - %s, 0))", (MAX_FINGERPRINTS,))
        removed += cursor.rowcount
        conn.commit()
        return removed
    finally:
        cursor.close()
        conn.close()


def run_daily():
    """Part of the daily job (data_retention.py). Never raises."""
    try:
        ensure_schema()
        return {"errors_removed": cleanup(), "reported": daily_summary()}
    except Exception as error:  # noqa: BLE001
        logger.warning("op=monitor_daily error=%s", type(error).__name__)
        return {"errors_removed": 0, "reported": 0}

"""GET /admin/overview/today: everything the admin's "Hoy" screen needs, in ONE light request (docs/ADMIN_UI_SETTINGS.md, "Overview").

Admin only. It reuses what already exists instead of duplicating it: the message counter (contact_messages.counts), the legal status
(legal.get_admin), the email check (emails.health.check_ready, the same one behind the warning of the trial sessions), the error summary
of "Estado del sistema" (app_errors) and the pack rule of the client list (pack_view.ACTIVE_PACK_CONDITION, EXPIRING_DAYS).

* Dates and the day of "today" are Europe/Madrid (emails.dates.to_madrid), never the server's zone.
* A short cache in memory (CACHE_SECONDS) keeps a reload from hitting the database every time. The email check calls the Google
  script, so it has its own, longer cache and a short timeout.
* One part failing never takes the page down: that part is null (the panel shows "unknown") and only the part's name and the
  exception type are logged. No client data is ever logged.
"""
import logging
import threading
import time
from datetime import datetime, timedelta, timezone

import contact_messages
import legal
import monitoring
import pack_view
from database import get_connection
from emails import health as email_health
from emails.dates import to_madrid
from fastapi import Depends

logger = logging.getLogger("thundbalance.overview")

CACHE_SECONDS = 12            # the whole answer
EMAIL_CACHE_SECONDS = 60      # the email check asks Google: not on every reload
EMAIL_TIMEOUT = 5             # seconds
MAX_SESSIONS = 30
EXPIRING_DAYS = 7
LIVE_TRIAL_STATUSES = ("pending", "approved", "confirmed")

_lock = threading.Lock()
_cache = {"at": 0.0, "value": None}
_email = {"at": 0.0, "value": None}


def clear_cache():
    with _lock:
        _cache.update(at=0.0, value=None)
        _email.update(at=0.0, value=None)


def madrid_today():
    """Today's date in Madrid."""
    return to_madrid(datetime.now(timezone.utc)).date()


def _safe(name, read, default=None):
    try:
        return read()
    except Exception as error:  # noqa: BLE001 - one broken part must not blank the whole screen
        logger.warning("overview part %s failed: %s", name, type(error).__name__)
        return default


def _with_cursor(read):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        value = read(cursor)
        conn.commit()
        return value
    finally:
        cursor.close()
        conn.close()


def _today_sessions(today):
    """Today's booked sessions plus the trial sessions that are alive (pending / approved / confirmed), by time."""
    def read(cursor):
        cursor.execute(
            """
            SELECT s.id, s.session_time, u.nome, t.nome, s.status
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            LEFT JOIN trainers t ON t.id = s.trainer_id
            WHERE s.session_date = %s AND s.status <> 'Cancelled'
            """,
            (today,),
        )
        items = [{"id": f"s{row[0]}", "kind": "session", "time": str(row[1] or "")[:5], "client": row[2] or "", "trainer": row[3] or "", "status": str(row[4] or "").lower()}
                 for row in cursor.fetchall()]
        cursor.execute(
            """
            SELECT ts.id, ts.session_time, ts.full_name, t.nome, ts.status, ts.confirmation_token
            FROM trial_sessions ts
            LEFT JOIN trainers t ON t.id = ts.trainer_id
            WHERE ts.session_date = %s
            """,
            (today,),
        )
        for row in cursor.fetchall():
            status = str(row[4] or "pending").lower()
            if status == "approved" and not row[5]:
                status = "confirmed"                      # approved before the confirmation flow (trial_confirmation.panel_status)
            if status in LIVE_TRIAL_STATUSES:
                items.append({"id": f"t{row[0]}", "kind": "trial", "time": str(row[1] or "")[:5], "client": row[2] or "", "trainer": row[3] or "", "status": status})
        items.sort(key=lambda item: (item["time"] or "99:99", item["id"]))
        return items
    return _with_cursor(read)


def _counts(today):
    def read(cursor):
        cursor.execute("SELECT COUNT(*) FROM client_requests WHERE LOWER(status) = 'pending' AND archived_at IS NULL")
        requests = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM trial_sessions WHERE LOWER(status) = 'pending'")
        trials = cursor.fetchone()[0]
        return requests, trials
    return _with_cursor(read)


def _deletions():
    def read(cursor):
        # the same rule as the list: a request of an account that no longer exists does not wait for an answer
        cursor.execute("SELECT COUNT(*) FROM deletion_requests d WHERE d.status = 'pending' AND EXISTS (SELECT 1 FROM users u WHERE u.id = d.user_id)")
        return cursor.fetchone()[0]
    return _with_cursor(read)


def _expiring_packs(today):
    """Clients whose latest active pack ends within the next EXPIRING_DAYS days (today included): the "expiring" of the client list."""
    def read(cursor):
        cursor.execute(
            f"""
            SELECT COUNT(*) FROM (
                SELECT MAX(up.end_date) AS end_date
                FROM user_plans up JOIN users u ON u.id = up.user_id
                WHERE u.archived_at IS NULL AND {pack_view.ACTIVE_PACK_CONDITION}
                GROUP BY up.user_id
            ) packs
            WHERE end_date >= %s AND end_date <= %s
            """,
            (today, today + timedelta(days=EXPIRING_DAYS)),
        )
        return cursor.fetchone()[0]
    return _with_cursor(read)


def _new_errors():
    def read(cursor):
        monitoring.ensure_schema()
        cursor.execute("SELECT COUNT(*) FROM app_errors WHERE status = 'new' AND last_seen > NOW() - INTERVAL '24 hours'")
        return cursor.fetchone()[0]
    return _with_cursor(read)


def _email_status():
    """{"ready": bool, "reason": str}: the same check as the warning of the trial sessions, cached for a minute."""
    with _lock:
        if _email["value"] is not None and time.monotonic() - _email["at"] < EMAIL_CACHE_SECONDS:
            return _email["value"]
    answer = email_health.check_ready(timeout=EMAIL_TIMEOUT)
    value = {"ready": bool(answer.get("email_ready")), "reason": "" if answer.get("email_ready") else str(answer.get("reason") or "")}
    with _lock:
        _email.update(at=time.monotonic(), value=value)
    return value


def build_today():
    today = madrid_today()
    sessions = _safe("sessions", lambda: _today_sessions(today))
    counts = _safe("counts", lambda: _counts(today))
    unread = _safe("messages", lambda: contact_messages.counts()["unread"])
    legal_view = _safe("legal", legal.get_admin)
    return {
        "date": today.isoformat(),
        "sessions_today": None if sessions is None else {"total": len(sessions), "items": sessions[:MAX_SESSIONS]},
        "pending_requests": None if counts is None else counts[0],
        "pending_trials": None if counts is None else counts[1],
        "unread_messages": unread,
        "pending_deletions": _safe("deletions", _deletions),
        "expiring_packs": _safe("packs", lambda: _expiring_packs(today)),
        "email": _safe("email", _email_status),
        "new_errors": _safe("errors", _new_errors),
        "legal_needs_attention": None if legal_view is None else bool(legal_view.get("needs_attention")),
    }


def today_overview():
    with _lock:
        if _cache["value"] is not None and time.monotonic() - _cache["at"] < CACHE_SECONDS:
            return _cache["value"]
    value = build_today()
    with _lock:
        _cache.update(at=time.monotonic(), value=value)
    return value


def register_overview_routes(app, require_admin):
    @app.get("/admin/overview/today", dependencies=[Depends(require_admin)])
    def admin_overview_today():
        return today_overview()

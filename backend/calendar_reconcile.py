"""A session deleted in Google Calendar is cancelled in the web (docs/GOOGLE_DELETE_SYNC.md).

The web stays the source of truth for everything else; this is the one thing Google can tell it: "that event is gone".

WHAT IT CHECKS: the future sessions of packs (Booked) and trial sessions (pending / approved / confirmed) that have a
google_event_id. ONE listing of the whole date range (showDeleted=true) answers for almost all of them; an event that is not in
the listing is looked up on its own (events.get), at most MAX_VERIFY per pass.

WHAT IT GUARANTEES:
- A session is cancelled ONLY when Google itself says the event is gone: it answers 404 / 410 for it, or returns it with
  status "cancelled". An error, a timeout, missing permissions, an empty or partial answer, a calendar that cannot be read:
  NOTHING is cancelled (the pass just stops and tries again later).
- More than MAX_AUTO_CANCEL events gone in one pass (a wrong calendar, an API anomaly): nothing is cancelled, a warning is kept
  and the admin sees "Se han detectado N eventos borrados en Google; revisa antes de cancelar" with a button to confirm.
- Only ACTIVE sessions are looked at: a session the web cancelled itself (it deletes its event) is already Cancelled and is
  ignored, so there is no loop. The update is conditional on the row still being active with the same event id.
- No e-mail, no inbox message: the cancellation is only recorded (cancel_source = 'google') and shown in the admin as
  "Cancelada desde Google Calendar", with a Restore button (the existing restore flow, which creates the event again).
- GOOGLE_DELETE_SYNC=off turns all of this off (default on).

WHEN IT RUNS: when the admin opens the calendar or the trial sessions list (at most once a minute, in the background) and in a
background thread every 10 minutes while the server is awake. Never inside a request.
"""
import json
import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone

import calendar_sync
import google_calendar as gc
from database import get_connection
from emails.dates import now_madrid

logger = logging.getLogger("thundbalance.reconcile")

MAX_AUTO_CANCEL = 5          # more "deleted" events than this in one pass: nothing is cancelled until the admin confirms
MAX_VERIFY = 40              # events looked up one by one in a normal pass (those missing from the listing)
MAX_VERIFY_CONFIRMED = 300   # ... when the admin confirmed
MIN_INTERVAL_SECONDS = 60    # opening the admin pages starts a pass at most this often
BACKGROUND_SECONDS = 600
FIRST_BACKGROUND_DELAY = 45
PENDING_KEY = "google_delete_sync_pending"
CANCELLED_BY = "google_calendar"
ACTIVE_TRIAL = ("pending", "approved", "confirmed")

_state_lock = threading.Lock()
_run_lock = threading.Lock()
_last_started = 0.0
_background_started = False
_columns_ready = False


def enabled():
    """GOOGLE_DELETE_SYNC: "on" (default) | "off" (also false / 0 / no)."""
    return gc._read_env("GOOGLE_DELETE_SYNC").strip().strip("'\"").strip().lower() not in ("off", "false", "0", "no")


def ensure_columns(cursor):
    """Idempotent: who cancelled a session (cancel_source = 'google') and the state a trial had before it was cancelled from Google."""
    cursor.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cancel_source TEXT")
    cursor.execute("ALTER TABLE trial_sessions ADD COLUMN IF NOT EXISTS cancel_source TEXT")
    cursor.execute("ALTER TABLE trial_sessions ADD COLUMN IF NOT EXISTS cancel_prev_status TEXT")
    cursor.execute("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")


def ensure_columns_once():
    global _columns_ready
    if _columns_ready:
        return
    conn = get_connection()
    cursor = conn.cursor()
    try:
        ensure_columns(cursor)
        conn.commit()
        _columns_ready = True
    finally:
        cursor.close()
        conn.close()


# ---------------------------------------------------------------------------------------------- the warning kept for the admin
def get_pending(cursor):
    cursor.execute("SELECT value FROM app_settings WHERE key = %s", (PENDING_KEY,))
    row = cursor.fetchone()
    if not row:
        return None
    try:
        data = json.loads(row[0])
        return {"count": int(data["count"]), "detected_at": data.get("detected_at")} if int(data["count"]) > 0 else None
    except (ValueError, KeyError, TypeError):
        return None


def _set_pending(cursor, count):
    if count <= 0:
        cursor.execute("DELETE FROM app_settings WHERE key = %s", (PENDING_KEY,))
        return
    value = json.dumps({"count": int(count), "detected_at": datetime.now(timezone.utc).isoformat()})
    cursor.execute(
        "INSERT INTO app_settings (key, value) VALUES (%s, %s) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", (PENDING_KEY, value))


# ---------------------------------------------------------------------------------------------- what to look at
def candidates(cursor, today):
    """[(kind, id, event_id, date)] of the future ACTIVE sessions that have an event: 'session' (Booked) and 'trial'."""
    cursor.execute(
        "SELECT id, google_event_id, session_date FROM sessions WHERE status = 'Booked' AND google_event_id IS NOT NULL "
        "AND google_event_id <> '' AND session_date >= %s", (today,))
    found = [("session", row[0], row[1], row[2]) for row in cursor.fetchall()]
    cursor.execute(
        "SELECT id, google_event_id, session_date FROM trial_sessions WHERE LOWER(status) = ANY(%s) AND google_event_id IS NOT NULL "
        "AND google_event_id <> '' AND session_date >= %s", (list(ACTIVE_TRIAL), today))
    found += [("trial", row[0], row[1], row[2]) for row in cursor.fetchall()]
    return found


class Unreadable(Exception):
    """Google could not be read as a whole: the pass stops and nothing is cancelled."""


def _google_says_gone(event_ids, first, last, verify_limit):
    """Returns (gone, unverified): the event ids Google CONFIRMED are gone, and how many missing from the listing could not be
    looked up (over the limit or an unclear answer: never counted as gone). Raises Unreadable when the listing fails."""
    time_min = (datetime.combine(first, datetime.min.time()) - timedelta(days=1)).strftime("%Y-%m-%dT00:00:00Z")
    time_max = (datetime.combine(last, datetime.min.time()) + timedelta(days=2)).strftime("%Y-%m-%dT00:00:00Z")
    try:
        listed = gc.list_calendar_events(time_min, time_max, show_deleted=True)
    except Exception as error:  # noqa: BLE001 - timeout, 403, 500...: nothing is concluded from it
        logger.error("google calendar could not be read for the deletion check (%s)", type(error).__name__)
        raise Unreadable() from error
    status = {event.get("id"): event.get("status") for event in listed if isinstance(event, dict)}
    gone, missing = set(), []
    for event_id in event_ids:
        if status.get(event_id) == "cancelled":
            gone.add(event_id)
        elif event_id not in status:
            missing.append(event_id)            # absent from the listing proves nothing: Google is asked about it directly
    unverified = 0
    for position, event_id in enumerate(missing):
        if position >= verify_limit:
            unverified += 1
            continue
        try:
            event = gc.get_calendar_event(event_id)
        except Exception as error:  # noqa: BLE001
            if gc.http_status(error) in (404, 410):
                gone.add(event_id)              # Google confirms the event does not exist
            else:
                unverified += 1                 # 500, timeout, 403 ...: unknown, never cancelled
            continue
        if isinstance(event, dict) and event.get("status") == "cancelled":
            gone.add(event_id)
    return gone, unverified


# ---------------------------------------------------------------------------------------------- the cancellation
def _cancel(cursor, kind, item_id, event_id):
    """Cancels ONE active session if it is still active with that very event id. True when it was cancelled."""
    if kind == "session":
        cursor.execute(
            "UPDATE sessions SET status = 'Cancelled', feed_sequence = feed_sequence + 1, "
            "cancelled_at = NOW() AT TIME ZONE 'UTC', cancelled_by = %s, cancel_source = 'google', "
            "google_event_id = NULL, calendar_sync_status = NULL, calendar_sync_error = NULL "
            "WHERE id = %s AND status = 'Booked' AND google_event_id = %s",
            (CANCELLED_BY, item_id, event_id))
    else:
        cursor.execute(
            "UPDATE trial_sessions SET cancel_prev_status = status, status = 'Cancelled', feed_sequence = feed_sequence + 1, "
            "cancel_source = 'google', google_event_id = NULL, calendar_sync_status = NULL, calendar_sync_error = NULL, calendar_error = NULL "
            "WHERE id = %s AND LOWER(status) = ANY(%s) AND google_event_id = %s",
            (item_id, list(ACTIVE_TRIAL), event_id))
    return cursor.rowcount == 1


def reconcile_deleted_events(force=False):
    """One pass. `force` is the admin's confirmation of a large deletion. Returns a summary:
    {"enabled", "checked", "gone", "cancelled", "pending", "unreadable"}. Never cancels because of an error."""
    summary = {"enabled": enabled(), "checked": 0, "gone": 0, "cancelled": 0, "pending": 0, "unreadable": False}
    if not summary["enabled"]:
        return summary
    ensure_columns_once()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        today = now_madrid().date()
        items = candidates(cursor, today)
        summary["checked"] = len(items)
        if not items:
            _set_pending(cursor, 0)
            conn.commit()
            return summary
        try:
            gone, unverified = _google_says_gone(
                {item[2] for item in items}, min(item[3] for item in items), max(item[3] for item in items),
                MAX_VERIFY_CONFIRMED if force else MAX_VERIFY)
        except Unreadable:
            summary["unreadable"] = True
            conn.rollback()
            return summary
        summary["gone"] = len(gone)
        suspicious = len(gone) + unverified          # events missing that we could not even check also count as an anomaly
        if suspicious > MAX_AUTO_CANCEL and not force:
            _set_pending(cursor, suspicious)
            conn.commit()
            summary["pending"] = suspicious
            logger.warning("google calendar: %s events look deleted in one pass: nothing was cancelled, the admin must confirm", suspicious)
            return summary
        for kind, item_id, event_id, _ in items:
            if event_id in gone and _cancel(cursor, kind, item_id, event_id):
                summary["cancelled"] += 1
        remaining = unverified if (suspicious > MAX_AUTO_CANCEL) else 0
        _set_pending(cursor, remaining)
        conn.commit()
        if summary["cancelled"]:
            logger.info("google calendar: %s sessions cancelled because their event was deleted in Google", summary["cancelled"])
        return summary
    except Exception as error:  # noqa: BLE001
        conn.rollback()
        logger.error("deletion check failed (%s)", type(error).__name__)
        summary["unreadable"] = True
        return summary
    finally:
        cursor.close()
        conn.close()


# ---------------------------------------------------------------------------------------------- when it runs
def _run_safely():
    if not _run_lock.acquire(blocking=False):          # a pass is already running
        return
    try:
        reconcile_deleted_events()
    except Exception as error:  # noqa: BLE001
        logger.error("deletion check crashed (%s)", type(error).__name__)
    finally:
        _run_lock.release()


def maybe_reconcile():
    """Called when the admin opens the calendar or the trial sessions: starts a pass in the BACKGROUND (never blocks the request),
    at most once a minute. Returns True when a pass was started."""
    global _last_started
    if not enabled():
        return False
    with _state_lock:
        if time.monotonic() - _last_started < MIN_INTERVAL_SECONDS:
            return False
        _last_started = time.monotonic()
    threading.Thread(target=_run_safely, name="google-delete-sync", daemon=True).start()
    return True


def start_background():
    """A thread that checks every 10 minutes while the server is awake (it does not keep it awake). Safe to call twice."""
    global _background_started
    if not enabled() or _background_started:
        return
    _background_started = True

    def loop():
        time.sleep(FIRST_BACKGROUND_DELAY)
        while True:
            if enabled():
                _run_safely()
            time.sleep(BACKGROUND_SECONDS)

    threading.Thread(target=loop, name="google-delete-sync-loop", daemon=True).start()


# ---------------------------------------------------------------------------------------------- restoring a trial cancelled from Google
def restore_trial(trial_id):
    """Brings back a trial session that was cancelled FROM GOOGLE: the state it had, and its event is created again. The pack
    sessions use the existing restore (session_restore.py). Returns {"restored", "already", "calendar_ok"}; raises ValueError with a
    code ("not_found", "not_from_google", "past", "trainer_unavailable") the endpoint turns into a 4xx."""
    import trial_confirmation
    from availability import hhmm, slot_problem
    ensure_columns_once()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT status, cancel_source, cancel_prev_status, session_date, session_time, trainer_id FROM trial_sessions WHERE id = %s FOR UPDATE",
            (trial_id,))
        row = cursor.fetchone()
        if not row:
            raise ValueError("not_found")
        status, source, previous, day, moment, trainer = row
        if str(status).lower() != "cancelled":
            conn.rollback()
            return {"restored": False, "already": True, "calendar_ok": True}
        if source != "google":
            raise ValueError("not_from_google")
        if datetime.strptime(f"{str(day)[:10]} {hhmm(moment)}", "%Y-%m-%d %H:%M") <= now_madrid().replace(tzinfo=None):
            raise ValueError("past")
        if trainer and slot_problem(cursor, trainer, str(day)[:10], hhmm(moment)):
            raise ValueError("trainer_unavailable")
        restored = previous if str(previous or "").lower() in ACTIVE_TRIAL else "Approved"
        cursor.execute(
            "UPDATE trial_sessions SET status = %s, feed_sequence = feed_sequence + 1, cancel_source = NULL, cancel_prev_status = NULL WHERE id = %s",
            (restored, trial_id))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()
    calendar_ok = trial_confirmation.sync_calendar_event(trial_id)          # creates the event again; a failure is flagged on the row
    return {"restored": True, "already": False, "calendar_ok": bool(calendar_ok)}


def register_reconcile_routes(app, require_admin):
    from fastapi import Depends, HTTPException
    admin = [Depends(require_admin)]

    @app.get("/admin/google-sync/status", dependencies=admin)
    def google_sync_status():
        """{"enabled", "pending": {"count", "detected_at"} | null}: the banner "N events deleted in Google, review before cancelling"."""
        if not enabled():
            return {"enabled": False, "pending": None}
        ensure_columns_once()
        conn = get_connection()
        cursor = conn.cursor()
        try:
            return {"enabled": True, "pending": get_pending(cursor)}
        finally:
            cursor.close()
            conn.close()

    @app.post("/admin/google-sync/confirm", dependencies=admin)
    def google_sync_confirm():
        """The admin reviewed the warning and confirms: the events Google STILL says are gone are cancelled (checked again now)."""
        if not enabled():
            raise HTTPException(status_code=409, detail="GOOGLE_DELETE_SYNC is off")
        with _run_lock:
            return reconcile_deleted_events(force=True)

    @app.post("/admin/trial-sessions/{trial_id}/restore", dependencies=admin)
    def restore_google_cancelled_trial(trial_id: int):
        """Restores a trial session that was cancelled from Google Calendar (state as before; the event is created again)."""
        messages = {
            "not_found": (404, "Trial session not found."),
            "not_from_google": (409, "Only a session cancelled from Google Calendar can be restored here."),
            "past": (409, "That day and hour are already in the past."),
            "trainer_unavailable": (409, "The trainer is not free at that day and hour any more."),
        }
        try:
            return restore_trial(trial_id)
        except ValueError as error:
            status, message = messages.get(str(error), (500, "The session could not be restored."))
            raise HTTPException(status_code=status, detail={"code": str(error), "message": message}) from None

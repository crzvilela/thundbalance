"""Keeps the Google Calendar events of client sessions in step with the database.

- Every event has a DETERMINISTIC id built from the session id and a key that
  belongs to this database, so creating it twice (double click, retry) can never
  produce two events, and two databases that share one calendar can not collide.
- Every create / move / cancel records its outcome in sessions.calendar_sync_status
  (ok | failed | pending) and calendar_sync_error. Rows from before this existed
  stay NULL (unknown): nothing is inferred.
- A calendar failure never stops the session from being created, moved or
  cancelled: it is recorded and shown in the panel, and "Sincronizar con
  calendario" creates what is missing.
"""
import logging
import secrets
import traceback
from datetime import date, datetime, timedelta

import google_calendar as gc
from database import get_connection

logger = logging.getLogger("thundbalance.calendar")

OK, FAILED, PENDING = "ok", "failed", "pending"
BASE32HEX = "0123456789abcdefghijklmnopqrstuv"      # the only characters Google accepts in an event id
KEY_SETTING = "calendar_instance_key"


def ensure_columns():
    """Idempotent, run at startup (also on the production database)."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS calendar_sync_status TEXT")
        cursor.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS calendar_sync_error TEXT")
        cursor.execute("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        conn.commit()
        instance_key(cursor)        # created once, in its own committed transaction
        conn.commit()
    finally:
        cursor.close()
        conn.close()


def instance_key(cursor):
    """8 characters that identify THIS database (random, created once)."""
    cursor.execute("SELECT value FROM app_settings WHERE key = %s", (KEY_SETTING,))
    row = cursor.fetchone()
    if row:
        return row[0]
    candidate = "".join(secrets.choice(BASE32HEX) for _ in range(8))
    cursor.execute(
        "INSERT INTO app_settings (key, value) VALUES (%s, %s) ON CONFLICT (key) DO NOTHING",
        (KEY_SETTING, candidate),
    )
    cursor.execute("SELECT value FROM app_settings WHERE key = %s", (KEY_SETTING,))
    return cursor.fetchone()[0]


def event_id_for(key, session_id):
    """Deterministic Google event id: 'tb' + database key + session id (base32hex)."""
    return f"tb{key}{int(session_id):08d}"


def record(cursor, session_id, ok, error=None, event_id=None):
    """Stores the outcome of the last calendar operation on a session."""
    if event_id is not None:
        cursor.execute(
            "UPDATE sessions SET google_event_id = %s, calendar_sync_status = %s, calendar_sync_error = %s WHERE id = %s",
            (event_id, OK if ok else FAILED, None if ok else str(error)[:200], session_id),
        )
    else:
        cursor.execute(
            "UPDATE sessions SET calendar_sync_status = %s, calendar_sync_error = %s WHERE id = %s",
            (OK if ok else FAILED, None if ok else str(error)[:200], session_id),
        )


def _local_start(event):
    start = (event.get("start") or {}).get("dateTime") or ""
    return start[:10], start[11:16]


def sync_client(client_id):
    """Creates the events that are missing for the client's FUTURE sessions and
    repairs the ones whose last calendar operation failed. Safe to repeat.

    Returns {"created", "updated", "failed", "already_ok", "errors": [...]}."""
    conn = get_connection()
    cursor = conn.cursor()
    result = {"created": 0, "updated": 0, "failed": 0, "already_ok": 0, "errors": []}
    try:
        key = instance_key(cursor)
        cursor.execute(
            """
            SELECT s.id, s.session_date, s.session_time, s.session_number, s.google_event_id,
                   s.calendar_sync_status, u.nome, u.email, t.nome
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            LEFT JOIN trainers t ON t.id = s.trainer_id
            WHERE s.user_id = %s AND s.status = 'Booked' AND s.session_date >= CURRENT_DATE
            ORDER BY s.session_date, s.session_time, s.id
            """,
            (client_id,),
        )
        sessions = cursor.fetchall()
        if not sessions:
            return result

        first = min(row[1] for row in sessions)
        last = max(row[1] for row in sessions)
        try:
            existing = {
                event["id"]: event
                for event in gc.list_calendar_events(
                    f"{(first - timedelta(days=1)).isoformat()}T00:00:00Z",
                    f"{(last + timedelta(days=2)).isoformat()}T00:00:00Z",
                )
                if event.get("id")
            }
        except Exception as error:  # noqa: BLE001 - without the calendar nothing can be compared
            reason = gc.describe_error(error)
            logger.error("Calendar could not be read for client %s (%s)", client_id, reason)
            for row in sessions:
                record(cursor, row[0], False, reason)
            conn.commit()
            result["failed"] = len(sessions)
            result["errors"].append(reason)
            return result

        for session_id, day, time, number, event_id, sync_status, client, email, trainer in sessions:
            hhmm = str(time)[:5]
            event = existing.get(event_id) if event_id else None
            if event_id and event is None:
                try:                      # outside the window read above, or really gone
                    event = gc.get_calendar_service().events().get(calendarId=gc.CALENDAR_ID, eventId=event_id).execute()
                except Exception as error:  # noqa: BLE001
                    event = None if gc.http_status(error) in (404, 410) else {"_error": gc.describe_error(error)}
            if event and event.get("status") == "cancelled":
                event = None

            try:
                if event and "_error" in event:
                    raise RuntimeError(event["_error"])

                if event is not None:
                    if sync_status == FAILED and _local_start(event) != (str(day), hhmm):
                        gc.update_calendar_event(event_id, str(day), hhmm)      # a failed move: retry it
                        result["updated"] += 1
                    else:
                        result["already_ok"] += 1
                    record(cursor, session_id, True)
                else:
                    new_id = gc.create_calendar_event(
                        trainer, client, email, str(day), hhmm, number,
                        event_id=event_id_for(key, session_id), session_id=session_id,
                    )
                    record(cursor, session_id, True, event_id=new_id)
                    result["created"] += 1
            except Exception as error:  # noqa: BLE001
                reason = gc.describe_error(error)
                print(f"Calendar sync of session {session_id} failed: {reason}")
                traceback.print_exc()
                record(cursor, session_id, False, reason)
                result["failed"] += 1
                if reason not in result["errors"]:
                    result["errors"].append(reason)
            conn.commit()
        return result
    finally:
        cursor.close()
        conn.close()

"""Keeps the Google Calendar events of client sessions in step with the database.

- Every event has a DETERMINISTIC id built from the session id and a key that
  belongs to this database, so creating it twice (double click, retry) can never
  produce two events, and two databases that share one calendar can not collide.
- Every create / move / cancel records its outcome in sessions.calendar_sync_status
  (ok | failed | pending) and calendar_sync_error. Rows from before this existed
  stay NULL (unknown): nothing is inferred.
- A calendar failure never stops the session from being created, moved or
  cancelled: it is recorded and shown in the panel, and "Sincronizar con
  calendario" creates what is missing and rewrites title and description of
  the future events to the current format (event_format.py).
"""
import logging
import secrets
import traceback
from datetime import date, timedelta

import event_format
import google_calendar as gc
import pack_view
from database import get_connection

logger = logging.getLogger("thundbalance.calendar")

OK, FAILED, PENDING = "ok", "failed", "pending"
BASE32HEX = "0123456789abcdefghijklmnopqrstuv"      # the only characters Google accepts in an event id
KEY_SETTING = "calendar_instance_key"
EVENT_FIELDS = ("summary", "description", "start", "end", "extendedProperties")


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


def trial_event_id_for(key, trial_id):
    """Deterministic id of a trial session's event. The 't' (a valid base32hex
    character) can never collide with the all-digit id of a pack session."""
    return f"tb{key}t{int(trial_id):07d}"


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


def load_sessions(cursor, user_id, *, session_id=None, only_future=False):
    """The data of a client's Booked sessions that goes into their events:
    [{"id", "date", "time", "number", "event_id", "sync_status", "client_name",
      "client_email", "client_phone", "trainer", "pack_name"}], oldest first.

    One place for the query, shared by "Sincronizar" and by moving a session,
    so every path describes a session with the same facts."""
    cursor.execute(
        """
        SELECT s.id, s.session_date, s.session_time, s.session_number, s.google_event_id,
               s.calendar_sync_status, u.nome, u.email, u.telefone, t.nome
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        LEFT JOIN trainers t ON t.id = s.trainer_id
        WHERE s.user_id = %s AND s.status = 'Booked'
          AND (%s::int IS NULL OR s.id = %s::int)
          AND (NOT %s OR s.session_date >= CURRENT_DATE)
        ORDER BY s.session_date, s.session_time, s.id
        """,
        (user_id, session_id, session_id, only_future),
    )
    rows = cursor.fetchall()
    packs, assignment = pack_view.user_packs(cursor, user_id)
    names = {pack["id"]: pack["name"] for pack in packs}
    return [
        {
            "id": row[0], "date": str(row[1])[:10], "time": str(row[2])[:5], "number": row[3],
            "event_id": row[4], "sync_status": row[5], "client_name": row[6], "client_email": row[7],
            "client_phone": row[8], "trainer": row[9], "pack_name": names.get(assignment.get(row[0])),
        }
        for row in rows
    ]


def event_body(session):
    """Google event body for a session of load_sessions()."""
    return event_format.build_session_event(
        client_name=session["client_name"], client_email=session["client_email"],
        client_phone=session["client_phone"], session_date=session["date"],
        session_time=session["time"], trainer_name=session["trainer"],
        pack_name=session["pack_name"], session_number=session["number"],
        session_id=session["id"],
    )


def push_session(cursor, session_id):
    """Writes the session's CURRENT date, hour, title and description to its
    existing Google event (used after a session is moved). Raises the Google
    error; the caller records it."""
    cursor.execute("SELECT user_id, google_event_id FROM sessions WHERE id = %s", (session_id,))
    row = cursor.fetchone()
    if not row or not row[1]:
        return
    sessions = load_sessions(cursor, row[0], session_id=session_id)
    if not sessions:
        return
    body = event_body(sessions[0])
    gc.patch_calendar_event(row[1], {key: body[key] for key in EVENT_FIELDS})


def sync_client(client_id):
    """Brings the Google Calendar in step with the client's FUTURE sessions.
    Safe to repeat: pressing it twice changes nothing the second time.

    - missing events are created (deterministic id: a 409 means "already
      there" and counts as already_ok, never as a duplicate);
    - events whose title, description or time differ from the current format
      are updated;
    - every event carries the private tag app=thundbalance.

    Returns {"created", "updated", "failed", "already_ok", "errors": [...]}."""
    conn = get_connection()
    cursor = conn.cursor()
    result = {"created": 0, "updated": 0, "failed": 0, "already_ok": 0, "errors": []}
    try:
        key = instance_key(cursor)
        sessions = load_sessions(cursor, client_id, only_future=True)
        if not sessions:
            return result

        first = min(date.fromisoformat(item["date"]) for item in sessions)
        last = max(date.fromisoformat(item["date"]) for item in sessions)
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
            for item in sessions:
                record(cursor, item["id"], False, reason)
            conn.commit()
            result["failed"] = len(sessions)
            result["errors"].append(reason)
            return result

        for item in sessions:
            session_id = item["id"]
            # The deterministic id is the identity of the session's event. An id
            # stored from before is honoured when that event exists.
            event_id = event_id_for(key, session_id)
            event = existing.get(event_id)
            if event is None and item["event_id"] and item["event_id"] != event_id:
                event = existing.get(item["event_id"])
                if event is not None:
                    event_id = item["event_id"]
            if event is None:
                try:                      # outside the window read above, or really gone
                    event = gc.get_calendar_event(event_id)
                except Exception as error:  # noqa: BLE001
                    event = None if gc.http_status(error) in (404, 410) else {"_error": gc.describe_error(error)}
            if event and event.get("status") == "cancelled":
                event = None

            try:
                if event and "_error" in event:
                    raise RuntimeError(event["_error"])

                body = event_body(item)
                if event is not None:
                    if event_format.differs(event, body) or not _tagged(event):
                        gc.patch_calendar_event(event_id, {k: body[k] for k in EVENT_FIELDS})
                        result["updated"] += 1
                    else:
                        result["already_ok"] += 1
                    record(cursor, session_id, True, event_id=event_id)
                else:
                    new_id, created = gc.create_calendar_event_status(
                        item["trainer"], item["client_name"], item["client_email"], item["date"], item["time"],
                        item["number"], event_id=event_id, session_id=session_id,
                        client_phone=item["client_phone"], pack_name=item["pack_name"],
                    )
                    record(cursor, session_id, True, event_id=new_id)
                    result["created" if created else "already_ok"] += 1
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


def _tagged(event):
    private = (event.get("extendedProperties") or {}).get("private") or {}
    return private.get(event_format.APP_PROPERTY) == event_format.APP_VALUE

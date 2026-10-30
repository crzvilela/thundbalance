"""Keeps the Google Calendar events of client sessions in step with the database.

- Every event has a DETERMINISTIC id built from the session id and a key that
  belongs to this database, so creating it twice (double click, retry) can never
  produce two events, and two databases that share one calendar can not collide.
- Every create / move / cancel records its outcome in sessions.calendar_sync_status
  (ok | failed | pending) and calendar_sync_error. Rows from before this existed
  stay NULL (unknown): nothing is inferred.
- A calendar failure never stops the session from being created, moved or
  cancelled: it is recorded and shown in the panel, and "Sincronizar con
  Google" creates what is missing and rewrites title and description of
  the future events to the current format (event_format.py).

THE RULE LIVES IN ONE PLACE: sync_session_to_google / sync_sessions_to_google.
Given the CURRENT state of a session in the database they create, update or delete
its Google event. Every path (new pack, approving a request, moving, cancelling,
archiving a client, editing a client, the "Sincronizar con Google" buttons) saves
first and then calls them. The app is the boss: Google is never read to decide
anything about a session, only written to.
"""
import logging
import secrets
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

import event_format
import google_calendar as gc
import pack_view
from database import get_connection

logger = logging.getLogger("thundbalance.calendar")

OK, FAILED, PENDING = "ok", "failed", "pending"
MAX_PARALLEL = 4                     # at most this many requests to Google at the same time
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
        # trial sessions get the same two columns (rows from before stay NULL = unknown)
        cursor.execute("ALTER TABLE trial_sessions ADD COLUMN IF NOT EXISTS calendar_sync_status TEXT")
        cursor.execute("ALTER TABLE trial_sessions ADD COLUMN IF NOT EXISTS calendar_sync_error TEXT")
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


def _pack_fields(pack):
    """What an event says about the pack of a session: its name and, for a dual pack, the second person."""
    pack = pack or {}
    return {
        "pack_name": pack.get("name"), "session_type": pack.get("session_type"),
        "second_person_name": pack.get("second_person_name"),
    }


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
    names = {pack["id"]: pack for pack in packs}
    return [
        {
            "id": row[0], "date": str(row[1])[:10], "time": str(row[2])[:5], "number": row[3],
            "event_id": row[4], "sync_status": row[5], "client_name": row[6], "client_email": row[7],
            "client_phone": row[8], "trainer": row[9], **_pack_fields(names.get(assignment.get(row[0]))),
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
        session_id=session["id"], session_type=session.get("session_type"),
        second_person_name=session.get("second_person_name"),
    )


def push_session(cursor, session_id):
    """Writes the session's CURRENT date, hour, title and description to its
    existing Google event. Raises the Google error; the caller records it.
    (Kept for callers that want the raw error; the paths of the app use
    sync_session_to_google.)"""
    cursor.execute("SELECT user_id, google_event_id FROM sessions WHERE id = %s", (session_id,))
    row = cursor.fetchone()
    if not row or not row[1]:
        return
    sessions = load_sessions(cursor, row[0], session_id=session_id)
    if not sessions:
        return
    body = event_body(sessions[0])
    gc.patch_calendar_event(row[1], {key: body[key] for key in EVENT_FIELDS})


# ---------------------------------------------------------------------------
# The central rule: make Google match the session as it is in the database.
# ---------------------------------------------------------------------------

def load_states(cursor, session_ids):
    """{session_id: state} with everything an event needs, cancelled sessions included.
    One query, plus one pack lookup per distinct client."""
    ids = [int(item) for item in session_ids]
    if not ids:
        return {}
    cursor.execute(
        """
        SELECT s.id, s.user_id, s.status, s.session_date, s.session_time, s.session_number, s.google_event_id,
               s.calendar_sync_status, u.nome, u.email, u.telefone, t.nome
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        LEFT JOIN trainers t ON t.id = s.trainer_id
        WHERE s.id = ANY(%s::int[])
        """,
        (ids,),
    )
    rows = cursor.fetchall()
    packs_of = {}
    for user_id in {row[1] for row in rows}:
        packs, assignment = pack_view.user_packs(cursor, user_id)
        packs_of[user_id] = ({pack["id"]: pack for pack in packs}, assignment)
    states = {}
    for row in rows:
        names, assignment = packs_of[row[1]]
        states[row[0]] = {
            "id": row[0], "user_id": row[1], "status": str(row[2]), "date": str(row[3])[:10], "time": str(row[4])[:5],
            "number": row[5], "event_id": row[6], "sync_status": row[7], "client_name": row[8], "client_email": row[9],
            "client_phone": row[10], "trainer": row[11], **_pack_fields(names.get(assignment.get(row[0]))),
        }
    return states


def _google_step(state, key):
    """The Google calls for ONE session (no database access: it may run in a thread).
    Returns {"action": created | updated | deleted | skipped | failed, "event_id", "error"}."""
    session_id = state["id"]
    stored = state["event_id"]
    wanted = event_id_for(key, session_id)
    try:
        if state["status"].lower() == "cancelled":
            # nothing to delete for a session that never reached Google
            if not stored and not state["sync_status"]:
                return {"action": "skipped", "event_id": None}
            try:
                gc.delete_calendar_event(stored or wanted)
            except Exception as error:  # noqa: BLE001
                if gc.http_status(error) not in (404, 410):    # "it does not exist" is success
                    raise
            return {"action": "deleted", "event_id": stored}

        body = event_body(state)
        if stored:
            try:
                gc.patch_calendar_event(stored, {field: body[field] for field in EVENT_FIELDS})
                return {"action": "updated", "event_id": stored}
            except Exception as error:  # noqa: BLE001
                if gc.http_status(error) not in (404, 410):
                    raise
                # the event is gone from Google: it is created again below
        new_id, created = gc.create_calendar_event_status(
            state["trainer"], state["client_name"], state["client_email"], state["date"], state["time"],
            state["number"], event_id=wanted, session_id=session_id,
            client_phone=state["client_phone"], pack_name=state["pack_name"],
            session_type=state.get("session_type"), second_person_name=state.get("second_person_name"),
        )
        return {"action": "created" if created else "updated", "event_id": new_id}
    except Exception as error:  # noqa: BLE001 - a Google failure never stops the operation in the app
        reason = gc.describe_error(error)
        logger.error("calendar sync of session %s failed: %s", session_id, reason)
        return {"action": "failed", "event_id": stored, "error": reason}


def sync_sessions_to_google(cursor, session_ids, workers=MAX_PARALLEL):
    """Creates, updates or deletes the Google event of every session so it matches the
    database NOW, and records the outcome (calendar_sync_status / calendar_sync_error).

    - Booked session: its event is created (a 409 means "already there"), or the existing
      one is patched with the current date, hour, title and description; if the event
      vanished from Google it is created again.
    - Cancelled session: its event is deleted ("not found" is success).
    - Requests to Google run in parallel (at most `workers` at once) and never read the
      database; the outcomes are written afterwards with `cursor`. The caller commits.

    Returns [{"id", "action", "event_id", "error"?}] in the order given."""
    ids = [int(item) for item in session_ids]
    states = load_states(cursor, ids)
    if not states:
        return []
    key = instance_key(cursor)
    ordered = [states[item] for item in ids if item in states]
    if len(ordered) > 1 and workers > 1:
        with ThreadPoolExecutor(max_workers=min(workers, len(ordered))) as pool:
            steps = list(pool.map(lambda state: _google_step(state, key), ordered))
    else:
        steps = [_google_step(state, key) for state in ordered]

    results = []
    for state, step in zip(ordered, steps):
        action = step["action"]
        if action == "failed":
            record(cursor, state["id"], False, step["error"])
        elif action in ("created", "updated"):
            record(cursor, state["id"], True, event_id=step["event_id"])
        elif action == "deleted":
            record(cursor, state["id"], True)
        results.append({"id": state["id"], **step})
    return results


def sync_session_to_google(session_id, cursor=None):
    """sync_sessions_to_google for one session. Without a cursor it opens (and commits) its
    own connection. Returns the result dict of that session, or None if it does not exist."""
    if cursor is not None:
        results = sync_sessions_to_google(cursor, [session_id])
        return results[0] if results else None
    conn = get_connection()
    cur = conn.cursor()
    try:
        results = sync_sessions_to_google(cur, [session_id])
        conn.commit()
        return results[0] if results else None
    finally:
        cur.close()
        conn.close()


def sync_client_sessions_to_google(user_id):
    """After something about a CLIENT changed (name, e-mail, phone): rewrites title and
    description of every session they still have to come. Best effort: it never raises,
    a failure is recorded on the session and the "Sincronizar con Google" button retries."""
    try:
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT id FROM sessions WHERE user_id = %s AND status = 'Booked' AND session_date >= CURRENT_DATE "
                "AND google_event_id IS NOT NULL ORDER BY session_date, session_time, id", (user_id,))
            ids = [row[0] for row in cursor.fetchall()]
            if ids:
                sync_sessions_to_google(cursor, ids)
                conn.commit()
        finally:
            cursor.close()
            conn.close()
    except Exception as error:  # noqa: BLE001
        logger.error("calendar update after a client change failed (%s)", type(error).__name__)


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
                        session_type=item.get("session_type"), second_person_name=item.get("second_person_name"),
                    )
                    record(cursor, session_id, True, event_id=new_id)
                    result["created" if created else "already_ok"] += 1
            except Exception as error:  # noqa: BLE001
                reason = gc.describe_error(error)
                logger.error("calendar sync of session %s failed: %s", session_id, reason)
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

"""Reschedule requests: the client no longer moves a session by themselves. They make ONE
request per session; the studio approves it, rejects it or proposes another date, and the
client answers a proposal.

The rules live here, in one place:
  MAX_RESCHEDULE_REQUESTS_PER_SESSION  how many requests a client may EVER make for one session
                                       (counted by code; change the number, no migration needed)
  features.RESCHEDULE_MIN_HOURS_BEFORE a request must be made at least this many hours before the session
                                       (24; Europe/Madrid, REAL hours: the clock change does not shift it), and a
                                       proposal of the studio expires that many hours before the session. ONE number
                                       for the backend, the page (GET /features), the texts and the e-mails
  NOTE_MAX                             longest note (client's reason, studio's note)

Statuses of reschedule_requests.status:
  pending            waiting for the studio
  approved           the studio approved it (or moved the session directly): the session moved
  rejected           the studio said no: the session stays as it was
  counter_proposed   the studio proposed another date: waiting for the client
  accepted           the client accepted the proposal: the session moved
  declined           the client declined the proposal: the session stays as it was
  expired            nobody answered in time (see expire_stale)
A request that is pending or counter_proposed is "open"; a session can have only one open
request (a partial unique index). A closed request still counts for the limit, forever: there
is no "withdraw".

Everything runs in one transaction; the e-mails go out AFTER it is committed and never break
the operation. The studio can always move a session directly (admin_reschedule): that never
counts for the client's limit.
"""
import logging
import re
import secrets
import threading
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException
from pydantic import BaseModel

import calendar_sync
import features
import inbox
import reschedule_notifications as notify
import trainer_choice
from availability import hhmm, slot_problem
from database import get_connection
from emails.dates import madrid_to_utc, now_madrid, to_madrid

logger = logging.getLogger("thundbalance.reschedule")

MAX_RESCHEDULE_REQUESTS_PER_SESSION = 1
NOTE_MAX = 300
OPEN_STATUSES = ("pending", "counter_proposed")
CLOSED_STATUSES = ("approved", "rejected", "accepted", "declined", "expired")
STATUSES = OPEN_STATUSES + CLOSED_STATUSES
TOKEN_LENGTH = (20, 100)

_ready = threading.Event()
_lock = threading.Lock()


# ----------------------------------------------------------------------------- database
def ensure_tables():
    """Idempotent, run at startup (also on the production database): the project has no migrations."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS reschedule_requests (
                id SERIAL PRIMARY KEY,
                session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                original_date DATE NOT NULL,
                original_time TIME NOT NULL,
                requested_date DATE NOT NULL,
                requested_time TIME NOT NULL,
                client_note TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                admin_note TEXT,
                counter_date DATE,
                counter_time TIME,
                decided_by TEXT,
                decided_at TIMESTAMP,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                token TEXT NOT NULL,
                lang TEXT
            )
            """
        )
        cursor.execute("ALTER TABLE reschedule_requests ADD COLUMN IF NOT EXISTS lang TEXT")
        # the trainer the client asks for at the NEW hour (empty = the session keeps its trainer)
        cursor.execute("ALTER TABLE reschedule_requests ADD COLUMN IF NOT EXISTS requested_trainer_id INTEGER REFERENCES trainers(id)")
        # true: the studio proposed inside the notice period and confirmed it, so the client may answer until the session starts
        cursor.execute("ALTER TABLE reschedule_requests ADD COLUMN IF NOT EXISTS counter_late BOOLEAN NOT NULL DEFAULT FALSE")
        cursor.execute("CREATE INDEX IF NOT EXISTS reschedule_requests_status_idx ON reschedule_requests (status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS reschedule_requests_session_idx ON reschedule_requests (session_id)")
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS reschedule_requests_token_key ON reschedule_requests (token)")
        # At most ONE open request per session. NOT unique over the whole table: how many requests a
        # session may have in total is MAX_RESCHEDULE_REQUESTS_PER_SESSION, checked by code.
        cursor.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS reschedule_requests_one_open ON reschedule_requests (session_id) "
            "WHERE status IN ('pending', 'counter_proposed')"
        )
        conn.commit()
    finally:
        cursor.close()
        conn.close()
    _ready.set()


def ensure_tables_once():
    if _ready.is_set():
        return
    with _lock:
        if not _ready.is_set():
            ensure_tables()


# ----------------------------------------------------------------------------- small helpers
def fail(status, code, message):
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _now():
    """Now in Madrid, as a naive datetime (the same clock the sessions are written in)."""
    return now_madrid().replace(tzinfo=None)


def _start(day, moment):
    return datetime.strptime(f"{str(day)[:10]} {hhmm(moment)}", "%Y-%m-%d %H:%M")


def _hours():
    return features.reschedule_min_hours_before()


def _enough_notice(start, now):
    """True when there are at least the notice hours (REAL hours, so the clock change counts) between now and `start`."""
    return madrid_to_utc(start) - madrid_to_utc(now) >= timedelta(hours=_hours())


def _deadline(day, moment, late=False):
    """When a proposal expires, as "YYYY-MM-DDTHH:MM" (Madrid): the notice hours before the session, or the session's start
    for a proposal the studio sent late."""
    start = _start(day, moment)
    when = start if late else to_madrid(madrid_to_utc(start) - timedelta(hours=_hours()))
    return when.strftime("%Y-%m-%dT%H:%M")


def _clean_note(text):
    note = " ".join(str(text or "").split())
    if len(note) > NOTE_MAX:
        raise fail(422, "note_too_long", f"The note can have up to {NOTE_MAX} characters.")
    return note or None


def _clean_slot(day, time):
    try:
        datetime.strptime(str(day), "%Y-%m-%d")
    except ValueError:
        raise fail(422, "invalid_slot", "Choose a valid date.") from None
    if not re.fullmatch(r"\d{2}:\d{2}", str(time or "")):
        raise fail(422, "invalid_slot", "Choose a valid time.")
    return str(day), str(time)


def _slot_error(cursor, user_id, trainer_id, session_id, day, time):
    """None when the session can be moved to this day and hour, otherwise why not."""
    if _start(day, time) <= _now():
        return "The new date and time must be in the future."
    problem = slot_problem(cursor, trainer_id, day, time, ignore_session_id=session_id)
    if problem:
        return problem
    cursor.execute(
        "SELECT 1 FROM sessions WHERE user_id = %s AND session_date = %s AND session_time = %s "
        "AND status = 'Booked' AND id <> %s LIMIT 1",
        (user_id, str(day)[:10], hhmm(time), session_id),
    )
    if cursor.fetchone():
        return "The client already has another session at that day and time."
    return None


def _escape_like(text):
    """The text with % _ and \\ escaped, so it is searched literally."""
    return re.sub(r"([\\%_])", r"\\\1", str(text).strip().lower())


def expire_stale(cursor, request_id=None):
    """Closes (status expired) the open requests whose time ran out. Done when listing and when
    deciding, so no background process is needed:
      - a pending request expires when the session starts (or if the session was cancelled);
      - a counter proposal expires the notice hours (features.RESCHEDULE_MIN_HOURS_BEFORE) before the session, counted in
        real hours (or when the session starts, if the studio sent it late and confirmed it; or if it was cancelled)."""
    cursor.execute(
        """
        UPDATE reschedule_requests rr
        SET status = 'expired', decided_at = COALESCE(rr.decided_at, NOW())
        FROM sessions s
        WHERE s.id = rr.session_id
          AND (%(id)s::int IS NULL OR rr.id = %(id)s::int)
          AND (
                (rr.status = 'pending' AND ((s.session_date + s.session_time) AT TIME ZONE 'Europe/Madrid') <= (%(now)s AT TIME ZONE 'Europe/Madrid'))
             OR (rr.status = 'counter_proposed' AND
                 ((s.session_date + s.session_time) AT TIME ZONE 'Europe/Madrid')
                   - (CASE WHEN rr.counter_late THEN interval '0' ELSE make_interval(hours => %(hours)s) END)
                   <= (%(now)s AT TIME ZONE 'Europe/Madrid'))
             OR (rr.status IN ('pending', 'counter_proposed') AND LOWER(s.status) = 'cancelled')
          )
        """,
        {"id": request_id, "now": _now(), "hours": _hours()},
    )


def _load(cursor, request_id=None, token=None, user_id=None, lock=False):
    """The request with its session, or None."""
    where, params = [], []
    if request_id is not None:
        where.append("rr.id = %s"); params.append(request_id)
    if token is not None:
        where.append("rr.token = %s"); params.append(token)
    if user_id is not None:
        where.append("rr.user_id = %s"); params.append(user_id)
    cursor.execute(
        f"""
        SELECT rr.id, rr.session_id, rr.user_id, rr.status, rr.requested_date, rr.requested_time,
               rr.counter_date, rr.counter_time, rr.lang, rr.client_note, rr.admin_note,
               s.status, s.session_date, s.session_time, s.trainer_id, s.session_number,
               rr.original_date, rr.original_time, rr.created_at, rr.decided_at, rr.counter_late, rr.requested_trainer_id
        FROM reschedule_requests rr JOIN sessions s ON s.id = rr.session_id
        WHERE {' AND '.join(where)}
        {"FOR UPDATE OF rr, s" if lock else ""}
        """,
        params,
    )
    row = cursor.fetchone()
    if not row:
        return None
    keys = ("id", "session_id", "user_id", "status", "requested_date", "requested_time", "counter_date", "counter_time",
            "lang", "client_note", "admin_note", "session_status", "session_date", "session_time", "trainer_id",
            "number", "original_date", "original_time", "created_at", "decided_at", "counter_late", "requested_trainer_id")
    return dict(zip(keys, row))


def _public(req, with_counter=True):
    """What the client's page needs about a request (never the token)."""
    return {
        "id": req["id"], "session_id": req["session_id"], "status": req["status"],
        "original_date": str(req["original_date"])[:10], "original_time": hhmm(req["original_time"]),
        "requested_date": str(req["requested_date"])[:10], "requested_time": hhmm(req["requested_time"]),
        "client_note": req["client_note"], "admin_note": req["admin_note"],
        "counter_date": str(req["counter_date"])[:10] if req["counter_date"] else None,
        "counter_time": hhmm(req["counter_time"]) if req["counter_time"] else None,
        # until when the client can answer a proposal (the studio's, only while it is open)
        "counter_deadline": _deadline(req["session_date"], req["session_time"], req["counter_late"]) if req["status"] == "counter_proposed" else None,
        "created_at": req["created_at"].isoformat() if req["created_at"] else None,
        "decided_at": req["decided_at"].isoformat() if req["decided_at"] else None,
        "requested_trainer_id": req.get("requested_trainer_id"),
    }


def _context(cursor, request_id):
    """What the e-mails need (read after the commit, so they describe what is saved)."""
    cursor.execute(
        """
        SELECT rr.id, rr.status, rr.lang, rr.client_note, rr.admin_note, rr.token,
               rr.original_date, rr.original_time, rr.requested_date, rr.requested_time, rr.counter_date, rr.counter_time,
               u.nome, u.email, s.session_number, s.session_date, s.session_time, t.nome, rr.counter_late
        FROM reschedule_requests rr
        JOIN users u ON u.id = rr.user_id JOIN sessions s ON s.id = rr.session_id
        LEFT JOIN trainers t ON t.id = s.trainer_id
        WHERE rr.id = %s
        """,
        (request_id,),
    )
    row = cursor.fetchone()
    if not row:
        return None
    return {
        "id": row[0], "status": row[1], "lang": row[2], "client_note": row[3], "admin_note": row[4], "token": row[5],
        "original_date": str(row[6])[:10], "original_time": hhmm(row[7]),
        "requested_date": str(row[8])[:10], "requested_time": hhmm(row[9]),
        "counter_date": str(row[10])[:10] if row[10] else None, "counter_time": hhmm(row[11]) if row[11] else None,
        "client_name": row[12], "client_email": row[13], "number": row[14],
        "session_date": str(row[15])[:10], "session_time": hhmm(row[16]), "trainer": row[17],
        "counter_deadline": _deadline(row[15], row[16], row[18]) if row[1] == "counter_proposed" else None,
    }


def _move_session(cursor, req, day, time, mark_rescheduled=True, trainer_id=None):
    """Moves the session of `req` to day/time after checking everything again (the slot may have
    been taken since the request was made). Raises 409 with the reason. The Google event is
    updated by the central rule; if Google fails the session stays moved and is flagged."""
    if str(req["session_status"]).lower() != "booked":
        raise fail(409, "session_not_open", "The session is no longer booked.")
    if _start(req["session_date"], req["session_time"]) <= _now():
        raise fail(409, "expired", "The session has already started.")
    trainer_id = trainer_id or req["trainer_id"]            # the trainer at the new hour: the one asked for, else the session's
    problem = _slot_error(cursor, req["user_id"], trainer_id, req["session_id"], day, time)
    if problem:
        raise fail(409, "slot_unavailable", problem)
    cursor.execute(
        "UPDATE sessions SET session_date = %s, session_time = %s, trainer_id = %s, rescheduled = rescheduled OR %s, "
        "feed_sequence = feed_sequence + 1 WHERE id = %s",
        (str(day)[:10], hhmm(time), trainer_id, bool(mark_rescheduled), req["session_id"]),
    )
    calendar_sync.sync_session_to_google(req["session_id"], cursor=cursor)


# ----------------------------------------------------------------------------- the client's side
def create_request(user_id, session_id, requested_date, requested_time, note=None, lang=None, trainer_id=None):
    """The client asks to move one of their sessions. Returns the request (public fields)."""
    ensure_tables_once()
    requested_date, requested_time = _clean_slot(requested_date, requested_time)
    note = _clean_note(note)
    conn = get_connection()
    cursor = conn.cursor()
    try:
        expire_stale(cursor)
        cursor.execute(
            "SELECT user_id, status, session_date, session_time, trainer_id FROM sessions WHERE id = %s FOR UPDATE", (session_id,)
        )
        row = cursor.fetchone()
        if not row or row[0] != user_id:
            raise fail(404, "not_found", "Session not found.")      # somebody else's session looks the same as a missing one
        if str(row[1]).lower() != "booked" or _start(row[2], row[3]) <= _now():
            raise fail(409, "session_not_open", "This session can no longer be changed.")
        cursor.execute("SELECT 1 FROM reschedule_requests WHERE session_id = %s AND status IN ('pending', 'counter_proposed')", (session_id,))
        if cursor.fetchone():
            raise fail(409, "open_request", "There is already a change request for this session.")
        cursor.execute("SELECT COUNT(*) FROM reschedule_requests WHERE session_id = %s", (session_id,))
        if cursor.fetchone()[0] >= MAX_RESCHEDULE_REQUESTS_PER_SESSION:
            raise fail(409, "limit_reached", "A change has already been requested for this session.")
        if not _enough_notice(_start(row[2], row[3]), _now()):
            raise fail(409, "too_late", f"Changes can only be requested up to {_hours()} hours before the session.")
        wanted = trainer_id or row[4]                           # the trainer asked for at the new hour, else the session's own
        problem = _slot_error(cursor, user_id, wanted, session_id, requested_date, requested_time)
        if problem:
            # the trainer is the reason: say who IS free (the client may pick another); any other reason stays as it was
            alternatives = trainer_choice.free_trainers(cursor, requested_date, requested_time, ignore_session_id=session_id)
            if problem != "The client already has another session at that day and time." and not problem.startswith("The new date"):
                raise trainer_choice.unavailable(alternatives, problem)
            raise fail(409, "slot_unavailable", problem)
        cursor.execute(
            """
            INSERT INTO reschedule_requests
                (session_id, user_id, original_date, original_time, requested_date, requested_time, client_note, token, lang,
                 requested_trainer_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
            """,
            (session_id, user_id, row[2], row[3], requested_date, requested_time, note, secrets.token_urlsafe(32), (lang or "en")[:2].lower() if lang else "en",
             trainer_id if trainer_id and trainer_id != row[4] else None),
        )
        request_id = cursor.fetchone()[0]
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception as error:  # noqa: BLE001
        conn.rollback()
        if type(error).__name__ == "UniqueViolation":               # two clicks at once: the open-request index decides
            raise fail(409, "open_request", "There is already a change request for this session.") from None
        raise
    finally:
        cursor.close()
        conn.close()
    return _after(request_id, notify.staff_requested)


def _session_state(session_id):
    """Where the session is now and how its Google event went (the panel warns when it failed)."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT session_date, session_time, calendar_sync_status, calendar_sync_error FROM sessions WHERE id = %s", (session_id,))
        row = cursor.fetchone()
    finally:
        cursor.close()
        conn.close()
    if not row:
        return None
    return {"date": str(row[0])[:10], "time": hhmm(row[1]), "sync_status": row[2], "sync_error": row[3]}


def _after(request_id, sender=None, **options):
    """Reads the committed request and (optionally) sends the e-mail. Returns {"request": ..., "email": ...}."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        req = _load(cursor, request_id=request_id)
        context = _context(cursor, request_id)
    finally:
        cursor.close()
        conn.close()
    result = {"request": _public(req), "session": _session_state(req["session_id"])}
    if sender and context:
        result["email"] = notify.wait(sender(context, **options))
    return result


def list_for_user(user_id):
    ensure_tables_once()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        expire_stale(cursor)
        conn.commit()
        cursor.execute("SELECT id FROM reschedule_requests WHERE user_id = %s ORDER BY created_at DESC, id DESC", (user_id,))
        ids = [row[0] for row in cursor.fetchall()]
        return [_public(_load(cursor, request_id=item)) for item in ids]
    finally:
        cursor.close()
        conn.close()


def respond(request_id=None, token=None, user_id=None, accept=True):
    """The client accepts or declines the studio's proposal. Accepting moves the session after
    the same checks as an approval. Repeating an answer changes nothing and sends nothing."""
    ensure_tables_once()
    conn = get_connection()
    cursor = conn.cursor()
    sender = None
    try:
        expire_stale(cursor)
        req = _load(cursor, request_id=request_id, token=token, user_id=user_id, lock=True)
        if not req:
            conn.rollback()
            raise fail(404, "not_found", "Request not found.")
        if req["status"] in ("accepted", "declined"):
            conn.rollback()
            return {"outcome": req["status"], "already": True, "request": _public(req)}
        if req["status"] == "expired":
            conn.commit()
            return {"outcome": "expired", "already": True, "request": _public(req)}
        if req["status"] != "counter_proposed":
            conn.rollback()
            return {"outcome": "unavailable", "already": True, "request": _public(req)}
        if accept:
            _move_session(cursor, req, req["counter_date"], req["counter_time"])
            cursor.execute(
                "UPDATE reschedule_requests SET status = 'accepted', decided_at = NOW() WHERE id = %s", (req["id"],))
            sender = notify.staff_counter_accepted
        else:
            cursor.execute(
                "UPDATE reschedule_requests SET status = 'declined', decided_at = NOW() WHERE id = %s", (req["id"],))
            sender = notify.staff_counter_declined
        conn.commit()
        request_id = req["id"]
    except HTTPException:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()
    answer = _after(request_id, sender)
    return {"outcome": "accepted" if accept else "declined", "already": False, **answer}


def public_view(token):
    """Read-only look at a proposal by its token: the least data possible. Never changes anything."""
    ensure_tables_once()
    if not (TOKEN_LENGTH[0] <= len(str(token)) <= TOKEN_LENGTH[1]):
        raise fail(404, "not_found", "Not found.")
    conn = get_connection()
    cursor = conn.cursor()
    try:
        expire_stale(cursor)
        conn.commit()
        req = _load(cursor, token=token)
        if not req:
            raise fail(404, "not_found", "Not found.")
        cursor.execute("SELECT nome FROM users WHERE id = %s", (req["user_id"],))
        name = (cursor.fetchone() or [""])[0] or ""
    finally:
        cursor.close()
        conn.close()
    state = {"counter_proposed": "waiting", "accepted": "accepted", "declined": "declined", "expired": "expired"}.get(req["status"], "unavailable")
    return {
        "state": state, "first_name": (name.split() or [""])[0],
        "session_date": str(req["session_date"])[:10], "session_time": hhmm(req["session_time"]),
        "counter_date": str(req["counter_date"])[:10] if req["counter_date"] else None,
        "counter_time": hhmm(req["counter_time"]) if req["counter_time"] else None,
    }


# ----------------------------------------------------------------------------- the studio's side
def pending_count():
    ensure_tables_once()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        expire_stale(cursor)
        conn.commit()
        cursor.execute("SELECT COUNT(*) FROM reschedule_requests WHERE status = 'pending'")
        return cursor.fetchone()[0]
    finally:
        cursor.close()
        conn.close()


def open_count():
    """Requests that need the studio's attention or an answer: pending + counter_proposed (the menu badge)."""
    ensure_tables_once()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        expire_stale(cursor)
        conn.commit()
        cursor.execute("SELECT status, COUNT(*) FROM reschedule_requests WHERE status = ANY(%s) GROUP BY status", (list(OPEN_STATUSES),))
        counts = {status: total for status, total in cursor.fetchall()}
        return {"pending": counts.get("pending", 0), "counter_proposed": counts.get("counter_proposed", 0),
                "open": sum(counts.values())}
    finally:
        cursor.close()
        conn.close()


def _id_list(value):
    """ "1,3" / [1, 3] -> [1, 3] (anything else is ignored)."""
    parts = value.split(",") if isinstance(value, str) else (value or [])
    return sorted({int(part) for part in parts if str(part).strip().isdigit()})


def list_for_admin(status=None, trainer_id=None, email=None, limit=25, offset=0, trainer_ids=None, request_id=None):
    """Requests filtered and paged: {"items", "total", "counts", "limit", "offset"}.
    `status` may be one status or several separated by commas. Open requests come first, the session
    that is closest first (the most urgent); the closed ones follow, the latest decision first.
    `counts` are per status for the same email / trainer filters (they feed the tabs).
    Open requests carry `conflict`: why the requested (or proposed) hour no longer works, or None."""
    ensure_tables_once()
    statuses = [part.strip() for part in str(status or "").split(",") if part.strip()]
    if any(part not in STATUSES for part in statuses):
        raise fail(422, "invalid_status", "Unknown status.")
    trainers = _id_list(trainer_ids) + ([int(trainer_id)] if trainer_id else [])
    limit = max(1, min(int(limit), 100))
    offset = max(0, int(offset))
    like = f"%{_escape_like(email)}%" if email and str(email).strip() else None
    conn = get_connection()
    cursor = conn.cursor()
    try:
        expire_stale(cursor)
        conn.commit()
        base = """(%(trainers)s::int[] IS NULL OR s.trainer_id = ANY(%(trainers)s::int[]))
                  AND (%(like)s::text IS NULL OR LOWER(u.email) LIKE %(like)s)
                  AND (%(rid)s::int IS NULL OR rr.id = %(rid)s)"""
        where = f"(%(statuses)s::text[] IS NULL OR rr.status = ANY(%(statuses)s::text[])) AND {base}"
        params = {"statuses": statuses or None, "trainers": trainers or None, "like": like, "rid": request_id,
                  "limit": limit, "offset": offset}
        joins = "FROM reschedule_requests rr JOIN users u ON u.id = rr.user_id JOIN sessions s ON s.id = rr.session_id"
        cursor.execute(f"SELECT COUNT(*) {joins} WHERE {where}", params)
        total = cursor.fetchone()[0]
        cursor.execute(f"SELECT rr.status, COUNT(*) {joins} WHERE {base} GROUP BY rr.status", params)
        counts = {name: 0 for name in STATUSES}
        counts.update({name: amount for name, amount in cursor.fetchall()})
        cursor.execute(
            f"""
            SELECT rr.id, rr.session_id, rr.status, rr.original_date, rr.original_time, rr.requested_date, rr.requested_time,
                   rr.client_note, rr.admin_note, rr.counter_date, rr.counter_time, rr.created_at, rr.decided_at,
                   u.id, u.nome, u.email, s.session_number, s.trainer_id, t.nome, rr.lang,
                   t.color, s.session_date, s.session_time, rr.decided_by, s.calendar_sync_status, s.calendar_sync_error, s.status, rr.counter_late,
                   rr.requested_trainer_id, rt.nome
            FROM reschedule_requests rr
            JOIN users u ON u.id = rr.user_id JOIN sessions s ON s.id = rr.session_id
            LEFT JOIN trainers t ON t.id = s.trainer_id
            LEFT JOIN trainers rt ON rt.id = rr.requested_trainer_id
            WHERE {where}
            ORDER BY (rr.status IN ('pending', 'counter_proposed')) DESC,
                     CASE WHEN rr.status IN ('pending', 'counter_proposed') THEN s.session_date + s.session_time END ASC,
                     COALESCE(rr.decided_at, rr.created_at) DESC, rr.id DESC
            LIMIT %(limit)s OFFSET %(offset)s
            """,
            params,
        )
        items = [
            {
                "id": r[0], "session_id": r[1], "status": r[2],
                "original_date": str(r[3])[:10], "original_time": hhmm(r[4]),
                "requested_date": str(r[5])[:10], "requested_time": hhmm(r[6]),
                "client_note": r[7], "admin_note": r[8],
                "counter_date": str(r[9])[:10] if r[9] else None, "counter_time": hhmm(r[10]) if r[10] else None,
                "created_at": r[11].isoformat() if r[11] else None, "decided_at": r[12].isoformat() if r[12] else None,
                "client_id": r[13], "client_name": r[14], "client_email": r[15], "number": r[16],
                "trainer_id": r[17], "trainer": r[18], "lang": r[19],
                "color": r[20], "session_date": str(r[21])[:10], "session_time": hhmm(r[22]), "decided_by": r[23],
                "sync_status": r[24], "sync_error": r[25], "session_status": r[26], "conflict": None,
                "counter_deadline": _deadline(r[21], r[22], r[27]) if r[2] == "counter_proposed" else None,
                "requested_trainer_id": r[28], "requested_trainer": r[29],
            }
            for r in cursor.fetchall()
        ]
        for item in items:                  # is the hour that would be applied still free?
            if item["status"] in OPEN_STATUSES:
                day, time = ((item["counter_date"], item["counter_time"]) if item["status"] == "counter_proposed"
                             else (item["requested_date"], item["requested_time"]))
                asked = item["requested_trainer_id"] if item["status"] != "counter_proposed" else None     # a counter-proposal keeps the session's trainer
                item["conflict"] = _slot_error(cursor, item["client_id"], asked or item["trainer_id"], item["session_id"], day, time)
        return {"items": items, "total": total, "counts": counts, "limit": limit, "offset": offset}
    finally:
        cursor.close()
        conn.close()


def _decide(request_id, admin, allowed, action):
    """Shared shell of approve / reject / counter: locks the request, applies expiry and idempotence,
    runs `action(cursor, req)` inside the transaction and commits. Returns (request_id, repeated)."""
    ensure_tables_once()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        expire_stale(cursor, request_id)
        req = _load(cursor, request_id=request_id, lock=True)
        if not req:
            conn.rollback()
            raise fail(404, "not_found", "Request not found.")
        if req["status"] in allowed["repeat"]:
            conn.rollback()
            return request_id, True                       # already decided this way: nothing happens twice
        if req["status"] not in allowed["from"]:
            conn.commit()                                 # keeps an expiry that was just recorded
            raise fail(409, "closed", f"This request is {req['status']}: it can not be changed.")
        action(cursor, req)
        conn.commit()
        return request_id, False
    except HTTPException:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


def _inbox(kind, request_id, state=""):
    """The inbox message of a decision (the e-mail is separate). Never raises."""
    try:
        conn = get_connection()
        cursor = conn.cursor()
        try:
            context = _context(cursor, request_id)
            cursor.execute("SELECT user_id, session_id FROM reschedule_requests WHERE id = %s", (request_id,))
            owner = cursor.fetchone()
        finally:
            cursor.close()
            conn.close()
        if not context or not owner:
            return
        params = {"number": context["number"] or "", "old_at": inbox.at(context["original_date"], context["original_time"]),
                  "new_at": inbox.at(context["requested_date"], context["requested_time"]), "note": context["admin_note"] or ""}
        if kind == "reschedule_counter":
            params["new_at"] = inbox.at(context["counter_date"], context["counter_time"])
            params["deadline_at"] = (context["counter_deadline"] or "").replace("T", " ")
        inbox.create_system_message(kind, user_id=owner[0], refs={"request_id": request_id, "session_id": owner[1]}, params=params, state=state)
    except Exception as error:  # noqa: BLE001
        logger.error("inbox message of request %s could not be written (%s)", request_id, type(error).__name__)


def approve(request_id, admin=""):
    """Moves the session to the requested day and hour (after checking conflicts again)."""
    def action(cursor, req):
        _move_session(cursor, req, req["requested_date"], req["requested_time"], trainer_id=req["requested_trainer_id"])
        cursor.execute("UPDATE reschedule_requests SET status = 'approved', decided_by = %s, decided_at = NOW() WHERE id = %s", (admin, req["id"]))

    request_id, repeated = _decide(request_id, admin, {"from": ("pending",), "repeat": ("approved",)}, action)
    if not repeated:
        _inbox("reschedule_approved", request_id)
    return {**_after(request_id, None if repeated else notify.client_approved), "repeated": repeated}


def reject(request_id, note=None, admin=""):
    note = _clean_note(note)

    def action(cursor, req):
        cursor.execute(
            "UPDATE reschedule_requests SET status = 'rejected', admin_note = %s, decided_by = %s, decided_at = NOW() WHERE id = %s",
            (note, admin, req["id"]))

    request_id, repeated = _decide(request_id, admin, {"from": ("pending",), "repeat": ("rejected",)}, action)
    if not repeated:
        _inbox("reschedule_rejected", request_id)
    return {**_after(request_id, None if repeated else notify.client_rejected), "repeated": repeated}


def counter(request_id, day, time, note=None, admin="", confirm_late=False):
    """Proposes another day and hour: a free slot, and with time left for the client to answer (they answer until the
    notice hours before the session). Inside that period the server refuses (409 too_late_for_client) unless the
    studio confirms (confirm_late): then the client can answer until the session starts. The studio can also move
    the session directly (admin_reschedule), which never has a notice period."""
    day, time = _clean_slot(day, time)
    note = _clean_note(note)

    def action(cursor, req):
        if str(req["session_status"]).lower() != "booked":
            raise fail(409, "session_not_open", "The session is no longer booked.")
        start = _start(req["session_date"], req["session_time"])
        if start <= _now():
            raise fail(409, "expired", "The session has already started.")
        late = not _enough_notice(start, _now())
        if late and not confirm_late:
            raise fail(409, "too_late_for_client",
                       f"The client will not have time to answer: a proposal needs {_hours()} hours before the session. "
                       "Send it anyway (the client can answer until the session starts) or move the session directly.")
        problem = _slot_error(cursor, req["user_id"], req["trainer_id"], req["session_id"], day, time)
        if problem:
            raise fail(409, "slot_unavailable", problem)
        cursor.execute(
            "UPDATE reschedule_requests SET status = 'counter_proposed', counter_date = %s, counter_time = %s, "
            "admin_note = %s, decided_by = %s, decided_at = NOW(), counter_late = %s WHERE id = %s",
            (day, time, note, admin, late, req["id"]))

    request_id, repeated = _decide(request_id, admin, {"from": ("pending",), "repeat": ()}, action)
    if not repeated:
        _inbox("reschedule_counter", request_id)
    return {**_after(request_id, notify.client_counter), "repeated": repeated}


def resend_email(request_id):
    """Sends again the last e-mail of a request (the panel's "reenviar" button, one per minute is the
    caller's business). Only for states that have a client e-mail."""
    ensure_tables_once()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        context = _context(cursor, request_id)
    finally:
        cursor.close()
        conn.close()
    if not context:
        raise fail(404, "not_found", "Request not found.")
    sender = {"approved": notify.client_approved, "rejected": notify.client_rejected, "counter_proposed": notify.client_counter,
              "pending": notify.staff_requested}.get(context["status"])
    if sender is None:
        raise fail(409, "nothing_to_send", "There is no e-mail to send for this state.")
    return {"email": notify.wait(sender(context))}


def admin_reschedule(session_id, day, time, note=None, admin=""):
    """The studio moves a session directly (no request, no limit for the client): the same checks,
    calendar and Google update as an approval, then an e-mail to the client. An open request for the
    session is closed: approved if the studio moved it to the day the client asked for, otherwise expired."""
    ensure_tables_once()
    day, time = _clean_slot(day, time)
    note = _clean_note(note)
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT user_id, status, session_date, session_time, trainer_id FROM sessions WHERE id = %s FOR UPDATE", (session_id,))
        row = cursor.fetchone()
        if not row:
            raise fail(404, "not_found", "Session not found.")
        req = {"session_id": session_id, "user_id": row[0], "session_status": row[1], "session_date": row[2],
               "session_time": row[3], "trainer_id": row[4]}
        expire_stale(cursor)
        old = (str(row[2])[:10], hhmm(row[3]))
        _move_session(cursor, req, day, time, mark_rescheduled=False)
        cursor.execute(
            "SELECT id, requested_date, requested_time, counter_date, counter_time FROM reschedule_requests "
            "WHERE session_id = %s AND status IN ('pending', 'counter_proposed') FOR UPDATE", (session_id,))
        open_request = cursor.fetchone()
        request_id = None
        if open_request:
            request_id = open_request[0]
            wanted = {(str(open_request[1])[:10], hhmm(open_request[2]))}
            if open_request[3]:
                wanted.add((str(open_request[3])[:10], hhmm(open_request[4])))
            status = "approved" if (day, time) in wanted else "expired"
            cursor.execute(
                "UPDATE reschedule_requests SET status = %s, admin_note = COALESCE(%s, admin_note), decided_by = %s, "
                "decided_at = NOW() WHERE id = %s", (status, note, admin, request_id))
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()
    try:
        inbox.create_system_message(
            "session_rescheduled", user_id=req["user_id"], refs={"session_id": session_id}, state=inbox.at(day, time),
            params={"number": _session_number(session_id), "old_at": inbox.at(old[0], old[1]), "new_at": inbox.at(day, time)})
    except Exception as error:  # noqa: BLE001
        logger.error("inbox message of session %s could not be written (%s)", session_id, type(error).__name__)
    return {"session_id": session_id, "old": {"date": old[0], "time": old[1]}, "new": {"date": day, "time": time},
            "request_id": request_id, "email": notify.wait(notify.session_moved(_moved_context(session_id, old, note, request_id)))}


def _session_number(session_id):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT session_number FROM sessions WHERE id = %s", (session_id,))
        row = cursor.fetchone()
        return (row[0] if row else "") or ""
    finally:
        cursor.close()
        conn.close()


def _moved_context(session_id, old, note, request_id):
    """The e-mail context of a direct move (there may be no request at all)."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT u.nome, u.email, s.session_number, s.session_date, s.session_time, t.nome,
                   (SELECT lang FROM reschedule_requests WHERE user_id = s.user_id AND lang IS NOT NULL ORDER BY id DESC LIMIT 1)
            FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN trainers t ON t.id = s.trainer_id WHERE s.id = %s
            """, (session_id,))
        row = cursor.fetchone()
    finally:
        cursor.close()
        conn.close()
    return {
        "id": request_id or f"s{session_id}", "client_name": row[0], "client_email": row[1], "number": row[2],
        "original_date": old[0], "original_time": old[1], "requested_date": str(row[3])[:10], "requested_time": hhmm(row[4]),
        "session_date": str(row[3])[:10], "session_time": hhmm(row[4]), "trainer": row[5], "lang": row[6],
        "admin_note": note, "client_note": None,
    }


# ----------------------------------------------------------------------------- HTTP
class RequestPayload(BaseModel):
    requested_date: str
    requested_time: str
    note: str | None = None
    lang: str | None = None
    trainer_id: int | None = None      # another trainer at the new hour (optional)


class RejectPayload(BaseModel):
    note: str | None = None


class CounterPayload(BaseModel):
    date: str
    time: str
    note: str | None = None
    confirm_late: bool = False      # send it although the client will not have the full notice period to answer


class DirectPayload(BaseModel):
    session_date: str
    session_time: str
    note: str | None = None


def register_reschedule_routes(app, require_admin, require_client, own_user_id):
    """own_user_id(claims) -> users.id of the signed-in account (or None)."""
    admin = [Depends(require_admin)]

    def me(claims):
        user_id = own_user_id(claims)
        if not user_id:
            raise fail(404, "not_found", "Client not found.")
        return user_id

    def admin_name(claims):
        return str(claims.get("email", ""))[:80]

    # ---- the client (Firebase ID token; only their own sessions and requests)
    @app.post("/me/sessions/{session_id}/reschedule-request")
    def client_create_request(session_id: int, data: RequestPayload, claims=Depends(require_client)):
        return create_request(me(claims), session_id, data.requested_date, data.requested_time, data.note, data.lang, data.trainer_id)

    @app.get("/me/reschedule-requests")
    def client_list_requests(claims=Depends(require_client)):
        """The client's requests (newest first) and the rules the page has to show, read from the
        constants above, so changing them changes the page without touching it."""
        return {
            "items": list_for_user(me(claims)),
            "max_per_session": MAX_RESCHEDULE_REQUESTS_PER_SESSION,
            "notice_hours": _hours(),
            "note_max": NOTE_MAX,
        }

    @app.get("/me/reschedule-requests/{request_id}")
    def client_get_request(request_id: int, claims=Depends(require_client)):
        user_id = me(claims)
        ensure_tables_once()
        conn = get_connection()
        cursor = conn.cursor()
        try:
            expire_stale(cursor, request_id)
            conn.commit()
            req = _load(cursor, request_id=request_id, user_id=user_id)
        finally:
            cursor.close()
            conn.close()
        if not req:
            raise fail(404, "not_found", "Request not found.")
        return _public(req)

    @app.post("/me/reschedule-requests/{request_id}/accept")
    def client_accept(request_id: int, claims=Depends(require_client)):
        return respond(request_id=request_id, user_id=me(claims), accept=True)

    @app.post("/me/reschedule-requests/{request_id}/decline")
    def client_decline(request_id: int, claims=Depends(require_client)):
        return respond(request_id=request_id, user_id=me(claims), accept=False)

    # ---- public, by token: only the answer to a proposal, and only the minimum of data
    @app.get("/reschedule-response/{token}")
    def public_proposal(token: str):
        """Read-only. Opening the link (a mail previewer, an antivirus) decides nothing."""
        return public_view(token)

    @app.post("/reschedule-response/{token}/accept")
    def public_accept(token: str):
        if not (TOKEN_LENGTH[0] <= len(token) <= TOKEN_LENGTH[1]):
            raise fail(404, "not_found", "Not found.")
        answer = respond(token=token, accept=True)
        return {"outcome": answer["outcome"], "already": answer["already"]}

    @app.post("/reschedule-response/{token}/decline")
    def public_decline(token: str):
        if not (TOKEN_LENGTH[0] <= len(token) <= TOKEN_LENGTH[1]):
            raise fail(404, "not_found", "Not found.")
        answer = respond(token=token, accept=False)
        return {"outcome": answer["outcome"], "already": answer["already"]}

    # ---- the studio (Firebase ID token + administrator)
    @app.get("/admin/reschedule-requests", dependencies=admin)
    def admin_list(status: str = "", trainer_id: int | None = None, email: str = "", limit: int = 25, offset: int = 0,
                   trainer_ids: str = "", request_id: int | None = None):
        return list_for_admin(status or None, trainer_id, email, limit, offset, trainer_ids, request_id)

    @app.get("/admin/reschedule-requests/count", dependencies=admin)
    def admin_count():
        """pending (kept as it was), counter_proposed and open = both (the menu badge)."""
        return open_count()

    @app.post("/admin/reschedule-requests/{request_id}/approve")
    def admin_approve(request_id: int, claims=Depends(require_admin)):
        return approve(request_id, admin_name(claims))

    @app.post("/admin/reschedule-requests/{request_id}/reject")
    def admin_reject(request_id: int, data: RejectPayload, claims=Depends(require_admin)):
        return reject(request_id, data.note, admin_name(claims))

    @app.post("/admin/reschedule-requests/{request_id}/counter")
    def admin_counter(request_id: int, data: CounterPayload, claims=Depends(require_admin)):
        return counter(request_id, data.date, data.time, data.note, admin_name(claims), data.confirm_late)

    @app.post("/admin/reschedule-requests/{request_id}/resend-email", dependencies=admin)
    def admin_resend(request_id: int):
        return resend_email(request_id)

    @app.post("/admin/sessions/{session_id}/reschedule")
    def admin_move(session_id: int, data: DirectPayload, claims=Depends(require_admin)):
        return admin_reschedule(session_id, data.session_date, data.session_time, data.note, admin_name(claims))

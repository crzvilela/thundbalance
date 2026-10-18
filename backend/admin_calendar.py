"""The admin calendar: sessions and trial sessions straight from the database, plus the
colour of each trainer.

Everything here reads the DATABASE. It never calls (or depends on) Google Calendar.

GET  /admin/calendar            events of a date range, already in FullCalendar's format
GET  /admin/calendar/emails     e-mail suggestions for the client filter
PUT  /admin/trainers/{id}/color the trainer's colour (one of the 12 palette colours)

Every route is protected with require_admin (the Firebase ID token is verified on the
server and the e-mail must be the admin's).
"""
import re
import threading
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from database import get_connection
from emails.dates import now_madrid

# 12 colours that read well on the dark background (and on white): fixed, in this order.
PALETTE = [
    "#34d399", "#38bdf8", "#f59e0b", "#f472b6", "#a78bfa", "#fb7185",
    "#2dd4bf", "#facc15", "#60a5fa", "#f97316", "#a3e635", "#e879f9",
]
SESSION_MINUTES = 60
MAX_RANGE_DAYS = 70               # a month grid shows up to 42 days
KINDS = ("all", "packs", "trials")
# Trial sessions that are still alive. The others (declined, rejected, cancelled) only show
# in the "Trial sessions" filter, with their status.
LIVE_TRIAL_STATUSES = ("pending", "approved", "confirmed")

_ready = threading.Event()
_lock = threading.Lock()


def next_free_color(cursor):
    """The first palette colour no trainer uses yet (the palette order for the rest if
    all twelve are taken)."""
    cursor.execute("SELECT color FROM trainers WHERE color IS NOT NULL")
    used = {str(row[0]).lower() for row in cursor.fetchall()}
    for color in PALETTE:
        if color not in used:
            return color
    cursor.execute("SELECT COUNT(*) FROM trainers")
    return PALETTE[cursor.fetchone()[0] % len(PALETTE)]


def ensure_columns():
    """Idempotent (also on the production database): trainers.color, a colour for every
    trainer that has none (by id order) and the indexes the calendar reads."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("ALTER TABLE trainers ADD COLUMN IF NOT EXISTS color TEXT")
        # the calendar shows the Google sync state of each session / trial (also created by calendar_sync)
        for table in ("sessions", "trial_sessions"):
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS calendar_sync_status TEXT")
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS calendar_sync_error TEXT")
        cursor.execute("SELECT id FROM trainers WHERE color IS NULL ORDER BY id")
        for (trainer_id,) in cursor.fetchall():
            cursor.execute("UPDATE trainers SET color = %s WHERE id = %s", (next_free_color(cursor), trainer_id))
        cursor.execute("CREATE INDEX IF NOT EXISTS sessions_date_idx ON sessions (session_date)")
        cursor.execute("CREATE INDEX IF NOT EXISTS sessions_trainer_date_idx ON sessions (trainer_id, session_date)")
        cursor.execute("CREATE INDEX IF NOT EXISTS trial_sessions_date_idx ON trial_sessions (session_date)")
        conn.commit()
    finally:
        cursor.close()
        conn.close()
    _ready.set()


def ensure_columns_once():
    """For code that can run before the startup hook did (tests, a cold worker)."""
    if _ready.is_set():
        return
    with _lock:
        if not _ready.is_set():
            ensure_columns()


class ColorPayload(BaseModel):
    color: str


def _hhmm(value):
    return str(value)[:5]


def _date(text, field):
    try:
        return datetime.strptime(str(text), "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{field}: use YYYY-MM-DD") from None


def _phone(phone, code):
    phone = str(phone or "").strip()
    if not phone:
        return ""
    return phone if phone.startswith("+") or not code else f"{str(code).strip()} {phone}"


def _like(text):
    return re.sub(r"([\\%_])", r"\\\1", text)


def session_status(day, moment, status, rescheduled, now):
    """cancelled | completed | rescheduled | booked (completed = the hour has ended in Madrid)."""
    if str(status).lower() == "cancelled":
        return "cancelled"
    end = datetime.strptime(f"{day} {_hhmm(moment)}", "%Y-%m-%d %H:%M") + timedelta(minutes=SESSION_MINUTES)
    if end <= now.replace(tzinfo=None):
        return "completed"
    return "rescheduled" if rescheduled else "booked"


def trial_status(status, token):
    """pending | approved | confirmed | declined | rejected | cancelled. An approved trial with
    no confirmation token was approved before the confirmation flow existed: it counts as confirmed."""
    value = str(status or "pending").lower()
    return "confirmed" if value == "approved" and not token else value


def _iso(day, moment):
    start = datetime.strptime(f"{str(day)[:10]} {_hhmm(moment)}", "%Y-%m-%d %H:%M")
    return start.strftime("%Y-%m-%dT%H:%M:00"), (start + timedelta(minutes=SESSION_MINUTES)).strftime("%Y-%m-%dT%H:%M:00")


def session_event(row, now):
    (session_id, day, moment, status, rescheduled, number, user_id, name, email, phone, code,
     trainer_id, trainer, color, pack, sync_status, sync_error) = row
    start, end = _iso(day, moment)
    number = str(number or "").strip()
    email = str(email or "").strip()
    title = " - ".join(part for part in (number, email) if part) or "—"
    return {
        "id": f"s{session_id}",
        "title": title,
        "start": start,
        "end": end,
        "extendedProps": {
            "kind": "session", "sessionId": session_id, "status": session_status(day, moment, status, rescheduled, now),
            "number": number, "pack": pack or "", "clientId": user_id, "clientName": name or "", "email": email,
            "phone": _phone(phone, code), "trainerId": trainer_id, "trainer": trainer or "", "color": color or "",
            "rescheduled": bool(rescheduled), "syncStatus": sync_status, "syncError": sync_error,
        },
    }


def trial_event(row):
    trial_id, day, moment, status, token, name, email, phone, trainer_id, trainer, color, goal, sync_status, sync_error = row
    start, end = _iso(day, moment)
    email = str(email or "").strip()
    return {
        "id": f"t{trial_id}",
        "title": f"Trial - {email}" if email else "Trial",
        "start": start,
        "end": end,
        "extendedProps": {
            "kind": "trial", "trialId": trial_id, "status": trial_status(status, token),
            "clientName": name or "", "email": email, "phone": str(phone or ""),
            "trainerId": trainer_id, "trainer": trainer or "", "color": color or "", "goal": goal or "",
            "syncStatus": sync_status, "syncError": sync_error,
        },
    }


def calendar_events(cursor, first, last, email=None, trainer_ids=None, kind="all", show_cancelled=False, now=None):
    """Events from `first` (inclusive) to `last` (exclusive) as FullCalendar objects."""
    now = now or now_madrid()
    email = (email or "").strip().lower() or None
    events = []

    if kind in ("all", "packs"):
        where, params = ["s.session_date >= %s", "s.session_date < %s"], [first, last]
        if not show_cancelled:
            where.append("LOWER(s.status) <> 'cancelled'")
        if email:
            where.append("LOWER(u.email) = %s")
            params.append(email)
        if trainer_ids:
            where.append("s.trainer_id = ANY(%s)")
            params.append(trainer_ids)
        cursor.execute(
            f"""
            SELECT s.id, s.session_date, s.session_time, s.status, s.rescheduled, s.session_number,
                   s.user_id, u.nome, u.email, u.telefone, u.codigo_pais,
                   s.trainer_id, t.nome, t.color, COALESCE(p1.nome, p2.nome),
                   s.calendar_sync_status, s.calendar_sync_error
            FROM sessions s
            LEFT JOIN users u ON u.id = s.user_id
            LEFT JOIN trainers t ON t.id = s.trainer_id
            LEFT JOIN user_plans up ON up.id = s.user_plan_id
            LEFT JOIN plans p1 ON p1.id = up.plan_id
            LEFT JOIN client_requests cr ON cr.id = s.request_id
            LEFT JOIN plans p2 ON p2.id = cr.plan_id
            WHERE {' AND '.join(where)}
            ORDER BY s.session_date, s.session_time, s.id
            """,
            params,
        )
        events += [session_event(row, now) for row in cursor.fetchall()]

    if kind in ("all", "trials"):
        where = ["ts.session_date IS NOT NULL", "ts.session_time IS NOT NULL", "ts.session_date >= %s", "ts.session_date < %s"]
        params = [first, last]
        if kind == "all":
            where.append("LOWER(ts.status) = ANY(%s)")
            params.append(list(LIVE_TRIAL_STATUSES))
        if email:
            where.append("LOWER(ts.email) = %s")
            params.append(email)
        if trainer_ids:
            where.append("ts.trainer_id = ANY(%s)")       # a trial with no trainer yet is left out
            params.append(trainer_ids)
        cursor.execute(
            f"""
            SELECT ts.id, ts.session_date, ts.session_time, ts.status, ts.confirmation_token,
                   ts.full_name, ts.email, ts.phone, ts.trainer_id, t.nome, t.color, ts.goal,
                   ts.calendar_sync_status, ts.calendar_sync_error
            FROM trial_sessions ts
            LEFT JOIN trainers t ON t.id = ts.trainer_id
            WHERE {' AND '.join(where)}
            ORDER BY ts.session_date, ts.session_time, ts.id
            """,
            params,
        )
        events += [trial_event(row) for row in cursor.fetchall()]

    events.sort(key=lambda event: (event["start"], event["id"]))
    return events


def register_admin_calendar_routes(app, require_admin):
    admin = [Depends(require_admin)]

    @app.get("/admin/calendar", dependencies=admin)
    def admin_calendar(start: str, end: str, email: str = "", trainer_ids: str = "", kind: str = "all",
                       show_cancelled: bool = False):
        """Sessions and trial sessions of [start, end) (YYYY-MM-DD), optionally filtered by client
        e-mail, trainers (comma separated ids) and kind (all | packs | trials)."""
        first, last = _date(start[:10], "start"), _date(end[:10], "end")
        if last <= first or (last - first).days > MAX_RANGE_DAYS:
            raise HTTPException(status_code=422, detail=f"Choose a range of up to {MAX_RANGE_DAYS} days")
        if kind not in KINDS:
            raise HTTPException(status_code=422, detail="kind must be all, packs or trials")
        try:
            ids = [int(part) for part in trainer_ids.split(",") if part.strip()][:50]
        except ValueError:
            raise HTTPException(status_code=422, detail="trainer_ids must be numbers separated by commas") from None
        ensure_columns_once()
        conn = get_connection()
        cursor = conn.cursor()
        try:
            return calendar_events(cursor, first, last, email[:150], ids or None, kind, show_cancelled)
        finally:
            cursor.close()
            conn.close()

    @app.get("/admin/calendar/emails", dependencies=admin)
    def admin_calendar_emails(q: str = ""):
        """Up to 8 client e-mails (accounts and trial requests) containing the typed text."""
        text = q.strip().lower()[:80]
        if len(text) < 2:
            return []
        pattern = f"%{_like(text)}%"
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                SELECT email FROM (
                    SELECT LOWER(email) AS email FROM users WHERE email ILIKE %s
                    UNION
                    SELECT LOWER(email) FROM trial_sessions WHERE email ILIKE %s
                ) found
                WHERE email <> ''
                ORDER BY email LIMIT 8
                """,
                (pattern, pattern),
            )
            return [row[0] for row in cursor.fetchall()]
        finally:
            cursor.close()
            conn.close()

    @app.put("/admin/trainers/{trainer_id}/color", dependencies=admin)
    def admin_trainer_color(trainer_id: int, data: ColorPayload):
        """Saves the trainer's colour. Only the colours of the palette are accepted."""
        color = data.color.strip().lower()
        if color not in PALETTE:
            raise HTTPException(status_code=422, detail="Choose one of the colours of the palette.")
        ensure_columns_once()
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("UPDATE trainers SET color = %s WHERE id = %s AND active RETURNING id", (color, trainer_id))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="Trainer not found")
            conn.commit()
            return {"id": trainer_id, "color": color}
        except HTTPException:
            conn.rollback()
            raise
        finally:
            cursor.close()
            conn.close()

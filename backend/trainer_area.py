"""Trainer area (backend): a read-only "trainer" role that the admin gives to an email.

TABLES (idempotent, created at startup)
  trainer_access      one ACTIVE access per trainer and one per email (partial unique
                      indexes where revoked_at IS NULL). Revoking only fills revoked_at.
  trainer_access_log  who granted or revoked what, and when.

WHO IS A TRAINER
  The trainer id never comes from the client. require_trainer verifies the Firebase ID
  token, demands email_verified = true and looks the access up (by the token's email, and
  by its uid when one was stored). Every request asks the table, so a revoke is immediate.

WHAT A TRAINER SEES
  Only their own sessions. The answers carry a display name ("First Last"), the pack
  session number ("3/12"), pack name, date, time and status. NEVER an email, phone,
  address, document or internal client id. The same three service functions serve the
  trainer (/trainer-area/me/*) and the admin (/admin/trainers/{id}/panel/*).

Dates and the limits of a day, week (Monday first) and month are Europe/Madrid.
No personal data is ever logged here.
"""
import logging
import threading
import time as _time
from datetime import date as date_type, datetime, timedelta
from typing import Optional

import psycopg2.errors
from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, StrictBool

import availability
import firebase_accounts as accounts
import validators
from admin_calendar import next_free_color
from database import get_connection
from emails.dates import now_madrid
from event_format import display_name

logger = logging.getLogger("thundbalance.trainer_area")

SESSION_MINUTES = 60
MAX_RANGE_DAYS = 366
PERIODS = ("today", "week", "month", "custom")
TRIAL_PACK_NAME = "Trial Session"


# --------------------------------------------------------------------------
# Tables, and the fifth trainer
# --------------------------------------------------------------------------

def ensure_tables():
    """Idempotent. Also run on the production database at startup."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS trainer_access (
                id SERIAL PRIMARY KEY,
                trainer_id INTEGER NOT NULL REFERENCES trainers(id),
                firebase_uid TEXT,
                email TEXT NOT NULL,
                granted_by TEXT,
                granted_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
                revoked_at TIMESTAMP
            )
            """
        )
        cursor.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS trainer_access_one_active_per_trainer "
            "ON trainer_access (trainer_id) WHERE revoked_at IS NULL"
        )
        cursor.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS trainer_access_one_active_per_email "
            "ON trainer_access (email) WHERE revoked_at IS NULL"
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS trainer_access_log (
                id SERIAL PRIMARY KEY,
                action TEXT NOT NULL,
                trainer_id INTEGER,
                email TEXT,
                admin_uid TEXT,
                created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
            )
            """
        )
        conn.commit()
    finally:
        cursor.close()
        conn.close()


def ensure_dominika():
    """The team has five trainers; Dominika must exist and have a colour of her own.

    Created only when no trainer called Dominika exists (active or not: an admin who
    switched her off keeps that decision). A new one has no working hours yet: the
    admin sets them in "Entrenadores"."""
    import admin_calendar
    admin_calendar.ensure_columns()                      # trainers.color + a colour for every trainer
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id, color FROM trainers WHERE LOWER(SPLIT_PART(nome, ' ', 1)) = 'dominika' ORDER BY id LIMIT 1")
        row = cursor.fetchone()
        if not row:
            trainer_id = availability.create_trainer(cursor, "Dominika")
        else:
            trainer_id, color = row
            cursor.execute(
                "SELECT 1 FROM trainers WHERE id <> %s AND LOWER(color) = LOWER(%s)", (trainer_id, color or "")
            )
            if not color or cursor.fetchone():           # no colour, or one another trainer already has
                cursor.execute("SELECT color FROM trainers WHERE id <> %s AND color IS NOT NULL", (trainer_id,))
                used = {str(r[0]).lower() for r in cursor.fetchall()}
                chosen = next((c for c in admin_calendar.PALETTE if c not in used), None) or next_free_color(cursor)
                cursor.execute("UPDATE trainers SET color = %s WHERE id = %s", (chosen, trainer_id))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


# --------------------------------------------------------------------------
# Who is a trainer
# --------------------------------------------------------------------------

def _email(value):
    return str(value or "").strip().lower()


def find_active_access(cursor, email, uid=None):
    """(trainer_id, trainer_name, colour) of the ACTIVE access of this login, or None."""
    cursor.execute(
        """
        SELECT ta.trainer_id, t.nome, t.color
        FROM trainer_access ta JOIN trainers t ON t.id = ta.trainer_id
        WHERE ta.revoked_at IS NULL AND ta.email = %s
          AND (ta.firebase_uid IS NULL OR %s::text IS NULL OR ta.firebase_uid = %s::text)
        LIMIT 1
        """,
        (_email(email), uid, uid),
    )
    row = cursor.fetchone()
    return (row[0], row[1], row[2]) if row else None


# Client endpoints turn trainers away; this answers "is it a trainer?" without a
# query per request (a few seconds of cache, cleared on every grant / revoke).
_TTL = 20
_cache = {}
_cache_lock = threading.Lock()


def forget():
    with _cache_lock:
        _cache.clear()


def is_active_trainer_email(email):
    """True when the email has an active trainer access. A database problem
    answers False: it must never lock the clients out."""
    key = _email(email)
    if not key:
        return False
    now = _time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
    value = False
    try:
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT 1 FROM trainer_access WHERE revoked_at IS NULL AND email = %s LIMIT 1", (key,))
            value = cursor.fetchone() is not None
        finally:
            cursor.close()
            conn.close()
    except Exception:  # noqa: BLE001
        return False
    with _cache_lock:
        _cache[key] = (now + _TTL, value)
    return value


def trainer_turned_away():
    """The 403 for a trainer on a client endpoint."""
    return HTTPException(
        status_code=403,
        detail={
            "code": "trainer_account",
            "message": "Esta cuenta es de entrenador y no puede usar el área de clientes. / "
                       "This is a trainer account and can not use the client area.",
        },
    )


# --------------------------------------------------------------------------
# Service functions (one implementation for the trainer and for the admin)
# --------------------------------------------------------------------------

def parse_date(text, field):
    try:
        return datetime.strptime(str(text or "")[:10], "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{field}: use a date as YYYY-MM-DD") from None


def check_range(first, last):
    """422 unless first <= last and the range is at most 366 days."""
    if last < first:
        raise HTTPException(status_code=422, detail="from must not be after to")
    if (last - first).days + 1 > MAX_RANGE_DAYS:
        raise HTTPException(status_code=422, detail=f"Choose a range of up to {MAX_RANGE_DAYS} days")
    return first, last


def parse_range(first_text, last_text):
    return check_range(parse_date(first_text, "from"), parse_date(last_text, "to"))


def resolve_period(period, first_text=None, last_text=None, today=None):
    """(first, last) of today | week (Monday to Sunday) | month | custom, in Madrid."""
    today = today or now_madrid().date()
    if period == "today":
        return today, today
    if period == "week":
        monday = today - timedelta(days=today.weekday())
        return monday, monday + timedelta(days=6)
    if period == "month":
        first = today.replace(day=1)
        following = (first + timedelta(days=32)).replace(day=1)
        return first, following - timedelta(days=1)
    if period == "custom":
        if not first_text or not last_text:
            raise HTTPException(status_code=422, detail="custom needs from and to")
        return parse_range(first_text, last_text)
    raise HTTPException(status_code=422, detail="period must be today, week, month or custom")


def _hhmm(value):
    return availability.hhmm(value)


def _status(day, moment, raw_status, now):
    if str(raw_status or "").lower() == "cancelled":
        return "cancelled"
    start = datetime.strptime(f"{str(day)[:10]} {_hhmm(moment)}", "%Y-%m-%d %H:%M")
    return "completed" if start + timedelta(minutes=SESSION_MINUTES) <= now else "booked"


def _rows(cursor, trainer_id, first, last, now):
    """Every session and CONFIRMED trial of the trainer between two dates (inclusive), with
    the internal client id only for counting (it never leaves this module)."""
    items = []
    cursor.execute(
        """
        SELECT s.id, s.session_date, s.session_time, s.status, s.rescheduled, s.session_number,
               s.user_id, u.nome, COALESCE(p1.nome, p2.nome)
        FROM sessions s
        LEFT JOIN users u ON u.id = s.user_id
        LEFT JOIN user_plans up ON up.id = s.user_plan_id
        LEFT JOIN plans p1 ON p1.id = up.plan_id
        LEFT JOIN client_requests cr ON cr.id = s.request_id
        LEFT JOIN plans p2 ON p2.id = cr.plan_id
        WHERE s.trainer_id = %s AND s.session_date >= %s AND s.session_date <= %s
        ORDER BY s.session_date, s.session_time, s.id
        """,
        (trainer_id, first, last),
    )
    for session_id, day, moment, raw, rescheduled, number, user_id, name, pack in cursor.fetchall():
        items.append({
            "kind": "session", "id": session_id, "date": str(day)[:10], "time": _hhmm(moment),
            "status": _status(day, moment, raw, now), "rescheduled": bool(rescheduled),
            "number": str(number or "").strip() or None, "client_key": user_id,
            "name": display_name(name), "pack": pack or "",
        })
    # Trial sessions: only CONFIRMED ones (an approved one with no confirmation token was
    # approved before the confirmation flow existed and counts as confirmed). Pending,
    # declined, rejected and cancelled trials are left out.
    cursor.execute(
        """
        SELECT ts.id, ts.session_date, ts.session_time, ts.full_name
        FROM trial_sessions ts
        WHERE ts.trainer_id = %s AND ts.session_date >= %s AND ts.session_date <= %s
          AND ts.session_time IS NOT NULL
          AND (LOWER(ts.status) = 'confirmed' OR (LOWER(ts.status) = 'approved' AND ts.confirmation_token IS NULL))
        ORDER BY ts.session_date, ts.session_time, ts.id
        """,
        (trainer_id, first, last),
    )
    for trial_id, day, moment, name in cursor.fetchall():
        items.append({
            "kind": "trial", "id": trial_id, "date": str(day)[:10], "time": _hhmm(moment),
            "status": _status(day, moment, "booked", now), "rescheduled": False,
            "number": None, "client_key": None, "name": display_name(name), "pack": TRIAL_PACK_NAME,
        })
    items.sort(key=lambda item: (item["date"], item["time"], item["kind"], item["id"]))
    return items


def get_trainer_sessions(cursor, trainer_id, first, last, now=None):
    """[{session_id, client_display_name, session_number, pack_name, date, time, status,
    is_trial}] for the trainer. No email, phone, address, document or client id."""
    now = now or now_madrid()
    return [
        {
            "session_id": item["id"],
            "client_display_name": item["name"],
            "session_number": item["number"],
            "pack_name": item["pack"],
            "date": item["date"],
            "time": item["time"],
            "status": item["status"],
            "is_trial": item["kind"] == "trial",
        }
        for item in _rows(cursor, trainer_id, first, last, now)
    ]


def get_trainer_free_slots(cursor, trainer_id, first, last, now=None):
    """[{date, time}] the trainer can still take, by the SAME rules as
    /trainer/{id}/available-times (working hours minus booked sessions and approved or
    confirmed trials). Slots that already started are left out."""
    now = now or now_madrid()
    slots = availability.free_slots_between(cursor, trainer_id, first, last)
    return [
        {"date": day, "time": hour} for day, hour in slots
        if datetime.strptime(f"{day} {hour}", "%Y-%m-%d %H:%M") > now
    ]


def get_trainer_insights(cursor, trainer_id, first, last, now=None):
    """Numbers of the period for one trainer. No comparison with another period and
    no money.

    - sessions_booked / cancelled / completed / rescheduled: pack sessions with a date in the
      period ("completed" = booked and its hour has passed; "rescheduled" = the session was
      moved at least once: the site keeps a yes/no flag, not a history of moves).
    - trial_sessions: confirmed trials in the period.
    - hours_given: completed pack sessions and trials x 1 hour.
    - distinct_clients: different clients with a completed pack session (counted here).
    - busiest_weekdays / busiest_hours: over the non-cancelled sessions and trials of the period.
    - upcoming_7_days: non-cancelled sessions and trials from now to 7 days ahead.
    - free_hours: free hours from now to the end of the period."""
    now = now or now_madrid()
    rows = _rows(cursor, trainer_id, first, last, now)
    sessions = [r for r in rows if r["kind"] == "session"]
    trials = [r for r in rows if r["kind"] == "trial"]
    live = [r for r in rows if r["status"] != "cancelled"]
    completed = [r for r in live if r["status"] == "completed"]

    weekday_counts, hour_counts = {}, {}
    for item in live:
        weekday = availability.weekday_name(item["date"])
        weekday_counts[weekday] = weekday_counts.get(weekday, 0) + 1
        hour = int(item["time"][:2])
        hour_counts[hour] = hour_counts.get(hour, 0) + 1

    ahead_first = now.date()
    ahead = [
        r for r in _rows(cursor, trainer_id, ahead_first, ahead_first + timedelta(days=7), now)
        if r["status"] == "booked"
        and datetime.strptime(f"{r['date']} {r['time']}", "%Y-%m-%d %H:%M") <= now + timedelta(days=7)
    ]

    return {
        "sessions_booked": sum(1 for r in sessions if r["status"] != "cancelled"),
        "sessions_completed": sum(1 for r in sessions if r["status"] == "completed"),
        "sessions_cancelled": sum(1 for r in sessions if r["status"] == "cancelled"),
        "sessions_rescheduled": sum(1 for r in sessions if r["rescheduled"] and r["status"] != "cancelled"),
        "upcoming_7_days": len(ahead),
        "hours_given": round(len(completed) * SESSION_MINUTES / 60, 2),
        "distinct_clients": len({r["client_key"] for r in completed if r["kind"] == "session" and r["client_key"] is not None}),
        "trial_sessions": sum(1 for r in trials if r["status"] != "cancelled"),
        "free_hours": round(len(get_trainer_free_slots(cursor, trainer_id, first, last, now)) * SESSION_MINUTES / 60, 2),
        "busiest_weekdays": [
            {"weekday": day, "count": count}
            for day, count in sorted(weekday_counts.items(), key=lambda kv: (-kv[1], availability.WEEKDAYS.index(kv[0])))
        ],
        "busiest_hours": [
            {"hour": hour, "count": count}
            for hour, count in sorted(hour_counts.items(), key=lambda kv: (-kv[1], kv[0]))
        ],
    }


# --------------------------------------------------------------------------
# Access management (admin)
# --------------------------------------------------------------------------

class CheckPayload(BaseModel):
    trainer_id: int
    email: str


class GrantPayload(CheckPayload):
    confirm: StrictBool = False


def _log_access(cursor, action, trainer_id, email, admin_uid):
    cursor.execute(
        "INSERT INTO trainer_access_log (action, trainer_id, email, admin_uid) VALUES (%s, %s, %s, %s)",
        (action, trainer_id, email, str(admin_uid or "")[:128]),
    )


def _account_unavailable(error):
    if isinstance(error, accounts.AccountsUnavailable):
        return HTTPException(status_code=503, detail={"code": "firebase_unavailable", "message": f"Firebase Admin no disponible ({error}). / Firebase Admin unavailable."})
    return HTTPException(status_code=502, detail={"code": "firebase_failed", "message": "Firebase no respondió. / Firebase did not answer."})


def evaluate_grant(cursor, trainer_id, email, admin_email, today=None):
    """Everything the admin needs to know before giving a trainer access to an email:
    {account_exists, email_verified, is_admin, is_client_with_activity,
    already_assigned_to_other_trainer, can_grant, reason, firebase_uid}. The server runs
    it again on every grant: a previous check is never trusted."""
    today = today or now_madrid().date()
    try:
        email = validators.validate_email(email)
    except validators.FieldError as error:
        raise validators.http_error(error) from None

    cursor.execute("SELECT 1 FROM trainers WHERE id = %s AND active", (trainer_id,))
    if not cursor.fetchone():
        raise HTTPException(status_code=404, detail="Trainer not found")

    try:
        account = accounts.get_user_by_email(email)
    except (accounts.AccountsUnavailable, accounts.AccountError) as error:
        raise _account_unavailable(error) from None
    account_exists = account is not None
    email_verified = bool(account and account.get("email_verified"))
    is_admin = email == _email(admin_email)

    cursor.execute("SELECT trainer_id FROM trainer_access WHERE revoked_at IS NULL AND email = %s", (email,))
    row = cursor.fetchone()
    held_by = row[0] if row else None
    assigned_to_other = held_by is not None and held_by != trainer_id
    already_this = held_by == trainer_id
    cursor.execute("SELECT 1 FROM trainer_access WHERE revoked_at IS NULL AND trainer_id = %s", (trainer_id,))
    trainer_has_access = cursor.fetchone() is not None

    # a client with an active pack or sessions still to come keeps being a client
    cursor.execute("SELECT id FROM users WHERE LOWER(email) = %s LIMIT 1", (email,))
    user = cursor.fetchone()
    with_activity = False
    if user:
        cursor.execute(
            "SELECT 1 FROM user_plans WHERE user_id = %s AND active AND (end_date IS NULL OR end_date >= %s) LIMIT 1",
            (user[0], today),
        )
        with_activity = cursor.fetchone() is not None
        if not with_activity:
            cursor.execute(
                "SELECT 1 FROM sessions WHERE user_id = %s AND status = 'Booked' AND session_date >= %s LIMIT 1",
                (user[0], today),
            )
            with_activity = cursor.fetchone() is not None

    reason = None
    if not account_exists:
        reason = "no_account"
    elif is_admin:
        reason = "is_admin"
    elif assigned_to_other:
        reason = "already_assigned_to_other_trainer"
    elif already_this:
        reason = "already_granted"
    elif trainer_has_access:
        reason = "trainer_has_access"
    elif with_activity:
        reason = "is_client_with_activity"
    elif not email_verified:
        reason = "email_not_verified"
    return {
        "account_exists": account_exists,
        "email_verified": email_verified,
        "is_admin": is_admin,
        "is_client_with_activity": with_activity,
        "already_assigned_to_other_trainer": assigned_to_other,
        "can_grant": reason is None,
        "reason": reason,
        "firebase_uid": account["uid"] if account else None,
        "email": email,
    }


def _public(check):
    return {key: value for key, value in check.items() if key not in ("firebase_uid", "email")}


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------

def register_trainer_area_routes(app, require_admin, verify_token, admin_email):
    """`verify_token(authorization)` returns the verified Firebase claims (401 otherwise)."""
    from fastapi import Header

    def claims_of(authorization):
        return verify_token(authorization)

    def require_trainer(authorization: str | None = Header(default=None)):
        claims = claims_of(authorization)
        if claims.get("email_verified") is not True:
            raise HTTPException(status_code=403, detail="Verify your email to use the trainer area")
        conn = get_connection()
        cursor = conn.cursor()
        try:
            found = find_active_access(cursor, claims.get("email"), claims.get("sub") or claims.get("user_id"))
        finally:
            cursor.close()
            conn.close()
        if not found:
            raise HTTPException(status_code=403, detail="Trainer access required")
        return {"trainer_id": found[0], "trainer_name": found[1], "trainer_color": found[2]}

    admin = [Depends(require_admin)]

    def with_cursor(work):
        conn = get_connection()
        cursor = conn.cursor()
        try:
            return work(cursor)
        finally:
            cursor.close()
            conn.close()

    def summary_for(trainer_id, period, first, last):
        first_day, last_day = resolve_period(period, first, last)
        data = with_cursor(lambda cursor: get_trainer_insights(cursor, trainer_id, first_day, last_day))
        return {"period": period, "from": str(first_day), "to": str(last_day), **data}

    def sessions_for(trainer_id, first, last):
        first_day, last_day = parse_range(first, last)
        return with_cursor(lambda cursor: get_trainer_sessions(cursor, trainer_id, first_day, last_day))

    def slots_for(trainer_id, first, last):
        first_day, last_day = parse_range(first, last)
        return with_cursor(lambda cursor: get_trainer_free_slots(cursor, trainer_id, first_day, last_day))

    def admin_trainer(trainer_id):
        def look(cursor):
            cursor.execute("SELECT 1 FROM trainers WHERE id = %s", (trainer_id,))
            return cursor.fetchone() is not None
        if not with_cursor(look):
            raise HTTPException(status_code=404, detail="Trainer not found")

    # ------------------------------------------------------------------ who am I
    @app.get("/me/roles")
    def my_roles(authorization: str | None = Header(default=None)):
        claims = claims_of(authorization)
        email = _email(claims.get("email"))
        is_admin = bool(email) and email == _email(admin_email)
        trainer = None
        if claims.get("email_verified") is True and not is_admin:
            trainer = with_cursor(lambda cursor: find_active_access(cursor, email, claims.get("sub") or claims.get("user_id")))
        return {
            "is_admin": is_admin,
            "is_trainer": trainer is not None,
            "trainer_id": trainer[0] if trainer else None,
            "trainer_name": trainer[1] if trainer else None,
            "trainer_color": trainer[2] if trainer else None,         # the colour of the trainer in the calendars
        }

    # ------------------------------------------------------------------ trainer
    @app.get("/trainer-area/me/summary")
    def trainer_summary(period: str = "week", from_: Optional[str] = Query(None, alias="from"), to: Optional[str] = Query(None),
                        trainer=Depends(require_trainer)):
        return summary_for(trainer["trainer_id"], period, from_, to)

    @app.get("/trainer-area/me/sessions")
    def trainer_sessions(from_: Optional[str] = Query(None, alias="from"), to: Optional[str] = Query(None), trainer=Depends(require_trainer)):
        return sessions_for(trainer["trainer_id"], from_, to)

    @app.get("/trainer-area/me/free-slots")
    def trainer_free_slots(from_: Optional[str] = Query(None, alias="from"), to: Optional[str] = Query(None), trainer=Depends(require_trainer)):
        return slots_for(trainer["trainer_id"], from_, to)

    # -------------------------------------------------------------------- admin
    @app.get("/admin/trainers/{trainer_id}/panel/summary", dependencies=admin)
    def admin_panel_summary(trainer_id: int, period: str = "week", from_: Optional[str] = Query(None, alias="from"), to: Optional[str] = Query(None)):
        admin_trainer(trainer_id)
        return summary_for(trainer_id, period, from_, to)

    @app.get("/admin/trainers/{trainer_id}/panel/sessions", dependencies=admin)
    def admin_panel_sessions(trainer_id: int, from_: Optional[str] = Query(None, alias="from"), to: Optional[str] = Query(None)):
        admin_trainer(trainer_id)
        return sessions_for(trainer_id, from_, to)

    @app.get("/admin/trainers/{trainer_id}/panel/free-slots", dependencies=admin)
    def admin_panel_free_slots(trainer_id: int, from_: Optional[str] = Query(None, alias="from"), to: Optional[str] = Query(None)):
        admin_trainer(trainer_id)
        return slots_for(trainer_id, from_, to)

    # ------------------------------------------------------------ access control
    @app.get("/admin/trainer-access", dependencies=admin)
    def list_access():
        def work(cursor):
            cursor.execute(
                """
                SELECT t.id, t.nome, ta.email, ta.granted_at, t.color
                FROM trainers t
                LEFT JOIN trainer_access ta ON ta.trainer_id = t.id AND ta.revoked_at IS NULL
                WHERE t.active
                ORDER BY t.id
                """
            )
            return [
                {
                    "trainer_id": row[0], "name": row[1],
                    "access_status": "active" if row[2] else "none",
                    "email": row[2], "granted_at": row[3].isoformat() if row[3] else None, "color": row[4],
                }
                for row in cursor.fetchall()
            ]
        return with_cursor(work)

    @app.post("/admin/trainer-access/check", dependencies=admin)
    def check_access(data: CheckPayload):
        return with_cursor(lambda cursor: _public(evaluate_grant(cursor, data.trainer_id, data.email, admin_email)))

    @app.post("/admin/trainer-access")
    def grant_access(data: GrantPayload, claims=Depends(require_admin)):
        if data.confirm is not True:
            raise HTTPException(status_code=422, detail={
                "code": "confirmation_required",
                "message": "Confirma la acción (confirm: true). / Confirm the action (confirm: true).",
            })
        conn = get_connection()
        cursor = conn.cursor()
        try:
            check = evaluate_grant(cursor, data.trainer_id, data.email, admin_email)   # again, never trusting a previous check
            if not check["can_grant"]:
                raise HTTPException(status_code=409, detail={"code": check["reason"], **_public(check)})
            admin_uid = claims.get("sub") or claims.get("user_id")
            try:
                cursor.execute(
                    "INSERT INTO trainer_access (trainer_id, firebase_uid, email, granted_by) VALUES (%s, %s, %s, %s) RETURNING granted_at",
                    (data.trainer_id, check["firebase_uid"], check["email"], str(admin_uid or "")[:128]),
                )
            except psycopg2.errors.UniqueViolation:
                conn.rollback()
                raise HTTPException(status_code=409, detail={"code": "already_assigned_to_other_trainer", "can_grant": False}) from None
            granted_at = cursor.fetchone()[0]
            _log_access(cursor, "grant", data.trainer_id, check["email"], admin_uid)
            conn.commit()
            forget()
            logger.info("trainer access granted trainer_id=%s", data.trainer_id)
            return {"trainer_id": data.trainer_id, "access_status": "active", "email": check["email"], "granted_at": granted_at.isoformat()}
        except HTTPException:
            conn.rollback()
            raise
        finally:
            cursor.close()
            conn.close()

    @app.delete("/admin/trainer-access/{trainer_id}")
    def revoke_access(trainer_id: int, claims=Depends(require_admin)):
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "UPDATE trainer_access SET revoked_at = (NOW() AT TIME ZONE 'UTC') "
                "WHERE trainer_id = %s AND revoked_at IS NULL RETURNING email",
                (trainer_id,),
            )
            row = cursor.fetchone()
            if not row:
                conn.rollback()
                raise HTTPException(status_code=404, detail="This trainer has no active access")
            _log_access(cursor, "revoke", trainer_id, row[0], claims.get("sub") or claims.get("user_id"))
            conn.commit()
            forget()
            logger.info("trainer access revoked trainer_id=%s", trainer_id)
            return {"trainer_id": trainer_id, "access_status": "none"}
        finally:
            cursor.close()
            conn.close()

    return require_trainer

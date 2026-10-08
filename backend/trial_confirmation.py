"""Client confirmation of an approved trial session.

Flow: the admin approves (a token is created and the client is emailed), the
client opens /trial-session/confirm/<token>, and only pressing the button on
that page (a POST) confirms or declines. The Google Calendar event is created
at confirmation, not before.

Statuses in trial_sessions.status:
  Pending    waiting for the admin
  Approved   approved, waiting for the client (has a confirmation_token)
  Confirmed  the client confirmed; the calendar event exists (or calendar_error is set)
  Declined   the client said they can't come
  Rejected   declined by the admin       Cancelled  cancelled by the admin
Rows approved before this flow existed stay "Approved" with no token and an
event already on the calendar; the panel shows them as confirmed.

The public endpoints accept only the token and return the least possible data.
"""
import secrets
import traceback

from fastapi import HTTPException

from database import get_connection
from emails.dates import now_madrid, parse_madrid
from google_calendar import create_trial_session_event, delete_calendar_event
import mailer
import trial_notifications

# Statuses whose slot is held for the trainer (availability.py uses the same list).
HOLDING_STATUSES = ("approved", "confirmed")


def ensure_confirmation_fields():
    """Idempotent migration, run at startup (also on the production database)."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("ALTER TABLE trial_sessions ADD COLUMN IF NOT EXISTS confirmation_token TEXT")
        cursor.execute("ALTER TABLE trial_sessions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP")
        cursor.execute("ALTER TABLE trial_sessions ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP")
        cursor.execute("ALTER TABLE trial_sessions ADD COLUMN IF NOT EXISTS declined_at TIMESTAMP")
        cursor.execute("ALTER TABLE trial_sessions ADD COLUMN IF NOT EXISTS calendar_error TEXT")
        cursor.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS trial_sessions_confirmation_token_key "
            "ON trial_sessions (confirmation_token)"
        )
        conn.commit()
    finally:
        cursor.close()
        conn.close()


def new_token():
    return secrets.token_urlsafe(32)


def panel_status(status, token):
    """Status shown in the admin panel (lower case)."""
    value = str(status or "Pending").lower()
    if value == "approved" and not token:
        return "confirmed"   # approved before the confirmation flow: already on the calendar
    return value


def _first_name(full_name):
    return (str(full_name or "").split() or [""])[0]


def _load(cursor, token, lock=False):
    cursor.execute(
        f"""
        SELECT ts.id, ts.full_name, ts.email, ts.phone, ts.age, ts.birth_date, ts.goal, ts.experience,
               ts.session_date, ts.session_time, ts.status, ts.google_event_id, t.nome
        FROM trial_sessions ts
        LEFT JOIN trainers t ON t.id = ts.trainer_id
        WHERE ts.confirmation_token = %s
        {"FOR UPDATE OF ts" if lock else ""}
        """,
        (token,),
    )
    return cursor.fetchone()


def _expired(row):
    return now_madrid() >= parse_madrid(str(row[8]), str(row[9])[:5])


def _trial_dict(row):
    return {
        "id": row[0], "full_name": row[1], "email": row[2], "phone": row[3], "age": row[4],
        "birth_date": row[5].isoformat() if row[5] else None, "goal": row[6], "experience": row[7],
        "session_date": str(row[8])[:10], "session_time": str(row[9])[:5], "trainer": row[12],
    }


def _public_view(row):
    return {
        "first_name": _first_name(row[1]),
        "date": str(row[8])[:10],
        "time": str(row[9])[:5],
    }


def _state(row):
    """Answer for a token: pending_confirmation | confirmed | declined | expired | unavailable."""
    if _expired(row):
        return "expired"
    status = str(row[10]).lower()
    return {"approved": "pending_confirmation", "confirmed": "confirmed", "declined": "declined"}.get(status, "unavailable")


def register_trial_confirmation_routes(app):

    @app.get("/trial-sessions/confirmation/{token}")
    def trial_confirmation_info(token: str):
        """Read-only: opening the link never changes anything."""
        conn = get_connection()
        cursor = conn.cursor()
        try:
            row = _load(cursor, token) if 20 <= len(token) <= 100 else None
            if not row:
                raise HTTPException(status_code=404, detail="not_found")
            return {"state": _state(row), **_public_view(row)}
        finally:
            cursor.close()
            conn.close()

    def _answer(token, wanted):
        """wanted: 'confirmed' or 'declined'. The row is locked, so two quick
        presses (or a double click) can not repeat emails or events."""
        conn = get_connection()
        cursor = conn.cursor()
        try:
            row = _load(cursor, token, lock=True) if 20 <= len(token) <= 100 else None
            if not row:
                conn.rollback()
                raise HTTPException(status_code=404, detail="not_found")
            state = _state(row)
            view = _public_view(row)

            if state == "expired":
                conn.rollback()
                return {"outcome": "expired", **view}
            if state == "unavailable":
                conn.rollback()
                return {"outcome": "unavailable", **view}
            if state == wanted:                       # already done: nothing is repeated
                conn.rollback()
                return {"outcome": f"already_{wanted}", **view}
            if state != "pending_confirmation":       # the other answer was given first
                conn.rollback()
                return {"outcome": f"already_{state}", **view}

            column = "confirmed_at" if wanted == "confirmed" else "declined_at"
            cursor.execute(
                f"UPDATE trial_sessions SET status = %s, {column} = NOW() WHERE id = %s",
                ("Confirmed" if wanted == "confirmed" else "Declined", row[0]),
            )
            conn.commit()                             # the answer is saved before anything else

            trial = _trial_dict(row)
            if wanted == "confirmed":
                calendar_ok = _create_event(row, trial)
                trial_notifications.notify_trial_confirmed(trial, calendar_ok)
                mailer.send_trial_confirmed(
                    trial["email"], _first_name(trial["full_name"]), trial["session_date"],
                    trial["session_time"], trial["trainer"], trial["id"],
                )
            else:
                _remove_event(row)
                trial_notifications.notify_trial_declined(trial)
            return {"outcome": wanted, **view}
        except HTTPException:
            raise
        except Exception as error:  # noqa: BLE001
            conn.rollback()
            traceback.print_exc()
            raise HTTPException(status_code=500, detail="Could not save your answer. Please try again.") from error
        finally:
            cursor.close()
            conn.close()

    @app.post("/trial-sessions/confirmation/{token}/confirm")
    def trial_confirm(token: str):
        return _answer(token, "confirmed")

    @app.post("/trial-sessions/confirmation/{token}/decline")
    def trial_decline(token: str):
        return _answer(token, "declined")


def _create_event(row, trial):
    """Create the Google event. A failure leaves the session confirmed, is
    logged, and sets calendar_error so the panel asks for a manual event."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        try:
            event_id = create_trial_session_event(
                trial["full_name"], trial["email"], trial["phone"], trial["goal"], trial["experience"],
                trial["session_date"], trial["session_time"], trial["trainer"],
            )
            cursor.execute(
                "UPDATE trial_sessions SET google_event_id = %s, calendar_error = NULL WHERE id = %s",
                (event_id, trial["id"]),
            )
            conn.commit()
            return True
        except Exception as error:  # noqa: BLE001
            conn.rollback()
            print(f"Calendar event for trial {trial['id']} could not be created: {type(error).__name__}")
            traceback.print_exc()
            cursor.execute(
                "UPDATE trial_sessions SET calendar_error = %s WHERE id = %s",
                (type(error).__name__[:80], trial["id"]),
            )
            conn.commit()
            return False
    finally:
        cursor.close()
        conn.close()


def _remove_event(row):
    """Delete the calendar event if one exists (a declined session frees the slot)."""
    event_id = row[11]
    if not event_id:
        return
    try:
        delete_calendar_event(event_id)
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("UPDATE trial_sessions SET google_event_id = NULL WHERE id = %s", (row[0],))
            conn.commit()
        finally:
            cursor.close()
            conn.close()
    except Exception:  # noqa: BLE001
        print(f"Calendar event for trial {row[0]} could not be deleted")
        traceback.print_exc()

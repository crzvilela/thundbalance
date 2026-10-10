"""Client confirmation of an approved trial session.

Flow: the admin approves (approve_trial: a token is created, the client is
emailed and a PROVISIONAL "[Pendiente] Trial Session" event is put on the
calendar), the client opens /trial-session/confirm/<token>, and only pressing
the button on that page (a POST) confirms or declines. Confirming updates the
same event; declining deletes it. There is exactly one approval path.

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

from availability import slot_problem
from database import get_connection
from emails import log as email_log
from emails.dates import now_madrid, parse_madrid
from google_calendar import create_trial_session_event, delete_calendar_event, update_trial_session_event
import mailer
import trial_notifications

RESEND_INTERVAL_SECONDS = 60
EMAIL_WAIT_SECONDS = 25


def _bilingual(es, en):
    return f"{es} / {en}"

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
        # Language of the site when the visit asked for the session (en | es | ca).
        # Added without a default first so rows from before stay NULL (they keep the older
        # ES+EN emails); new rows default to 'en', the language the site starts in.
        cursor.execute("ALTER TABLE trial_sessions ADD COLUMN IF NOT EXISTS lang TEXT")
        cursor.execute("ALTER TABLE trial_sessions ALTER COLUMN lang SET DEFAULT 'en'")
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
               ts.session_date, ts.session_time, ts.status, ts.google_event_id, t.nome, ts.lang
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
        "lang": row[13],
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
                calendar_ok = sync_calendar_event(trial["id"], provisional=False)
                trial_notifications.notify_trial_confirmed(trial, calendar_ok)
                mailer.send_trial_confirmed(
                    trial["email"], _first_name(trial["full_name"]), trial["session_date"],
                    trial["session_time"], trial["trainer"], trial["id"], trial["lang"],
                    reference=trial["id"],
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


def _is_gone(error):
    """The Google event no longer exists (deleted by hand in the calendar)."""
    status = getattr(getattr(error, "resp", None), "status", None)
    return status in (404, 410)


def sync_calendar_event(trial_id, provisional):
    """Makes the calendar event match the session and returns True when it does.

    - no event yet  -> creates it (title "[Pendiente] Trial Session · Ana" while
      provisional, "Trial Session · Ana" once confirmed) and stores its id;
    - event exists  -> updates THAT event (never a second one); if somebody
      deleted it in Google, a new one is created.

    The session row is locked while this runs, so a double click on "Crear
    evento" or a confirmation at the same moment can not create two events.
    A failure never undoes the approval or the confirmation: it is logged and
    stored in calendar_error, which the panel shows with a retry button."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT ts.full_name, ts.email, ts.phone, ts.goal, ts.experience, ts.session_date,
                   ts.session_time, ts.google_event_id, t.nome
            FROM trial_sessions ts LEFT JOIN trainers t ON t.id = ts.trainer_id
            WHERE ts.id = %s FOR UPDATE OF ts
            """,
            (trial_id,),
        )
        row = cursor.fetchone()
        if not row:
            conn.rollback()
            return False
        full_name, email, phone, goal, experience, day, time, event_id, trainer = row
        try:
            if event_id:
                try:
                    update_trial_session_event(
                        event_id, full_name, email, phone, goal, experience, trainer, provisional=provisional
                    )
                except Exception as error:  # noqa: BLE001
                    if not _is_gone(error):
                        raise
                    event_id = None
            if not event_id:
                event_id = create_trial_session_event(
                    full_name, email, phone, goal, experience, str(day)[:10], str(time)[:5], trainer,
                    provisional=provisional,
                )
            cursor.execute(
                "UPDATE trial_sessions SET google_event_id = %s, calendar_error = NULL WHERE id = %s",
                (event_id, trial_id),
            )
            conn.commit()
            return True
        except Exception as error:  # noqa: BLE001
            conn.rollback()
            print(f"Calendar event for trial {trial_id} could not be created or updated: {type(error).__name__}")
            traceback.print_exc()
            cursor.execute(
                "UPDATE trial_sessions SET calendar_error = %s WHERE id = %s",
                (type(error).__name__[:80], trial_id),
            )
            conn.commit()
            return False
    finally:
        cursor.close()
        conn.close()


def _email_result(future):
    """(sent, problem) from the Future of an email, waiting for it."""
    try:
        result = future.result(timeout=EMAIL_WAIT_SECONDS)
        return bool(result.ok), ("" if result.ok else result.error)
    except Exception:  # noqa: BLE001 - timeout or worker error
        return False, "timeout"


def approve_trial(trial_id, trainer_id):
    """THE way a trial session becomes "Pendiente de confirmación del cliente".

    1. status -> Approved, trainer and a new token saved (nothing else can
       approve a session: the panel button calls this and only this);
    2. the approval email goes out in the language saved with the booking;
    3. the provisional event is put on the shared calendar.

    Email and calendar failures do not undo the approval. They are reported in
    the return value ({"email": {"sent", "problem"}, "calendar": {"ok"}}), the
    email also in email_log, the calendar in calendar_error."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT full_name, email, session_date, session_time, lang
            FROM trial_sessions
            WHERE id = %s AND LOWER(status) = 'pending'
            FOR UPDATE
            """,
            (trial_id,),
        )
        trial = cursor.fetchone()
        if not trial:
            raise HTTPException(status_code=404, detail="Pending trial request not found")

        cursor.execute("SELECT nome FROM trainers WHERE id = %s", (trainer_id,))
        trainer = cursor.fetchone()
        if not trainer:
            raise HTTPException(status_code=404, detail="Trainer not found")

        problem = slot_problem(cursor, trainer_id, str(trial[2]), str(trial[3])[:5], ignore_trial_id=trial_id)
        if problem:
            raise HTTPException(status_code=409, detail=problem)

        token = new_token()
        cursor.execute(
            """
            UPDATE trial_sessions
            SET status = 'Approved', trainer_id = %s, confirmation_token = %s,
                approved_at = NOW(), rejection_reason = NULL
            WHERE id = %s
            """,
            (trainer_id, token, trial_id),
        )
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()

    # From here on the session IS approved, whatever happens to the email or the calendar.
    full_name, email, day, time, lang = trial
    try:
        future = mailer.send_trial_approved(
            email, _first_name(full_name), str(day)[:10], str(time)[:5], trainer[0], token, lang,
            reference=trial_id,
        )
    except Exception as error:  # noqa: BLE001 - building the email failed
        print(f"Approval email for trial {trial_id} could not be built: {type(error).__name__}")
        email_log.record("trial_approved", trial_id, email, False, "error")
        future = None

    calendar_ok = sync_calendar_event(trial_id, provisional=True)   # runs while the email is sent
    sent, problem = _email_result(future) if future is not None else (False, "error")
    return {
        "email": {"sent": sent, "problem": problem},
        "calendar": {"ok": calendar_ok},
    }


def resend_approval(trial_id):
    """Sends the approval email again with the SAME link (the token does not
    change and stays valid). At most once a minute per session."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT full_name, email, session_date, session_time, lang, status, confirmation_token, t.nome
            FROM trial_sessions ts LEFT JOIN trainers t ON t.id = ts.trainer_id
            WHERE ts.id = %s
            """,
            (trial_id,),
        )
        row = cursor.fetchone()
    finally:
        cursor.close()
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Trial session not found")
    full_name, email, day, time, lang, status, token, trainer = row
    if str(status).lower() != "approved" or not token:
        raise HTTPException(status_code=409, detail=_bilingual(
            "Esta sesión no está pendiente de confirmación del cliente.",
            "This session is not waiting for the client's confirmation."))
    if now_madrid() >= parse_madrid(str(day), str(time)[:5]):
        raise HTTPException(status_code=409, detail=_bilingual(
            "El enlace ya ha caducado: la hora de la sesión ya ha pasado.",
            "The link has expired: the session time has already passed."))
    elapsed = email_log.seconds_since_last("trial_approved", trial_id)
    if elapsed is not None and elapsed < RESEND_INTERVAL_SECONDS:
        wait = int(RESEND_INTERVAL_SECONDS - elapsed) + 1
        raise HTTPException(status_code=429, detail=_bilingual(
            f"Espera {wait} s antes de volver a reenviar el email.",
            f"Wait {wait} s before resending the email."))

    future = mailer.send_trial_approved(
        email, _first_name(full_name), str(day)[:10], str(time)[:5], trainer, token, lang, reference=trial_id,
    )
    sent, problem = _email_result(future)
    return {"email": {"sent": sent, "problem": problem}}


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

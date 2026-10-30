"""Client confirmation of an approved trial session.

Flow: the admin approves (approve_trial: a token is created and the client is
emailed; NOTHING is put on the calendar yet), the client opens
/trial-session/confirm/<token>, and only pressing the button on that page (a
POST) confirms or declines. The calendar event ("Trial Session - Ana Ruiz") is
created only when the client CONFIRMS; declining afterwards deletes it. There
is exactly one approval path. Until the client answers, the hour stays blocked
for the trainer by the database (availability.py counts approved and
confirmed trials), so nobody else can book it.

Statuses in trial_sessions.status:
  Pending    waiting for the admin
  Approved   approved, waiting for the client (has a confirmation_token)
  Confirmed  the client confirmed; the calendar event exists (or calendar_error is set
             and the panel offers "Crear evento en el calendario")
  Declined   the client said they can't come
  Rejected   declined by the admin       Cancelled  cancelled by the admin
Rows approved before this flow existed stay "Approved" with no token; the
panel shows them as confirmed (and offers the calendar button if they have no
event).

The public endpoints accept only the token and return the least possible data.
"""
import logging
import secrets
import traceback

from fastapi import HTTPException

from availability import slot_problem
from database import get_connection
from emails import log as email_log
from emails.dates import now_madrid, parse_madrid
import calendar_sync
import inbox
from google_calendar import (
    create_trial_session_event, delete_calendar_event, describe_error, update_trial_session_event,
)
import mailer
import trial_notifications

logger = logging.getLogger("thundbalance.calendar")

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
        # ok | failed (NULL = unknown, for rows from before): the same pair sessions have
        cursor.execute("ALTER TABLE trial_sessions ADD COLUMN IF NOT EXISTS calendar_sync_status TEXT")
        cursor.execute("ALTER TABLE trial_sessions ADD COLUMN IF NOT EXISTS calendar_sync_error TEXT")
        # SEQUENCE of the client's calendar event: bumped when a confirmed session is declined or cancelled
        cursor.execute("ALTER TABLE trial_sessions ADD COLUMN IF NOT EXISTS feed_sequence INTEGER NOT NULL DEFAULT 0")
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


def _details(trial):
    """What the client's emails say about the kind of session: {type, second person, price per session}."""
    return {
        "session_type": trial.get("session_type"), "second_person_name": trial.get("second_person_name"),
        "price_per_session": trial.get("price_per_session"),
    }


def _first_name(full_name):
    return (str(full_name or "").split() or [""])[0]


def _load(cursor, token, lock=False):
    cursor.execute(
        f"""
        SELECT ts.id, ts.full_name, ts.email, ts.phone, ts.age, ts.birth_date, ts.goal, ts.experience,
               ts.session_date, ts.session_time, ts.status, ts.google_event_id, t.nome, ts.lang,
               ts.session_type, ts.second_person_name, ts.price_per_session
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
        "lang": row[13], "session_type": row[14], "second_person_name": row[15], "price_per_session": row[16],
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


def answer_trial(token, wanted):
    """THE way a client confirms or declines an approved trial session: the e-mail page and the inbox call
    this very function. wanted: 'confirmed' or 'declined'. The row is locked, so two quick presses (or a
    double click) can not repeat emails, events or inbox messages."""
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
        # A confirmed session can still be declined (the event is deleted);
        # a declined one can not be confirmed again from the same link.
        changing_mind = state == "confirmed" and wanted == "declined"
        if state != "pending_confirmation" and not changing_mind:
            conn.rollback()
            return {"outcome": f"already_{state}", **view}

        column = "confirmed_at" if wanted == "confirmed" else "declined_at"
        # a confirmed session that is declined leaves the client's calendar: its SEQUENCE grows
        bump = ", feed_sequence = feed_sequence + 1" if changing_mind else ""
        cursor.execute(
            f"UPDATE trial_sessions SET status = %s, {column} = NOW(){bump} WHERE id = %s",
            ("Confirmed" if wanted == "confirmed" else "Declined", row[0]),
        )
        conn.commit()                             # the answer is saved before anything else

        trial = _trial_dict(row)
        if wanted == "confirmed":
            calendar_ok = sync_calendar_event(trial["id"])
            trial_notifications.notify_trial_confirmed(trial, calendar_ok)
            mailer.send_trial_confirmed(
                trial["email"], _first_name(trial["full_name"]), trial["session_date"],
                trial["session_time"], trial["trainer"], trial["id"], trial["lang"],
                reference=trial["id"], details=_details(trial),
            )
        else:
            _remove_event(row)
            trial_notifications.notify_trial_declined(trial)
        inbox.on_trial_answered(trial, wanted)         # the inbox message (never raises, never repeated)
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

    @app.post("/trial-sessions/confirmation/{token}/confirm")
    def trial_confirm(token: str):
        return answer_trial(token, "confirmed")

    @app.post("/trial-sessions/confirmation/{token}/decline")
    def trial_decline(token: str):
        return answer_trial(token, "declined")


def _is_gone(error):
    """The Google event no longer exists (deleted by hand in the calendar)."""
    status = getattr(getattr(error, "resp", None), "status", None)
    return status in (404, 410)


def sync_calendar_event(trial_id):
    """Makes the calendar event of a CONFIRMED trial session exist and match
    the session, and returns True when it does.

    - no event yet  -> creates it ("Trial Session - Ana Ruiz") with a
      deterministic id and stores it;
    - event exists  -> updates THAT event (never a second one); if somebody
      deleted it in Google, it is created again.

    The session row is locked while this runs, so a double click on "Crear
    evento" or a confirmation at the same moment can not create two events.
    A failure never undoes the confirmation: it is logged and stored in
    calendar_error, which the panel shows with a retry button."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT ts.full_name, ts.email, ts.phone, ts.goal, ts.experience, ts.session_date,
                   ts.session_time, ts.google_event_id, t.nome, ts.session_type, ts.second_person_name
            FROM trial_sessions ts LEFT JOIN trainers t ON t.id = ts.trainer_id
            WHERE ts.id = %s FOR UPDATE OF ts
            """,
            (trial_id,),
        )
        row = cursor.fetchone()
        if not row:
            conn.rollback()
            return False
        full_name, email, phone, goal, experience, day, time, event_id, trainer, session_type, second_name = row
        day, time = str(day)[:10], str(time)[:5]
        try:
            key = calendar_sync.instance_key(cursor)
            wanted_id = calendar_sync.trial_event_id_for(key, trial_id)
            if event_id:
                try:
                    update_trial_session_event(
                        event_id, full_name, email, phone, goal, experience, day, time, trainer,
                        trial_id=trial_id, session_type=session_type, second_person_name=second_name,
                    )
                except Exception as error:  # noqa: BLE001
                    if not _is_gone(error):
                        raise
                    event_id = None
            if not event_id:
                event_id = create_trial_session_event(
                    full_name, email, phone, goal, experience, day, time, trainer,
                    event_id=wanted_id, trial_id=trial_id, session_type=session_type, second_person_name=second_name,
                )
            cursor.execute(
                "UPDATE trial_sessions SET google_event_id = %s, calendar_error = NULL, "
                "calendar_sync_status = 'ok', calendar_sync_error = NULL WHERE id = %s",
                (event_id, trial_id),
            )
            conn.commit()
            return True
        except Exception as error:  # noqa: BLE001
            conn.rollback()
            reason = describe_error(error)
            logger.error("calendar event of trial %s could not be created or updated: %s", trial_id, reason)
            cursor.execute(
                "UPDATE trial_sessions SET calendar_error = %s, calendar_sync_status = 'failed', "
                "calendar_sync_error = %s WHERE id = %s",
                (reason[:200], reason[:200], trial_id),
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
    2. the approval email goes out in the language saved with the booking.

    NO calendar event is created here: it is created when the client
    confirms. The hour stays blocked meanwhile (the database holds it, see
    availability.py).

    An email failure does not undo the approval. It is reported in the return
    value ({"email": {"sent", "problem"}}) and in email_log."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT full_name, email, session_date, session_time, lang, session_type, second_person_name, price_per_session
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
    full_name, email, day, time, lang, session_type, second_name, price = trial
    inbox.on_trial_approved(trial_id, email, day, time)         # the inbox message: parallel to the e-mail, never raises
    try:
        future = mailer.send_trial_approved(
            email, _first_name(full_name), str(day)[:10], str(time)[:5], trainer[0], token, lang,
            reference=trial_id,
            details={"session_type": session_type, "second_person_name": second_name, "price_per_session": price},
        )
    except Exception as error:  # noqa: BLE001 - building the email failed
        logger.error("approval email of trial %s could not be built (%s)", trial_id, type(error).__name__)
        email_log.record("trial_approved", trial_id, email, False, "error")
        future = None

    sent, problem = _email_result(future) if future is not None else (False, "error")
    return {"email": {"sent": sent, "problem": problem}}


def resend_approval(trial_id):
    """Sends the approval email again with the SAME link (the token does not
    change and stays valid). At most once a minute per session."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT ts.full_name, ts.email, ts.session_date, ts.session_time, ts.lang, ts.status, ts.confirmation_token, t.nome,
                   ts.session_type, ts.second_person_name, ts.price_per_session
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
    full_name, email, day, time, lang, status, token, trainer, session_type, second_name, price = row
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
        details={"session_type": session_type, "second_person_name": second_name, "price_per_session": price},
    )
    sent, problem = _email_result(future)
    return {"email": {"sent": sent, "problem": problem}}


def resend_received(trial_id):
    """Sends the "request received" email to the client again, in the language
    saved with the booking. Allowed while the session is still alive (pending,
    approved or confirmed); at most once a minute per session."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT full_name, email, session_date, session_time, lang, status, session_type, second_person_name, price_per_session "
            "FROM trial_sessions WHERE id = %s",
            (trial_id,),
        )
        row = cursor.fetchone()
    finally:
        cursor.close()
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Trial session not found")
    full_name, email, day, time, lang, status, session_type, second_name, price = row
    if str(status).lower() in ("rejected", "cancelled", "declined"):
        raise HTTPException(status_code=409, detail=_bilingual(
            "Esta solicitud ya no está activa: no se reenvía el email.",
            "This request is no longer active: the email is not sent again."))
    elapsed = email_log.seconds_since_last("trial_received", trial_id)
    if elapsed is not None and elapsed < RESEND_INTERVAL_SECONDS:
        wait = int(RESEND_INTERVAL_SECONDS - elapsed) + 1
        raise HTTPException(status_code=429, detail=_bilingual(
            f"Espera {wait} s antes de volver a reenviar el email.",
            f"Wait {wait} s before resending the email."))
    future = mailer.send_trial_received(
        email, _first_name(full_name), str(day)[:10], str(time)[:5], lang, reference=trial_id,
        details={"session_type": session_type, "second_person_name": second_name, "price_per_session": price},
    )
    sent, problem = _email_result(future)
    return {"email": {"sent": sent, "problem": problem}}


def _remove_event(row):
    remove_trial_event(row[0], row[11])


def remove_trial_event(trial_id, event_id):
    """Delete the calendar event if one exists (a declined or cancelled session frees the
    slot). An event that is already gone counts as deleted; any other failure
    is stored in calendar_error and the id is kept so it can be retried."""
    if not event_id:
        return
    row = (trial_id,)
    try:
        try:
            delete_calendar_event(event_id)
        except Exception as error:  # noqa: BLE001
            if not _is_gone(error):
                raise
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "UPDATE trial_sessions SET google_event_id = NULL, calendar_error = NULL, "
                "calendar_sync_status = 'ok', calendar_sync_error = NULL WHERE id = %s", (row[0],)
            )
            conn.commit()
        finally:
            cursor.close()
            conn.close()
    except Exception as error:  # noqa: BLE001
        reason = describe_error(error)
        logger.error("calendar event of trial %s could not be deleted: %s", row[0], reason)
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "UPDATE trial_sessions SET calendar_error = %s, calendar_sync_status = 'failed', "
                "calendar_sync_error = %s WHERE id = %s",
                (f"No se pudo borrar el evento: {reason}"[:200], reason[:200], row[0]),
            )
            conn.commit()
        finally:
            cursor.close()
            conn.close()

"""Restoring a cancelled session of a pack (admin only). Nothing is ever deleted: a cancelled session keeps its row, its number
(x/y stays fixed) and who cancelled it and when; restoring turns it back into 'Booked'.

  POST /admin/sessions/{id}/restore   {date?, time?, trainer_id?, confirm_client_overlap?}

- Only a cancelled session can be restored. Asking again for one that is already active answers 200 {"restored": false,
  "already": true} and changes nothing (no second Google event, no second message).
- The original day, hour and trainer are used unless the admin picks others. The slot is checked with the same rules as every
  other booking (availability.slot_problem: trainer active and working, no session, no approved / confirmed / pending trial) and
  it must be in the future (Madrid). A problem is a 409 with the reason and, when it is the trainer, the trainers who ARE free
  then: the panel lets the admin choose another day / hour / trainer and asks again (the number x/y is kept).
- A client who already has ANOTHER session at that hour (from another pack) is a 409 "client_busy" the admin can confirm
  (confirm_client_overlap = true).
- The Google event is created again by the central rule (calendar_sync.sync_session_to_google): the title "Name Surname x/y",
  the description and the new google_event_id are written there. If Google fails the session is still restored and flagged.
- The client finds a message in their inbox ("Tu sesión … ha sido restaurada"), in their language. No e-mail is sent.
Trial sessions are out of scope: only the sessions of packs are restored.
"""
import logging
import re
import traceback
from datetime import datetime

from fastapi import Depends, HTTPException
from pydantic import BaseModel

import calendar_sync
import inbox
import trainer_choice
from availability import hhmm, slot_problem
from database import get_connection
from emails.dates import now_madrid

logger = logging.getLogger("thundbalance.restore")


class RestorePayload(BaseModel):
    date: str | None = None
    time: str | None = None
    trainer_id: int | None = None
    confirm_client_overlap: bool = False


def _fail(status, code, message, **extra):
    return HTTPException(status_code=status, detail={"code": code, "message": message, **extra})


def _slot(day, time):
    try:
        datetime.strptime(str(day), "%Y-%m-%d")
    except ValueError:
        raise _fail(422, "invalid_slot", "Choose a valid date.") from None
    if not re.fullmatch(r"\d{2}:\d{2}", str(time or "")):
        raise _fail(422, "invalid_slot", "Choose a valid time.")
    return str(day), str(time)


def restore_session(session_id, admin="", date=None, time=None, trainer_id=None, confirm_client_overlap=False):
    conn = get_connection()
    cursor = conn.cursor()
    message = None
    try:
        cursor.execute(
            "SELECT user_id, status, session_date, session_time, trainer_id, session_number FROM sessions WHERE id = %s FOR UPDATE",
            (session_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise _fail(404, "not_found", "Session not found.")
        user_id, status, old_day, old_time, old_trainer, number = row
        if str(status).lower() != "cancelled":
            conn.rollback()
            return {"restored": False, "already": True, "message": "The session is not cancelled."}

        day, moment = _slot(date or str(old_day)[:10], time or hhmm(old_time))
        trainer = trainer_id or old_trainer
        start = datetime.strptime(f"{day} {moment}", "%Y-%m-%d %H:%M")
        if start <= now_madrid().replace(tzinfo=None):
            raise _fail(409, "past", "That day and hour are already in the past. Choose another date and time.")

        problem = slot_problem(cursor, trainer, day, moment, ignore_session_id=session_id)
        if problem:
            raise _fail(409, "trainer_unavailable", problem,
                        alternatives=trainer_choice.free_trainers(cursor, day, moment, ignore_session_id=session_id))

        cursor.execute(
            "SELECT 1 FROM sessions WHERE user_id = %s AND session_date = %s AND session_time = %s AND status = 'Booked' AND id <> %s LIMIT 1",
            (user_id, day, moment, session_id),
        )
        if cursor.fetchone() and not confirm_client_overlap:
            raise _fail(409, "client_busy", "The client already has another session at that day and hour.")

        moved = (day, moment, trainer) != (str(old_day)[:10], hhmm(old_time), old_trainer)
        cursor.execute(
            "UPDATE sessions SET status = 'Booked', session_date = %s, session_time = %s, trainer_id = %s, "
            "rescheduled = rescheduled OR %s, feed_sequence = feed_sequence + 1, "
            "restored_at = NOW() AT TIME ZONE 'UTC', restored_by = %s WHERE id = %s RETURNING restored_at",
            (day, moment, trainer, moved, (str(admin)[:120] or "admin"), session_id),
        )
        restored_at = cursor.fetchone()[0]
        # THE rule: creates the event again (title, description, google_event_id) or flags the failure; never raises
        sync = calendar_sync.sync_session_to_google(session_id, cursor=cursor)
        conn.commit()
        message = {"number": number or "", "new_at": inbox.at(day, moment), "state": restored_at.isoformat()}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as error:  # noqa: BLE001
        conn.rollback()
        traceback.print_exc()
        logger.error("session could not be restored (%s)", type(error).__name__)
        raise _fail(500, "error", "The session could not be restored.") from error
    finally:
        cursor.close()
        conn.close()

    # the client's inbox (after the commit; it never raises, and one message per restoration)
    inbox.create_system_message(
        "session_restored", user_id=user_id, refs={"session_id": session_id},
        params={"number": message["number"], "new_at": message["new_at"]}, state=message["state"],
    )
    return {
        "restored": True, "already": False, "id": session_id, "number": number,
        "date": day, "time": moment, "trainer_id": trainer, "moved": moved,
        "calendar": {"ok": (sync or {}).get("action") != "failed", "error": (sync or {}).get("error")},
    }


def register_restore_routes(app, require_admin):
    @app.post("/admin/sessions/{session_id}/restore")
    def admin_restore_session(session_id: int, data: RestorePayload | None = None, claims=Depends(require_admin)):
        data = data or RestorePayload()
        return restore_session(
            session_id, str((claims or {}).get("email", "")), data.date, data.time, data.trainer_id, data.confirm_client_overlap,
        )

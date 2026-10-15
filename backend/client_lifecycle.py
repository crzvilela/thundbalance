"""Archiving and deleting clients from the admin panel.

ARCHIVE (reversible, organisation only)
  - users.archived_at is set; the client leaves the normal list, searches and
    counters (the lists filter on it);
  - the Firebase account is DISABLED (and its refresh tokens revoked), so the
    client can not sign in; un-archiving enables it again;
  - future sessions are cancelled (and their calendar events deleted) only when
    the admin asked for it, and the second confirmation was sent
    (cancel_future_sessions + confirm_cancel; without the second the server
    answers 409 "confirm_cancel" with the number of sessions);
  - un-archiving never recreates cancelled sessions.

DELETE (irreversible)
  - needs confirm_data = true and the client's full name typed exactly;
  - steps, in this order: calendar events -> database rows -> Firebase user ->
    profile. A step that fails stops the run and the answer (HTTP 502,
    code "delete_incomplete") lists what was done and what is left; running it
    again continues from there. "Event not found" in Google and "user not
    found" in Firebase count as success, so a repeat never fails because
    something was already deleted. The profile row is the LAST thing removed:
    it is what makes the action repeatable.

Both are protected like every /admin route (require_admin: Firebase ID token
verified on the server, email must be the admin's) and refuse the admin
account and the caller's own account. Every action is written to
admin_audit_log: who (the admin's Firebase uid), what, which client id, when,
the outcome. No names, emails or documents are ever logged or stored there.
"""
import logging
import os
import traceback

from fastapi import Depends, HTTPException
from pydantic import BaseModel

import calendar_sync
import firebase_accounts as accounts
import google_calendar
from database import get_connection

logger = logging.getLogger("thundbalance.lifecycle")


class ArchivePayload(BaseModel):
    # also cancel the client's future sessions (and delete their calendar events)
    cancel_future_sessions: bool = False
    # the admin's second confirmation, after seeing how many sessions are cancelled
    confirm_cancel: bool = False


class DeletePayload(BaseModel):
    confirm_data: bool = False
    confirm_name: str = ""


def ensure_columns():
    """Idempotent, run at startup (also on the production database)."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP")
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS admin_audit_log (
                id SERIAL PRIMARY KEY,
                at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
                admin_uid TEXT,
                action TEXT NOT NULL,
                client_id INTEGER,
                outcome TEXT NOT NULL,
                detail TEXT
            )
            """
        )
        conn.commit()
    finally:
        cursor.close()
        conn.close()


def audit(claims, action, client_id, outcome, detail=None):
    """One row in admin_audit_log. Never raises, never holds personal data:
    `detail` is a short code or a list of step names."""
    admin_uid = str((claims or {}).get("user_id") or (claims or {}).get("sub") or "")[:128]
    logger.info("audit action=%s client_id=%s outcome=%s", action, client_id, outcome)
    try:
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "INSERT INTO admin_audit_log (admin_uid, action, client_id, outcome, detail) VALUES (%s, %s, %s, %s, %s)",
                (admin_uid, str(action)[:40], client_id, str(outcome)[:40], None if detail is None else str(detail)[:200]),
            )
            conn.commit()
        finally:
            cursor.close()
            conn.close()
    except Exception as error:  # noqa: BLE001
        logger.error("audit row could not be written (%s)", type(error).__name__)


def _norm(text):
    return " ".join(str(text or "").split()).casefold()


def _refuse_protected(email, firebase_uid, claims, admin_email):
    """403 for the admin account and for the caller's own account."""
    target_email = _norm(email)
    caller_email = _norm((claims or {}).get("email"))
    caller_uid = (claims or {}).get("user_id") or (claims or {}).get("sub")
    protected = (
        (target_email and target_email in {_norm(admin_email), caller_email})
        or (firebase_uid and caller_uid and firebase_uid == caller_uid)
    )
    if protected:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "protected_account",
                "message": "Una cuenta de administrador, o la tuya propia, no se puede archivar ni eliminar. / "
                           "An administrator account, or your own, can not be archived or deleted.",
            },
        )


def _account_problem(error):
    """HTTP error for a Firebase failure (nothing was changed yet)."""
    if isinstance(error, accounts.AccountsUnavailable):
        return HTTPException(
            status_code=503,
            detail={"code": "firebase_unavailable", "message": f"Firebase Admin no disponible ({error}). / Firebase Admin unavailable."},
        )
    return HTTPException(
        status_code=502,
        detail={"code": "firebase_failed", "message": "Firebase no respondió. No se ha cambiado nada. / Firebase failed. Nothing was changed."},
    )


def _delete_events(cursor, items):
    """Deletes Google events for [(session_id | None, event_id)]. "Not found /
    gone" is success. Returns (deleted, failed_reasons) and records the outcome
    on the sessions."""
    deleted, failures = 0, []
    for session_id, event_id in items:
        try:
            google_calendar.delete_calendar_event(event_id)
            deleted += 1
            if session_id is not None:
                calendar_sync.record(cursor, session_id, True)
        except Exception as error:  # noqa: BLE001
            if google_calendar.http_status(error) in (404, 410):
                deleted += 1
                if session_id is not None:
                    calendar_sync.record(cursor, session_id, True)
                continue
            reason = google_calendar.describe_error(error)
            failures.append(reason)
            if session_id is not None:
                calendar_sync.record(cursor, session_id, False, reason)
    return deleted, failures


def register_client_lifecycle_routes(app, require_admin, admin_email, upload_dir=None):

    def load_target(cursor, client_id, claims):
        cursor.execute(
            "SELECT id, nome, email, firebase_uid, archived_at, foto FROM users WHERE id = %s", (client_id,)
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Client not found")
        _refuse_protected(row[2], row[3], claims, admin_email)
        return row

    # ------------------------------------------------------------------ archive
    @app.post("/admin/clients/{client_id}/archive")
    def archive_client(client_id: int, data: ArchivePayload, claims=Depends(require_admin)):
        conn = get_connection()
        cursor = conn.cursor()
        try:
            _, _, email, firebase_uid, archived_at, _ = load_target(cursor, client_id, claims)

            cursor.execute(
                """
                SELECT id FROM sessions
                WHERE user_id = %s AND status = 'Booked' AND session_date >= CURRENT_DATE
                ORDER BY session_date, session_time, id
                """,
                (client_id,),
            )
            future_ids = [row[0] for row in cursor.fetchall()]
            if data.cancel_future_sessions and future_ids and not data.confirm_cancel:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "confirm_cancel",
                        "message": f"{len(future_ids)} future session(s) would be cancelled. Confirm to continue.",
                        "count": len(future_ids),
                    },
                )

            # 1) the login first: if Firebase fails nothing has changed and the
            #    same call can simply be repeated.
            account = "none"
            try:
                uid = accounts.find_uid(firebase_uid, email)
                if uid:
                    accounts.set_disabled(uid, True)
                    account = "disabled"
            except (accounts.AccountsUnavailable, accounts.AccountError) as error:
                audit(claims, "archive", client_id, "failed", "firebase")
                raise _account_problem(error) from None

            # 2) the database
            cancelled_ids = future_ids if data.cancel_future_sessions else []
            cursor.execute(
                "UPDATE users SET archived_at = COALESCE(archived_at, NOW() AT TIME ZONE 'UTC') WHERE id = %s",
                (client_id,),
            )
            if cancelled_ids:
                cursor.execute(
                    "UPDATE sessions SET status = 'Cancelled', feed_sequence = feed_sequence + 1 WHERE id = ANY(%s::int[])",
                    (cancelled_ids,),
                )
            conn.commit()

            # 3) their calendar events: the ones just cancelled, and any left
            #    from an earlier attempt that failed (so repeating the action finishes it)
            cursor.execute(
                """
                SELECT id, google_event_id FROM sessions
                WHERE user_id = %s AND google_event_id IS NOT NULL
                  AND (id = ANY(%s::int[]) OR (status = 'Cancelled' AND calendar_sync_status = 'failed'))
                """,
                (client_id, cancelled_ids),
            )
            pending = [(row[0], row[1]) for row in cursor.fetchall()]
            deleted, failures = _delete_events(cursor, pending) if pending else (0, [])
            conn.commit()

            audit(claims, "archive", client_id, "ok" if not failures else "partial",
                  f"cancelled={len(cancelled_ids)} events_failed={len(failures)}")
            return {
                "message": "Client archived",
                "account": account,
                "cancelled_sessions": len(cancelled_ids),
                "calendar": {"deleted": deleted, "failed": len(failures), "errors": sorted(set(failures))},
            }
        except HTTPException:
            conn.rollback()
            raise
        except Exception as error:  # noqa: BLE001
            conn.rollback()
            traceback.print_exc()
            audit(claims, "archive", client_id, "error", type(error).__name__)
            raise HTTPException(status_code=500, detail="Could not archive the client") from error
        finally:
            cursor.close()
            conn.close()

    @app.post("/admin/clients/{client_id}/unarchive")
    def unarchive_client(client_id: int, claims=Depends(require_admin)):
        conn = get_connection()
        cursor = conn.cursor()
        try:
            _, _, email, firebase_uid, _, _ = load_target(cursor, client_id, claims)
            account = "none"
            try:
                uid = accounts.find_uid(firebase_uid, email)
                if uid:
                    accounts.set_disabled(uid, False)
                    account = "enabled"
            except (accounts.AccountsUnavailable, accounts.AccountError) as error:
                audit(claims, "unarchive", client_id, "failed", "firebase")
                raise _account_problem(error) from None
            cursor.execute("UPDATE users SET archived_at = NULL WHERE id = %s", (client_id,))
            conn.commit()
            audit(claims, "unarchive", client_id, "ok")
            return {"message": "Client restored", "account": account}
        except HTTPException:
            conn.rollback()
            raise
        except Exception as error:  # noqa: BLE001
            conn.rollback()
            traceback.print_exc()
            audit(claims, "unarchive", client_id, "error", type(error).__name__)
            raise HTTPException(status_code=500, detail="Could not restore the client") from error
        finally:
            cursor.close()
            conn.close()

    # ------------------------------------------------------------------- delete
    @app.post("/admin/clients/{client_id}/delete")
    def delete_client(client_id: int, data: DeletePayload, claims=Depends(require_admin)):
        conn = get_connection()
        cursor = conn.cursor()
        steps = []

        def step(name, ok, detail=None):
            steps.append({"id": name, "ok": ok, **({"detail": detail} if detail is not None else {})})

        def incomplete(name):
            remaining = [item for item in ("calendar", "database", "firebase", "profile") if item not in
                         {s["id"] for s in steps if s["ok"]}]
            audit(claims, "delete", client_id, "partial", f"stopped_at={name}")
            raise HTTPException(
                status_code=502,
                detail={
                    "code": "delete_incomplete",
                    "message": "La eliminación no terminó. Se puede repetir sin problema. / "
                               "The deletion did not finish. It is safe to repeat.",
                    "steps": steps,
                    "remaining": remaining,
                },
            )

        try:
            _, name, email, firebase_uid, _, photo = load_target(cursor, client_id, claims)

            if not data.confirm_data or _norm(data.confirm_name) != _norm(name):
                raise HTTPException(
                    status_code=422,
                    detail={
                        "code": "confirmation_required",
                        "message": "Marca la casilla y escribe el nombre completo del cliente. / "
                                   "Tick the box and type the client's full name.",
                    },
                )

            # 1) Google Calendar: every event of the client's sessions and trial
            #    sessions (past and future). The stored id, or the deterministic
            #    one when none was stored.
            key = calendar_sync.instance_key(cursor)
            cursor.execute("SELECT id, google_event_id FROM sessions WHERE user_id = %s", (client_id,))
            items = [
                (row[0], row[1] or calendar_sync.event_id_for(key, row[0])) for row in cursor.fetchall()
            ]
            cursor.execute(
                "SELECT id, google_event_id FROM trial_sessions WHERE LOWER(email) = LOWER(%s)", (email,)
            )
            trial_rows = cursor.fetchall()
            trial_items = [
                (None, row[1] or calendar_sync.trial_event_id_for(key, row[0])) for row in trial_rows
            ]
            wanted = {}
            for session_id, event_id in items + trial_items:
                wanted.setdefault(event_id, session_id)
            # only ask Google when there is something to ask (and it is configured)
            deleted, failures = _delete_events(cursor, [(sid, eid) for eid, sid in wanted.items()]) if wanted else (0, [])
            conn.commit()
            if failures:
                step("calendar", False, {"failed": len(failures), "errors": sorted(set(failures))})
                incomplete("calendar")
            step("calendar", True, {"deleted": deleted})

            # 2) database: sessions, packs, requests, trial sessions and email log
            trial_ids = [str(row[0]) for row in trial_rows]
            cursor.execute("DELETE FROM sessions WHERE user_id = %s", (client_id,))
            cursor.execute("DELETE FROM user_plans WHERE user_id = %s", (client_id,))
            cursor.execute("DELETE FROM client_requests WHERE user_id = %s", (client_id,))
            cursor.execute("DELETE FROM trial_sessions WHERE LOWER(email) = LOWER(%s)", (email,))
            cursor.execute(
                """
                DELETE FROM email_log
                WHERE LOWER(destinatario) = LOWER(%s)
                   OR (tipo LIKE 'trial%%' AND referencia = ANY(%s::text[]))
                """,
                (email, trial_ids),
            )
            conn.commit()
            step("database", True)

            # 3) Firebase (the account may already be gone)
            try:
                uid = accounts.find_uid(firebase_uid, email)
                removed = accounts.delete_account(uid) if uid else False
            except (accounts.AccountsUnavailable, accounts.AccountError) as error:
                step("firebase", False, {"reason": "unavailable" if isinstance(error, accounts.AccountsUnavailable) else "failed"})
                incomplete("firebase")
            step("firebase", True, {"deleted": bool(removed)})

            # 4) the profile (last: it is what makes a repeat possible) and its photo
            cursor.execute("DELETE FROM users WHERE id = %s", (client_id,))
            conn.commit()
            step("profile", True)
            if photo and upload_dir and str(photo).startswith("/uploads/"):
                path = os.path.join(upload_dir, os.path.basename(str(photo)))
                try:
                    if os.path.isfile(path):
                        os.remove(path)
                except OSError:
                    logger.error("A profile photo could not be removed")

            audit(claims, "delete", client_id, "ok")
            return {"message": "Client deleted", "deleted": True, "steps": steps}
        except HTTPException:
            conn.rollback()
            raise
        except Exception as error:  # noqa: BLE001
            conn.rollback()
            traceback.print_exc()
            audit(claims, "delete", client_id, "error", type(error).__name__)
            raise HTTPException(status_code=500, detail="Could not delete the client") from error
        finally:
            cursor.close()
            conn.close()

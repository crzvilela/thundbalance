"""A client's right of access and right to erasure: the export of their data and the request to delete their account.

EXPORT (GET /me/export for the client, GET /admin/clients/{id}/export for the admin): one JSON file with the personal data of ONE
client, found through the id of the signed-in account (never an id sent in the request) or, for the admin, through the id in the path.
It holds the profile and photo, the packs and their history, the sessions, the pack requests, the reschedule requests, the messages
of the inbox addressed to the client, the contact messages and trial sessions made with the client's e-mail, and the list of e-mails
sent to them (type, date, state, language: the subject and the body are not stored). It NEVER holds: data of other clients (a
second person on a pack is data the client gave), the login id, the calendar feed token or any other token, the ids of the calendar
events, the uid of the admin who handled something, the audit log or any configuration. A test checks the forbidden names.

DELETION REQUEST (POST /me/deletion-request): the client asks, nothing is deleted. A row in `deletion_requests` (one pending request
per client) goes to the admin, who approves (the complete deletion of client_lifecycle.perform_delete runs and the request is marked
completed) or rejects it with a short reason. The team gets a notice with the name of the client and the date, and the client a short
confirmation in their language. This protects against a deletion by mistake or by whoever steals a session.

Nothing here writes an e-mail address, a name or exported content to a log: only the type of the action and an abbreviated uid.
"""
import base64
import logging
from datetime import date, datetime, time as dtime
from decimal import Decimal

from fastapi import Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

import client_erasure
import client_lifecycle
import export_html
import emails.privacy_emails as privacy_emails
from database import get_connection
from emails import team_emails
from emails.transport import send_email_async
from safe_log import log_error
from web_safety import SharedRateLimit

logger = logging.getLogger("thundbalance.privacy")

EXPORT_LIMIT = SharedRateLimit("me_export", 3, 3600)            # 3 exports per hour per client
MAX_PHOTO_BYTES = 5 * 1024 * 1024
STATUSES = ("pending", "completed", "rejected")
FORMAT = "thundbalance-personal-data/1"


# ---------------------------------------------------------------------------------------------------------------- schema
def ensure_schema():
    """Idempotent: the requests to delete an account (one pending request per client)."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS deletion_requests (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                status TEXT NOT NULL DEFAULT 'pending',
                handled_by TEXT,
                handled_at TIMESTAMP,
                reason TEXT
            )
            """
        )
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS deletion_requests_one_pending ON deletion_requests (user_id) WHERE status = 'pending'")
        conn.commit()
    finally:
        cursor.close()
        conn.close()


# ---------------------------------------------------------------------------------------------------------------- export
def _jsonable(value):
    if isinstance(value, (datetime, date, dtime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {key: _jsonable(item) for key, item in value.items()}
    return value


def _rows(cursor, sql, args, names):
    cursor.execute(sql, args)
    return [{name: _jsonable(value) for name, value in zip(names, row)} for row in cursor.fetchall()]


def _photo(cursor, user_id, foto):
    """{"kind": "upload", "content_type", "data_base64"} for a photo of ours, {"kind": "external", "url"} for a Google one, or None."""
    if not foto:
        return None
    text = str(foto)
    if text.startswith("/uploads/"):
        cursor.execute("SELECT content_type, data, size FROM uploaded_files WHERE name = %s AND (owner_user_id = %s OR owner_user_id IS NULL)",
                       (text.rsplit("/", 1)[-1], user_id))
        row = cursor.fetchone()
        if row and row[2] and row[2] <= MAX_PHOTO_BYTES:
            return {"kind": "upload", "content_type": row[0], "data_base64": base64.b64encode(bytes(row[1])).decode("ascii")}
        return {"kind": "upload", "available": False}
    return {"kind": "external", "url": text}


def build_export(cursor, user_id):
    """The JSON-ready dict with ONE client's data, or None when there is no such client."""
    cursor.execute(
        "SELECT nome, email, foto, created_at, telefone, codigo_pais, cidade, morada, cep, tax_id_type, tax_id, country, lang FROM users WHERE id = %s",
        (user_id,),
    )
    row = cursor.fetchone()
    if not row:
        return None
    names = ("name", "email", "photo", "created_at", "phone", "phone_country_code", "city", "address", "postal_code", "tax_id_type", "tax_id", "country", "language")
    profile = {name: _jsonable(value) for name, value in zip(names, row) if name != "photo"}
    email = str(row[1] or "").strip().lower()
    photo = _photo(cursor, user_id, row[2])

    packs = _rows(
        cursor,
        """
        SELECT p.nome, up.session_type, up.status, up.active, up.start_date, up.end_date, up.sessions_per_week, up.preferred_days,
               up.preferred_time, t.nome, up.price_per_session, up.total_price, up.weeks, up.second_person_name, up.second_person_email,
               up.extra_emails, up.created_at, up.replaced_at
        FROM user_plans up LEFT JOIN plans p ON p.id = up.plan_id LEFT JOIN trainers t ON t.id = up.trainer_id
        WHERE up.user_id = %s ORDER BY up.created_at, up.id
        """,
        (user_id,),
        ("pack", "session_type", "status", "active", "start_date", "end_date", "sessions_per_week", "preferred_days", "preferred_time",
         "trainer", "price_per_session", "total_price", "weeks", "second_person_name", "second_person_email", "extra_emails", "created_at", "replaced_at"),
    )
    sessions = _rows(
        cursor,
        """
        SELECT s.session_date, s.session_time, s.status, s.session_number, t.nome, s.rescheduled, s.created_at, s.cancelled_at
        FROM sessions s LEFT JOIN trainers t ON t.id = s.trainer_id WHERE s.user_id = %s ORDER BY s.session_date, s.session_time
        """,
        (user_id,),
        ("date", "time", "status", "number", "trainer", "rescheduled", "created_at", "cancelled_at"),
    )
    pack_requests = _rows(
        cursor,
        """
        SELECT p.nome, r.session_type, r.sessions_per_week, r.preferred_days, r.preferred_time, r.status, r.start_date, t.nome,
               r.rejection_reason, r.second_person_name, r.second_person_email, r.created_at
        FROM client_requests r LEFT JOIN plans p ON p.id = r.plan_id LEFT JOIN trainers t ON t.id = r.trainer_id
        WHERE r.user_id = %s ORDER BY r.created_at, r.id
        """,
        (user_id,),
        ("pack", "session_type", "sessions_per_week", "preferred_days", "preferred_time", "status", "start_date", "trainer",
         "rejection_reason", "second_person_name", "second_person_email", "created_at"),
    )
    reschedule = _rows(
        cursor,
        """
        SELECT original_date, original_time, requested_date, requested_time, client_note, status, admin_note, counter_date, counter_time,
               decided_at, created_at
        FROM reschedule_requests WHERE user_id = %s ORDER BY created_at, id
        """,
        (user_id,),
        ("original_date", "original_time", "requested_date", "requested_time", "client_note", "status", "admin_note", "counter_date",
         "counter_time", "decided_at", "created_at"),
    )
    inbox = _rows(
        cursor,
        """
        SELECT m.kind, m.type, m.title, m.body, m.created_at, r.read_at
        FROM inbox_recipients r JOIN inbox_messages m ON m.id = r.message_id
        WHERE r.user_id = %s OR LOWER(r.recipient_email) = %s ORDER BY m.created_at, m.id
        """,
        (user_id, email),
        ("kind", "type", "title", "body", "created_at", "read_at"),
    )
    contact = _rows(
        cursor,
        "SELECT name, email, phone, subject, message, language, created_at FROM contact_messages WHERE LOWER(email) = %s ORDER BY created_at, id",
        (email,),
        ("name", "email", "phone", "subject", "message", "language", "created_at"),
    )
    trials = _rows(
        cursor,
        """
        SELECT s.full_name, s.email, s.phone, s.age, s.birth_date, s.goal, s.experience, s.session_date, s.session_time, s.status,
               t.nome, s.session_type, s.second_person_name, s.second_person_email, s.price_per_session, s.created_at
        FROM trial_sessions s LEFT JOIN trainers t ON t.id = s.trainer_id WHERE LOWER(s.email) = %s ORDER BY s.created_at, s.id
        """,
        (email,),
        ("name", "email", "phone", "age", "birth_date", "goal", "experience", "date", "time", "status", "trainer", "session_type",
         "second_person_name", "second_person_email", "price_per_session", "created_at"),
    )
    emails_sent = _rows(
        cursor,
        "SELECT tipo, estado, criado_em, lang FROM email_log WHERE LOWER(destinatario) = %s ORDER BY criado_em, id",
        (email,),
        ("type", "state", "sent_at", "language"),
    )
    return {
        "export": {
            "format": FORMAT, "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "note": "Your personal data held by ThundBalance. E-mails sent to you are listed by type and date: their subject and text are not stored.",
        },
        "profile": profile, "photo": photo, "packs": packs, "sessions": sessions, "pack_requests": pack_requests,
        "reschedule_requests": reschedule, "inbox": inbox, "contact_messages": contact, "trial_sessions": trials, "emails_sent": emails_sent,
    }


def _download(data, fmt="html"):
    """The export as a file. "html" (the main format: one readable page in the client's language) and "json" (the technical one) are
    written from the SAME data, so their content never differs. Never cached."""
    if fmt not in ("html", "json"):
        raise HTTPException(status_code=422, detail={"code": "invalid_format", "message": "Formato no válido (html o json). / Invalid format (html or json)."})
    headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
    name = f"thundbalance-datos-{date.today().isoformat()}.{fmt}"
    headers["Content-Disposition"] = f'attachment; filename="{name}"'
    if fmt == "json":
        return JSONResponse(content=data, headers=headers)
    headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    return HTMLResponse(content=export_html.render_html(data, (data.get("profile") or {}).get("language")), headers=headers)


# --------------------------------------------------------------------------------------------------------- deletion requests
def _short_uid(claims):
    return str((claims or {}).get("sub") or (claims or {}).get("user_id") or "")[:6]


def _state(row):
    if not row:
        return {"status": "none"}
    return {"id": row[0], "status": row[1], "created_at": _jsonable(row[2]), "handled_at": _jsonable(row[3]), "reason": row[4]}


class ConfirmPayload(BaseModel):
    confirm: bool = False


class RejectPayload(BaseModel):
    reason: str = Field(default="", max_length=200)


def register_privacy_routes(app, require_admin, require_client, own_user_id, is_email_verified, email_not_verified, admin_email):

    def me(claims):
        """The users.id of the signed-in account, taken from the token (never from the request), and only with a verified e-mail."""
        if not is_email_verified(claims):
            raise email_not_verified()
        user_id = own_user_id(claims)
        if user_id is None:
            raise HTTPException(status_code=404, detail={"code": "no_profile", "message": "No hay perfil. / There is no profile."})
        return user_id

    def with_cursor(work):
        conn = get_connection()
        cursor = conn.cursor()
        try:
            result = work(cursor)
            conn.commit()
            return result
        except HTTPException:
            conn.rollback()
            raise
        except Exception as error:  # noqa: BLE001
            conn.rollback()
            log_error(error, op="privacy", logger=logger)
            raise HTTPException(status_code=500, detail="Could not complete the request") from error
        finally:
            cursor.close()
            conn.close()

    # ----------------------------------------------------------------------------------------------------------- the client
    @app.get("/me/export")
    def my_export(format: str = Query("html"), claims=Depends(require_client)):
        if format not in ("html", "json"):
            raise HTTPException(status_code=422, detail={"code": "invalid_format", "message": "Formato no válido (html o json). / Invalid format (html or json)."})
        user_id = me(claims)
        if EXPORT_LIMIT.too_many(f"u{user_id}"):
            raise HTTPException(status_code=429, detail={
                "code": "too_many_exports",
                "message": "Has descargado tus datos varias veces. Espera un rato. / You have downloaded your data several times. Please wait a while.",
            })
        data = with_cursor(lambda cursor: build_export(cursor, user_id))
        client_lifecycle.audit({"sub": _short_uid(claims)}, "me_export", user_id, "ok")
        return _download(data, format)

    @app.get("/me/deletion-request")
    def my_deletion_request(claims=Depends(require_client)):
        user_id = me(claims)

        def read(cursor):
            cursor.execute("SELECT id, status, created_at, handled_at, reason FROM deletion_requests WHERE user_id = %s ORDER BY id DESC LIMIT 1", (user_id,))
            return _state(cursor.fetchone())
        return with_cursor(read)

    @app.post("/me/deletion-request")
    def request_deletion(data: ConfirmPayload, claims=Depends(require_client)):
        user_id = me(claims)
        if not data.confirm:
            raise HTTPException(status_code=422, detail={
                "code": "confirmation_required", "message": "Confirma que quieres pedir la eliminación. / Confirm that you want to ask for the deletion.",
            })
        if str(claims.get("email", "")).strip().casefold() == str(admin_email).strip().casefold():
            raise HTTPException(status_code=403, detail={"code": "protected_account", "message": "Esta cuenta no se puede eliminar. / This account cannot be deleted."})

        def create(cursor):
            cursor.execute("SELECT nome, email, lang FROM users WHERE id = %s", (user_id,))
            name, email, lang = cursor.fetchone()
            cursor.execute(
                "INSERT INTO deletion_requests (user_id) VALUES (%s) ON CONFLICT (user_id) WHERE status = 'pending' DO NOTHING RETURNING id", (user_id,))
            created = cursor.fetchone() is not None
            cursor.execute("SELECT id, status, created_at, handled_at, reason FROM deletion_requests WHERE user_id = %s ORDER BY id DESC LIMIT 1", (user_id,))
            return created, _state(cursor.fetchone()), name, email, lang

        created, state, name, email, lang = with_cursor(create)
        if created:
            client_lifecycle.audit({"sub": _short_uid(claims)}, "me_deletion_request", user_id, "ok")
            try:
                subject, html, text = privacy_emails.team_deletion_request(name, date.today().isoformat())
                send_email_async(team_emails(), subject, html, text, kind="deletion_request_team", lang="es")
                if email:
                    subject, html, text = privacy_emails.client_deletion_received(name, lang)
                    send_email_async(email, subject, html, text, kind="deletion_request", lang=lang or "")
            except Exception as error:  # noqa: BLE001
                log_error(error, op="request_deletion_notice", logger=logger)        # the request is saved: a notice that fails never undoes it
        return {**state, "already_pending": not created}

    # ------------------------------------------------------------------------------------------------------------ the admin
    @app.get("/admin/clients/{client_id}/export")
    def admin_export(client_id: int, format: str = Query("html"), claims=Depends(require_admin)):
        data = with_cursor(lambda cursor: build_export(cursor, client_id))
        if data is None:
            raise HTTPException(status_code=404, detail="Client not found")
        client_lifecycle.audit({"sub": _short_uid(claims)}, "export", client_id, "ok")
        return _download(data, format)

    @app.get("/admin/deletion-requests")
    def list_requests(claims=Depends(require_admin)):
        def read(cursor):
            # a client whose account was already deleted another way no longer needs an answer
            cursor.execute(
                "UPDATE deletion_requests d SET status = 'completed', handled_by = 'system', handled_at = NOW() "
                "WHERE d.status = 'pending' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = d.user_id)")
            cursor.execute(
                """
                SELECT d.id, d.user_id, u.nome, d.created_at, d.status, d.handled_at, d.reason
                FROM deletion_requests d LEFT JOIN users u ON u.id = d.user_id
                ORDER BY (d.status = 'pending') DESC, d.created_at DESC LIMIT 100
                """
            )
            return [{"id": r[0], "client_id": r[1], "client_name": r[2], "created_at": _jsonable(r[3]), "status": r[4], "handled_at": _jsonable(r[5]), "reason": r[6]}
                    for r in cursor.fetchall()]
        return {"items": with_cursor(read)}

    def pending(cursor, request_id):
        cursor.execute("SELECT user_id, status FROM deletion_requests WHERE id = %s FOR UPDATE", (request_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={"code": "request_not_found", "message": "Solicitud no encontrada. / Request not found."})
        if row[1] != "pending":
            raise HTTPException(status_code=409, detail={"code": "request_closed", "message": "Esta solicitud ya está resuelta. / This request is already handled."})
        return row[0]

    @app.post("/admin/deletion-requests/{request_id}/approve")
    def approve(request_id: int, data: ConfirmPayload, claims=Depends(require_admin)):
        if not data.confirm:
            raise HTTPException(status_code=422, detail={"code": "confirmation_required", "message": "Confirma la eliminación. / Confirm the deletion."})
        user_id = with_cursor(lambda cursor: pending(cursor, request_id))

        def check(cursor):
            cursor.execute("SELECT email, firebase_uid FROM users WHERE id = %s", (user_id,))
            row = cursor.fetchone()
            if row:
                client_lifecycle._refuse_protected(row[0], row[1], claims, admin_email)       # never the admin's account
            return row is not None
        exists = with_cursor(check)
        result = client_erasure.ERASER(user_id, claims) if exists else {"deleted": True, "steps": []}     # the complete deletion of client_lifecycle

        def close(cursor):
            cursor.execute("UPDATE deletion_requests SET status = 'completed', handled_by = %s, handled_at = NOW() WHERE id = %s",
                           (_short_uid(claims), request_id))
        with_cursor(close)
        client_lifecycle.audit({"sub": _short_uid(claims)}, "deletion_approved", user_id, "ok", f"request={request_id}")
        return {"status": "completed", "deleted": bool(result.get("deleted", True))}

    @app.post("/admin/deletion-requests/{request_id}/reject")
    def reject(request_id: int, data: RejectPayload, claims=Depends(require_admin)):
        reason = " ".join(data.reason.split())
        if not reason or "<" in reason or ">" in reason:
            raise HTTPException(status_code=422, detail={"code": "reason_required", "message": "Escribe un motivo corto (sin < ni >). / Write a short reason (no < or >)."})
        user_id = with_cursor(lambda cursor: pending(cursor, request_id))

        def close(cursor):
            cursor.execute("UPDATE deletion_requests SET status = 'rejected', handled_by = %s, handled_at = NOW(), reason = %s WHERE id = %s",
                           (_short_uid(claims), reason, request_id))
        with_cursor(close)
        client_lifecycle.audit({"sub": _short_uid(claims)}, "deletion_rejected", user_id, "ok", f"request={request_id}")
        return {"status": "rejected"}

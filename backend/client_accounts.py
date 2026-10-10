"""Clients created by the admin: login account + profile (+ optional pack),
welcome email, resend of credentials, and the "password changed" flag.

Rules kept here:
- every /admin route needs the administrator (require_admin: Firebase ID token
  verified on the server, email must equal ADMIN_EMAIL);
- the password is generated here, set in Firebase only, emailed once, and never
  stored in Postgres, logged, or returned by any endpoint;
- if anything fails after something was created, it is undone (database rows,
  Google Calendar events, the Firebase account).
"""
import logging
import traceback

import psycopg2.errors
from fastapi import Depends, HTTPException
from pydantic import BaseModel

import firebase_accounts as accounts
import tax_id
from database import get_connection
from emails import send_email_async
from emails.dates import parse_madrid
from emails.transport import validate_address
from emails.welcome_emails import build_staff_client_created, build_welcome_email
from packs import create_pack, delete_created_events, validate_pack_request
from trial_notifications import studio_address

logger = logging.getLogger("thundbalance.accounts")

SEND_TIMEOUT = 40


class ClientPack(BaseModel):
    plan_id: int
    sessions_per_week: int
    preferred_days: str
    preferred_time: str
    trainer_id: int
    start_date: str
    allow_conflicts: bool = False


class CreateClient(BaseModel):
    name: str
    email: str
    phone: str | None = None
    country_code: str | None = None
    city: str | None = None
    address: str | None = None
    postal_code: str | None = None
    # invoicing (optional): document type DNI | NIE | PASSPORT | OTHER, document, country
    tax_id_type: str | None = None
    tax_id: str | None = None
    country: str | None = None
    pack: ClientPack | None = None


def ensure_account_fields():
    """Idempotent migration, run at startup (also on the production database)."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE")
        # Invoicing data. morada / cidade / cep already existed and are the billing
        # address; only the document and the country are new. Old rows stay NULL.
        cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS tax_id_type TEXT")
        cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS tax_id TEXT")
        cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT")
        conn.commit()
    finally:
        cursor.close()
        conn.close()


def _bilingual(es, en):
    return f"{es} / {en}"


DUPLICATE = _bilingual(
    "Ya existe una cuenta con este email.",
    "An account with this email already exists.",
)
UNAVAILABLE = _bilingual(
    "La creación de cuentas no está configurada en el servidor.",
    "Account creation is not configured on the server.",
)


def _unavailable(reason):
    """503 text with the reason Firebase Admin is not ready (never a secret)."""
    return f"{UNAVAILABLE} [{reason}]"
FAILED = _bilingual(
    "No se pudo completar la operación. No se ha creado nada.",
    "The operation could not be completed. Nothing was created.",
)


def _text(value, limit):
    return " ".join(str(value or "").split())[:limit] or None


def _pack_summary(cursor, user_id):
    """The client's active pack as an email summary (None without one)."""
    cursor.execute(
        """
        SELECT p.nome, up.sessions_per_week, up.preferred_days, up.start_date, up.end_date, t.nome
        FROM user_plans up
        JOIN plans p ON p.id = up.plan_id
        LEFT JOIN trainers t ON t.id = up.trainer_id
        WHERE up.user_id = %s AND up.active
        ORDER BY up.id DESC LIMIT 1
        """,
        (user_id,),
    )
    plan = cursor.fetchone()
    if not plan:
        return None
    plan_name, per_week, days, start, end, trainer = plan
    cursor.execute(
        """
        SELECT s.id, s.session_date, s.session_time, s.session_number, t.nome
        FROM sessions s LEFT JOIN trainers t ON t.id = s.trainer_id
        WHERE s.user_id = %s AND s.status = 'Booked'
          AND (%s::date IS NULL OR s.session_date >= %s::date)
          AND (%s::date IS NULL OR s.session_date <= %s::date)
        ORDER BY s.session_date, s.session_time
        """,
        (user_id, start, start, end, end),
    )
    sessions = [
        {"id": row[0], "start": parse_madrid(str(row[1]), str(row[2])[:5]), "number": row[3], "trainer": row[4] or trainer}
        for row in cursor.fetchall()
    ]
    if not sessions:
        return None
    return {
        "plan_name": plan_name, "sessions_per_week": per_week,
        "days": [day.strip() for day in str(days or "").split(",") if day.strip()],
        "trainer": trainer, "sessions": sessions,
    }


def send_welcome(name, email, password, pack_summary):
    """Sends the welcome email (with pack summary and .ics when there is a
    pack) and, separately, a password-free notice to the studio. Waits for the
    client's email so the panel can tell the admin what happened. Returns
    {"sent": bool, "problem": str}. Never raises, never logs the password."""
    try:
        subject, html, text, ics = build_welcome_email(name, email, password, pack_summary)
        attachments = [{"filename": "thundbalance-sesiones.ics", "content_type": "text/calendar", "data": ics.encode("utf-8")}] if ics else None
        future = send_email_async(email, subject, html, text, attachments=attachments)

        team_subject, team_html, team_text = build_staff_client_created(name, email, pack_summary)
        send_email_async(studio_address(), team_subject, team_html, team_text)

        result = future.result(timeout=SEND_TIMEOUT)
        return {"sent": bool(result.ok), "problem": "" if result.ok else result.error}
    except Exception as error:  # noqa: BLE001
        logger.error("Welcome email failed (%s)", type(error).__name__)
        return {"sent": False, "problem": "error"}


def register_client_account_routes(app, require_admin, require_client):

    @app.get("/admin/firebase-status", dependencies=[Depends(require_admin)])
    def firebase_status():
        """Is Firebase Admin ready? {"firebase_admin_ready": bool, "reason": text}.
        The reason is "ok" or one of: variável em falta, ficheiro não encontrado,
        JSON inválido, pacote em falta, inicialização falhou. Nothing else."""
        ready, reason = accounts.status()
        return {"firebase_admin_ready": ready, "reason": reason}

    @app.post("/admin/clients", dependencies=[Depends(require_admin)])
    def admin_create_client(data: CreateClient):
        """Creates a client end to end: profile, Firebase login with a generated
        password (must change it at first login), optional pack, welcome email."""
        name = _text(data.name, 120)
        if not name:
            raise HTTPException(status_code=422, detail=_bilingual("El nombre es obligatorio.", "The name is required."))
        try:
            email = validate_address(data.email, "email").lower()
        except ValueError:
            raise HTTPException(status_code=422, detail=_bilingual("El email no es válido.", "The email is not valid.")) from None

        try:
            doc_type, document = tax_id.clean(data.tax_id_type, data.tax_id)
        except tax_id.TaxIdError as error:
            raise HTTPException(status_code=422, detail=error.message) from None

        conn = get_connection()
        cursor = conn.cursor()
        created_event_ids = []
        uid = None
        pack_summary = None
        pack_info = None
        try:
            cursor.execute("SELECT 1 FROM users WHERE LOWER(email) = %s", (email,))
            if cursor.fetchone():
                raise HTTPException(status_code=409, detail=DUPLICATE)

            cursor.execute(
                """
                INSERT INTO users (nome, email, telefone, codigo_pais, cidade, morada, cep, must_change_password,
                                   tax_id_type, tax_id, country)
                VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE, %s, %s, %s)
                RETURNING id
                """,
                (name, email, _text(data.phone, 40), _text(data.country_code, 10), _text(data.city, 80),
                 _text(data.address, 200), _text(data.postal_code, 20), doc_type, document, _text(data.country, 60)),
            )
            user_id = cursor.fetchone()[0]

            if data.pack:
                pack = data.pack
                trainer_name, days = validate_pack_request(
                    cursor, trainer_id=pack.trainer_id, sessions_per_week=pack.sessions_per_week,
                    preferred_days=pack.preferred_days, start_date=pack.start_date,
                )
                created = create_pack(
                    cursor, created_event_ids,
                    user_id=user_id, client_name=name, client_email=email,
                    plan_id=pack.plan_id, trainer_id=pack.trainer_id, trainer_name=trainer_name,
                    sessions_per_week=pack.sessions_per_week, preferred_days=",".join(days),
                    preferred_time=pack.preferred_time, start_date=pack.start_date,
                    allow_conflicts=pack.allow_conflicts,
                )
                pack_summary = {
                    "client_name": name, "client_email": email, "plan_name": created["plan_name"],
                    "sessions_per_week": pack.sessions_per_week, "days": days,
                    "trainer": trainer_name, "sessions": created["sessions"],
                }
                pack_info = {
                    "total_sessions": created["total_sessions"],
                    "calendar_failed": created["calendar_failed"],
                    "calendar_errors": created["calendar_errors"],
                    "start_date": created["session_dates"][0],
                    "end_date": created["session_dates"][-1],
                }

            # The login account is created last: if it fails, nothing else exists yet outside
            # this (uncommitted) transaction and the calendar events are deleted below.
            password = accounts.generate_password()
            uid = accounts.create_login(email, password, name)
            cursor.execute("UPDATE users SET firebase_uid = %s WHERE id = %s", (uid, user_id))
            conn.commit()
        except HTTPException:
            conn.rollback()
            delete_created_events(created_event_ids)
            if uid:
                accounts.delete_login(uid)
            raise
        except accounts.EmailAlreadyRegistered:
            conn.rollback()
            delete_created_events(created_event_ids)
            raise HTTPException(status_code=409, detail=DUPLICATE) from None
        except accounts.AccountsUnavailable as error:
            conn.rollback()
            delete_created_events(created_event_ids)
            logger.error("Account creation unavailable: %s", error)
            raise HTTPException(status_code=503, detail=_unavailable(str(error))) from None
        except psycopg2.errors.UniqueViolation:
            # Two requests for the same email at once (double click): the second one loses.
            conn.rollback()
            delete_created_events(created_event_ids)
            if uid:
                accounts.delete_login(uid)
            raise HTTPException(status_code=409, detail=DUPLICATE) from None
        except Exception as error:  # noqa: BLE001
            conn.rollback()
            delete_created_events(created_event_ids)
            if uid:
                accounts.delete_login(uid)
            logger.error("Client creation failed (%s)", type(error).__name__)
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=FAILED) from None
        finally:
            cursor.close()
            conn.close()

        email_result = send_welcome(name, email, password, pack_summary)
        del password
        return {"id": user_id, "email": email_result, "pack": pack_info}

    @app.post("/admin/clients/{client_id}/resend-credentials", dependencies=[Depends(require_admin)])
    def admin_resend_credentials(client_id: int):
        """New temporary password + the welcome email again. Only while the
        client still has the temporary password (has not changed it yet)."""
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT nome, email, firebase_uid, must_change_password FROM users WHERE id = %s",
                (client_id,),
            )
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Client not found")
            name, email, uid, must_change = row
            if not must_change or not uid:
                raise HTTPException(
                    status_code=409,
                    detail=_bilingual(
                        "Este cliente ya cambió su contraseña, no se pueden reenviar credenciales.",
                        "This client has already changed their password, credentials cannot be resent.",
                    ),
                )
            pack_summary = _pack_summary(cursor, client_id)

            password = accounts.generate_password()
            try:
                accounts.set_password(uid, password)
            except accounts.AccountsUnavailable as error:
                logger.error("Resend unavailable: %s", error)
                raise HTTPException(status_code=503, detail=_unavailable(str(error))) from None
            except accounts.AccountError:
                raise HTTPException(
                    status_code=502,
                    detail=_bilingual("No se pudo cambiar la contraseña en Firebase.", "The password could not be changed in Firebase."),
                ) from None
        finally:
            cursor.close()
            conn.close()

        email_result = send_welcome(name, email, password, pack_summary)
        del password
        return {"id": client_id, "email": email_result}

    @app.post("/me/password-changed")
    def password_changed(claims=Depends(require_client)):
        """The signed-in client has just changed their password in Firebase:
        the temporary-password notice goes away. (The flag only controls that
        notice; it is not an access control.)"""
        email = str(claims.get("email", "")).strip().lower()
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "UPDATE users SET must_change_password = FALSE WHERE firebase_uid = %s OR LOWER(email) = %s",
                (claims.get("sub"), email),
            )
            conn.commit()
            return {"ok": True}
        finally:
            cursor.close()
            conn.close()

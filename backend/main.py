from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, Header, Request, Response

import os
import hashlib
import web_safety
import re
import threading
import time as _time
import json
from safe_log import log_error, safe_error
import uuid
from datetime import datetime, timedelta
from typing import Any
from pydantic import BaseModel
from database import get_connection, run_read
import schedule_cache
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from psycopg2.extras import Json as PgJson
from google_calendar import (
    create_calendar_event,
    update_calendar_event,
    delete_calendar_event,
    create_trial_session_event,
    clear_calendar
)
from landing_page_default import DEFAULT_LANDING_CONTENT
from admin_api import register_admin_routes
import data_retention
import landing_limits
import photo_urls
import landing_pricing
import pack_catalog
import pack_schedule
import plans_schema
import pricing
import trainer_area
from client_lifecycle import ensure_columns as ensure_lifecycle_columns, register_client_lifecycle_routes
import admin_calendar
import logging
import client_lang
import session_restore
import trainer_choice
from bulk_actions import BulkPayload, run_each, unknown_action
import inbox
import reschedule_requests
from features import client_calendar_enabled, reschedule_min_hours_before
from contact_messages import register_contact_routes
from trial_notifications import notify_trial_requested
import mailer
from packs import (
    clean_pack_recipients, create_pack, publish_calendar, email_pack,
    ensure_pack_columns, preview_pack,
)
import pack_view
from emails import send_pack_summary_email, team_emails
from emails import log as email_log
from emails.texts import normalize_language
import admin_ui_settings
import calendar_reconcile
import calendar_sync
import calendar_feed
import google_calendar
import tax_id
import validators
from trial_confirmation import ensure_confirmation_fields, register_trial_confirmation_routes
from client_accounts import ensure_account_fields, register_client_account_routes
import firebase_accounts
from availability import (
    WEEKDAYS,
    ensure_trainers_and_availability,
    purge_unused_inactive_trainers,
    free_start_times,
    free_start_times_any_trainer,
    slot_problem,
    trainers_for_slot,
    weekday_name,
    weekly_start_times,
    within_hours,
)
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import id_token




# Application logs go to the console at INFO (ids and outcomes, never names or e-mails).
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper(), format="%(levelname)s %(name)s: %(message)s")

web_safety.start_error_reporting()
# The interactive API docs list every route: only on request (ENABLE_API_DOCS=1), never in production.
_DOCS = os.getenv("ENABLE_API_DOCS", "").strip() == "1"
app = FastAPI(docs_url="/docs" if _DOCS else None, redoc_url=None, openapi_url="/openapi.json" if _DOCS else None)
web_safety.register_safety(app)

# Sites allowed to call this API from a browser. Extra ones (the final domain)
# come from CORS_ORIGINS in the environment, comma separated, so changing
# domain is a Render setting and not a code change.
# In production only the production site and what CORS_ORIGINS lists are allowed; localhost is added only when ENV / ENVIRONMENT
# says development (web_safety.cors_origins). Never "*".
CORS_ORIGINS = web_safety.cors_origins()

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.exception_handler(RequestValidationError)
async def validation_error_without_input(request, exc):
    """422 for a malformed body, without FastAPI's default echo of the offending
    input (it could repeat a document number or an address)."""
    return JSONResponse(
        status_code=422,
        content={"detail": [{"loc": list(e.get("loc", [])), "msg": e.get("msg"), "type": e.get("type")} for e in exc.errors()]},
    )


FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "thundbalance").strip()
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "david@admin.es").strip().casefold()
firebase_token_request = GoogleAuthRequest()


_revocation_not_configured_logged = False
WRITE_METHODS = ("POST", "PUT", "PATCH", "DELETE")


def _check_revocation(token, strict):
    """Asks Firebase whether the login was revoked (account deleted or disabled), so it stops working at once instead of after the hour
    the ID token lasts. A revoked login is a plain 401 with the same text as any invalid one. If Firebase can not be reached the
    request goes on (`strict` False: nobody is locked out by a passing problem) or is refused with 503 (`strict` True: the admin
    routes); only the TYPE of the error is logged. If Firebase Admin is not configured on this server nothing can be checked: the
    request goes on and a warning is logged once."""
    global _revocation_not_configured_logged
    try:
        firebase_accounts.ensure_not_revoked(token)
    except firebase_accounts.TokenRevoked:
        raise HTTPException(status_code=401, detail="Invalid or expired login") from None
    except firebase_accounts.AccountsUnavailable:
        if not _revocation_not_configured_logged:
            _revocation_not_configured_logged = True
            logging.getLogger("thundbalance.accounts").warning("Revoked logins are NOT checked: Firebase Admin is not configured")
    except Exception as error:  # noqa: BLE001
        log_error(error, op="check_revoked")
        if strict:
            raise HTTPException(status_code=503, detail="Your login could not be checked right now. Please try again.") from None


def _is_sensitive(request):
    """A route that deletes, approves, cancels or changes data (any write, except the inbox's own read / archive marks)."""
    return request is not None and request.method in WRITE_METHODS and not request.url.path.startswith("/inbox")


def require_admin(authorization: str | None = Header(default=None)):
    """Verify a Firebase ID token and allow only the configured admin email. Every admin route also checks that the login was not
    revoked, and refuses when that can not be checked."""
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.casefold() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        claims = id_token.verify_firebase_token(
            token,
            firebase_token_request,
            audience=FIREBASE_PROJECT_ID,
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired login")

    expected_issuer = f"https://securetoken.google.com/{FIREBASE_PROJECT_ID}"
    if claims.get("iss") != expected_issuer:
        raise HTTPException(status_code=401, detail="Invalid login issuer")

    token_email = str(claims.get("email", "")).strip().casefold()
    if not ADMIN_EMAIL or token_email != ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Administrator access required")
    _check_revocation(token, strict=True)

    return claims


def verified_claims(authorization, check_revoked=False):
    """The verified Firebase claims of a Bearer token (401 otherwise); no role is checked. With `check_revoked` Firebase is also asked
    whether the login was revoked (the sensitive client routes)."""
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.casefold() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        claims = id_token.verify_firebase_token(
            token, firebase_token_request, audience=FIREBASE_PROJECT_ID
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired login")
    if claims.get("iss") != f"https://securetoken.google.com/{FIREBASE_PROJECT_ID}":
        raise HTTPException(status_code=401, detail="Invalid login issuer")
    if check_revoked:
        _check_revocation(token, strict=False)
    return claims


def require_client(authorization: str | None = Header(default=None), request: Request = None):
    """Verify a Firebase token for client-owned workflow endpoints. A trainer account
    (trainer_area.py) has no client rights and is turned away with 403. Routes that change data also check the login was not revoked."""
    claims = verified_claims(authorization, check_revoked=_is_sensitive(request))
    token_email = str(claims.get("email", "")).strip().casefold()
    if token_email != ADMIN_EMAIL and trainer_area.is_active_trainer_email(token_email):
        raise trainer_area.trainer_turned_away()
    return claims


def require_inbox_user(authorization: str | None = Header(default=None), request: Request = None):
    """Anyone with an account on the site: a client, the admin or a trainer (require_client turns
    trainers away). Used by the inbox and by the profile (a trainer reads and edits their own)."""
    return verified_claims(authorization, check_revoked=_is_sensitive(request))


require_account = require_inbox_user


register_admin_routes(app, require_admin)
trainer_area.register_trainer_area_routes(app, require_admin, verified_claims, ADMIN_EMAIL)
admin_calendar.register_admin_calendar_routes(app, require_admin)
register_client_lifecycle_routes(
    app, require_admin, ADMIN_EMAIL,
    upload_dir=os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads"),
)


@app.on_event("startup")
def ensure_reschedule_tables():
    # reschedule_requests (reschedule_requests.py). Idempotent.
    try:
        reschedule_requests.ensure_tables()
    except Exception as error:  # noqa: BLE001
        print(f"reschedule tables could not be created: {type(error).__name__}")


@app.on_event("startup")
def ensure_admin_calendar_columns():
    # trainers.color (+ a colour for each trainer) and the calendar's indexes (admin_calendar.py)
    try:
        admin_calendar.ensure_columns()
    except Exception as error:  # noqa: BLE001
        print(f"admin calendar columns could not be created: {type(error).__name__}")


@app.on_event("startup")
def ensure_trainer_area():
    # trainer_access + trainer_access_log, and the fifth trainer (Dominika) with a colour of her own
    try:
        trainer_area.ensure_tables()
        trainer_area.ensure_dominika()
    except Exception as error:  # noqa: BLE001
        print(f"trainer area could not be prepared: {type(error).__name__}")


@app.on_event("startup")
def ensure_admin_ui_settings_table():
    # admin_ui_settings: the panel configuration (names, order, visibility). Idempotent.
    try:
        admin_ui_settings.ensure_table_once()
    except Exception as error:  # noqa: BLE001
        print(f"admin ui settings table could not be created: {type(error).__name__}")


@app.on_event("startup")
def start_google_delete_sync():
    # cancel_source columns (idempotent) and the 10-minute check of sessions deleted in Google Calendar (GOOGLE_DELETE_SYNC=off disables it)
    try:
        calendar_reconcile.ensure_columns_once()
        calendar_reconcile.start_background()
    except Exception as error:  # noqa: BLE001
        print(f"google delete sync could not start: {type(error).__name__}")


@app.on_event("startup")
def clean_saved_photo_addresses():
    # users.foto that would not be accepted today (an address of some other server) is emptied. Our own uploads are never touched.
    try:
        photo_urls.clean_stored_photos()
    except Exception as error:  # noqa: BLE001
        print(f"photo addresses could not be checked: {type(error).__name__}")


@app.on_event("startup")
def start_data_retention():
    # the daily job: unfinished client deletions are repeated, old rate-limit addresses go, and the retention policy runs ONLY when
    # RETENTION_ENABLED=true (off by default). RETENTION_JOB=off disables the job. See data_retention.py
    try:
        data_retention.start_background()
    except Exception as error:  # noqa: BLE001
        print(f"data retention job could not start: {type(error).__name__}")


@app.on_event("startup")
def ensure_client_lifecycle_columns():
    # users.archived_at + admin_audit_log (client_lifecycle.py). Idempotent.
    try:
        ensure_lifecycle_columns()
    except Exception as error:  # noqa: BLE001
        print(f"client lifecycle columns could not be created: {type(error).__name__}")


@app.on_event("startup")
def _log_email_status():
    # One line in the log: "Email: OK" or "Email: NÃO configurado (motivo)".
    from emails.health import log_startup_status
    log_startup_status()

register_contact_routes(app, require_admin)
register_trial_confirmation_routes(app)
register_client_account_routes(app, require_admin, require_client)


def _is_admin(claims):
    return str(claims.get("email", "")).strip().casefold() == ADMIN_EMAIL


def is_email_verified(decoded_token):
    """THE one answer to "is the e-mail of this login verified?": the token says email_verified, or the login is made with Google
    (provider google.com: Google only gives verified addresses). A token that says nothing counts as NOT verified."""
    claims = decoded_token or {}
    if claims.get("email_verified") is True:
        return True
    return str((claims.get("firebase") or {}).get("sign_in_provider") or "") == "google.com"


def email_not_verified():
    """403 with a stable code the site recognises (it shows "verify your email"). The text is the same whatever the reason: it never
    says whether the address has data."""
    return HTTPException(status_code=403, detail={
        "code": "email_not_verified",
        "message": "Verify your email to access your data. / Verifica tu email para acceder a tus datos.",
    })


def _own_user_id(claims):
    """users.id of the signed-in account: matched by login id and, failing that, by e-mail. An e-mail match is a claim on data that
    already exists, so it only counts when the e-mail is VERIFIED (anybody can sign up with any address): an unverified login that
    would be tied to a record it is not linked to gets 403 email_not_verified, and nothing is linked. Somebody whose login id is
    already linked to their record (or who has no record at all) is not affected."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM users WHERE firebase_uid = %s", (claims.get("sub"),))
        row = cursor.fetchone()
        if row:
            return row[0]
        email = str(claims.get("email", "")).strip().casefold()
        if email:
            cursor.execute("SELECT id FROM users WHERE LOWER(email) = %s", (email,))
            row = cursor.fetchone()
            if row:
                if not is_email_verified(claims):
                    raise email_not_verified()
                return row[0]
        return None
    finally:
        cursor.close()
        conn.close()


def assert_owner(claims, user_id):
    """403 unless the signed-in account is user `user_id` (the admin always may).
    Call it at the very top of a route: several routes turn any exception into
    a 200 answer, which would hide this error."""
    if _is_admin(claims):
        return
    if _own_user_id(claims) != user_id:
        raise HTTPException(status_code=403, detail="This belongs to another account")


def assert_session_owner(claims, session_id):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT user_id FROM sessions WHERE id = %s", (session_id,))
        row = cursor.fetchone()
    finally:
        cursor.close()
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    assert_owner(claims, row[0])


calendar_feed.register_calendar_feed_routes(app, require_admin, require_client, _own_user_id)
reschedule_requests.register_reschedule_routes(app, require_admin, require_client, _own_user_id)
inbox.register_inbox_routes(app, require_admin, require_inbox_user, _own_user_id, ADMIN_EMAIL)
trainer_choice.register_trainer_choice_routes(app)
session_restore.register_restore_routes(app, require_admin)
calendar_reconcile.register_reconcile_routes(app, require_admin)
admin_ui_settings.register_ui_settings_routes(app, require_admin)
client_lang.register_client_lang_routes(app, require_client, _own_user_id)


UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

web_safety.register_upload_routes(app, UPLOAD_DIR)         # images live in the database; the disk only keeps older files and videos
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}      # no .svg: it can carry scripts
MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024  # 8MB

MAX_VIDEO_SIZE_BYTES = web_safety.MAX_VIDEO_BYTES  # 300MB — raised from 50MB, phone-recorded workout clips were hitting the old limit


@app.on_event("startup")
def ensure_landing_page_table():

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS landing_page_content (
                id SERIAL PRIMARY KEY,
                version TEXT UNIQUE NOT NULL,
                content JSONB NOT NULL,
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """
        )

        for version in ("draft", "published", "default_base"):

            cursor.execute(
                """
                INSERT INTO landing_page_content (version, content)
                VALUES (%s, %s)
                ON CONFLICT (version) DO NOTHING
                """,
                (version, PgJson(DEFAULT_LANDING_CONTENT))
            )

        conn.commit()

    finally:

        cursor.close()
        conn.close()


@app.on_event("startup")
def ensure_training_videos_table():

    # Independent of the Landing Page Editor's JSON-versioned content — this
    # is a plain relational table, same pattern as sessions/client_requests.

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS training_videos (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                video_source TEXT NOT NULL,
                video_url TEXT NOT NULL,
                display_order INT DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """
        )

        conn.commit()

    finally:

        cursor.close()
        conn.close()


@app.on_event("startup")
def ensure_team():
    conn = get_connection()
    try:
        ensure_trainers_and_availability(conn)
        purge_unused_inactive_trainers(conn)
    finally:
        conn.close()


@app.on_event("startup")
def ensure_trial_session_fields():
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("ALTER TABLE trial_sessions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Pending'")
        cursor.execute("ALTER TABLE trial_sessions ADD COLUMN IF NOT EXISTS trainer_id INTEGER REFERENCES trainers(id)")
        cursor.execute("ALTER TABLE trial_sessions ADD COLUMN IF NOT EXISTS google_event_id TEXT")
        cursor.execute("ALTER TABLE trial_sessions ADD COLUMN IF NOT EXISTS rejection_reason TEXT")
        cursor.execute("ALTER TABLE trial_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()")
        cursor.execute("ALTER TABLE trial_sessions ADD COLUMN IF NOT EXISTS birth_date DATE")
        # Several training goals can now be chosen, stored as a comma-separated list.
        cursor.execute("ALTER TABLE trial_sessions ALTER COLUMN goal TYPE TEXT")
        conn.commit()
    finally:
        cursor.close()
        conn.close()
    # Token, approval / confirmation dates and calendar warning (trial_confirmation.py).
    ensure_confirmation_fields()


@app.on_event("startup")
def ensure_session_pack_column():
    # sessions.user_plan_id: which pack a session belongs to (packs run in parallel)
    try:
        ensure_pack_columns()
    except Exception as error:  # noqa: BLE001
        print(f"sessions.user_plan_id could not be created: {type(error).__name__}")


@app.on_event("startup")
def ensure_calendar_sync_columns():
    # sessions.calendar_sync_status / calendar_sync_error + this database's event-id key
    try:
        calendar_sync.ensure_columns()
    except Exception as error:  # noqa: BLE001
        print(f"calendar_sync columns could not be created: {type(error).__name__}")
    # "Calendar: OK (…ce.com)" or "Calendar: NÃO configurado (motivo)". It asks
    # Google, so it runs apart: a slow answer never delays the server.
    threading.Thread(
        target=lambda: print(google_calendar.status_line(), flush=True),
        daemon=True,
    ).start()


@app.on_event("startup")
def ensure_calendar_feed_columns():
    # users.calendar_feed_token + sessions.feed_sequence (calendar_feed.py)
    try:
        calendar_feed.ensure_columns()
    except Exception as error:  # noqa: BLE001
        print(f"calendar_feed columns could not be created: {type(error).__name__}")


@app.on_event("startup")
def ensure_email_log_table():
    # one row per email sent or failed (emails/log.py)
    try:
        email_log.ensure_table()
    except Exception as error:  # noqa: BLE001 - logging must never stop the server
        print(f"email_log table could not be created: {type(error).__name__}")


@app.on_event("startup")
def init_firebase_admin_at_startup():
    # One diagnostic line ("Firebase Admin: OK" / "NÃO inicializado (motivo: ...)").
    # A missing key never stops the server: only account creation answers 503.
    try:
        firebase_accounts.init_firebase_admin()
    except Exception as error:  # noqa: BLE001
        print(f"Firebase Admin: NÃO inicializado (motivo: inicialização falhou) [{type(error).__name__}]")


@app.on_event("startup")
def ensure_user_account_fields():
    # must_change_password (client_accounts.py)
    ensure_account_fields()


@app.on_event("startup")
def ensure_client_workflow_fields():
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("ALTER TABLE client_requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT")
        cursor.execute("ALTER TABLE client_requests ADD COLUMN IF NOT EXISTS trainer_id INTEGER REFERENCES trainers(id)")
        cursor.execute("ALTER TABLE client_requests ADD COLUMN IF NOT EXISTS start_date DATE")
        cursor.execute("ALTER TABLE client_requests ADD COLUMN IF NOT EXISTS sessions_per_week INTEGER")
        # the schedule asked for: one entry per day (weekday, hour, trainer). Older requests only have preferred_days / preferred_time
        cursor.execute("ALTER TABLE client_requests ADD COLUMN IF NOT EXISTS schedule JSONB")
        # Archiving hides a request from the admin lists without deleting anything.
        cursor.execute("ALTER TABLE client_requests ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP")
        # When the client sent it (shown on their "pending requests" card). Older rows stay empty: the card then shows no date.
        cursor.execute("ALTER TABLE client_requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMP")
        cursor.execute("ALTER TABLE client_requests ALTER COLUMN created_at SET DEFAULT (NOW() AT TIME ZONE 'UTC')")
        cursor.execute("ALTER TABLE client_requests ALTER COLUMN status SET DEFAULT 'Pending'")
        cursor.execute("ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE")
        # Pack period and schedule, recorded when a pack is created (approved request, new pack, new client).
        cursor.execute("ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS start_date DATE")
        cursor.execute("ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS end_date DATE")
        cursor.execute("ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS sessions_per_week INTEGER")
        cursor.execute("ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS preferred_days TEXT")
        cursor.execute("ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS preferred_time TEXT")
        cursor.execute("ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS trainer_id INTEGER REFERENCES trainers(id)")
        # Approvals store session numbers as text such as "1/12".
        cursor.execute("""
            SELECT data_type FROM information_schema.columns
            WHERE table_name = 'sessions' AND column_name = 'session_number'
        """)
        column = cursor.fetchone()
        if column and column[0] != "text":
            cursor.execute("ALTER TABLE sessions ALTER COLUMN session_number TYPE TEXT USING session_number::text")
        cursor.execute("ALTER TABLE plans ADD COLUMN IF NOT EXISTS duration_weeks INTEGER")
        plans_schema.price_column(cursor)              # the price column exists (under its real name); never a second one
        pricing.ensure_schema(cursor)                  # the prices table (seeded once) and the Individual | Dual columns
        cursor.execute("""
            UPDATE plans SET duration_weeks = CASE id
                WHEN 1 THEN 4 WHEN 2 THEN 12 WHEN 3 THEN 24 ELSE 4 END
            WHERE duration_weeks IS NULL
        """)
        pack_catalog.ensure_schema(cursor)             # the catalogue of packs (seeded once from the plans and prices that existed)
        conn.commit()
    finally:
        cursor.close()
        conn.close()


@app.on_event("startup")
def migrate_landing_pricing():
    # The Pricing section keeps its own list of packs (landing_pricing.py); a section without one gets the list that
    # reproduces what it showed. Runs after the landing table and the catalogue exist; changes nothing the second time.
    try:
        conn = get_connection()
        cursor = conn.cursor()
        try:
            landing_pricing.migrate_all(cursor)
            conn.commit()
        finally:
            cursor.close()
            conn.close()
    except Exception as error:  # noqa: BLE001
        print(f"landing pricing list could not be migrated: {type(error).__name__}")


class LandingContentPayload(BaseModel):
    content: dict[str, Any]


class UserCreate(BaseModel):
    firebase_uid: str
    nome: str
    email: str
    foto: str | None = None
    telefone: str | None = None
    codigo_pais: str | None = None
    cidade: str | None = None
    morada: str | None = None
    cep: str | None = None


class UpdateSession(BaseModel):
    session_date: str
    session_time: str


class UpdateProfile(BaseModel):
    telefone: str
    codigo_pais: str
    cidade: str
    morada: str
    cep: str
    # invoicing, all optional: not sent = unchanged, empty text = cleared
    tax_id_type: str | None = None
    tax_id: str | None = None
    country: str | None = None


class TrialSessionCreate(BaseModel):
    # Language the visitor had on the site (en | es | ca); anything else is stored as 'en'.
    lang: str | None = None
    # Hidden field real visitors never fill; bots usually do.
    tb_hp: str | None = None
    full_name: str
    email: str
    phone: str
    age: int | None = None
    birth_date: str | None = None
    goal: str = ""
    goals: list[str] | None = None
    experience: str
    session_date: str
    session_time: str
    # individual (default) | dual; a dual trial needs the second person (the price is worked out by the server)
    session_type: str | None = None
    second_person_name: str | None = None
    second_person_email: str | None = None


class ClientRequestCreate(BaseModel):
    user_id: int | None = None
    pack_id: int                       # a pack of the catalogue (GET /pricing)
    sessions_per_week: int
    # one entry per training day, each with ITS hour and (optionally) ITS trainer; as many entries as sessions per week
    schedule: list[pack_schedule.ScheduleEntry]
    session_type: str | None = None
    second_person_name: str | None = None
    second_person_email: str | None = None


class ApproveRequest(BaseModel):
    request_id: int
    # the final schedule, one entry per day with its hour and trainer (the admin may adjust what the client asked for)
    schedule: list[pack_schedule.ScheduleEntry]
    start_date: str
    pack_id: int | None = None         # another catalogue pack than the one requested
    sessions_per_week: int | None = None
    # Pack summary email: the client ALWAYS gets it; `extra_recipients` get it in BCC (max 5, validated by the server).
    # email_client / email_extra are the older names and are still read (email_client is ignored).
    email_client: bool = True
    email_extra: list[str] | None = None
    extra_recipients: list[str] | None = None
    allow_conflicts: bool = False      # create it although the trainer is busy / outside their hours ("Crear igualmente")
    allow_overlaps: bool = False       # continue although the client gets two sessions at the same time
    # the client sees the events in THEIR Google Calendar (a guest of each event); off = no guests
    share_calendar: bool = True


class NewPack(BaseModel):
    pack_id: int
    sessions_per_week: int
    schedule: list[pack_schedule.ScheduleEntry]      # one entry per training day: weekday, hour and trainer
    start_date: str
    session_type: str | None = None
    second_person_name: str | None = None
    second_person_email: str | None = None
    email_client: bool = True          # ignored: the client always gets the email
    email_extra: list[str] | None = None          # older name of extra_recipients
    extra_recipients: list[str] | None = None     # BCC of the pack email (max 5)
    # create the sessions even when the trainer is busy (the panel asks first)
    allow_conflicts: bool = False
    # continue although the client gets two sessions at the same time as another pack (the panel warns first)
    allow_overlaps: bool = False
    # the client sees the events in THEIR Google Calendar (a guest of each event); off = no guests
    share_calendar: bool = True


class PackPreview(BaseModel):
    client_id: int | None = None
    pack_id: int
    sessions_per_week: int
    schedule: list[pack_schedule.ScheduleEntry]
    start_date: str


class RejectRequest(BaseModel):
    request_id: int
    reason: str | None = None


class ArchiveRequest(BaseModel):
    request_id: int


class TrainingVideoCreate(BaseModel):
    title: str
    description: str | None = None
    video_source: str
    video_url: str


class TrainingVideoUpdate(BaseModel):
    title: str
    description: str | None = None
    video_source: str
    video_url: str


class TrainingVideoReorder(BaseModel):
    ordered_ids: list[int]


def trainer_is_available(
    cursor,
    trainer_id,
    session_date,
    session_time
):

    cursor.execute(
        """
        SELECT id
        FROM sessions
        WHERE trainer_id = %s
        AND session_date = %s
        AND session_time = %s
        AND status = 'Booked'
        """,
        (
            trainer_id,
            session_date,
            session_time
        )
    )

    existing_session = cursor.fetchone()

    return existing_session is None


@app.get("/")
def home():
    return {
        "message": "ThundBalance API Running"
    }


PRICING_CACHE_SECONDS = web_safety.env_int("PRICING_CACHE_SECONDS", 30)
_pricing_cache = {"at": None, "value": None}


def invalidate_pricing_cache():
    """Forgets the cached /pricing answer (called after any successful write; it also expires on its own after PRICING_CACHE_SECONDS)."""
    _pricing_cache["at"] = None
    _pricing_cache["value"] = None


@app.get("/pricing")
def get_pricing(response: Response):
    """The packs on sale and the trial prices, public like the prices themselves (the catalogue, see pack_catalog.py):
    {"packs": [{"id", "name", "session_type", "weeks", "months", "sessions_per_week_options", "price_per_session",
    "price_per_pack"}], "trial": {"individual": 40, "dual": 50}}. Archived packs are not listed. Read only; the
    server never trusts a price sent back by the browser.
    The answer is public and the same for everybody: the browser may keep it PRICING_CACHE_SECONDS (30) and the server keeps it in memory
    for as long, so a visit does not reach the database. An admin change (any successful write) clears the memory at once."""
    response.headers["Cache-Control"] = f"public, max-age={PRICING_CACHE_SECONDS}"
    now = _time.monotonic()
    if _pricing_cache["value"] is not None and _pricing_cache["at"] is not None and now - _pricing_cache["at"] < PRICING_CACHE_SECONDS:
        return _pricing_cache["value"]
    conn = get_connection()
    cursor = conn.cursor()
    try:
        value = pack_catalog.public_catalog(cursor)
    finally:
        cursor.close()
        conn.close()
    _pricing_cache["value"], _pricing_cache["at"] = value, now
    return value


@app.get("/trainers")
def get_trainers():

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT id, nome, especialidade
            FROM trainers
            WHERE active
            ORDER BY id
            """
        )

        return cursor.fetchall()

    finally:

        cursor.close()
        conn.close()


@app.get("/sessions", dependencies=[Depends(require_admin)])
def get_sessions():

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT *
            FROM sessions
            """
        )

        return cursor.fetchall()

    finally:

        cursor.close()
        conn.close()


@app.post("/users")
def create_user(user: UserCreate, claims=Depends(require_account)):

    # The photo is only kept when it is a file of our own uploads or a photo of a Google account; any other address is ignored (the
    # panel would load it in the admin's browser: a tracking pixel). The registration is not refused for it.
    user.foto = photo_urls.clean_photo_url(user.foto)

    # Who the account is comes from the login, never from the request body.
    user.firebase_uid = claims.get("sub")
    user.email = str(claims.get("email") or user.email).strip()

    try:
        user.nome = validators.validate_name(user.nome, "name")
        if user.telefone:
            user.telefone = validators.validate_phone(user.telefone, user.codigo_pais)
            user.codigo_pais = validators.split_phone(user.telefone)[0]
        if user.cep:
            user.cep = validators.validate_postal_code(user.cep, validators.region_of_phone(user.telefone) or "ES")
    except validators.FieldError as error:
        raise validators.http_error(error) from None

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT id, firebase_uid
            FROM users
            WHERE LOWER(email) = LOWER(%s)
            """,
            (user.email,)
        )

        existing_user = cursor.fetchone()

        if existing_user:

            # A record that already exists is only tied to a login whose e-mail is VERIFIED (or that is already its own login):
            # an unverified address must not take over somebody else's data. Nothing is read or written then.
            if existing_user[1] != user.firebase_uid and not is_email_verified(claims):
                raise email_not_verified()

            cursor.execute(
                "UPDATE users SET firebase_uid = COALESCE(firebase_uid, %s) WHERE id = %s",
                (user.firebase_uid, existing_user[0])
            )
            conn.commit()

            return {
                "message": "User already exists"
            }

        cursor.execute(
            """
            INSERT INTO users
            (
                firebase_uid,
                nome,
                email,
                foto,
                telefone,
                codigo_pais,
                cidade,
                morada,
                cep
            )

            VALUES
            (
                %s, %s, %s, %s,
                %s, %s, %s, %s, %s
            )
            """,
            (
                user.firebase_uid,
                user.nome,
                user.email,
                user.foto,
                user.telefone,
                user.codigo_pais,
                user.cidade,
                user.morada,
                user.cep
            )
        )

        conn.commit()

        return {
            "message": "User created successfully"
        }

    except HTTPException:
        # a deliberate refusal (email_not_verified) must reach the site as it is, not as a 200 with an "error" text
        conn.rollback()
        raise

    except Exception as e:

        conn.rollback()

        return {
            "error": safe_error(e)
        }

    finally:

        cursor.close()
        conn.close()


@app.get("/users", dependencies=[Depends(require_admin)])
def get_users():

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT id, firebase_uid, nome, email, foto, telefone, codigo_pais, cidade, morada, cep,
                   must_change_password, tax_id
            FROM users
            WHERE archived_at IS NULL
            """
        )

        # same columns as before, plus the document: masked, like every list
        return [[*row[:-1], tax_id.mask(row[-1])] for row in cursor.fetchall()]

    finally:

        cursor.close()
        conn.close()


@app.get("/users/email/{email}")
def get_user_by_email(email: str, claims=Depends(require_account)):

    if not _is_admin(claims) and email.strip().casefold() != str(claims.get("email", "")).strip().casefold():
        raise HTTPException(status_code=403, detail="This belongs to another account")
    if not _is_admin(claims):
        _own_user_id(claims)        # 403 email_not_verified when an unverified login asks for a record it is not linked to

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            f"""
            SELECT
                u.id,
                u.nome,
                u.email,
                (
                    SELECT string_agg(p.nome, ' + ' ORDER BY up.id)
                    FROM user_plans up JOIN plans p ON p.id = up.plan_id
                    WHERE up.user_id = u.id AND {pack_view.ACTIVE_PACK_CONDITION}
                ),
                u.must_change_password

            FROM users u

            WHERE LOWER(u.email) = LOWER(%s)
            """,
            (email,)
        )

        user = cursor.fetchone()

        if not user:

            return {
                "message": "User not found"
            }

        return {
            "id": user[0],
            "nome": user[1],
            "email": user[2],
            "plano": user[3],
            "must_change_password": bool(user[4])
        }

    finally:

        cursor.close()
        conn.close()


@app.get("/sessions/user/{user_id}")
def get_user_sessions(user_id: int, claims=Depends(require_client)):

    assert_owner(claims, user_id)

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT
                s.id,
                s.session_date,
                s.session_time,
                t.nome,
                s.status,
                s.rescheduled,
                s.session_number

            FROM sessions s

            JOIN trainers t
                ON s.trainer_id = t.id

            WHERE s.user_id = %s

            ORDER BY s.session_date ASC, s.session_time ASC, s.id ASC
            """,
            (user_id,)
        )
        rows = cursor.fetchall()
        # Every session says which pack it belongs to (a client can have several at once): [..., number, pack id, pack name]
        packs, assignment = pack_view.user_packs(cursor, user_id)
        names = {pack["id"]: pack["name"] for pack in packs}
        return [[*row, assignment.get(row[0]), names.get(assignment.get(row[0]))] for row in rows]

    finally:

        cursor.close()
        conn.close()


@app.delete("/sessions/{session_id}")
def cancel_session(session_id: int, claims=Depends(require_client)):

    assert_session_owner(claims, session_id)

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT google_event_id, user_id, session_number, session_date, session_time, status
            FROM sessions
            WHERE id = %s
            """,
            (session_id,)
        )

        result = cursor.fetchone()

        if not result:

            return {
                "error": "Session not found"
            }

        google_event_id = result[0]
        cancelled_by_studio = _is_admin(claims) and str(result[5]).lower() != "cancelled"

        cursor.execute(
            """
            UPDATE sessions
            SET status = 'Cancelled', feed_sequence = feed_sequence + 1,
                cancelled_at = NOW() AT TIME ZONE 'UTC', cancelled_by = %s
            WHERE id = %s
            """,
            ((str(claims.get("email", ""))[:120] or "admin") if _is_admin(claims) else "client", session_id)
        )

        # The session is cancelled whatever Google answers: the central rule deletes its
        # event ("it does not exist" counts as done) and records the outcome.
        calendar_sync.sync_session_to_google(session_id, cursor=cursor)

        conn.commit()

        if cancelled_by_studio:         # the inbox message of the client (parallel to everything else, never raises)
            inbox.create_system_message(
                "session_cancelled", user_id=result[1], refs={"session_id": session_id},
                params={"number": result[2] or "", "old_at": inbox.at(result[3], result[4])},
            )

        return {
            "message": "Session cancelled successfully"
        }

    except Exception as e:

        conn.rollback()

        return {
            "error": safe_error(e)
        }

    finally:

        cursor.close()
        conn.close()


@app.get("/profile/{user_id}")
def get_profile(user_id: int, claims=Depends(require_account)):

    assert_owner(claims, user_id)

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            f"""
            SELECT
                u.id,
                u.nome,
                u.email,
                u.foto,
                u.telefone,
                u.codigo_pais,
                u.cidade,
                u.morada,
                u.cep,
                (
                    SELECT string_agg(p.nome, ' + ' ORDER BY up.id)
                    FROM user_plans up JOIN plans p ON p.id = up.plan_id
                    WHERE up.user_id = u.id AND {pack_view.ACTIVE_PACK_CONDITION}
                ),
                u.tax_id_type,
                u.tax_id,
                u.country

            FROM users u

            WHERE u.id = %s
            """,
            (user_id,)
        )

        profile = cursor.fetchone()

        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found")

        return {
            "id": profile[0],
            "nome": profile[1],
            "email": profile[2],
            "foto": profile[3],
            "telefone": profile[4],
            "codigo_pais": profile[5],
            "cidade": profile[6],
            "morada": profile[7],
            "cep": profile[8],
            "plano": profile[9],
            "tax_id_type": profile[10],
            "tax_id": profile[11],
            "country": profile[12]
        }

    finally:

        cursor.close()
        conn.close()


@app.put("/sessions/{session_id}")
def update_session(
    session_id: int,
    session: UpdateSession,
    claims=Depends(require_client)
):
    """Clients no longer move a session by themselves: they ask (POST /me/sessions/{id}/reschedule-request)
    and the studio decides. The studio itself should use POST /admin/sessions/{id}/reschedule; a call
    from the administrator here is forwarded to it."""

    assert_session_owner(claims, session_id)

    if not _is_admin(claims):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "use_reschedule_request",
                "message": "Sessions are no longer moved directly. Send a change request instead.",
            },
        )
    reschedule_requests.admin_reschedule(
        session_id, str(session.session_date), str(session.session_time)[:5], None, str(claims.get("email", ""))[:80]
    )
    return {"message": "Session updated successfully"}


@app.get("/admin/stats", dependencies=[Depends(require_admin)])
def get_admin_stats():

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute("SELECT COUNT(*) FROM users WHERE archived_at IS NULL")
        total_users = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM trainers")
        total_trainers = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM sessions")
        total_sessions = cursor.fetchone()[0]

        return {
            "users": total_users,
            "trainers": total_trainers,
            "sessions": total_sessions
        }

    finally:

        cursor.close()
        conn.close()


@app.get("/admin/users", dependencies=[Depends(require_admin)])
def admin_users():

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            f"""
            SELECT

                u.id,

                u.nome,

                u.email,

                COALESCE(
                    (
                        SELECT string_agg(p.nome, ' + ' ORDER BY up.id)
                        FROM user_plans up JOIN plans p ON p.id = up.plan_id
                        WHERE up.user_id = u.id AND {pack_view.ACTIVE_PACK_CONDITION}
                    ),
                    'No Plan'
                )

            FROM users u

            WHERE u.archived_at IS NULL

            ORDER BY u.id
            """
        )

        return cursor.fetchall()

    finally:

        cursor.close()
        conn.close()


@app.get("/admin/trainers", dependencies=[Depends(require_admin)])
def admin_trainers():

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT id, nome, especialidade
            FROM trainers
            WHERE active
            ORDER BY id
            """
        )

        return cursor.fetchall()

    finally:

        cursor.close()
        conn.close()


@app.get("/admin/sessions", dependencies=[Depends(require_admin)])
def admin_sessions():

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT
                s.id,
                u.nome,
                t.nome,
                s.session_date,
                s.session_time,
                s.status
            FROM sessions s
            JOIN users u
                ON s.user_id = u.id
            JOIN trainers t
                ON s.trainer_id = t.id
            ORDER BY s.session_date ASC
            """
        )

        return cursor.fetchall()

    finally:

        cursor.close()
        conn.close()


@app.post("/profile/{user_id}/photo")
async def upload_profile_photo(user_id: int, file: UploadFile = File(...), claims=Depends(require_account)):
    contents = await file.read(5 * 1024 * 1024 + 1)
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image must be smaller than 5MB")
    extension = web_safety.check_image(file.filename, contents)
    conn = get_connection()
    cursor = conn.cursor()
    destination = None
    try:
        cursor.execute("SELECT id, foto FROM users WHERE id = %s AND firebase_uid = %s", (user_id, claims.get("sub")))
        owner = cursor.fetchone()
        if not owner:
            raise HTTPException(status_code=403, detail="You can only update your own photo")
        previous_photo = owner[1]
        filename = f"{uuid.uuid4().hex}{extension}"
        photo_url = web_safety.save_upload(filename, contents, owner_user_id=user_id)      # also removes the previous photos of this person
        cursor.execute("UPDATE users SET foto = %s WHERE id = %s", (photo_url, user_id))
        conn.commit()
        if previous_photo and previous_photo != photo_url:
            web_safety.delete_stored_photo(previous_photo, UPLOAD_DIR)             # an older one that had no owner, or one on the disk
        return {"url": photo_url}
    except Exception:
        conn.rollback()
        if destination and os.path.exists(destination):
            os.remove(destination)
        raise
    finally:
        cursor.close()
        conn.close()


@app.put("/profile/{user_id}")
def update_profile(
    user_id: int,
    profile: UpdateProfile,
    claims=Depends(require_account)
):

    assert_owner(claims, user_id)

    # The document is checked before anything is written. The answer carries a
    # short code (the site shows it in the visitor's language), never the value.
    document = None
    if profile.tax_id is not None:
        try:
            document = tax_id.clean(profile.tax_id_type, profile.tax_id)
        except tax_id.TaxIdError as error:
            raise HTTPException(status_code=422, detail=f"tax_id_{error.code}") from None
    elif profile.tax_id_type is not None:
        try:
            tax_id.check_type(profile.tax_id_type)
        except tax_id.TaxIdError as error:
            raise HTTPException(status_code=422, detail=f"tax_id_{error.code}") from None

    conn = get_connection()
    cursor = conn.cursor()

    try:

        # A phone or postal code that is exactly what is already saved is not
        # checked again: old records keep opening and saving. A new value must be valid.
        cursor.execute("SELECT telefone, cep, country FROM users WHERE id = %s", (user_id,))
        saved_contact = cursor.fetchone() or (None, None, None)
        telefone, codigo_pais, cep = profile.telefone, profile.codigo_pais, profile.cep
        try:
            if str(telefone or "").strip() != str(saved_contact[0] or "").strip():
                telefone = validators.validate_phone(telefone, codigo_pais)
                codigo_pais = validators.split_phone(telefone)[0]
            if str(cep or "").strip() != str(saved_contact[1] or "").strip() and str(cep or "").strip():
                region = validators.region_of_phone(telefone) or profile.country or saved_contact[2] or "ES"
                cep = validators.validate_postal_code(cep, region)
        except validators.FieldError as error:
            raise validators.http_error(error) from None

        fields = {
            "telefone": telefone,
            "codigo_pais": codigo_pais,
            "cidade": profile.cidade,
            "morada": profile.morada,
            "cep": cep,
        }
        if profile.country is not None:
            fields["country"] = " ".join(profile.country.split())[:60] or None
        if document is not None:
            fields["tax_id_type"], fields["tax_id"] = document
        elif profile.tax_id_type is not None:
            # only the type changed: the saved document has to be valid for it
            cursor.execute("SELECT tax_id FROM users WHERE id = %s", (user_id,))
            saved = cursor.fetchone()
            if saved and saved[0]:
                try:
                    fields["tax_id_type"], fields["tax_id"] = tax_id.validate(profile.tax_id_type, saved[0])
                except tax_id.TaxIdError as error:
                    raise HTTPException(status_code=422, detail=f"tax_id_{error.code}") from None

        assignments = ", ".join(f"{column} = %s" for column in fields)
        cursor.execute(f"UPDATE users SET {assignments} WHERE id = %s", (*fields.values(), user_id))

        conn.commit()

        # The name, e-mail or phone are in the title / description of the future events.
        if {"nome", "email", "telefone", "codigo_pais"} & set(fields):
            threading.Thread(target=calendar_sync.sync_client_sessions_to_google, args=(user_id,), daemon=True).start()

        return {
            "message": "Profile updated successfully"
        }

    except HTTPException:

        conn.rollback()
        raise

    except Exception as e:

        conn.rollback()

        # Only the kind of error: the message could repeat personal data.
        print(f"Profile update failed ({type(e).__name__})")

        return {
            "error": "Could not update the profile"
        }

    finally:

        cursor.close()
        conn.close()


@app.get("/pack-availability")
def pack_availability(request: Request, start_date: str | None = None, weeks: int | None = None):
    """The free hours of every weekday, with the trainers free at each one, to choose the schedule of a pack (one hour and one
    trainer for EACH training day). Public (the client's request page uses it), rate limited, only trainer id and name.

      GET /pack-availability                              working hours only (a request without a start date yet)
      GET /pack-availability?start_date=2026-01-12&weeks=8   also leaves out the hours a trainer is already booked in that window
      -> {"weekdays": {"Monday": [{"time": "07:00", "trainers": [{"id": 1, "name": "Carles"}]}, ...], ...}}

    The same rules as the rest of the app (pack_schedule.Grid); the server checks again when the pack or request is saved."""
    if trainer_choice._too_many(web_safety.get_client_ip(request)):
        raise HTTPException(status_code=429, detail="Too many requests. Please try again in a minute.")
    if start_date is not None:
        try:
            datetime.strptime(start_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=422, detail="Use the date as YYYY-MM-DD") from None
        if weeks is None or not 1 <= weeks <= pack_schedule.MAX_WEEKS_WINDOW:
            raise HTTPException(status_code=422, detail=f"Use weeks between 1 and {pack_schedule.MAX_WEEKS_WINDOW}")
    conn = get_connection()
    cursor = conn.cursor()
    try:
        return {"weekdays": pack_schedule.Grid.load(cursor, start_date, weeks).hours()}
    finally:
        cursor.close()
        conn.close()


@app.get("/available-trainers/{day}/{time}")
def available_trainers(day: str, time: str):
    """Active trainers working at that weekday and time (by working hours)."""

    if day not in WEEKDAYS:
        raise HTTPException(status_code=422, detail="Unknown weekday")

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute("SELECT id, nome FROM trainers WHERE active ORDER BY id")

        return [
            [trainer_id, name]
            for trainer_id, name in cursor.fetchall()
            if within_hours(cursor, trainer_id, day, time)
        ]

    finally:

        cursor.close()
        conn.close()


# A query that runs longer than this fails with a clear error instead of leaving
# the visitor waiting (the times come from our own database; no Google call).
SCHEDULE_QUERY_TIMEOUT_MS = 8000


@app.api_route("/health", methods=["GET", "HEAD"])
def health():
    """Answers at once: no database, no Google. Used to wake the service up
    (the site pings it when a page opens) and by an uptime monitor."""
    return {"status": "ok"}


@app.middleware("http")
async def _drop_schedule_cache_after_writes(request, call_next):
    """Any successful write (a booking, an approval, a cancellation, new hours)
    may change the free times: the short-lived cache starts again from empty."""
    response = await call_next(request)
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and response.status_code < 400:
        schedule_cache.invalidate()
        invalidate_pricing_cache()          # the packs and prices an admin just changed show at once
    return response


def _schedule_unavailable(error):
    print(f"timing schedule failed: {type(error).__name__}", flush=True)
    raise HTTPException(
        status_code=503,
        detail="The available times could not be loaded right now. Please try again in a moment.",
    )


@app.get("/schedule")
def get_schedule():
    """Start times offered on each weekday (at least one trainer works)."""
    started = _time.perf_counter()
    try:
        value, cached = schedule_cache.get_or_set(
            ("week",),
            lambda: run_read(lambda cursor: weekly_start_times(cursor, SCHEDULE_QUERY_TIMEOUT_MS), "schedule/week"),
        )
    except Exception as error:  # noqa: BLE001 - reported as a clear 503
        _schedule_unavailable(error)
    print(f"timing schedule/week cache={'hit' if cached else 'miss'} total={(_time.perf_counter() - started) * 1000:.0f}ms", flush=True)
    return value


@app.get("/schedule/{session_date}")
def get_schedule_for_date(session_date: str):
    """Start times on a date with at least one trainer free."""

    try:
        day = datetime.strptime(session_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=422, detail="Use a date as YYYY-MM-DD")

    started = _time.perf_counter()
    try:
        value, cached = schedule_cache.get_or_set(
            ("day", day.isoformat()),
            lambda: run_read(
                lambda cursor: free_start_times_any_trainer(cursor, day, SCHEDULE_QUERY_TIMEOUT_MS), "schedule/day"),
        )
    except Exception as error:  # noqa: BLE001 - reported as a clear 503
        _schedule_unavailable(error)
    print(f"timing schedule/day cache={'hit' if cached else 'miss'} total={(_time.perf_counter() - started) * 1000:.0f}ms", flush=True)
    return value


TRIAL_GOALS = [
    "Body recomposition", "Lose weight", "Build muscle", "Increase strength",
    "Rehabilitation/injury recovery", "Conditioning", "Endurance", "Tone/define",
    "Improve mobility & flexibility", "Increase energy",
]


def age_from_birth_date(birth_date, today=None):
    today = today or datetime.now().date()
    return today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))


TRIAL_TIMES = {f"{hour:02d}:00" for hour in range(7, 21)}

# At most this many requests per address per hour (kept in memory, so it
# resets when the server restarts; it only needs to stop floods).
# Both limits are settings (Render environment); the defaults are the values below.
TRIAL_EXISTS_TEXT = {
    "es": "Ya tienes una solicitud en curso",
    "en": "You already have a request in progress",
    "ca": "Ja tens una sol·licitud en curs",
}
TRIAL_LIMIT = web_safety.env_int("TRIAL_IP_LIMIT", 5)                                  # requests per address ...
TRIAL_WINDOW_SECONDS = web_safety.env_int("TRIAL_IP_WINDOW_SECONDS", 3600)             # ... per hour
TRIAL_EMAIL_LIMIT = web_safety.env_int("TRIAL_EMAIL_LIMIT", 3)                         # requests with the same e-mail ...
TRIAL_EMAIL_WINDOW_SECONDS = web_safety.env_int("TRIAL_EMAIL_WINDOW_SECONDS", 86400)   # ... per 24 hours
_trial_hits = web_safety.SharedRateLimit("trial", TRIAL_LIMIT, TRIAL_WINDOW_SECONDS)     # kept in the database; .clear() for tests
# The e-mail limit shares the bucket "trial" (so .clear() forgets both) under keys that cannot collide with an address.
_trial_email_hits = web_safety.SharedRateLimit("trial", TRIAL_EMAIL_LIMIT, TRIAL_EMAIL_WINDOW_SECONDS)


def _too_many_trial_requests(ip):
    return _trial_hits.too_many(ip)


def _email_limit_key(email):
    """The e-mail (lower case, no spaces) as a hash: the address itself is never stored in the limit table."""
    normalized = "".join(str(email).split()).lower()
    return "email:" + hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:40]


def _too_many_trial_requests_for_email(email):
    return _trial_email_hits.too_many(_email_limit_key(email))


def _active_trial_for_email(cursor, email):
    """The newest trial request of this email that is still open: waiting for
    the team (pending), waiting for the client (approved) or booked (confirmed),
    and not in the past. Declined/cancelled ones do not count."""
    cursor.execute(
        """
        SELECT ts.id, ts.status, ts.session_date, ts.session_time, ts.goal, ts.experience, t.nome, ts.created_at
        FROM trial_sessions ts
        LEFT JOIN trainers t ON t.id = ts.trainer_id
        WHERE LOWER(ts.email) = %s AND LOWER(ts.status) IN ('pending', 'approved', 'confirmed')
          AND ts.session_date >= CURRENT_DATE
        ORDER BY ts.created_at DESC, ts.id DESC
        LIMIT 1
        """,
        (email.strip().lower(),)
    )
    row = cursor.fetchone()
    if not row:
        return None
    return {
        "id": row[0],
        "status": str(row[1]).strip().lower(),
        "session_date": str(row[2]),
        "session_time": str(row[3])[:5],
        "goal": row[4],
        "experience": row[5],
        "trainer": row[6],
        "created_at": row[7].isoformat() if row[7] else None,
    }


@app.get("/client/trial")
def client_trial(authorization: str | None = Header(default=None)):
    """The logged-in client's open trial session (matched by login email), or null."""
    claims = require_client(authorization)
    email = str(claims.get("email", "")).strip().lower()
    if not email:
        return {"trial": None}
    # The trial is found by e-mail alone, so only a VERIFIED e-mail may read it (anybody can sign up with somebody else's address).
    if not is_email_verified(claims):
        raise email_not_verified()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        return {"trial": _active_trial_for_email(cursor, email)}
    finally:
        cursor.close()
        conn.close()


@app.post("/trial-sessions")
def create_trial_session(
    trial: TrialSessionCreate,
    request: Request
):
    """Public form. Stores a Pending request; the calendar event is created
    only when the admin approves it and picks a trainer."""

    if trial.tb_hp:
        print("Trial form ignored: hidden field was filled (bot or autofill)")
        # A bot filled the hidden field: pretend it worked, store nothing.
        return {"message": "Trial session requested", "trial_id": 0}

    # Checked against a fixed list; the site starts in English, so that is the fallback.
    client_lang = normalize_language(trial.lang) or "en"

    if _too_many_trial_requests(web_safety.get_client_ip(request)):
        raise HTTPException(
            status_code=429,
            detail="Too many requests from this connection. Please try again later."
        )

    # The same rules as the site (validators.py); the answer is a code and a fixed
    # message, never the value typed. The phone is stored as E.164 (+34613502662).
    try:
        full_name = validators.validate_name(trial.full_name, "full_name", 100)
        email = validators.validate_email(trial.email)
        phone = validators.validate_phone(trial.phone)
        birth_date = validators.validate_birth_date(trial.birth_date) if trial.birth_date else None
    except validators.FieldError as error:
        raise validators.http_error(error) from None
    age = trial.age
    if birth_date:
        age = age_from_birth_date(birth_date)
    if age is not None and not 10 <= age <= 100:
        raise validators.http_error(validators.FieldError("invalid_birth_date", "birth_date"))

    session_type = pricing.normalize_type(trial.session_type)
    second_name, second_email = pricing.second_person(session_type, trial.second_person_name, trial.second_person_email)

    chosen = trial.goals if trial.goals is not None else [g.strip() for g in trial.goal.split(",") if g.strip()]
    goals = [g for g in TRIAL_GOALS if g in chosen]
    if not goals:
        raise HTTPException(status_code=422, detail="Please select at least one training goal.")
    goal_text = ", ".join(goals)
    if trial.session_time not in TRIAL_TIMES:
        raise HTTPException(status_code=422, detail="Please choose a time between 07:00 and 20:00.")

    try:
        session_date = datetime.strptime(trial.session_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=422, detail="Please choose a valid date.")
    today = datetime.now().date()
    if session_date < today or session_date > today + timedelta(days=180):
        raise HTTPException(status_code=422, detail="Please choose a date within the next 6 months.")

    conn = get_connection()
    cursor = conn.cursor()

    try:

        free = trainers_for_slot(cursor, session_date, trial.session_time)
        if not free:
            raise HTTPException(
                status_code=422,
                detail="No trainer is available at that day and time. Please choose another."
            )
        trial_price = pricing.trial_price(cursor, session_type)
        if trial_price is None:
            raise HTTPException(status_code=422, detail="No price is defined for this trial session.")

        # At most TRIAL_EMAIL_LIMIT requests per e-mail every 24 hours, besides the limit per address: nobody can fill a mailbox (or this
        # table) with one address. The answer is the same generic 429 as the address limit: it never says whether the e-mail exists.
        if _too_many_trial_requests_for_email(email):
            raise HTTPException(
                status_code=429,
                detail="Too many requests from this connection. Please try again later."
            )

        existing = _active_trial_for_email(cursor, email)
        if existing:
            # Public answer, so it says NOTHING about the session (no state, day or hour): anybody can type any address here. The
            # client sees the state of their own session after logging in (GET /client/trial).
            raise HTTPException(
                status_code=409,
                detail={"code": "trial_exists", "message": TRIAL_EXISTS_TEXT.get(client_lang, TRIAL_EXISTS_TEXT["en"])},
            )

        cursor.execute(
            """
            INSERT INTO trial_sessions
            (
                full_name,
                email,
                phone,
                age,
                birth_date,
                goal,
                experience,
                session_date,
                session_time,
                status,
                lang,
                session_type,
                second_person_name,
                second_person_email,
                price_per_session
            )

            VALUES
            (%s,%s,%s,%s,%s,%s,%s,%s,%s,'Pending',%s,%s,%s,%s,%s)

            RETURNING id
            """,
            (
                full_name,
                email,
                phone,
                age,
                birth_date,
                goal_text,
                trial.experience.strip()[:60],
                session_date,
                trial.session_time,
                client_lang,
                session_type,
                second_name,
                second_email,
                trial_price
            )
        )

        trial_id = cursor.fetchone()[0]
        conn.commit()

        notify_trial_requested({
            "id": trial_id,
            "full_name": full_name,
            "email": email,
            "phone": phone,
            "age": age,
            "birth_date": birth_date.isoformat() if birth_date else None,
            "goal": goal_text,
            "experience": trial.experience.strip()[:60],
            "session_date": session_date.isoformat(),
            "session_time": trial.session_time,
            "session_type": session_type,
            "second_person_name": second_name,
            "second_person_email": second_email,
            "price_per_session": pricing.number(trial_price),       # a plain number: the dict is sent as JSON
        })
        mailer.send_trial_received(email, full_name.split()[0] if full_name.split() else full_name,
                                   session_date.isoformat(), trial.session_time, client_lang, reference=trial_id,
                                   details={"session_type": session_type, "second_person_name": second_name, "price_per_session": pricing.number(trial_price)})

        return {
            "message": "Trial session requested",
            "trial_id": trial_id
        }

    except HTTPException:
        conn.rollback()
        raise
    except Exception as error:
        conn.rollback()
        log_error(error)
        raise HTTPException(
            status_code=500,
            detail="We could not save your request. Please try again in a moment."
        ) from error

    finally:

        cursor.close()
        conn.close()


@app.get("/client/workflow", dependencies=[Depends(require_client)])
def client_workflow(authorization: str | None = Header(default=None)):
    claims = require_client(authorization)
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM users WHERE firebase_uid = %s", (claims.get("sub"),))
        user = cursor.fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="Client profile not found")
        user_id = user[0]
        cursor.execute("""
            SELECT cr.id, cr.status, cr.rejection_reason, p.nome, cr.sessions_per_week,
                   cr.preferred_days, cr.preferred_time, t.nome, cr.start_date,
                   cr.session_type, cr.second_person_name,
                   cr.created_at, cr.schedule
            FROM client_requests cr
            LEFT JOIN plans p ON p.id = cr.plan_id
            LEFT JOIN trainers t ON t.id = cr.trainer_id
            WHERE cr.user_id = %s ORDER BY cr.id DESC LIMIT 1
        """, (user_id,))
        request = cursor.fetchone()
        # Every active pack (a client can have several at once), each with its own counters.
        all_packs, assignment = pack_view.user_packs(cursor, user_id)
        active_packs = [p for p in all_packs if p["shown"]]
        plan = None
        if active_packs:
            newest = active_packs[-1]
            # the notice "your pack is ending" looks at the LAST end date of all the active packs, not at the newest pack
            last_end = max((p["end_date"] for p in active_packs if p["end_date"]), default=None)
            plan = (newest["name"], newest["trainer"], newest["plan_id"], last_end)
        cursor.execute("""
            SELECT s.id, s.session_date, s.session_time, t.nome, s.status, s.session_number
            FROM sessions s LEFT JOIN trainers t ON t.id = s.trainer_id
            WHERE s.user_id = %s ORDER BY s.session_date ASC, s.session_time ASC
        """, (user_id,))
        sessions = cursor.fetchall()
        status = "active" if plan else (
            str(request[1]).strip().lower() if request else "new"
        )
        return {
            "user_id": user_id, "state": status,
            "request": ({"id": request[0], "status": request[1], "reason": request[2],
                         "package": request[3], "sessions_per_week": request[4],
                         "preferred_days": request[5], "preferred_time": request[6],
                         "trainer": request[7], "start_date": request[8],
                         "session_type": request[9], "second_person_name": request[10],
                         "created_at": request[11].isoformat() if request[11] else None,
                         # one entry per day; [] for an old request (single hour: preferred_days / preferred_time)
                         "schedule": pack_schedule.loads(request[12])} if request else None),
            "plan": ({"name": plan[0], "trainer": plan[1], "id": plan[2],
                      "end_date": str(plan[3]) if plan[3] else None} if plan else None),
            # all the packs that are running, each with its own counters
            "plans": [
                {"id": p["id"], "name": p["name"], "trainer": p["trainer"],
                 "start_date": str(p["start_date"]) if p["start_date"] else None,
                 "end_date": str(p["end_date"]) if p["end_date"] else None,
                 "sessions_per_week": p["sessions_per_week"],
                 "done": p["done"], "remaining": p["remaining"], "total": p["total"],
                 "session_type": p["session_type"], "second_person_name": p["second_person_name"],
                 "price_per_session": pricing.number(p["price_per_session"]), "total_price": pricing.number(p["total_price"])}
                for p in active_packs
            ],
            "sessions": [{"id": s[0], "date": str(s[1]), "time": str(s[2]), "trainer": s[3],
                          "status": s[4], "number": s[5], "pack_id": assignment.get(s[0])} for s in sessions],
            "sessions_remaining": sum(1 for s in sessions if s[4] == "Booked" and s[1] >= datetime.now().date()),
        }
    finally:
        cursor.close()
        conn.close()


@app.post("/client-requests", dependencies=[Depends(require_client)])
def create_client_request(
    request: ClientRequestCreate,
    authorization: str | None = Header(default=None),
):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        claims = require_client(authorization)
        cursor.execute("SELECT id FROM users WHERE firebase_uid = %s", (claims.get("sub"),))
        user = cursor.fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="Client profile not found")
        user_id = user[0]

        session_type = pricing.normalize_type(request.session_type)
        second_name, second_email = pricing.second_person(session_type, request.second_person_name, request.second_person_email)

        # one entry per day, each with its own hour and (optionally) trainer; the same rules as everywhere (pack_schedule)
        entries = pack_schedule.clean(request.schedule, request.sessions_per_week, trainer_required=False)
        offered = weekly_start_times(cursor)
        closed = [entry for entry in entries if entry["time"] not in offered.get(entry["weekday"], [])]
        if closed:
            raise pack_schedule.unavailable(pack_schedule.problems(cursor, closed))
        taken = pack_schedule.problems(cursor, entries)
        if taken:
            raise pack_schedule.unavailable(taken)

        cursor.execute("""
            SELECT id FROM client_requests WHERE user_id = %s AND LOWER(status) = 'pending'
            LIMIT 1
        """, (user_id,))
        if cursor.fetchone():
            raise HTTPException(status_code=409, detail="You already have a pending request")
        # the pack must be on sale, of the chosen type and offer those sessions per week (the price is worked out at approval)
        sale = pack_catalog.sale(cursor, request.pack_id, request.sessions_per_week)
        if sale["pack"]["session_type"] != session_type:
            raise HTTPException(status_code=422, detail={
                "code": "invalid_session_type", "field": "session_type",
                "message": "El tipo de sesión no coincide con el pack. / The session type does not match the pack.",
            })

        cursor.execute(
            """
            INSERT INTO client_requests
            (
                user_id,
                plan_id,
                catalog_pack_id,
                sessions_per_week,
                preferred_days,
                preferred_time,
                schedule,
                session_type,
                second_person_name,
                second_person_email,
                trainer_id
            )

            VALUES
            (%s,%s,%s,%s,%s,NULL,%s::jsonb,%s,%s,%s,%s)
            """,
            (
                user_id,
                sale["pack"]["plan_id"],
                request.pack_id,
                request.sessions_per_week,
                pack_schedule.days_csv(entries),
                pack_schedule.dumps(entries),
                session_type,
                second_name,
                second_email,
                pack_schedule.main_trainer(entries)
            )
        )

        conn.commit()

        return {
            "message": "Request submitted successfully"
        }

    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Could not submit training request") from e

    finally:

        cursor.close()
        conn.close()


@app.get("/admin/client-requests", dependencies=[Depends(require_admin)])
def admin_client_requests(archived: str = "exclude"):
    """Training requests as rows [id, client, plan, per week, days, time, status,
    reason, archived_at, session type, second person name, second person email, plan months]. archived=exclude (default) hides archived ones,
    only returns just the archived ones, include returns everything."""
    if archived not in ("exclude", "only", "include"):
        raise HTTPException(status_code=422, detail="archived must be exclude, only or include")

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT

                cr.id,

                u.nome,

                p.nome,

                cr.sessions_per_week,

                cr.preferred_days,

                cr.preferred_time,

                cr.status,
                cr.rejection_reason,
                cr.archived_at,
                cr.session_type,
                cr.second_person_name,
                cr.second_person_email,
                p.duracao_meses,
                cr.trainer_id,
                tr.nome,
                cr.catalog_pack_id,
                u.email,
                cr.schedule

            FROM client_requests cr

            JOIN users u
                ON cr.user_id = u.id

            JOIN plans p
                ON cr.plan_id = p.id

            LEFT JOIN trainers tr
                ON tr.id = cr.trainer_id

            WHERE (%s = 'include'
                   OR (%s = 'only' AND cr.archived_at IS NOT NULL)
                   OR (%s = 'exclude' AND cr.archived_at IS NULL))

            ORDER BY cr.id DESC
            """,
            (archived, archived, archived)
        )

        rows = cursor.fetchall()
        names = pack_schedule.all_names(cursor)
        return [
            [*row[:8], row[8].isoformat() if row[8] else None, *row[9:17], pack_schedule.named(pack_schedule.loads(row[17]), names)]
            for row in rows
        ]

    finally:

        cursor.close()
        conn.close()


@app.post("/admin/packs/preview", dependencies=[Depends(require_admin)])
def admin_preview_pack(data: PackPreview):
    """What a pack would create and what would collide, without writing anything.
    The modal calls it while the form is filled in."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        return preview_pack(
            cursor, user_id=data.client_id, catalog_pack_id=data.pack_id,
            sessions_per_week=data.sessions_per_week, schedule=data.schedule, start_date=data.start_date,
        )
    finally:
        cursor.close()
        conn.close()


@app.get("/admin/email-defaults", dependencies=[Depends(require_admin)])
def admin_email_defaults():
    """Addresses pre-filled in "Enviar confirmación a" (TEAM_EMAILS or the defaults)."""
    return {"team_emails": team_emails()}


@app.post("/admin/approve-request", dependencies=[Depends(require_admin)])
def approve_request(
    data: ApproveRequest
):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT
                user_id,
                plan_id,
                sessions_per_week,
                preferred_days,
                preferred_time,
                session_type,
                second_person_name,
                second_person_email,
                catalog_pack_id,
                schedule
            FROM client_requests
            WHERE id = %s AND LOWER(status) = 'pending'
            FOR UPDATE
            """,
            (data.request_id,)
        )

        request = cursor.fetchone()

        if not request:

            raise HTTPException(status_code=404, detail="Pending request not found")

        user_id = request[0]
        # the catalogue pack: the one the admin picked, else the requested one (a request made before the catalogue
        # only knows its plan: it stands for the catalogue pack made from that plan)
        pack_id = data.pack_id or request[8] or pack_catalog.pack_for_request(cursor, request[1], request[5])
        if not pack_id:
            raise HTTPException(status_code=422, detail="Choose a pack for this request.")
        sessions_per_week = data.sessions_per_week or request[2]

        cursor.execute("SELECT nome, email FROM users WHERE id = %s", (user_id,))
        client_name, client_email = cursor.fetchone()

        if sessions_per_week < 1 or sessions_per_week > 7:
            raise HTTPException(status_code=400, detail="Sessions per week must be between 1 and 7")
        # The final schedule is the one the admin sends (the client's request, adjusted day by day): create_pack checks it
        # again (one entry per day, hour and trainer) and the trainers' conflicts, so nothing is trusted from the page.

        extra = clean_pack_recipients(data.extra_recipients if data.extra_recipients is not None else data.email_extra, client_email)

        created = create_pack(
            cursor, extra_emails=extra,
            user_id=user_id, client_name=client_name, client_email=client_email,
            catalog_pack_id=pack_id,
            sessions_per_week=sessions_per_week, schedule=data.schedule, start_date=data.start_date,
            request_id=data.request_id, allow_conflicts=data.allow_conflicts,
            allow_overlaps=data.allow_overlaps,
            session_type=request[5], second_person_name=request[6], second_person_email=request[7],
            calendar_share=data.share_calendar, calendar_extra=extra,
        )

        cursor.execute(
            """
            UPDATE client_requests

            SET
                status = 'Approved',
                trainer_id = %s,
                schedule = %s::jsonb,
                preferred_days = %s,
                start_date = %s,
                plan_id = %s,
                catalog_pack_id = %s,
                sessions_per_week = %s,
                rejection_reason = NULL

            WHERE id = %s
            """,
            (
                pack_schedule.main_trainer(created["schedule"]),
                pack_schedule.dumps(created["schedule"]),
                pack_schedule.days_csv(created["schedule"]),
                data.start_date,
                created["plan_id"],
                pack_id,
                sessions_per_week,
                data.request_id
            )
        )

        conn.commit()
        publish_calendar(created)           # only now (saved): the Google events and their invitations; never raises, never deletes
        inbox.on_pack_created(user_id, created["pack_id"], created["plan_name"])

        email = email_pack(
            created, client_name=client_name, client_email=client_email,
            days=pack_schedule.weekdays(created["schedule"]),
            sessions_per_week=sessions_per_week, trainer_name=created["trainer_label"],
            to_client=True, extra=extra,
        )

        return {
            "message": "Request approved successfully",
            "extra_recipients": extra,
            "total_sessions": created["total_sessions"],
            "calendar": {"failed": created["calendar_failed"], "errors": created["calendar_errors"], "guests_warning": created.get("calendar_guests_warning")},
            "email": email,
        }

    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:

        conn.rollback()

        log_error(e)
        # Admin-only endpoint: surface the real cause so it can be fixed
        # instead of hiding it behind a generic message.
        raise HTTPException(
            status_code=500,
            detail=f"Could not approve training request: {type(e).__name__}"
        ) from e

    finally:

        cursor.close()
        conn.close()


@app.post("/admin/clients/{client_id}/renew-pack", dependencies=[Depends(require_admin)])
def admin_new_pack(client_id: int, data: NewPack):
    """Adds a new pack to a client, on any start date, WITHOUT touching the packs
    the client already has (they run in parallel). Creates its sessions
    (database rows first, then Google Calendar events), then emails the client
    and the extra recipients a summary of this pack with a .ics of its sessions.
    Colliding sessions are refused with a 409 list unless allow_conflicts."""

    conn = get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SELECT nome, email FROM users WHERE id = %s", (client_id,))
        user = cursor.fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="Client not found")
        client_name, client_email = user

        extra = clean_pack_recipients(data.extra_recipients if data.extra_recipients is not None else data.email_extra, client_email)

        created = create_pack(
            cursor, extra_emails=extra,
            user_id=client_id, client_name=client_name, client_email=client_email,
            catalog_pack_id=data.pack_id,
            sessions_per_week=data.sessions_per_week, schedule=data.schedule, start_date=data.start_date,
            allow_conflicts=data.allow_conflicts, allow_overlaps=data.allow_overlaps,
            session_type=data.session_type, second_person_name=data.second_person_name,
            second_person_email=data.second_person_email,
            calendar_share=data.share_calendar, calendar_extra=extra,
        )

        conn.commit()
        publish_calendar(created)           # only now (saved): the Google events and their invitations; never raises, never deletes
        inbox.on_pack_created(client_id, created["pack_id"], created["plan_name"])

        email = email_pack(
            created, client_name=client_name, client_email=client_email, days=pack_schedule.weekdays(created["schedule"]),
            sessions_per_week=data.sessions_per_week, trainer_name=created["trainer_label"],
            to_client=True, extra=extra,
        )

        return {
            "message": "Pack created successfully",
            "extra_recipients": extra,
            "total_sessions": created["total_sessions"],
            "start_date": created["session_dates"][0],
            "end_date": created["session_dates"][-1],
            "session_type": created["session_type"],
            "price_per_session": pricing.number(created["price_per_session"]),
            "total_price": pricing.number(created["total_price"]),
            "calendar": {"failed": created["calendar_failed"], "errors": created["calendar_errors"], "guests_warning": created.get("calendar_guests_warning")},
            "email": email,
        }

    except HTTPException:
        conn.rollback()
        raise
    except Exception as error:
        conn.rollback()
        log_error(error)
        raise HTTPException(
            status_code=500,
            detail=f"Could not create the pack: {type(error).__name__}"
        ) from error

    finally:
        cursor.close()
        conn.close()


@app.post("/admin/reject-request", dependencies=[Depends(require_admin)])
def reject_request(data: RejectRequest):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            UPDATE client_requests SET status = 'Rejected', rejection_reason = %s
            WHERE id = %s AND LOWER(status) = 'pending'
            RETURNING id
        """, ((data.reason or "").strip() or None, data.request_id))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Pending request not found")
        conn.commit()
        return {"message": "Request rejected"}
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


def set_request_archived(request_id, archived):
    """Archives or restores a request. Only the archived_at mark changes: the
    status, sessions, plans and calendar events the request created stay as they are.
    Repeating the action is harmless (an archived request keeps its original date)."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        if archived:
            cursor.execute(
                "UPDATE client_requests SET archived_at = COALESCE(archived_at, NOW()) WHERE id = %s RETURNING id",
                (request_id,)
            )
        else:
            cursor.execute("UPDATE client_requests SET archived_at = NULL WHERE id = %s RETURNING id", (request_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Request not found")
        conn.commit()
        return {"message": "Request archived" if archived else "Request restored"}
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


@app.post("/admin/archive-request", dependencies=[Depends(require_admin)])
def archive_request(data: ArchiveRequest):
    return set_request_archived(data.request_id, True)


@app.post("/admin/unarchive-request", dependencies=[Depends(require_admin)])
def unarchive_request(data: ArchiveRequest):
    return set_request_archived(data.request_id, False)


@app.post("/admin/client-requests/bulk", dependencies=[Depends(require_admin)])
def bulk_client_requests(data: BulkPayload):
    """archive | unarchive several requests (only the archive mark changes, like the single action)."""
    if data.action not in ("archive", "unarchive"):
        raise unknown_action(data.action)
    return run_each("client-requests", data.action, data.ids, lambda request_id: set_request_archived(request_id, data.action == "archive"))


@app.get("/admin/sessions/email/{email}", dependencies=[Depends(require_admin)])
def get_sessions_by_email(email: str):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT

                s.session_number,

                s.session_date,

                s.session_time,

                s.status,

                t.nome

            FROM sessions s

            JOIN users u
                ON s.user_id = u.id

            JOIN trainers t
                ON s.trainer_id = t.id

            WHERE u.email = %s

            ORDER BY s.session_date
            """,
            (email,)
        )

        return cursor.fetchall()

    finally:

        cursor.close()
        conn.close()


@app.get("/admin/client-progress/{email}", dependencies=[Depends(require_admin)])
def client_progress(email: str):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT

                COUNT(*)

            FROM sessions s

            JOIN users u
                ON s.user_id = u.id

            WHERE

                u.email = %s

                AND s.session_date < CURRENT_DATE
            """,
            (email,)
        )

        completed = cursor.fetchone()[0]

        cursor.execute(
            """
            SELECT

                COUNT(*)

            FROM sessions s

            JOIN users u
                ON s.user_id = u.id

            WHERE u.email = %s
            """,
            (email,)
        )

        total = cursor.fetchone()[0]

        cursor.execute(
            """
            SELECT

                MIN(session_date)

            FROM sessions s

            JOIN users u
                ON s.user_id = u.id

            WHERE

                u.email = %s

                AND session_date >= CURRENT_DATE
            """,
            (email,)
        )

        next_session = cursor.fetchone()[0]

        return {
            "completed": completed,
            "total": total,
            "remaining": total - completed,
            "next_session": next_session
        }

    finally:

        cursor.close()
        conn.close()


@app.get("/trainer/{trainer_id}/available-times/{session_date}")
def get_available_times(
    trainer_id: int,
    session_date: str
):
    """Start times this trainer can still take on that date: inside their
    working hours and not already booked."""

    try:
        datetime.strptime(session_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=422, detail="Use a date as YYYY-MM-DD")

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute("SELECT 1 FROM trainers WHERE id = %s AND active", (trainer_id,))
        if not cursor.fetchone():
            return []

        return free_start_times(cursor, trainer_id, session_date)

    finally:

        cursor.close()
        conn.close()


@app.get("/features")
def public_features():
    """What the site is allowed to show; the frontend asks once. client_calendar is the
    CLIENT_CALENDAR_ENABLED switch (calendar buttons, feed and .ics for clients)."""
    return {"client_calendar": client_calendar_enabled(), "reschedule_min_hours_before": reschedule_min_hours_before()}


CLEAR_CALENDAR_CONFIRMATION = "CLEAR CALENDAR"


class ClearCalendarPayload(BaseModel):
    confirm: str = ""


@app.delete("/admin/clear-calendar", dependencies=[Depends(require_admin)])
def clear_google_calendar(data: ClearCalendarPayload):
    """Deletes from the calendar ONLY the events this app created (private tag
    app=thundbalance), every page of them; events made by people are never touched.
    Needs the administrator's Firebase token and {"confirm": "CLEAR CALENDAR"}."""
    if data.confirm != CLEAR_CALENDAR_CONFIRMATION:
        raise HTTPException(
            status_code=422,
            detail=f'Send {{"confirm": "{CLEAR_CALENDAR_CONFIRMATION}"}} to confirm.',
        )
    deleted = clear_calendar()
    return {
        "message": "Events created by the app were deleted from the calendar",
        "deleted": deleted,
    }


# ---------------------------------------------------------------------------
# Landing Page Editor (visual page builder)
# ---------------------------------------------------------------------------
# Content is stored as a single JSON document per "version" (draft / published).
# The public site always reads the "published" version. The admin editor reads
# and writes the "draft" version, and only overwrites "published" when the
# admin explicitly clicks Publish.


@app.get("/landing-page/content")
def get_landing_page_content(
    response: Response,
    version: str = "published",
    authorization: str | None = Header(default=None),
):

    if version not in ("draft", "published"):
        raise HTTPException(status_code=400, detail="Invalid version")

    # The published landing is ONE public, read-only answer for everybody (visitor, client, admin): it never looks at a token and
    # may be cached for a short time. The draft is the admin's own and is never cached.
    response.headers["Cache-Control"] = "public, max-age=30" if version == "published" else "no-store"

    if version == "draft":
        require_admin(authorization)

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT content, updated_at
            FROM landing_page_content
            WHERE version = %s
            """,
            (version,)
        )

        row = cursor.fetchone()

        if not row:

            return {
                "version": version,
                "content": DEFAULT_LANDING_CONTENT,
                "updated_at": None
            }

        content, updated_at = row

        return {
            "version": version,
            "content": content,
            "updated_at": updated_at.isoformat() if updated_at else None
        }

    finally:

        cursor.close()
        conn.close()


class FooterContentPayload(BaseModel):
    footer: dict[str, Any]
    previous_footer: dict[str, Any]


@app.put("/landing-page/footer", dependencies=[Depends(require_admin)])
def save_footer_content(payload: FooterContentPayload):
    """Publish just the footer, retaining unrelated draft and published content."""
    landing_limits.validate_structure(payload.footer, "footer")
    landing_limits.validate_structure(payload.previous_footer, "previous_footer")
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT version, content FROM landing_page_content "
            "WHERE version IN ('draft', 'published') ORDER BY version FOR UPDATE"
        )
        versions = dict(cursor.fetchall())
        published = versions.get('published', DEFAULT_LANDING_CONTENT)
        if published.get('sections', {}).get('footer', {}) != payload.previous_footer:
            raise HTTPException(status_code=409, detail="Footer has changed since it was loaded")
        for version in ('draft', 'published'):
            content = versions.get(version, DEFAULT_LANDING_CONTENT)
            updated = {**content, 'sections': {**content.get('sections', {}), 'footer': payload.footer}}
            cursor.execute(
                "INSERT INTO landing_page_content (version, content, updated_at) VALUES (%s, %s, NOW()) "
                "ON CONFLICT (version) DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()",
                (version, PgJson(updated)),
            )
        conn.commit()
        return {"message": "Footer saved successfully"}
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


@app.put("/landing-page/content/draft", dependencies=[Depends(require_admin)])
def save_landing_page_draft(payload: LandingContentPayload):

    landing_limits.validate_structure(payload.content)     # size, depth, items and text length (422 otherwise)
    landing_pricing.validate_content(payload.content)      # the manual pricing cards: limits, no HTML (422 otherwise)

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            INSERT INTO landing_page_content (version, content, updated_at)
            VALUES ('draft', %s, NOW())
            ON CONFLICT (version)
            DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()
            """,
            (PgJson(payload.content),)
        )

        conn.commit()

        return {"message": "Draft saved successfully"}

    finally:

        cursor.close()
        conn.close()


@app.post("/landing-page/publish", dependencies=[Depends(require_admin)])
def publish_landing_page(payload: LandingContentPayload | None = None):

    if payload is not None:
        landing_limits.validate_structure(payload.content)     # same limits as saving the draft
        landing_pricing.validate_content(payload.content)

    conn = get_connection()
    cursor = conn.cursor()

    try:

        if payload is not None:

            # Publish this exact content and keep the draft in sync with it.
            cursor.execute(
                """
                INSERT INTO landing_page_content (version, content, updated_at)
                VALUES ('draft', %s, NOW())
                ON CONFLICT (version)
                DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()
                """,
                (PgJson(payload.content),)
            )

            cursor.execute(
                """
                INSERT INTO landing_page_content (version, content, updated_at)
                VALUES ('published', %s, NOW())
                ON CONFLICT (version)
                DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()
                """,
                (PgJson(payload.content),)
            )

        else:

            # No content sent: publish whatever is currently saved as draft.
            cursor.execute(
                "SELECT content FROM landing_page_content WHERE version = 'draft'"
            )

            row = cursor.fetchone()

            draft_content = row[0] if row else DEFAULT_LANDING_CONTENT

            cursor.execute(
                """
                INSERT INTO landing_page_content (version, content, updated_at)
                VALUES ('published', %s, NOW())
                ON CONFLICT (version)
                DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()
                """,
                (PgJson(draft_content),)
            )

        conn.commit()

        return {"message": "Landing page published successfully"}

    finally:

        cursor.close()
        conn.close()


@app.post("/landing-page/reset", dependencies=[Depends(require_admin)])
def reset_landing_page(version: str = "draft"):

    # 'default_base' is an immutable snapshot written once on first startup
    # (see ensure_landing_page_table) and must never be a valid destination
    # for this endpoint — that's exactly what would let it be overwritten.
    if version not in ("draft", "published"):
        raise HTTPException(status_code=400, detail="Invalid version")

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            "SELECT content FROM landing_page_content WHERE version = 'default_base'"
        )

        row = cursor.fetchone()

        # Should always exist after ensure_landing_page_table runs on startup,
        # but fall back to the in-code default just in case.
        base_content = row[0] if row else DEFAULT_LANDING_CONTENT

        cursor.execute(
            """
            INSERT INTO landing_page_content (version, content, updated_at)
            VALUES (%s, %s, NOW())
            ON CONFLICT (version)
            DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()
            """,
            (version, PgJson(base_content))
        )
        landing_pricing.migrate_version(cursor, version)     # the restored Pricing section gets its list of packs too

        conn.commit()

        return {"message": f"{version} restored from default_base"}

    finally:

        cursor.close()
        conn.close()


@app.post("/landing-page/upload-image", dependencies=[Depends(require_admin)])
async def upload_landing_page_image(file: UploadFile = File(...)):

    contents = await file.read(MAX_IMAGE_SIZE_BYTES + 1)

    if len(contents) > MAX_IMAGE_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="Image is too large (max 8MB)")

    extension = web_safety.check_image(file.filename, contents)       # extension AND first bytes, no .svg
    return {"url": web_safety.save_upload(f"{uuid.uuid4().hex}{extension}", contents)}


@app.post("/landing-page/upload-video", dependencies=[Depends(require_admin)])
async def upload_landing_page_video(file: UploadFile = File(...)):

    # Same pattern as upload_landing_page_image above, just with video
    # extensions and a larger size ceiling. Videos are stored in the same
    # backend/uploads/ directory and served the same way.

    # The extension, the declared Content-Type and the first bytes of the file must agree (415 otherwise), and the stored name is made
    # here (uuid + the validated extension): the name sent by the user is never used.
    # The file is read 1 MB at a time into a temporary file and only moved to its final name when it is a valid video under the limit
    # (415 for the type, 413 as soon as it is too big): a 300 MB video is never held in memory.
    filename = await web_safety.store_video(file, UPLOAD_DIR, MAX_VIDEO_SIZE_BYTES)

    return {"url": f"/uploads/{filename}"}


# ---------------------------------------------------------------------------
# Training Videos (student-facing video library)
# ---------------------------------------------------------------------------
# Plain relational table (see ensure_training_videos_table above), saved
# directly — no draft/publish versioning like the Landing Page Editor.
# video_source is one of: 'instagram' | 'youtube' | 'vimeo' | 'upload'.
# For uploads, video_url is reused from POST /landing-page/upload-video
# (that endpoint isn't specific to the landing page despite its name — it
# just stores a file under backend/uploads/ and returns its path).


@app.get("/training-videos")
def get_training_videos():

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT
                id,
                title,
                description,
                video_source,
                video_url,
                display_order
            FROM training_videos
            ORDER BY display_order ASC, id ASC
            """
        )

        rows = cursor.fetchall()

        return [
            {
                "id": row[0],
                "title": row[1],
                "description": row[2],
                "video_source": row[3],
                "video_url": row[4],
                "display_order": row[5]
            }
            for row in rows
        ]

    finally:

        cursor.close()
        conn.close()


@app.post("/training-videos", dependencies=[Depends(require_admin)])
def create_training_video(video: TrainingVideoCreate):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT COALESCE(MAX(display_order), -1) + 1
            FROM training_videos
            """
        )

        next_order = cursor.fetchone()[0]

        cursor.execute(
            """
            INSERT INTO training_videos
            (title, description, video_source, video_url, display_order)

            VALUES (%s, %s, %s, %s, %s)

            RETURNING id
            """,
            (
                video.title,
                video.description,
                video.video_source,
                video.video_url,
                next_order
            )
        )

        video_id = cursor.fetchone()[0]

        conn.commit()

        return {
            "message": "Training video created successfully",
            "id": video_id
        }

    except Exception as e:

        conn.rollback()

        return {
            "error": safe_error(e)
        }

    finally:

        cursor.close()
        conn.close()


# Declared BEFORE /training-videos/{video_id} so "reorder" is never
# swallowed by the {video_id}: int path parameter.
@app.put("/training-videos/reorder", dependencies=[Depends(require_admin)])
def reorder_training_videos(payload: TrainingVideoReorder):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        for index, video_id in enumerate(payload.ordered_ids):

            cursor.execute(
                """
                UPDATE training_videos
                SET display_order = %s
                WHERE id = %s
                """,
                (index, video_id)
            )

        conn.commit()

        return {
            "message": "Training videos reordered successfully"
        }

    except Exception as e:

        conn.rollback()

        return {
            "error": safe_error(e)
        }

    finally:

        cursor.close()
        conn.close()


@app.put("/training-videos/{video_id}", dependencies=[Depends(require_admin)])
def update_training_video(
    video_id: int,
    video: TrainingVideoUpdate
):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            UPDATE training_videos
            SET
                title = %s,
                description = %s,
                video_source = %s,
                video_url = %s
            WHERE id = %s
            """,
            (
                video.title,
                video.description,
                video.video_source,
                video.video_url,
                video_id
            )
        )

        conn.commit()

        return {
            "message": "Training video updated successfully"
        }

    except Exception as e:

        conn.rollback()

        return {
            "error": safe_error(e)
        }

    finally:

        cursor.close()
        conn.close()


@app.post("/admin/training-videos/bulk", dependencies=[Depends(require_admin)])
def bulk_training_videos(data: BulkPayload):
    """remove several training videos, like the single action."""
    if data.action != "delete":
        raise unknown_action(data.action)
    return run_each("training-videos", "delete", data.ids, delete_training_video)


@app.delete("/training-videos/{video_id}", dependencies=[Depends(require_admin)])
def delete_training_video(video_id: int):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            DELETE FROM training_videos
            WHERE id = %s
            """,
            (video_id,)
        )

        conn.commit()

        return {
            "message": "Training video deleted successfully"
        }

    except Exception as e:

        conn.rollback()

        return {
            "error": safe_error(e)
        }

    finally:

        cursor.close()
        conn.close()

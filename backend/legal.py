"""Legal data of the studio: who the holder is (legal_settings), the texts the admin edited (legal_documents) and the proof of consent.

* legal_settings: ONE row (id = 1) with the company data the legal pages show. Nothing is invented: every field starts empty and the
  admin fills it in. The retention periods default to the RETENTION_* variables of data_retention.py.
* legal_documents: a text the admin edited, one per (document, language). No row = the site shows the model text of the code
  (src/legal/legalModels.js). Deleting the row restores the model. The text is plain text (paragraphs, "## " titles, "- " lists): the
  site escapes everything else, so a "<script>" typed here is shown as text.
* consents: who accepted what and when, only the version of the text and the date (no address, no browser data).
* The proof of consent of the public forms (trial, contact) is stored in the row itself (consent_version / consent_at).

GET /legal (public): the public company data and the edited texts. PUT /admin/legal/... : admin only.
"""
import logging
import re
from datetime import date

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

import data_retention
import validators
import web_safety
from database import get_connection

logger = logging.getLogger("thundbalance.legal")

DOCS = ("privacy", "legal", "terms", "cancellations", "cookies")
LANGS = ("es", "en", "ca")
BODY_MAX = 40000
VERSION_RE = re.compile(r"^[A-Za-z0-9._-]{1,20}$")
CONSENT_TYPES = ("privacy", "terms", "pack_request", "health")
TEXT_FIELDS = {"holder": 150, "tax_id": 30, "address": 250, "email": 120, "phone": 40, "registry": 250, "dpo_name": 120}
# the company data the legal pages need to be complete (the registry and the DPO are optional)
REQUIRED = ("holder", "tax_id", "address", "email")
RETENTION_FIELDS = ("retention_contact_days", "retention_trial_days", "retention_email_log_days")
_public_limit = web_safety.RateLimit(120, 60)

CONSENT_MESSAGES = {
    "es": "Debes aceptar la Política de privacidad para continuar.",
    "en": "You must accept the Privacy policy to continue.",
    "ca": "Has d'acceptar la Política de privacitat per continuar.",
}
HEALTH_MESSAGES = {
    "es": "Para el objetivo de rehabilitación o lesión necesitamos tu consentimiento explícito para tratar datos de salud.",
    "en": "For the rehabilitation or injury goal we need your explicit consent to process health data.",
    "ca": "Per a l'objectiu de rehabilitació o lesió necessitem el teu consentiment explícit per tractar dades de salut.",
}


# ---------------------------------------------------------------------------------------------------------------- schema
def ensure_schema():
    """Idempotent."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS legal_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                holder TEXT NOT NULL DEFAULT '',
                tax_id TEXT NOT NULL DEFAULT '',
                address TEXT NOT NULL DEFAULT '',
                email TEXT NOT NULL DEFAULT '',
                phone TEXT NOT NULL DEFAULT '',
                registry TEXT NOT NULL DEFAULT '',
                dpo_name TEXT NOT NULL DEFAULT '',
                retention_contact_days INTEGER,
                retention_trial_days INTEGER,
                retention_email_log_days INTEGER,
                last_review DATE,
                reviewed BOOLEAN NOT NULL DEFAULT FALSE,
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """
        )
        cursor.execute("INSERT INTO legal_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING")
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS legal_documents (
                doc TEXT NOT NULL,
                lang TEXT NOT NULL,
                body TEXT NOT NULL,
                updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
                PRIMARY KEY (doc, lang)
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS consents (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                consent_type TEXT NOT NULL,
                version TEXT NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """
        )
        cursor.execute("CREATE INDEX IF NOT EXISTS consents_user_idx ON consents (user_id)")
        # the proof of consent of the public forms lives in the row of the request itself
        cursor.execute("ALTER TABLE IF EXISTS trial_sessions ADD COLUMN IF NOT EXISTS consent_version TEXT")
        cursor.execute("ALTER TABLE IF EXISTS trial_sessions ADD COLUMN IF NOT EXISTS consent_at TIMESTAMP")
        cursor.execute("ALTER TABLE IF EXISTS trial_sessions ADD COLUMN IF NOT EXISTS health_consent_at TIMESTAMP")
        cursor.execute("ALTER TABLE IF EXISTS contact_messages ADD COLUMN IF NOT EXISTS consent_version TEXT")
        cursor.execute("ALTER TABLE IF EXISTS contact_messages ADD COLUMN IF NOT EXISTS consent_at TIMESTAMP")
        conn.commit()
    finally:
        cursor.close()
        conn.close()


# ---------------------------------------------------------------------------------------------------------------- consent
def clean_version(version):
    """The version of the text the visitor accepted ('2026-11'). Anything else is a 422."""
    text = str(version or "").strip()
    if not VERSION_RE.match(text):
        raise HTTPException(status_code=422, detail={"code": "invalid_consent_version", "message": "Invalid consent version."})
    return text


def require_consent(accepted, version, lang=None):
    """The public forms only go on when the box was ticked. Returns the clean version to store with the request."""
    if accepted is not True:
        message = CONSENT_MESSAGES.get(lang or "en", CONSENT_MESSAGES["en"])
        raise HTTPException(status_code=422, detail={"code": "consent_required", "message": message})
    return clean_version(version)


def require_health_consent(accepted, lang=None):
    if accepted is not True:
        message = HEALTH_MESSAGES.get(lang or "en", HEALTH_MESSAGES["en"])
        raise HTTPException(status_code=422, detail={"code": "health_consent_required", "message": message})


def record_consents(cursor, user_id, types, version):
    """One row per accepted text: only the type, the version and the date. The caller commits."""
    for consent_type in types:
        if consent_type in CONSENT_TYPES:
            cursor.execute("INSERT INTO consents (user_id, consent_type, version) VALUES (%s, %s, %s)", (user_id, consent_type, version))


# ---------------------------------------------------------------------------------------------------------------- reading
def _row_settings(row):
    keys = ["holder", "tax_id", "address", "email", "phone", "registry", "dpo_name", *RETENTION_FIELDS, "last_review", "reviewed", "updated_at"]
    data = dict(zip(keys, row))
    data["last_review"] = data["last_review"].isoformat() if data["last_review"] else None
    data["updated_at"] = data["updated_at"].isoformat() if data["updated_at"] else None
    return data


def read_settings(cursor):
    cursor.execute(
        "SELECT holder, tax_id, address, email, phone, registry, dpo_name, retention_contact_days, retention_trial_days, "
        "retention_email_log_days, last_review, reviewed, updated_at FROM legal_settings WHERE id = 1"
    )
    row = cursor.fetchone()
    if not row:
        cursor.execute("INSERT INTO legal_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING")
        return read_settings(cursor)
    return _row_settings(row)


def effective_retention(settings):
    """What the pages say: the value the admin typed, or what the daily job really uses (the RETENTION_* variables)."""
    defaults = data_retention.settings()
    return {
        "retention_contact_days": settings["retention_contact_days"] or defaults["contact_days"],
        "retention_trial_days": settings["retention_trial_days"] or defaults["trial_days"],
        "retention_email_log_days": settings["retention_email_log_days"] or defaults["email_log_days"],
    }


def missing_fields(settings):
    return [name for name in REQUIRED if not (settings.get(name) or "").strip()]


def needs_attention(settings):
    """True while the company data is incomplete or the admin did not mark the texts as reviewed."""
    return bool(missing_fields(settings)) or not settings["reviewed"]


def read_documents(cursor):
    cursor.execute("SELECT doc, lang, body, updated_at FROM legal_documents ORDER BY doc, lang")
    documents = {}
    for doc, lang, body, updated in cursor.fetchall():
        documents.setdefault(doc, {})[lang] = {"body": body, "updated_at": updated.isoformat() if updated else None}
    return documents


def public_view(settings, documents):
    public = {key: settings[key] for key in (*TEXT_FIELDS, "last_review")}
    public.update(effective_retention(settings))
    return {"settings": public, "documents": documents}


def get_public():
    conn = get_connection()
    cursor = conn.cursor()
    try:
        settings = read_settings(cursor)
        documents = read_documents(cursor)
        conn.commit()
        return public_view(settings, documents)
    finally:
        cursor.close()
        conn.close()


def get_admin():
    conn = get_connection()
    cursor = conn.cursor()
    try:
        settings = read_settings(cursor)
        documents = read_documents(cursor)
        conn.commit()
        view = public_view(settings, documents)
        view["settings"].update({"reviewed": settings["reviewed"], "updated_at": settings["updated_at"]})
        # what the admin typed, not the default of the variable (an empty box means "use the default")
        for name in RETENTION_FIELDS:
            view["settings"][name + "_custom"] = settings[name]
        view["defaults"] = {name: value for name, value in effective_retention({**settings, **{n: None for n in RETENTION_FIELDS}}).items()}
        view["missing"] = missing_fields(settings)
        view["needs_attention"] = needs_attention(settings)
        return view
    finally:
        cursor.close()
        conn.close()


# ---------------------------------------------------------------------------------------------------------------- writing
class SettingsPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    holder: str = Field(default="", max_length=150)
    tax_id: str = Field(default="", max_length=30)
    address: str = Field(default="", max_length=250)
    email: str = Field(default="", max_length=120)
    phone: str = Field(default="", max_length=40)
    registry: str = Field(default="", max_length=250)
    dpo_name: str = Field(default="", max_length=120)
    retention_contact_days: int | None = Field(default=None, ge=1, le=3650)
    retention_trial_days: int | None = Field(default=None, ge=1, le=3650)
    retention_email_log_days: int | None = Field(default=None, ge=1, le=3650)
    last_review: str | None = Field(default=None, max_length=10)
    reviewed: bool = False


class DocumentPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    body: str = Field(max_length=BODY_MAX)


def _clean_line(value, name):
    text = " ".join(str(value or "").split())
    if "<" in text or ">" in text:
        raise HTTPException(status_code=422, detail={"code": "no_html", "message": f"{name}: no HTML is allowed."})
    return text


def save_settings(payload):
    values = {}
    for name in TEXT_FIELDS:
        values[name] = _clean_line(getattr(payload, name), name)
    if values["email"]:
        try:
            values["email"] = validators.validate_email(values["email"])
        except validators.FieldError as error:
            raise validators.http_error(error) from None
    last_review = None
    if payload.last_review:
        try:
            last_review = date.fromisoformat(payload.last_review)
        except ValueError:
            raise HTTPException(status_code=422, detail={"code": "invalid_date", "message": "Invalid date."}) from None
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            UPDATE legal_settings SET holder = %s, tax_id = %s, address = %s, email = %s, phone = %s, registry = %s, dpo_name = %s,
                   retention_contact_days = %s, retention_trial_days = %s, retention_email_log_days = %s,
                   last_review = %s, reviewed = %s, updated_at = NOW()
            WHERE id = 1
            """,
            (values["holder"], values["tax_id"], values["address"], values["email"], values["phone"], values["registry"], values["dpo_name"],
             payload.retention_contact_days, payload.retention_trial_days, payload.retention_email_log_days, last_review, payload.reviewed),
        )
        conn.commit()
    finally:
        cursor.close()
        conn.close()
    logger.info("legal settings saved")
    return get_admin()


def _check_target(doc, lang):
    if doc not in DOCS or lang not in LANGS:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Document not found."})


def save_document(doc, lang, body):
    _check_target(doc, lang)
    text = str(body or "").replace("\r\n", "\n").strip()
    if not text:
        raise HTTPException(status_code=422, detail={"code": "empty_text", "message": "The text can not be empty (use Restore model)."})
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO legal_documents (doc, lang, body, updated_at) VALUES (%s, %s, %s, NOW()) "
            "ON CONFLICT (doc, lang) DO UPDATE SET body = EXCLUDED.body, updated_at = NOW()",
            (doc, lang, text),
        )
        conn.commit()
    finally:
        cursor.close()
        conn.close()
    return get_admin()


def restore_document(doc, lang):
    _check_target(doc, lang)
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM legal_documents WHERE doc = %s AND lang = %s", (doc, lang))
        conn.commit()
    finally:
        cursor.close()
        conn.close()
    return get_admin()


# ---------------------------------------------------------------------------------------------------------------- routes
def register_legal_routes(app, require_admin):
    admin = [Depends(require_admin)]

    @app.get("/legal")
    def public_legal(request: Request):
        """Public. Company data and the texts the admin edited. Nothing personal: it is what the legal pages show anyway."""
        if _public_limit.too_many(web_safety.get_client_ip(request)):
            raise HTTPException(status_code=429, detail={"code": "rate_limited", "message": "Too many requests."})
        return get_public()

    @app.get("/admin/legal", dependencies=admin)
    def admin_legal():
        return get_admin()

    @app.get("/admin/legal/status", dependencies=admin)
    def admin_legal_status():
        view = get_admin()
        return {"needs_attention": view["needs_attention"], "missing": view["missing"], "reviewed": view["settings"]["reviewed"]}

    @app.put("/admin/legal/settings", dependencies=admin)
    def put_settings(payload: SettingsPayload):
        return save_settings(payload)

    @app.put("/admin/legal/documents/{doc}/{lang}", dependencies=admin)
    def put_document(doc: str, lang: str, payload: DocumentPayload):
        return save_document(doc, lang, payload.body)

    @app.delete("/admin/legal/documents/{doc}/{lang}", dependencies=admin)
    def delete_document(doc: str, lang: str):
        return restore_document(doc, lang)

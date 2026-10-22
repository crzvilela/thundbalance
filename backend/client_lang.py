"""The language of a client, and the ONE function that decides the language of every e-mail sent to a client.

Languages: en, es, ca (a fixed list). users.lang holds the language the client has on the site (the site updates it when
they sign in and when they change the language); a booking or a request keeps its own (trial_sessions.lang,
reschedule_requests.lang). Old rows without a language stay empty.

resolve_client_lang(booking_lang, user_id, email) decides, in this order:
  1. the language saved with the booking / request itself, if it has one;
  2. users.lang of the client (found by user_id, or by e-mail);
  3. English (the language the site starts in).
It never uses the language of the admin panel, never raises and never writes personal data in the log.

PUT /me/language {lang}: the signed-in client changes THEIR OWN language (validated against the list).
"""
import logging

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from database import get_connection

logger = logging.getLogger("thundbalance.lang")

LANGUAGES = ("en", "es", "ca")
DEFAULT_LANGUAGE = "en"


def valid_lang(value):
    """'en' | 'es' | 'ca' when `value` is exactly one of them (any capitals / spaces forgiven), otherwise None."""
    code = str(value or "").strip().lower()
    return code if code in LANGUAGES else None


def ensure_column():
    """Idempotent, run at startup (also on the production database): users.lang, empty for the clients that already exist."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS lang TEXT")
        conn.commit()
    finally:
        cursor.close()
        conn.close()


def stored_lang(user_id=None, email=None):
    """users.lang of a client (by id, else by e-mail), or None."""
    if not user_id and not str(email or "").strip():
        return None
    conn = get_connection()
    cursor = conn.cursor()
    try:
        if user_id:
            cursor.execute("SELECT lang FROM users WHERE id = %s", (user_id,))
        else:
            cursor.execute("SELECT lang FROM users WHERE LOWER(email) = %s", (str(email).strip().lower(),))
        row = cursor.fetchone()
        return valid_lang(row[0]) if row else None
    finally:
        cursor.close()
        conn.close()


def resolve_client_lang(booking_lang=None, user_id=None, email=None):
    """The language of an e-mail to a client: the booking's / request's own, else the client's profile, else English."""
    own = valid_lang(booking_lang)
    if own:
        return own
    try:
        return stored_lang(user_id, email) or DEFAULT_LANGUAGE
    except Exception as error:  # noqa: BLE001 - an e-mail is never lost for want of a language
        logger.error("client language could not be read (%s)", type(error).__name__)
        return DEFAULT_LANGUAGE


def set_user_lang(user_id, lang):
    """Saves the client's language. Returns the saved code. Only the account `user_id` is touched."""
    code = valid_lang(lang)
    if not code:
        raise HTTPException(status_code=422, detail={"code": "invalid_language", "message": "Language must be en, es or ca."})
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("UPDATE users SET lang = %s WHERE id = %s AND lang IS DISTINCT FROM %s", (code, user_id, code))
        conn.commit()
        return code
    finally:
        cursor.close()
        conn.close()


class LanguagePayload(BaseModel):
    lang: str


def register_client_lang_routes(app, require_client, own_user_id):
    """own_user_id(claims) -> users.id of the signed-in account (or None)."""

    @app.put("/me/language")
    def put_my_language(data: LanguagePayload, claims=Depends(require_client)):
        user_id = own_user_id(claims)
        if not user_id:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Client not found."})
        return {"lang": set_user_lang(user_id, data.lang)}

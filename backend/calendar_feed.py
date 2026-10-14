"""Subscribable calendar feed (iCalendar) of a client's sessions.

The sessions live in the studio's shared Google Calendar; the client's own
calendar never sees them. This module gives each client a private URL that any
calendar app can subscribe to:

    GET /calendar/feed/{token}.ics        public, no login (the token IS the secret)

- users.calendar_feed_token: random (secrets.token_urlsafe(32)), unique,
  generated lazily the first time it is needed. Regenerating it invalidates
  the old link.
- sessions.feed_sequence: bumped whenever a session is cancelled or moved, so
  the SEQUENCE of its event grows and calendar apps replace their copy. A
  cancelled session stays in the feed as STATUS:CANCELLED so it disappears from
  the subscriber's calendar on the next refresh.
- Content is minimal: no email, phone, document, or client name.

Environment: PUBLIC_API_URL (optional) is the public origin of this backend,
used to build the link; default https://thundbalance.onrender.com.
"""
import logging
import os
import re
import secrets
from datetime import date, timedelta
from urllib.parse import quote

from fastapi import Depends, HTTPException
from fastapi.responses import Response

from database import get_connection
from emails.dates import parse_madrid
from emails.ics import build_ics

logger = logging.getLogger("thundbalance.calendar")

DEFAULT_PUBLIC_API_URL = "https://thundbalance.onrender.com"
FEED_PLACE = "ThundBalance, Carrer de Pallars 286, Barcelona"
PAST_DAYS = 30
REFRESH_HOURS = 6          # a hint only; Google ignores it and refreshes when it wants
CACHE_SECONDS = 300
_TOKEN = re.compile(r"^[A-Za-z0-9_-]{20,128}$")


def ensure_columns():
    """Idempotent, run at startup (also on the production database)."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_feed_token TEXT")
        cursor.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS users_calendar_feed_token_key ON users (calendar_feed_token)"
        )
        cursor.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS feed_sequence INTEGER NOT NULL DEFAULT 0")
        conn.commit()
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------- tokens

def _new_token():
    return secrets.token_urlsafe(32)


def get_or_create_token(cursor, user_id):
    """The client's token, created on first use. The caller commits."""
    cursor.execute("SELECT calendar_feed_token FROM users WHERE id = %s", (user_id,))
    row = cursor.fetchone()
    if not row:
        return None
    if row[0]:
        return row[0]
    # the WHERE keeps a concurrent request from overwriting a token just created
    cursor.execute(
        "UPDATE users SET calendar_feed_token = %s WHERE id = %s AND calendar_feed_token IS NULL",
        (_new_token(), user_id),
    )
    cursor.execute("SELECT calendar_feed_token FROM users WHERE id = %s", (user_id,))
    return cursor.fetchone()[0]


def regenerate_token(cursor, user_id):
    """Replaces the token (the old link stops working). The caller commits."""
    token = _new_token()
    cursor.execute("UPDATE users SET calendar_feed_token = %s WHERE id = %s", (token, user_id))
    return token if cursor.rowcount else None


def feed_urls(token, base_url=None):
    """{"https", "webcal", "google"} links for a token."""
    base = (base_url or os.getenv("PUBLIC_API_URL", "").strip() or DEFAULT_PUBLIC_API_URL).rstrip("/")
    https = f"{base}/calendar/feed/{token}.ics"
    webcal = re.sub(r"^https?://", "webcal://", https)
    return {
        "https": https,
        "webcal": webcal,
        "google": f"https://calendar.google.com/calendar/r?cid={quote(webcal, safe='')}",
    }


def links_for_email(client_email):
    """Links for the pack email, or None. Opens its own connection, commits,
    and never raises: an email must not fail because of the calendar link."""
    try:
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT id FROM users WHERE LOWER(email) = %s", (str(client_email or "").strip().lower(),))
            row = cursor.fetchone()
            if not row:
                return None
            token = get_or_create_token(cursor, row[0])
            conn.commit()
            return feed_urls(token) if token else None
        finally:
            cursor.close()
            conn.close()
    except Exception as error:  # noqa: BLE001
        logger.error("Calendar link for email unavailable (%s)", type(error).__name__)
        return None


# --------------------------------------------------------------------- feed

def _first_name(full_name):
    parts = str(full_name or "").split()
    return parts[0] if parts else ""


def session_summary(trainer_name):
    first = _first_name(trainer_name)
    return f"ThundBalance · Sesión con {first}" if first else "ThundBalance · Sesión"


def build_feed(cursor, user_id, today=None):
    """iCalendar text: sessions from the last 30 days on, cancelled ones included
    as STATUS:CANCELLED. Only ids, dates, trainer first name and the studio
    address leave the database."""
    since = (today or date.today()) - timedelta(days=PAST_DAYS)
    cursor.execute(
        """
        SELECT s.id, s.session_date, s.session_time, s.status, s.feed_sequence, t.nome
        FROM sessions s LEFT JOIN trainers t ON t.id = s.trainer_id
        WHERE s.user_id = %s AND s.session_date >= %s
        ORDER BY s.session_date, s.session_time, s.id
        """,
        (user_id, since),
    )
    events = []
    for session_id, day, moment, status, sequence, trainer in cursor.fetchall():
        events.append({
            "id": f"session-{session_id}",
            "start": parse_madrid(str(day), str(moment)[:5]),
            "summary": session_summary(trainer),
            "location": FEED_PLACE,
            "sequence": sequence or 0,
            "status": "CANCELLED" if str(status).lower() == "cancelled" else "CONFIRMED",
        })
    return build_ics(events, method=None, calname="ThundBalance", refresh_hours=REFRESH_HOURS)


def bump_sequence(cursor, session_id):
    """Call after a session is cancelled or moved."""
    cursor.execute("UPDATE sessions SET feed_sequence = feed_sequence + 1 WHERE id = %s", (session_id,))


# ------------------------------------------------------------------- routes

def register_calendar_feed_routes(app, require_admin, require_client, own_user_id):
    """own_user_id(claims) -> users.id of the signed-in account (or None)."""

    def _not_found():
        # same answer for "malformed", "unknown" and "regenerated": no hints
        return Response(status_code=404, content="Not found", media_type="text/plain")

    @app.api_route("/calendar/feed/{filename}", methods=["GET", "HEAD"], include_in_schema=False)
    def public_feed(filename: str):
        token = filename[:-4] if filename.endswith(".ics") else ""
        if not _TOKEN.match(token):
            return _not_found()
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT id FROM users WHERE calendar_feed_token = %s", (token,))
            row = cursor.fetchone()
            if not row:
                return _not_found()
            body = build_feed(cursor, row[0])
        except Exception as error:  # noqa: BLE001
            logger.error("Calendar feed failed (%s)", type(error).__name__)
            return Response(status_code=503, content="Unavailable", media_type="text/plain")
        finally:
            cursor.close()
            conn.close()
        return Response(
            content=body,
            media_type="text/calendar; charset=utf-8",
            headers={
                "Cache-Control": f"private, max-age={CACHE_SECONDS}",
                "Content-Disposition": 'inline; filename="thundbalance.ics"',
                "X-Robots-Tag": "noindex, nofollow",
                "Referrer-Policy": "no-referrer",
            },
        )

    def _links(user_id, regenerate=False):
        conn = get_connection()
        cursor = conn.cursor()
        try:
            token = regenerate_token(cursor, user_id) if regenerate else get_or_create_token(cursor, user_id)
            if not token:
                raise HTTPException(status_code=404, detail="Client not found")
            conn.commit()
            return feed_urls(token)
        finally:
            cursor.close()
            conn.close()

    @app.get("/me/calendar-feed")
    def my_calendar_feed(claims=Depends(require_client)):
        user_id = own_user_id(claims)
        if not user_id:
            raise HTTPException(status_code=404, detail="Client not found")
        return _links(user_id)

    @app.post("/me/calendar-feed/regenerate")
    def regenerate_my_calendar_feed(claims=Depends(require_client)):
        user_id = own_user_id(claims)
        if not user_id:
            raise HTTPException(status_code=404, detail="Client not found")
        return _links(user_id, regenerate=True)

    @app.get("/admin/clients/{client_id}/calendar-feed", dependencies=[Depends(require_admin)])
    def admin_calendar_feed(client_id: int):
        """The client's link (created now if it did not exist), for the admin to copy."""
        return _links(client_id)

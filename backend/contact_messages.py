"""Messages sent through the website's contact form.

Public: POST /contact-messages (saves the message and e-mails the studio).
Admin (Firebase ID token + administrator, every route):
  GET    /admin/contact-messages          ?archived=0|1 &q= &limit= &offset=  -> items, total, counts
  GET    /admin/contact-messages/count    -> inbox, unread, archived (the menu badge)
  GET    /admin/contact-messages/{id}
  POST   /admin/contact-messages/{id}/read | unread | archive | unarchive
  POST   /admin/contact-messages/bulk     {action: read|unread|archive|unarchive|delete, ids: [...]}
  DELETE /admin/contact-messages/{id}
Archiving and reading are idempotent; deleting is final and idempotent too (a message that is already
gone is not an error). A delete writes one row to contact_message_audit: who, how many, when. NEVER the
messages or any data of the people who wrote them.

Spam protection: a hidden "website" field that real people never fill, a limit
per IP address and a limit per e-mail address, and length limits on every field.
The notice e-mail goes to the team (TEAM_NOTIFICATION_EMAILS, default pt@thundbalance.com), with the sender as Reply-To.
"""
import logging
import os
import re
import threading
import time
from collections import defaultdict, deque

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel

from database import get_connection
from emails import send_email_async
from emails.contact_emails import staff_contact_message
from trial_notifications import studio_address
import validators

PER_IP_LIMIT = 5          # messages per hour from one IP address
PER_EMAIL_LIMIT = 3       # messages per hour with the same sender e-mail
WINDOW_SECONDS = 3600
MAX_BULK = 200            # ids per bulk request
PAGE_MAX = 100

logger = logging.getLogger("thundbalance.contact")

_recent_by_ip = defaultdict(deque)
_lock = threading.Lock()


class ContactCreate(BaseModel):
    name: str
    email: str
    message: str
    website: str | None = None   # honeypot: must stay empty
    language: str | None = None
    phone: str | None = None     # optional
    subject: str | None = None   # optional


class BulkPayload(BaseModel):
    action: str
    ids: list[int]


def _client_ip(request: Request):
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _allow_ip(ip):
    now = time.time()
    with _lock:
        hits = _recent_by_ip[ip]
        while hits and now - hits[0] > WINDOW_SECONDS:
            hits.popleft()
        if len(hits) >= PER_IP_LIMIT:
            return False
        hits.append(now)
        return True


def _clean(text, limit, multiline=False):
    """Control characters out, length limited. Not HTML-escaped on purpose: the panel (React) and the
    e-mail template escape when they draw it, and escaping here would show "&amp;" to the studio."""
    value = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    value = "".join(ch for ch in value if ch == "\n" or ch == "\t" or ord(ch) >= 32)
    if not multiline:
        value = " ".join(value.split())
    return value.strip()[:limit]


def ensure_contact_table():
    """Idempotent, run at startup (the project has no migrations). read_at is the "read" flag."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS contact_messages (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                message TEXT NOT NULL,
                language TEXT,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                read_at TIMESTAMP
            )
            """
        )
        cursor.execute("ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP")
        cursor.execute("ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS phone TEXT")
        cursor.execute("ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS subject TEXT")
        cursor.execute("CREATE INDEX IF NOT EXISTS contact_messages_archived_idx ON contact_messages (archived_at)")
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS contact_message_audit (
                id SERIAL PRIMARY KEY,
                action TEXT NOT NULL,
                amount INTEGER NOT NULL,
                admin_email TEXT,
                created_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """
        )
        conn.commit()
    finally:
        cursor.close()
        conn.close()


def _iso(value):
    return value.isoformat() if value is not None else None


def _fail(status, message):
    return HTTPException(status_code=status, detail=message)


COLUMNS = "id, name, email, message, language, created_at, read_at, archived_at, phone, subject"


def _item(row):
    return {"id": row[0], "name": row[1], "email": row[2], "message": row[3], "language": row[4],
            "created_at": _iso(row[5]), "read": row[6] is not None, "archived": row[7] is not None,
            "phone": row[8], "subject": row[9]}


def _like(text):
    """% and _ typed by the admin are searched literally."""
    return "%" + re.sub(r"([\\%_])", r"\\\1", str(text).strip().lower()) + "%"


def counts():
    """{"inbox", "unread", "archived"}: the archived ones are in neither inbox nor unread."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT COUNT(*) FILTER (WHERE archived_at IS NULL), "
            "COUNT(*) FILTER (WHERE archived_at IS NULL AND read_at IS NULL), "
            "COUNT(*) FILTER (WHERE archived_at IS NOT NULL) FROM contact_messages"
        )
        inbox, unread, archived = cursor.fetchone()
        return {"inbox": inbox, "unread": unread, "archived": archived}
    finally:
        cursor.close()
        conn.close()


def list_messages(archived=False, q="", limit=25, offset=0):
    """Newest first, one tab (inbox or archived), searched by name, email, subject or text, paged."""
    limit = max(1, min(int(limit), PAGE_MAX))
    offset = max(0, int(offset))
    like = _like(q) if str(q or "").strip() else None
    conn = get_connection()
    cursor = conn.cursor()
    try:
        where = ("(archived_at IS NOT NULL) = %(archived)s AND (%(like)s::text IS NULL OR LOWER(name) LIKE %(like)s "
                 "OR LOWER(email) LIKE %(like)s OR LOWER(COALESCE(subject, '')) LIKE %(like)s OR LOWER(message) LIKE %(like)s)")
        params = {"archived": bool(archived), "like": like, "limit": limit, "offset": offset}
        cursor.execute(f"SELECT COUNT(*) FROM contact_messages WHERE {where}", params)
        total = cursor.fetchone()[0]
        cursor.execute(f"SELECT {COLUMNS} FROM contact_messages WHERE {where} ORDER BY id DESC LIMIT %(limit)s OFFSET %(offset)s", params)
        items = [_item(row) for row in cursor.fetchall()]
    finally:
        cursor.close()
        conn.close()
    return {"items": items, "total": total, "counts": counts(), "limit": limit, "offset": offset}


def get_message(message_id):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(f"SELECT {COLUMNS} FROM contact_messages WHERE id = %s", (message_id,))
        row = cursor.fetchone()
    finally:
        cursor.close()
        conn.close()
    if not row:
        raise _fail(404, "Message not found")
    return _item(row)


def _clean_ids(ids):
    unique = sorted({int(item) for item in ids or []})
    if not unique:
        raise _fail(422, "Choose at least one message.")
    if len(unique) > MAX_BULK:
        raise _fail(422, f"At most {MAX_BULK} messages at a time.")
    return unique


ACTIONS = {
    "read": "UPDATE contact_messages SET read_at = COALESCE(read_at, NOW()) WHERE id = ANY(%s)",
    "unread": "UPDATE contact_messages SET read_at = NULL WHERE id = ANY(%s)",
    "archive": "UPDATE contact_messages SET archived_at = COALESCE(archived_at, NOW()) WHERE id = ANY(%s)",
    "unarchive": "UPDATE contact_messages SET archived_at = NULL WHERE id = ANY(%s)",
    "delete": "DELETE FROM contact_messages WHERE id = ANY(%s)",
}


def apply(action, ids, admin=""):
    """One action on several messages in ONE transaction. Repeating it changes nothing and is not an error:
    ids that no longer exist are simply not counted. Returns {"ok", "matched"} (matched = rows that exist)."""
    if action not in ACTIONS:
        raise _fail(422, "Unknown action.")
    ids = _clean_ids(ids)
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(ACTIONS[action], (ids,))
        matched = cursor.rowcount
        if action == "delete" and matched:
            # who deleted how many and when: no message, no sender, nothing about the people who wrote
            cursor.execute("INSERT INTO contact_message_audit (action, amount, admin_email) VALUES ('delete', %s, %s)",
                           (matched, str(admin)[:120] or None))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()
    if action == "delete":
        logger.info("contact messages deleted: %s", matched)
    return {"ok": True, "matched": matched}


def create_message(name, email, message, language, phone=None, subject=None):
    """Saves a message of the public form and returns (id, created_at). The per-email limit is checked here."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT COUNT(*) FROM contact_messages WHERE LOWER(email) = %s AND created_at > NOW() - INTERVAL '1 hour'",
            (email,),
        )
        if cursor.fetchone()[0] >= PER_EMAIL_LIMIT:
            raise HTTPException(status_code=429, detail="Too many messages. Please try again later.")
        cursor.execute(
            "INSERT INTO contact_messages (name, email, message, language, phone, subject) VALUES (%s, %s, %s, %s, %s, %s) "
            "RETURNING id, created_at",
            (name, email, message, language, phone, subject),
        )
        message_id, created = cursor.fetchone()
        conn.commit()
        return message_id, created
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise HTTPException(status_code=500, detail="We could not send your message. Please try again.")
    finally:
        cursor.close()
        conn.close()


def register_contact_routes(app, require_admin):
    admin = [Depends(require_admin)]

    @app.on_event("startup")
    def _ensure_table():
        ensure_contact_table()

    @app.post("/contact-messages")
    def create_contact_message(data: ContactCreate, request: Request):
        # A bot filled the hidden field: pretend it worked, store nothing.
        if (data.website or "").strip():
            return {"ok": True}

        message = _clean(data.message, 3000, multiline=True)
        try:
            name = validators.validate_name(data.name, "name")
            email = validators.validate_email(data.email)
        except validators.FieldError as error:
            raise validators.http_error(error) from None
        if len(message) < 5:
            raise HTTPException(status_code=422, detail="Please write a message.")
        if not _allow_ip(_client_ip(request)):
            raise HTTPException(status_code=429, detail="Too many messages. Please try again later.")

        language = _clean(data.language, 5) or None
        phone = _clean(data.phone, 30) or None
        subject = _clean(data.subject, 150) or None
        message_id, created = create_message(name, email, message, language, phone, subject)

        # The message is already saved; a mail problem must not fail the request.
        try:
            subject_line, html, text = staff_contact_message({"name": name, "email": email, "message": message, "created": created})
            to = studio_address()
            send_email_async(to, subject_line, html, text, reply_to=email, kind="staff_contact_message", lang="es")
        except Exception as error:  # noqa: BLE001
            logger.warning("Contact notification could not be sent: %s", type(error).__name__)
        return {"ok": True, "id": message_id}

    @app.get("/admin/contact-messages", dependencies=admin)
    def list_contact_messages(archived: bool = False, q: str = "", limit: int = 25, offset: int = 0):
        return list_messages(archived, q, limit, offset)

    @app.get("/admin/contact-messages/count", dependencies=admin)
    def count_contact_messages():
        return counts()

    @app.post("/admin/contact-messages/bulk")
    def bulk_contact_messages(data: BulkPayload, claims=Depends(require_admin)):
        return apply(data.action, data.ids, claims.get("email", ""))

    @app.get("/admin/contact-messages/{message_id}", dependencies=admin)
    def get_contact_message(message_id: int):
        return get_message(message_id)

    def single(action):
        def endpoint(message_id: int):
            get_message(message_id)                  # 404 for a message that does not exist
            return apply(action, [message_id])
        return endpoint

    for name in ("read", "unread", "archive", "unarchive"):
        app.post(f"/admin/contact-messages/{{message_id}}/{name}", dependencies=admin)(single(name))

    @app.delete("/admin/contact-messages/{message_id}")
    def delete_contact_message(message_id: int, claims=Depends(require_admin)):
        return apply("delete", [message_id], claims.get("email", ""))

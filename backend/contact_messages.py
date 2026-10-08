"""Messages sent through the website's contact form.

Public: POST /contact-messages (saves the message and e-mails the studio).
Admin:  GET /admin/contact-messages, POST .../{id}/read, POST .../{id}/unread,
        DELETE .../{id}.

Spam protection: a hidden "website" field that real people never fill, a limit
per IP address and a limit per e-mail address, and length limits on every field.
The notice e-mail goes to CONTACT_NOTIFY_TO (default: the same address as the
trial-session notices, TRIAL_NOTIFY_TO / info@thundbalance.com).
"""
import os
import re
import threading
import time
from collections import defaultdict, deque
from datetime import datetime

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel

from database import get_connection
from emails import send_email_async
from emails.contact_emails import staff_contact_message
from trial_notifications import studio_address

PER_IP_LIMIT = 5          # messages per hour from one IP address
PER_EMAIL_LIMIT = 3       # messages per hour with the same sender e-mail
WINDOW_SECONDS = 3600

_recent_by_ip = defaultdict(deque)
_lock = threading.Lock()


class ContactCreate(BaseModel):
    name: str
    email: str
    message: str
    website: str | None = None   # honeypot: must stay empty
    language: str | None = None


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
    value = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    value = "".join(ch for ch in value if ch == "\n" or ch == "\t" or ord(ch) >= 32)
    if not multiline:
        value = " ".join(value.split())
    return value.strip()[:limit]


def ensure_contact_table():
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
        conn.commit()
    finally:
        cursor.close()
        conn.close()


def _iso(value):
    return value.isoformat() if value is not None else None


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

        name = _clean(data.name, 120)
        email = _clean(data.email, 254).lower()
        message = _clean(data.message, 3000, multiline=True)
        if len(name) < 2:
            raise HTTPException(status_code=422, detail="Please enter your name.")
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise HTTPException(status_code=422, detail="Please enter a valid email address.")
        if len(message) < 5:
            raise HTTPException(status_code=422, detail="Please write a message.")
        if not _allow_ip(_client_ip(request)):
            raise HTTPException(status_code=429, detail="Too many messages. Please try again later.")

        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT COUNT(*) FROM contact_messages WHERE LOWER(email) = %s AND created_at > NOW() - INTERVAL '1 hour'",
                (email,),
            )
            if cursor.fetchone()[0] >= PER_EMAIL_LIMIT:
                raise HTTPException(status_code=429, detail="Too many messages. Please try again later.")
            language = _clean(data.language, 5) or None
            cursor.execute(
                "INSERT INTO contact_messages (name, email, message, language) VALUES (%s, %s, %s, %s) RETURNING id, created_at",
                (name, email, message, language),
            )
            message_id, created = cursor.fetchone()
            conn.commit()
        except HTTPException:
            conn.rollback()
            raise
        except Exception:
            conn.rollback()
            raise HTTPException(status_code=500, detail="We could not send your message. Please try again.")
        finally:
            cursor.close()
            conn.close()

        # The message is already saved; a mail problem must not fail the request.
        try:
            subject, html, text = staff_contact_message({"name": name, "email": email, "message": message, "created": created})
            to = os.getenv("CONTACT_NOTIFY_TO", "").strip() or studio_address()
            send_email_async(to, subject, html, text, reply_to=email)
        except Exception as error:  # noqa: BLE001
            print(f"Contact notification could not be sent: {type(error).__name__}")
        return {"ok": True, "id": message_id}

    @app.get("/admin/contact-messages", dependencies=admin)
    def list_contact_messages():
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT id, name, email, message, language, created_at, read_at FROM contact_messages ORDER BY id DESC LIMIT 300"
            )
            return [
                {"id": r[0], "name": r[1], "email": r[2], "message": r[3], "language": r[4],
                 "created_at": _iso(r[5]), "read": r[6] is not None}
                for r in cursor.fetchall()
            ]
        finally:
            cursor.close()
            conn.close()

    def _set_read(message_id, read):
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "UPDATE contact_messages SET read_at = %s WHERE id = %s RETURNING id",
                (datetime.now() if read else None, message_id),
            )
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="Message not found")
            conn.commit()
            return {"ok": True}
        except HTTPException:
            conn.rollback()
            raise
        finally:
            cursor.close()
            conn.close()

    @app.post("/admin/contact-messages/{message_id}/read", dependencies=admin)
    def mark_contact_message_read(message_id: int):
        return _set_read(message_id, True)

    @app.post("/admin/contact-messages/{message_id}/unread", dependencies=admin)
    def mark_contact_message_unread(message_id: int):
        return _set_read(message_id, False)

    @app.delete("/admin/contact-messages/{message_id}", dependencies=admin)
    def delete_contact_message(message_id: int):
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("DELETE FROM contact_messages WHERE id = %s RETURNING id", (message_id,))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="Message not found")
            conn.commit()
            return {"ok": True}
        except HTTPException:
            conn.rollback()
            raise
        finally:
            cursor.close()
            conn.close()

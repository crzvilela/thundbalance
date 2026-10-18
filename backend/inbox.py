"""The client's inbox: messages the studio writes and messages the system writes by itself.

A PARALLEL channel to the e-mails: nothing here replaces, removes or changes an e-mail, and a failure
here never breaks the operation that caused it (create_system_message and the on_* helpers catch
everything and log WITHOUT personal data).

Tables
  inbox_messages    one row per message. kind 'admin' (title/body written by the studio, optional
                    translations) or 'system' (template_key + params, drawn in the reader's language).
  inbox_recipients  one row per person who receives it (user_id, or only recipient_email while that
                    person has no account: it is linked when they sign up with a VERIFIED e-mail).

Who receives (worked out WHEN the studio sends or schedules; later sign-ups do not get old messages)
  all          every client that is not archived (never the admin account)
  active_pack  the same, with an active pack (pack_view.active_pack_sql: the dashboard's definition)
  user         one client, chosen by e-mail
  Archived clients never receive anything, automatic messages included.

Time: visible_from / expires_at are Europe/Madrid wall-clock times. There is no background job: "send
later" is only a filter (visible_from <= now) when the inbox is read.

Buttons inside a message: the STATE is always read live from the real object (the trial session, the
reschedule request): available | done | expired. So the e-mail link and the inbox never contradict.
Opening or listing never decides anything; only the POST of an action does, through the SAME functions
the e-mail pages use.

Cleanup: lazy and light. Reading the inbox deletes, at most once an hour per process, the messages that
expired more than CLEANUP_DAYS ago. (No cron.)
"""
import logging
import re
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta
from urllib.parse import urlparse

from fastapi import Depends, HTTPException
from psycopg2.extras import Json
from pydantic import BaseModel

import pack_view
from database import get_connection
from emails.dates import format_date_bilingual, now_madrid, parse_madrid
from emails.texts import normalize_language
from inbox_texts import ACTION_LABELS, NOTE_INTRO, TITLES_BODIES

logger = logging.getLogger("thundbalance.inbox")

DEFAULT_LANGUAGE = "en"
LANGUAGES = ("en", "es", "ca")
TITLE_MAX = 120
BODY_MAX = 2000
LABEL_MAX = 40
TARGET_MAX = 500
PAGE_SIZE = 20
PAGE_SIZE_MAX = 50
MAX_SCHEDULE_DAYS = 366
CLEANUP_DAYS = 90
# the only internal paths a button of the studio may open (anything else must be an http(s) address)
INTERNAL_TARGETS = ("/my-sessions", "/profile", "/dashboard", "/trial-session", "/training-request", "/training-tips")
AUDIENCES = ("all", "active_pack", "user")

# What each automatic message offers. (action type, label key, target for links)
SYSTEM_ACTIONS = {
    "trial_approved": [("trial_confirm", "trial_confirm", None), ("trial_decline", "trial_decline", None)],
    "reschedule_counter": [("reschedule_accept", "reschedule_accept", None), ("reschedule_reject", "reschedule_reject", None)],
    "pack_approved": [("link", "view_sessions", "/my-sessions")],
}
SYSTEM_TYPES = tuple(TITLES_BODIES["en"])

ADMIN_EMAIL = ""           # set by register_inbox_routes (the account that never gets general messages)

_ready = threading.Event()
_lock = threading.Lock()
_cleanup_at = 0.0
_hits = defaultdict(deque)
_hits_lock = threading.Lock()
RATE = {"list": (60, 60), "count": (60, 60), "act": (30, 60)}      # name -> (requests, seconds) per person


def configure(admin_email):
    global ADMIN_EMAIL
    ADMIN_EMAIL = str(admin_email or "").strip().casefold()


def fail(status, code, message):
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _now():
    """Now in Madrid as a naive datetime (the clock visible_from and expires_at use)."""
    return now_madrid().replace(tzinfo=None)


def _iso(value):
    return value.isoformat() if value is not None else None


def _limited(kind, who):
    """True when `who` made too many requests of this kind in the last window."""
    limit, window = RATE[kind]
    now = time.time()
    with _hits_lock:
        hits = _hits[(kind, who)]
        while hits and now - hits[0] > window:
            hits.popleft()
        if len(hits) >= limit:
            return True
        hits.append(now)
        return False


def _throttle(kind, claims):
    if _limited(kind, str(claims.get("sub") or claims.get("email") or "?")):
        raise fail(429, "too_many_requests", "Too many requests. Please wait a moment.")


# ----------------------------------------------------------------------------- database
def ensure_tables():
    """Idempotent, run at startup (the project has no migrations)."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS inbox_messages (
                id SERIAL PRIMARY KEY,
                kind TEXT NOT NULL,
                type TEXT NOT NULL,
                title TEXT,
                body TEXT,
                translations JSONB,
                main_lang TEXT,
                audience TEXT,
                action_label TEXT,
                action_target TEXT,
                template_key TEXT,
                params JSONB,
                refs JSONB,
                dedupe_key TEXT,
                visible_from TIMESTAMP NOT NULL,
                expires_at TIMESTAMP,
                created_by TEXT,
                idempotency_key TEXT,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                deleted_at TIMESTAMP
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS inbox_recipients (
                id SERIAL PRIMARY KEY,
                message_id INTEGER NOT NULL REFERENCES inbox_messages(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                recipient_email TEXT NOT NULL,
                read_at TIMESTAMP,
                deleted_at TIMESTAMP,
                created_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS inbox_audit (
                id SERIAL PRIMARY KEY,
                action TEXT NOT NULL,
                message_id INTEGER,
                admin_email TEXT,
                created_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """
        )
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS inbox_messages_dedupe_key ON inbox_messages (dedupe_key)")
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS inbox_messages_idempotency_key ON inbox_messages (idempotency_key)")
        cursor.execute("CREATE INDEX IF NOT EXISTS inbox_messages_kind_visible_idx ON inbox_messages (kind, visible_from)")
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS inbox_recipients_message_user_key ON inbox_recipients (message_id, user_id)")
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS inbox_recipients_message_email_key ON inbox_recipients (message_id, recipient_email)")
        cursor.execute("CREATE INDEX IF NOT EXISTS inbox_recipients_user_idx ON inbox_recipients (user_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS inbox_recipients_email_idx ON inbox_recipients (recipient_email)")
        cursor.execute("CREATE INDEX IF NOT EXISTS inbox_recipients_user_read_idx ON inbox_recipients (user_id, read_at)")
        conn.commit()
    finally:
        cursor.close()
        conn.close()
    _ready.set()


def ensure_tables_once():
    if _ready.is_set():
        return
    with _lock:
        if not _ready.is_set():
            ensure_tables()


# ----------------------------------------------------------------------------- automatic messages
def _dedupe_key(message_type, refs, state):
    parts = [message_type] + [f"{key}{value}" for key, value in sorted((refs or {}).items())]
    if state:
        parts.append(str(state))
    return ":".join(parts)[:200]


def create_system_message(message_type, user_id=None, email=None, refs=None, params=None, state=""):
    """THE function that writes an automatic message. Returns the message id, or None when nothing was
    written (duplicate, archived client, no recipient or an error). It NEVER raises: whatever happens
    here must not break the operation that called it. Calling it twice for the same thing (same type,
    refs and state) writes one message.

    The person is `user_id`, or the client with `email`; with neither an account the message waits for
    recipient_email (user_id empty) until that person signs up with a verified e-mail."""
    try:
        if message_type not in SYSTEM_TYPES:
            raise ValueError("unknown type")
        ensure_tables_once()
        conn = get_connection()
        cursor = conn.cursor()
        try:
            if user_id:
                cursor.execute("SELECT id, LOWER(email), archived_at IS NOT NULL FROM users WHERE id = %s", (user_id,))
            else:
                cursor.execute("SELECT id, LOWER(email), archived_at IS NOT NULL FROM users WHERE LOWER(email) = %s",
                               (str(email or "").strip().lower(),))
            account = cursor.fetchone()
            if account and account[2]:
                return None                                   # archived clients never receive
            recipient = (account[1] if account else str(email or "")).strip().lower()
            if not recipient:
                return None
            cursor.execute(
                """
                INSERT INTO inbox_messages (kind, type, template_key, params, refs, dedupe_key, visible_from)
                VALUES ('system', %s, %s, %s, %s, %s, %s)
                ON CONFLICT (dedupe_key) DO NOTHING RETURNING id
                """,
                (message_type, message_type, Json(params or {}), Json(refs or {}), _dedupe_key(message_type, refs, state), _now()),
            )
            row = cursor.fetchone()
            if not row:
                conn.rollback()
                return None                                   # the same message already exists
            cursor.execute(
                "INSERT INTO inbox_recipients (message_id, user_id, recipient_email) VALUES (%s, %s, %s)",
                (row[0], account[0] if account else None, recipient),
            )
            conn.commit()
            return row[0]
        except Exception:
            conn.rollback()
            raise
        finally:
            cursor.close()
            conn.close()
    except Exception as error:  # noqa: BLE001 - never breaks the caller; no personal data in the log
        logger.error("inbox message %s could not be created (%s)", message_type, type(error).__name__)
        return None


def at(day, time_):
    """"2026-10-21 18:00": how the params carry a moment (written as a date when read)."""
    return f"{str(day)[:10]} {str(time_)[:5]}"


# one small helper per operation, called by the functions that already concentrate it
def on_trial_approved(trial_id, email, day, time_):
    create_system_message("trial_approved", email=email, refs={"trial_id": trial_id}, params={"session_at": at(day, time_)})


def on_trial_answered(trial, wanted):
    """The client confirmed or declined the trial session (by e-mail link or from the inbox: same function)."""
    kind = "trial_confirmed" if wanted == "confirmed" else "trial_declined"
    create_system_message(kind, email=trial["email"], refs={"trial_id": trial["id"]},
                          params={"session_at": at(trial["session_date"], trial["session_time"])})


def on_pack_created(user_id, pack_id, plan_name, state=""):
    """A pack was approved / assigned / created for the client (never raises)."""
    create_system_message("pack_approved", user_id=user_id, refs={"pack_id": pack_id}, params={"plan_name": plan_name}, state=state)


# ----------------------------------------------------------------------------- reading
class SafeValues(dict):
    def __missing__(self, key):
        return ""


def _when(text, lang):
    try:
        day, moment = str(text).split(" ")
        return format_date_bilingual(parse_madrid(day, moment)).full(lang)
    except Exception:  # noqa: BLE001
        return str(text)


def render_system(message_type, params, lang):
    """(title, body) of an automatic message in `lang` (English when the type is unknown)."""
    title, body = TITLES_BODIES.get(lang, TITLES_BODIES[DEFAULT_LANGUAGE]).get(message_type) or TITLES_BODIES[DEFAULT_LANGUAGE][message_type]
    values = SafeValues()
    for key, value in (params or {}).items():
        values[key] = _when(value, lang) if str(key).endswith("_at") else str(value)
    note = " ".join(str((params or {}).get("note") or "").split())
    values["note_text"] = NOTE_INTRO[lang].format(note=note) if note else ""
    return title.format_map(values), body.format_map(values)


def render_admin(title, body, translations, lang):
    """The studio's text in the reader's language: the translation if there is one, else what was written
    (each part falls back on its own)."""
    own = (translations or {}).get(lang) or {}
    return (own.get("title") or title or ""), (own.get("body") or body or "")


def _trial_state(row):
    status = str(row[0] or "").lower()
    if status in ("confirmed", "declined"):
        return "done"
    if status == "approved":
        return "expired" if _now() >= parse_madrid(str(row[1])[:10], str(row[2])[:5]).replace(tzinfo=None) else "available"
    return "expired"


def _live_states(cursor, entries):
    """{("trial", id): state, ("request", id): state}, one query each, for the objects the page refers to."""
    trials = sorted({item["refs"].get("trial_id") for item in entries if item["refs"].get("trial_id")})
    requests = sorted({item["refs"].get("request_id") for item in entries if item["refs"].get("request_id")})
    states = {}
    if trials:
        cursor.execute("SELECT id, status, session_date, session_time FROM trial_sessions WHERE id = ANY(%s)", (trials,))
        for row in cursor.fetchall():
            states[("trial", row[0])] = _trial_state(row[1:])
    if requests:
        import reschedule_requests
        reschedule_requests.expire_stale(cursor)               # a proposal that ran out of time says so
        cursor.execute("SELECT id, status FROM reschedule_requests WHERE id = ANY(%s)", (requests,))
        for request_id, status in cursor.fetchall():
            states[("request", request_id)] = "available" if status == "counter_proposed" else ("done" if status in ("accepted", "declined") else "expired")
    return states


def _actions(entry, lang, states):
    """The buttons of one message with their live state."""
    result = []
    if entry["kind"] == "admin":
        if entry["action_target"] and entry["action_label"]:
            result.append({"type": "link", "label": entry["action_label"], "target": entry["action_target"], "state": "available"})
        return result
    for action_type, label_key, target in SYSTEM_ACTIONS.get(entry["type"], []):
        if action_type in ("trial_confirm", "trial_decline"):
            state = states.get(("trial", entry["refs"].get("trial_id")), "expired")
        elif action_type in ("reschedule_accept", "reschedule_reject"):
            state = states.get(("request", entry["refs"].get("request_id")), "expired")
        else:
            state = "available"
        result.append({"type": action_type, "label": ACTION_LABELS[lang][label_key], "target": target, "state": state})
    return result


SELECT_ITEMS = """
    SELECT r.id, m.kind, m.type, m.title, m.body, m.translations, m.params, m.refs, m.action_label, m.action_target,
           m.visible_from, r.read_at
    FROM inbox_recipients r JOIN inbox_messages m ON m.id = r.message_id
"""
VISIBLE = ("r.deleted_at IS NULL AND m.deleted_at IS NULL AND m.visible_from <= %(now)s "
           "AND (m.expires_at IS NULL OR m.expires_at > %(now)s)")


def _entry(row):
    return {"id": row[0], "kind": row[1], "type": row[2], "title": row[3], "body": row[4], "translations": row[5],
            "params": row[6] or {}, "refs": row[7] or {}, "action_label": row[8], "action_target": row[9],
            "visible_from": row[10], "read_at": row[11]}


def _item(entry, lang, states):
    if entry["kind"] == "system":
        title, body = render_system(entry["type"], entry["params"], lang)
    else:
        title, body = render_admin(entry["title"], entry["body"], entry["translations"], lang)
    actions = _actions(entry, lang, states)
    return {
        "id": entry["id"], "kind": entry["kind"], "type": entry["type"], "title": title, "body": body,
        "date": _iso(entry["visible_from"]), "read": entry["read_at"] is not None, "actions": actions,
        # a message that still waits for an answer can not be deleted; a plain link does not count
        "can_delete": not any(action["type"] != "link" and action["state"] == "available" for action in actions),
    }


def link_by_email(cursor, user_id, claims):
    """Messages that were waiting for this e-mail (no account then) become theirs, but ONLY when the
    sign-in e-mail is VERIFIED: nobody can read another person's messages by registering their address."""
    email = str(claims.get("email") or "").strip().lower()
    if not email or claims.get("email_verified") is not True:
        return 0
    cursor.execute("UPDATE inbox_recipients SET user_id = %s WHERE user_id IS NULL AND recipient_email = %s", (user_id, email))
    return cursor.rowcount


def cleanup_expired(cursor):
    """Lazy: at most once an hour, remove the messages that expired more than CLEANUP_DAYS ago."""
    global _cleanup_at
    if time.time() - _cleanup_at < 3600:
        return
    _cleanup_at = time.time()
    cursor.execute("DELETE FROM inbox_messages WHERE expires_at IS NOT NULL AND expires_at < %s", (_now() - timedelta(days=CLEANUP_DAYS),))


def _lang(value):
    return normalize_language(value) or DEFAULT_LANGUAGE


def list_inbox(user_id, claims, lang=None, page=1, filter_="all", size=PAGE_SIZE):
    ensure_tables_once()
    lang = _lang(lang)
    size = max(1, min(int(size or PAGE_SIZE), PAGE_SIZE_MAX))
    page = max(1, int(page or 1))
    unread_only = filter_ == "unread"
    conn = get_connection()
    cursor = conn.cursor()
    try:
        link_by_email(cursor, user_id, claims)
        cleanup_expired(cursor)
        conn.commit()
        params = {"user": user_id, "now": _now(), "limit": size, "offset": (page - 1) * size}
        extra = " AND r.read_at IS NULL" if unread_only else ""
        cursor.execute(f"SELECT COUNT(*) FROM inbox_recipients r JOIN inbox_messages m ON m.id = r.message_id "
                       f"WHERE r.user_id = %(user)s AND {VISIBLE}{extra}", params)
        total = cursor.fetchone()[0]
        cursor.execute(f"{SELECT_ITEMS} WHERE r.user_id = %(user)s AND {VISIBLE}{extra} "
                       "ORDER BY m.visible_from DESC, r.id DESC LIMIT %(limit)s OFFSET %(offset)s", params)
        entries = [_entry(row) for row in cursor.fetchall()]
        states = _live_states(cursor, entries)
        conn.commit()                                          # keeps the expiry the live check may have recorded
        cursor.execute(f"SELECT COUNT(*) FROM inbox_recipients r JOIN inbox_messages m ON m.id = r.message_id "
                       f"WHERE r.user_id = %(user)s AND {VISIBLE} AND r.read_at IS NULL", params)
        unread = cursor.fetchone()[0]
    finally:
        cursor.close()
        conn.close()
    return {"items": [_item(entry, lang, states) for entry in entries], "total": total, "page": page,
            "pages": max(1, -(-total // size)), "unread": unread}


def unread_count(user_id, claims):
    ensure_tables_once()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        if link_by_email(cursor, user_id, claims):
            conn.commit()
        cursor.execute(
            f"SELECT COUNT(*) FROM inbox_recipients r JOIN inbox_messages m ON m.id = r.message_id "
            f"WHERE r.user_id = %(user)s AND r.read_at IS NULL AND {VISIBLE}", {"user": user_id, "now": _now()})
        return {"unread": cursor.fetchone()[0]}
    finally:
        cursor.close()
        conn.close()


def _own_recipient(cursor, user_id, recipient_id, lock=False):
    cursor.execute(
        f"{SELECT_ITEMS} WHERE r.id = %s AND r.user_id = %s {'FOR UPDATE OF r' if lock else ''}", (recipient_id, user_id))
    row = cursor.fetchone()
    return _entry(row) if row else None


def mark_read(user_id, recipient_id):
    ensure_tables_once()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("UPDATE inbox_recipients SET read_at = COALESCE(read_at, %s) WHERE id = %s AND user_id = %s RETURNING id",
                       (_now(), recipient_id, user_id))
        if not cursor.fetchone():
            raise fail(404, "not_found", "Message not found.")
        conn.commit()
        return {"ok": True}
    finally:
        cursor.close()
        conn.close()


def mark_all_read(user_id):
    ensure_tables_once()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            f"UPDATE inbox_recipients r SET read_at = %(now)s FROM inbox_messages m WHERE m.id = r.message_id "
            f"AND r.user_id = %(user)s AND r.read_at IS NULL AND {VISIBLE}", {"user": user_id, "now": _now()})
        updated = cursor.rowcount
        conn.commit()
        return {"ok": True, "updated": updated}
    finally:
        cursor.close()
        conn.close()


def delete_own(user_id, recipient_id):
    """The client removes a message from their own inbox. Idempotent. Refused (409) while the message has a
    button that still waits for an answer; after done / expired it can go."""
    ensure_tables_once()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT deleted_at FROM inbox_recipients WHERE id = %s AND user_id = %s FOR UPDATE", (recipient_id, user_id))
        row = cursor.fetchone()
        if not row:
            raise fail(404, "not_found", "Message not found.")
        if row[0] is not None:
            conn.rollback()
            return {"ok": True}
        entry = _own_recipient(cursor, user_id, recipient_id)
        states = _live_states(cursor, [entry])
        item = _item(entry, "en", states)
        if not item["can_delete"]:
            conn.rollback()
            raise fail(409, "action_pending", "Answer this message first: it still waits for your reply.")
        cursor.execute("UPDATE inbox_recipients SET deleted_at = %s WHERE id = %s", (_now(), recipient_id))
        conn.commit()
        return {"ok": True}
    except HTTPException:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


# ----------------------------------------------------------------------------- actions inside a message
BOOKING_EMAIL_MESSAGE = "Inicia sesión con el email de la reserva"


def do_action(user_id, claims, recipient_id, action_type, lang=None):
    """A button of an automatic message. Same functions as the e-mail pages, so nothing can disagree."""
    ensure_tables_once()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        entry = _own_recipient(cursor, user_id, recipient_id)
        valid = [item[0] for item in SYSTEM_ACTIONS.get(entry["type"], [])] if entry and entry["kind"] == "system" else []
        if not entry or action_type not in valid or action_type == "link":
            raise fail(404, "not_found", "That action does not exist.")
        trial_id = entry["refs"].get("trial_id")
        request_id = entry["refs"].get("request_id")
        token = trial_email = None
        if action_type.startswith("trial_"):
            cursor.execute("SELECT LOWER(email), confirmation_token FROM trial_sessions WHERE id = %s", (trial_id,))
            row = cursor.fetchone()
            if not row:
                raise fail(404, "not_found", "That session no longer exists.")
            trial_email, token = row
    finally:
        cursor.close()
        conn.close()

    if action_type.startswith("trial_"):
        # only the person of the booking: the VERIFIED sign-in e-mail must be the booking's e-mail
        if claims.get("email_verified") is not True or str(claims.get("email") or "").strip().lower() != str(trial_email or "").strip().lower():
            raise fail(403, "use_booking_email", BOOKING_EMAIL_MESSAGE)
        if not token:
            raise fail(409, "no_token", "This session can not be answered here.")
        import trial_confirmation
        outcome = trial_confirmation.answer_trial(token, "confirmed" if action_type == "trial_confirm" else "declined")
    else:
        import reschedule_requests
        outcome = reschedule_requests.respond(request_id=request_id, user_id=user_id, accept=action_type == "reschedule_accept")

    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("UPDATE inbox_recipients SET read_at = COALESCE(read_at, %s) WHERE id = %s", (_now(), recipient_id))
        conn.commit()
        entry = _own_recipient(cursor, user_id, recipient_id)
        states = _live_states(cursor, [entry])
        conn.commit()
    finally:
        cursor.close()
        conn.close()
    return {"outcome": outcome.get("outcome"), "item": _item(entry, _lang(lang), states)}


# ----------------------------------------------------------------------------- the studio
def _check_text(value, limit, field, required=False):
    text = str(value or "").replace("\r\n", "\n").strip()
    if required and not text:
        raise fail(422, "required", f"{field} is required.")
    if len(text) > limit:
        raise fail(422, "too_long", f"{field} can have up to {limit} characters.")
    if re.search(r"<\s*/?\s*[a-zA-Z!]", text):
        raise fail(422, "html_not_allowed", "Plain text only: HTML is not accepted.")
    return text


def check_target(target):
    """An internal path from the fixed list, or an http(s) address. Nothing else (no javascript:, data:...)."""
    value = str(target or "").strip()
    if len(value) > TARGET_MAX or re.search(r"[\s\x00-\x1f]", value):
        raise fail(422, "invalid_target", "The button's destination is not valid.")
    if value.startswith("/"):
        path = value.split("?", 1)[0].split("#", 1)[0]
        if value.startswith("//") or path not in INTERNAL_TARGETS:
            raise fail(422, "invalid_target", "That page can not be used as a button destination.")
        return value
    parsed = urlparse(value)
    if parsed.scheme.lower() not in ("http", "https") or not parsed.netloc:
        raise fail(422, "invalid_target", "Use a page of the site or an http(s) address.")
    return value


def _check_moment(text, field):
    try:
        moment = datetime.strptime(str(text).strip()[:16].replace(" ", "T"), "%Y-%m-%dT%H:%M")
    except ValueError:
        raise fail(422, "invalid_date", f"{field} is not a valid date and time.") from None
    return moment


def _clean_message(data):
    """Validated, cleaned fields of a message of the studio."""
    if data.audience not in AUDIENCES:
        raise fail(422, "invalid_audience", "Choose who receives the message.")
    main_lang = normalize_language(data.main_lang) or ("es" if not data.main_lang else None)
    if not main_lang:
        raise fail(422, "invalid_language", "Choose the language of the message.")
    title = _check_text(data.title, TITLE_MAX, "The title", required=True)
    body = _check_text(data.body, BODY_MAX, "The text", required=True)
    translations = {}
    for code, part in (data.translations or {}).items():
        if code not in LANGUAGES:
            raise fail(422, "invalid_language", "Translations can only be en, es or ca.")
        part = part or {}
        clean = {"title": _check_text(part.get("title"), TITLE_MAX, "The title"), "body": _check_text(part.get("body"), BODY_MAX, "The text")}
        clean = {key: value for key, value in clean.items() if value}
        if clean:
            translations[code] = clean
    label = _check_text(data.action_label, LABEL_MAX, "The button's label")
    target = str(data.action_target or "").strip()
    if bool(label) != bool(target):
        raise fail(422, "button_incomplete", "A button needs both a label and a destination.")
    target = check_target(target) if target else ""
    now = _now()
    visible_from = now
    if data.visible_from:
        visible_from = _check_moment(data.visible_from, "The send date")
        if visible_from <= now:
            raise fail(422, "date_in_past", "The send date must be in the future.")
        if visible_from > now + timedelta(days=MAX_SCHEDULE_DAYS):
            raise fail(422, "date_too_far", "The send date can be at most one year ahead.")
    expires_at = None
    if data.expires_at:
        expires_at = _check_moment(data.expires_at, "The expiry date")
        if expires_at <= visible_from:
            raise fail(422, "expiry_before_start", "The expiry must be after the send date.")
    key = str(data.idempotency_key or "").strip()[:100] or None
    return {"audience": data.audience, "main_lang": main_lang, "title": title, "body": body, "translations": translations,
            "label": label or None, "target": target or None, "visible_from": visible_from, "expires_at": expires_at, "key": key}


def _audience_sql(audience):
    """(FROM/WHERE for the recipients, extra parameters)."""
    where = "u.archived_at IS NULL AND u.email IS NOT NULL AND LOWER(u.email) <> %(admin)s"
    if audience == "active_pack":
        where += f" AND {pack_view.active_pack_sql('u.id')}"
    return where


def preview(audience, email=None):
    """How many clients would receive a message for this audience (nothing is written)."""
    ensure_tables_once()
    if audience not in AUDIENCES:
        raise fail(422, "invalid_audience", "Choose who receives the message.")
    conn = get_connection()
    cursor = conn.cursor()
    try:
        if audience == "user":
            cursor.execute("SELECT archived_at IS NOT NULL FROM users WHERE LOWER(email) = %s", (str(email or "").strip().lower(),))
            row = cursor.fetchone()
            return {"count": 1 if row and not row[0] else 0, "found": bool(row), "archived": bool(row and row[0])}
        cursor.execute(f"SELECT COUNT(*) FROM users u WHERE {_audience_sql(audience)}", {"admin": ADMIN_EMAIL})
        return {"count": cursor.fetchone()[0]}
    finally:
        cursor.close()
        conn.close()


def send_admin_message(data, admin=""):
    """Creates (and so sends or schedules) a message of the studio: the recipients are fixed now, in one
    transaction. The same idempotency_key twice returns the first message instead of sending again."""
    ensure_tables_once()
    clean = _clean_message(data)
    conn = get_connection()
    cursor = conn.cursor()
    try:
        if clean["key"]:
            cursor.execute("SELECT id FROM inbox_messages WHERE idempotency_key = %s", (clean["key"],))
            existing = cursor.fetchone()
            if existing:
                return {"id": existing[0], "repeated": True, **_summary(cursor, existing[0])}
        email = str(data.email or "").strip().lower()
        if clean["audience"] == "user":
            cursor.execute("SELECT id, archived_at IS NOT NULL FROM users WHERE LOWER(email) = %s", (email,))
            account = cursor.fetchone()
            if not account:
                raise fail(422, "no_such_client", "There is no client with that email.")
            if account[1]:
                raise fail(422, "client_archived", "That client is archived and does not receive messages.")
        cursor.execute(
            """
            INSERT INTO inbox_messages (kind, type, title, body, translations, main_lang, audience, action_label, action_target,
                                        visible_from, expires_at, created_by, idempotency_key)
            VALUES ('admin', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
            """,
            ("direct" if clean["audience"] == "user" else "broadcast", clean["title"], clean["body"], Json(clean["translations"]),
             clean["main_lang"], clean["audience"], clean["label"], clean["target"], clean["visible_from"], clean["expires_at"],
             str(admin)[:120] or None, clean["key"]),
        )
        message_id = cursor.fetchone()[0]
        if clean["audience"] == "user":
            cursor.execute("INSERT INTO inbox_recipients (message_id, user_id, recipient_email) SELECT %s, id, LOWER(email) FROM users WHERE LOWER(email) = %s",
                           (message_id, email))
        else:
            cursor.execute(
                f"INSERT INTO inbox_recipients (message_id, user_id, recipient_email) SELECT %(id)s, u.id, LOWER(u.email) FROM users u WHERE {_audience_sql(clean['audience'])}",
                {"id": message_id, "admin": ADMIN_EMAIL})
        if cursor.rowcount == 0:
            raise fail(409, "no_recipients", "Nobody would receive this message.")
        conn.commit()
        return {"id": message_id, "repeated": False, **_summary(cursor, message_id)}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as error:  # noqa: BLE001
        conn.rollback()
        if type(error).__name__ == "UniqueViolation":          # two sends with the same key at the same moment
            return send_admin_message(data, admin)
        raise
    finally:
        cursor.close()
        conn.close()


def _status(visible_from, expires_at, now):
    if visible_from > now:
        return "scheduled"
    if expires_at is not None and expires_at <= now:
        return "expired"
    return "sent"


def _summary(cursor, message_id):
    cursor.execute(
        "SELECT m.visible_from, m.expires_at, (SELECT COUNT(*) FROM inbox_recipients r WHERE r.message_id = m.id) "
        "FROM inbox_messages m WHERE m.id = %s", (message_id,))
    visible_from, expires_at, recipients = cursor.fetchone()
    return {"recipients": recipients, "status": _status(visible_from, expires_at, _now())}


def list_admin(page=1, size=20):
    """The studio's own messages (never the automatic ones): audience, status, recipients and how many read."""
    ensure_tables_once()
    size = max(1, min(int(size or 20), 100))
    page = max(1, int(page or 1))
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT COUNT(*) FROM inbox_messages WHERE kind = 'admin' AND deleted_at IS NULL")
        total = cursor.fetchone()[0]
        cursor.execute(
            """
            SELECT m.id, m.title, m.audience, m.main_lang, m.visible_from, m.expires_at, m.created_at, m.created_by,
                   (SELECT COUNT(*) FROM inbox_recipients r WHERE r.message_id = m.id),
                   (SELECT COUNT(*) FROM inbox_recipients r WHERE r.message_id = m.id AND r.read_at IS NOT NULL)
            FROM inbox_messages m WHERE m.kind = 'admin' AND m.deleted_at IS NULL
            ORDER BY m.id DESC LIMIT %s OFFSET %s
            """,
            (size, (page - 1) * size),
        )
        now = _now()
        items = [
            {"id": r[0], "title": r[1], "audience": r[2], "main_lang": r[3], "visible_from": _iso(r[4]), "expires_at": _iso(r[5]),
             "created_at": _iso(r[6]), "created_by": r[7], "status": _status(r[4], r[5], now), "recipients": r[8], "read": r[9]}
            for r in cursor.fetchall()
        ]
    finally:
        cursor.close()
        conn.close()
    return {"items": items, "total": total, "page": page, "pages": max(1, -(-total // size))}


def get_admin(message_id):
    """One message of the studio. Who read it is listed ONLY for a message to one person; for the others,
    just the counts."""
    ensure_tables_once()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT m.id, m.title, m.body, m.translations, m.main_lang, m.audience, m.action_label, m.action_target,
                   m.visible_from, m.expires_at, m.created_at, m.created_by
            FROM inbox_messages m WHERE m.id = %s AND m.kind = 'admin' AND m.deleted_at IS NULL
            """, (message_id,))
        row = cursor.fetchone()
        if not row:
            raise fail(404, "not_found", "Message not found.")
        summary = _summary(cursor, message_id)
        cursor.execute("SELECT COUNT(*) FROM inbox_recipients WHERE message_id = %s AND read_at IS NOT NULL", (message_id,))
        read = cursor.fetchone()[0]
        detail = {
            "id": row[0], "title": row[1], "body": row[2], "translations": row[3] or {}, "main_lang": row[4], "audience": row[5],
            "action_label": row[6], "action_target": row[7], "visible_from": _iso(row[8]), "expires_at": _iso(row[9]),
            "created_at": _iso(row[10]), "created_by": row[11], "status": summary["status"], "recipients": summary["recipients"], "read": read,
        }
        if row[5] == "user":
            cursor.execute("SELECT recipient_email, read_at IS NOT NULL, deleted_at IS NOT NULL FROM inbox_recipients WHERE message_id = %s", (message_id,))
            detail["people"] = [{"email": r[0], "read": r[1], "deleted_by_client": r[2]} for r in cursor.fetchall()]
        return detail
    finally:
        cursor.close()
        conn.close()


def delete_admin(message_id, admin=""):
    """Soft delete: the message disappears from everybody's inbox. Idempotent. Leaves a simple audit row
    (who, when, which message): no personal data."""
    ensure_tables_once()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT deleted_at FROM inbox_messages WHERE id = %s AND kind = 'admin' FOR UPDATE", (message_id,))
        row = cursor.fetchone()
        if not row:
            raise fail(404, "not_found", "Message not found.")
        if row[0] is None:
            cursor.execute("UPDATE inbox_messages SET deleted_at = %s WHERE id = %s", (_now(), message_id))
            cursor.execute("INSERT INTO inbox_audit (action, message_id, admin_email) VALUES ('delete', %s, %s)", (message_id, str(admin)[:120] or None))
            logger.info("inbox message deleted: %s", message_id)
        conn.commit()
        return {"ok": True}
    except HTTPException:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


# ----------------------------------------------------------------------------- HTTP
class PreviewPayload(BaseModel):
    audience: str
    email: str | None = None


class MessagePayload(BaseModel):
    audience: str
    email: str | None = None
    main_lang: str | None = None
    title: str
    body: str
    translations: dict[str, dict[str, str | None]] | None = None
    action_label: str | None = None
    action_target: str | None = None
    visible_from: str | None = None
    expires_at: str | None = None
    idempotency_key: str | None = None


def register_inbox_routes(app, require_admin, require_client, own_user_id, admin_email=""):
    """own_user_id(claims) -> users.id of the signed-in account (or None)."""
    configure(admin_email)
    admin = [Depends(require_admin)]

    @app.on_event("startup")
    def _ensure_inbox_tables():
        try:
            ensure_tables()
        except Exception as error:  # noqa: BLE001
            logger.error("inbox tables could not be created (%s)", type(error).__name__)

    def me(claims):
        user_id = own_user_id(claims)
        if not user_id:
            raise fail(404, "not_found", "Client not found.")
        return user_id

    # ---- the client
    @app.get("/inbox")
    def client_inbox(lang: str = "en", page: int = 1, filter: str = "all", size: int = PAGE_SIZE, claims=Depends(require_client)):
        _throttle("list", claims)
        return list_inbox(me(claims), claims, lang, page, filter, size)

    @app.get("/inbox/unread-count")
    def client_unread(claims=Depends(require_client)):
        _throttle("count", claims)
        return unread_count(me(claims), claims)

    @app.post("/inbox/read-all")
    def client_read_all(claims=Depends(require_client)):
        _throttle("act", claims)
        return mark_all_read(me(claims))

    @app.post("/inbox/{recipient_id}/read")
    def client_read(recipient_id: int, claims=Depends(require_client)):
        _throttle("act", claims)
        return mark_read(me(claims), recipient_id)

    @app.delete("/inbox/{recipient_id}")
    def client_delete(recipient_id: int, claims=Depends(require_client)):
        _throttle("act", claims)
        return delete_own(me(claims), recipient_id)

    @app.post("/inbox/{recipient_id}/actions/{action_type}")
    def client_action(recipient_id: int, action_type: str, lang: str = "en", claims=Depends(require_client)):
        _throttle("act", claims)
        return do_action(me(claims), claims, recipient_id, action_type, lang)

    # ---- the studio (Firebase ID token + administrator)
    @app.post("/admin/messages/preview", dependencies=admin)
    def admin_preview(data: PreviewPayload):
        return preview(data.audience, data.email)

    @app.post("/admin/messages")
    def admin_send(data: MessagePayload, claims=Depends(require_admin)):
        return send_admin_message(data, str(claims.get("email", "")))

    @app.get("/admin/messages", dependencies=admin)
    def admin_list(page: int = 1, size: int = 20):
        return list_admin(page, size)

    @app.get("/admin/messages/{message_id}", dependencies=admin)
    def admin_detail(message_id: int):
        return get_admin(message_id)

    @app.delete("/admin/messages/{message_id}")
    def admin_delete(message_id: int, claims=Depends(require_admin)):
        return delete_admin(message_id, str(claims.get("email", "")))

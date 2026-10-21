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
  all          every client that is not archived (never the admin account, never an active trainer)
  active_pack  the same, with an active pack (pack_view.active_pack_sql: the dashboard's definition)
  trainers     the people with an ACTIVE trainer access (trainer_access). They read it in this same inbox
  user         one person, chosen by e-mail (a client, or an active trainer: the way a future automatic
               message will reach one trainer)
  A message can have SEVERAL audiences (inbox_messages.audiences, a JSON list; older messages only have the
  single `audience` column and are read as a list of one). A person who falls in more than one rule gets ONE
  message (the recipients are de-duplicated by e-mail). Trainers are not clients: "all" and "active_pack" leave
  them out. What reached someone only through the "trainers" rule (inbox_recipients.source = 'trainers') is
  visible only while their trainer access is active.
  Archived clients never receive anything, automatic messages included.

Time: visible_from / expires_at are Europe/Madrid wall-clock times. There is no background job: "send
later" is only a filter (visible_from <= now) when the inbox is read.

Buttons inside a message: the STATE is always read live from the real object (the trial session, the
reschedule request): available | done | expired. So the e-mail link and the inbox never contradict.
Opening or listing never decides anything; only the POST of an action does, through the SAME functions
the e-mail pages use.

Nothing is ever deleted by a person. The client ARCHIVES a message (inbox_recipients.archived_at) and can bring it
back; the studio ARCHIVES a message it sent (inbox_messages.archived_at / archived_by): it leaves every client's inbox
and archive, stays in the studio's history under "Archived" and can be restored. The old deleted_at columns stay in the
tables but nothing reads or writes them any more; rows that had a deleted_at became archived (see ensure_tables).
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
# the only internal paths a button of the studio may open (anything else must be an http(s) address)
INTERNAL_TARGETS = ("/my-sessions", "/profile", "/dashboard", "/trial-session", "/training-request", "/training-tips")
AUDIENCES = ("all", "active_pack", "trainers", "user")
TRAINERS_SOURCE = "trainers"

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
        # archive instead of delete (idempotent). What used to be "deleted" is now archived, at the same moment.
        cursor.execute("ALTER TABLE inbox_recipients ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP")
        cursor.execute("ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP")
        cursor.execute("ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS archived_by TEXT")
        # several audiences per message (JSON list); the old single `audience` column keeps being written and read
        cursor.execute("ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS audiences JSONB")
        # how a recipient was reached: 'trainers' = only through the trainers rule (hidden once the access is revoked)
        cursor.execute("ALTER TABLE inbox_recipients ADD COLUMN IF NOT EXISTS source TEXT")
        cursor.execute("UPDATE inbox_recipients SET archived_at = deleted_at WHERE deleted_at IS NOT NULL AND archived_at IS NULL")
        cursor.execute("UPDATE inbox_messages SET archived_at = deleted_at WHERE deleted_at IS NOT NULL AND archived_at IS NULL")
        cursor.execute("CREATE INDEX IF NOT EXISTS inbox_recipients_user_archived_idx ON inbox_recipients (user_id, archived_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS inbox_messages_archived_idx ON inbox_messages (kind, archived_at)")
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
    import trainer_area
    trainer_area.ensure_tables()          # the queries below read trainer_access
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


def render_label(label, translations, lang):
    """The button's text in the reader's language: its translation if there is one, else the written one."""
    return ((translations or {}).get(lang) or {}).get("action_label") or label


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
            # (state, result): once it is done, `result` says WHAT was answered, read from the real session
            states[("trial", row[0])] = (_trial_state(row[1:]), {"confirmed": "confirmed", "declined": "declined"}.get(str(row[1] or "").lower()))
    if requests:
        import reschedule_requests
        reschedule_requests.expire_stale(cursor)               # a proposal that ran out of time says so
        cursor.execute("SELECT id, status FROM reschedule_requests WHERE id = ANY(%s)", (requests,))
        for request_id, status in cursor.fetchall():
            states[("request", request_id)] = (
                "available" if status == "counter_proposed" else ("done" if status in ("accepted", "declined") else "expired"),
                status if status in ("accepted", "declined") else None)
    return states


def _actions(entry, lang, states):
    """The buttons of one message with their live state. Once an answer button is "done", `result` says what was
    answered (confirmed | declined for a trial session, accepted | declined for a proposal), always read from the
    real object, so the e-mail link and the inbox say the same."""
    buttons = []
    if entry["kind"] == "admin":
        if entry["action_target"] and entry["action_label"]:
            buttons.append({"type": "link", "label": render_label(entry["action_label"], entry["translations"], lang),
                            "target": entry["action_target"], "state": "available", "result": None})
        return buttons
    for action_type, label_key, target in SYSTEM_ACTIONS.get(entry["type"], []):
        result = None
        if action_type in ("trial_confirm", "trial_decline"):
            state, result = states.get(("trial", entry["refs"].get("trial_id")), ("expired", None))
        elif action_type in ("reschedule_accept", "reschedule_reject"):
            state, result = states.get(("request", entry["refs"].get("request_id")), ("expired", None))
        else:
            state = "available"
        buttons.append({"type": action_type, "label": ACTION_LABELS[lang][label_key], "target": target, "state": state,
                        "result": result if state == "done" else None})
    return buttons


SELECT_ITEMS = """
    SELECT r.id, m.kind, m.type, m.title, m.body, m.translations, m.params, m.refs, m.action_label, m.action_target,
           m.visible_from, r.read_at, r.archived_at
    FROM inbox_recipients r JOIN inbox_messages m ON m.id = r.message_id
"""
# A message the studio archived is in nobody's inbox or archive; one past its expiry neither.
VISIBLE = ("m.archived_at IS NULL AND m.visible_from <= %(now)s "
           "AND (m.expires_at IS NULL OR m.expires_at > %(now)s) "
           # what arrived only through the "trainers" rule stops showing when the trainer access is revoked
           "AND (r.source IS DISTINCT FROM 'trainers' OR EXISTS ("
           "SELECT 1 FROM trainer_access ta WHERE ta.revoked_at IS NULL AND ta.email = LOWER(r.recipient_email)))")
IN_INBOX = "r.archived_at IS NULL"
IN_ARCHIVE = "r.archived_at IS NOT NULL"


def _entry(row):
    return {"id": row[0], "kind": row[1], "type": row[2], "title": row[3], "body": row[4], "translations": row[5],
            "params": row[6] or {}, "refs": row[7] or {}, "action_label": row[8], "action_target": row[9],
            "visible_from": row[10], "read_at": row[11], "archived_at": row[12]}


def _item(entry, lang, states):
    if entry["kind"] == "system":
        title, body = render_system(entry["type"], entry["params"], lang)
    else:
        title, body = render_admin(entry["title"], entry["body"], entry["translations"], lang)
    actions = _actions(entry, lang, states)
    return {
        "id": entry["id"], "kind": entry["kind"], "type": entry["type"], "title": title, "body": body,
        "date": _iso(entry["visible_from"]), "read": entry["read_at"] is not None, "actions": actions,
        "archived": entry["archived_at"] is not None,
        # a message that still waits for an answer can not be archived; a plain link does not count
        "can_archive": not any(action["type"] != "link" and action["state"] == "available" for action in actions),
    }


def link_by_email(cursor, user_id, claims):
    """Messages that were waiting for this e-mail (no account then) become theirs, but ONLY when the
    sign-in e-mail is VERIFIED: nobody can read another person's messages by registering their address."""
    email = str(claims.get("email") or "").strip().lower()
    if not email or claims.get("email_verified") is not True:
        return 0
    cursor.execute("UPDATE inbox_recipients SET user_id = %s WHERE user_id IS NULL AND recipient_email = %s", (user_id, email))
    return cursor.rowcount


def _lang(value):
    return normalize_language(value) or DEFAULT_LANGUAGE


def list_inbox(user_id, claims, lang=None, page=1, filter_="all", size=PAGE_SIZE):
    """filter_: all (the inbox, WITHOUT the archived ones) | unread (the unread of the inbox) | archived.
    `counts` is {inbox, unread, archived} for the tabs; `unread` (the menu's number) never includes archived ones."""
    ensure_tables_once()
    lang = _lang(lang)
    size = max(1, min(int(size or PAGE_SIZE), PAGE_SIZE_MAX))
    page = max(1, int(page or 1))
    where = IN_ARCHIVE if filter_ == "archived" else IN_INBOX + (" AND r.read_at IS NULL" if filter_ == "unread" else "")
    conn = get_connection()
    cursor = conn.cursor()
    try:
        link_by_email(cursor, user_id, claims)
        conn.commit()
        params = {"user": user_id, "now": _now(), "limit": size, "offset": (page - 1) * size}
        cursor.execute(f"SELECT COUNT(*) FROM inbox_recipients r JOIN inbox_messages m ON m.id = r.message_id "
                       f"WHERE r.user_id = %(user)s AND {VISIBLE} AND {where}", params)
        total = cursor.fetchone()[0]
        cursor.execute(f"{SELECT_ITEMS} WHERE r.user_id = %(user)s AND {VISIBLE} AND {where} "
                       "ORDER BY m.visible_from DESC, r.id DESC LIMIT %(limit)s OFFSET %(offset)s", params)
        entries = [_entry(row) for row in cursor.fetchall()]
        states = _live_states(cursor, entries)
        conn.commit()                                          # keeps the expiry the live check may have recorded
        cursor.execute(
            f"SELECT COUNT(*) FILTER (WHERE {IN_INBOX}), COUNT(*) FILTER (WHERE {IN_INBOX} AND r.read_at IS NULL), "
            f"COUNT(*) FILTER (WHERE {IN_ARCHIVE}) FROM inbox_recipients r JOIN inbox_messages m ON m.id = r.message_id "
            f"WHERE r.user_id = %(user)s AND {VISIBLE}", params)
        inbox_count, unread, archived = cursor.fetchone()
    finally:
        cursor.close()
        conn.close()
    return {"items": [_item(entry, lang, states) for entry in entries], "total": total, "page": page,
            "pages": max(1, -(-total // size)), "unread": unread,
            "counts": {"inbox": inbox_count, "unread": unread, "archived": archived}}


def unread_count(user_id, claims):
    ensure_tables_once()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        if link_by_email(cursor, user_id, claims):
            conn.commit()
        cursor.execute(
            f"SELECT COUNT(*) FROM inbox_recipients r JOIN inbox_messages m ON m.id = r.message_id "
            f"WHERE r.user_id = %(user)s AND r.read_at IS NULL AND {IN_INBOX} AND {VISIBLE}", {"user": user_id, "now": _now()})
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
            f"AND r.user_id = %(user)s AND r.read_at IS NULL AND {IN_INBOX} AND {VISIBLE}", {"user": user_id, "now": _now()})
        updated = cursor.rowcount
        conn.commit()
        return {"ok": True, "updated": updated}
    finally:
        cursor.close()
        conn.close()


def _waits_for_an_answer(item):
    return not item["can_archive"]


def archive_own(user_id, recipient_id):
    """The client archives a message: it leaves the inbox and the unread number, and is marked as read. Idempotent.
    Refused (409) while the message has a button that still waits for an answer (a trial to confirm, a proposal to
    answer); once it is done or expired it can be archived. Nothing is deleted."""
    ensure_tables_once()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT archived_at FROM inbox_recipients WHERE id = %s AND user_id = %s FOR UPDATE", (recipient_id, user_id))
        row = cursor.fetchone()
        if not row:
            raise fail(404, "not_found", "Message not found.")
        if row[0] is not None:
            conn.rollback()
            return {"ok": True}
        entry = _own_recipient(cursor, user_id, recipient_id)
        if _waits_for_an_answer(_item(entry, "en", _live_states(cursor, [entry]))):
            conn.rollback()
            raise fail(409, "action_pending", "Answer this message first: it still waits for your reply.")
        now = _now()
        cursor.execute("UPDATE inbox_recipients SET archived_at = %s, read_at = COALESCE(read_at, %s) WHERE id = %s", (now, now, recipient_id))
        conn.commit()
        return {"ok": True}
    except HTTPException:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


def unarchive_own(user_id, recipient_id):
    """Back to the inbox. Idempotent."""
    ensure_tables_once()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("UPDATE inbox_recipients SET archived_at = NULL WHERE id = %s AND user_id = %s RETURNING id", (recipient_id, user_id))
        if not cursor.fetchone():
            raise fail(404, "not_found", "Message not found.")
        conn.commit()
        return {"ok": True}
    finally:
        cursor.close()
        conn.close()


ARCHIVE_READ_MAX = 500


def archive_read(user_id):
    """Archives, at once, every message of the inbox that is already read and has no answer waiting."""
    ensure_tables_once()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            f"{SELECT_ITEMS} WHERE r.user_id = %(user)s AND {VISIBLE} AND {IN_INBOX} AND r.read_at IS NOT NULL "
            "ORDER BY r.id DESC LIMIT %(limit)s", {"user": user_id, "now": _now(), "limit": ARCHIVE_READ_MAX})
        entries = [_entry(row) for row in cursor.fetchall()]
        states = _live_states(cursor, entries)
        ids = [entry["id"] for entry in entries if not _waits_for_an_answer(_item(entry, "en", states))]
        if ids:
            cursor.execute("UPDATE inbox_recipients SET archived_at = %s WHERE id = ANY(%s) AND archived_at IS NULL", (_now(), ids))
        conn.commit()
        return {"ok": True, "archived": len(ids)}
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
    audiences = audiences_of(data)
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
        clean = {"title": _check_text(part.get("title"), TITLE_MAX, "The title"), "body": _check_text(part.get("body"), BODY_MAX, "The text"),
                 "action_label": _check_text(part.get("action_label"), LABEL_MAX, "The button's label")}
        clean = {key: value for key, value in clean.items() if value}
        if clean:
            translations[code] = clean
    label = _check_text(data.action_label, LABEL_MAX, "The button's label")
    target = str(data.action_target or "").strip()
    if bool(label) != bool(target):
        raise fail(422, "button_incomplete", "A button needs both a label and a destination.")
    target = check_target(target) if target else ""
    if not target:                                     # no button: a translated button text means nothing
        for code in list(translations):
            translations[code].pop("action_label", None)
            if not translations[code]:
                del translations[code]
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
    return {"audiences": audiences, "main_lang": main_lang, "title": title, "body": body, "translations": translations,
            "label": label or None, "target": target or None, "visible_from": visible_from, "expires_at": expires_at, "key": key}


def audiences_of(data):
    """The audiences of a payload, in order and without repeats. `audiences` (a list) wins; the old
    single `audience` still works."""
    raw = getattr(data, "audiences", None) or ([getattr(data, "audience", None)] if getattr(data, "audience", None) else [])
    result = []
    for item in raw:
        if item not in AUDIENCES:
            raise fail(422, "invalid_audience", "Choose who receives the message.")
        if item not in result:
            result.append(item)
    if not result:
        raise fail(422, "invalid_audience", "Choose who receives the message.")
    return result


def _client_where(active_pack):
    """Clients: not archived, with an email, not the admin and NOT an active trainer."""
    where = ("u.archived_at IS NULL AND u.email IS NOT NULL AND LOWER(u.email) <> %(admin)s "
             "AND NOT EXISTS (SELECT 1 FROM trainer_access ta WHERE ta.revoked_at IS NULL AND ta.email = LOWER(u.email))")
    if active_pack:
        where += f" AND {pack_view.active_pack_sql('u.id')}"
    return where


def _recipient_rows_sql(audiences):
    """SELECT of (user_id, email, src) for every rule of the message, before de-duplicating. Parameters: admin, email."""
    parts = []
    if "all" in audiences:
        parts.append(f"SELECT u.id AS user_id, LOWER(u.email) AS email, 'client' AS src FROM users u WHERE {_client_where(False)}")
    if "active_pack" in audiences:
        parts.append(f"SELECT u.id AS user_id, LOWER(u.email) AS email, 'client' AS src FROM users u WHERE {_client_where(True)}")
    if "trainers" in audiences:
        parts.append(
            "SELECT u.id AS user_id, ta.email AS email, 'trainer' AS src FROM trainer_access ta LEFT JOIN users u ON LOWER(u.email) = ta.email "
            "WHERE ta.revoked_at IS NULL AND ta.email <> %(admin)s AND (u.id IS NULL OR u.archived_at IS NULL)")
    if "user" in audiences:
        # one person: a client (not archived) or an active trainer; a trainer with no profile yet waits by e-mail
        parts.append("SELECT u.id AS user_id, LOWER(u.email) AS email, 'user' AS src FROM users u WHERE LOWER(u.email) = %(email)s AND u.archived_at IS NULL")
        parts.append(
            "SELECT NULL::int AS user_id, ta.email AS email, 'user' AS src FROM trainer_access ta WHERE ta.revoked_at IS NULL AND ta.email = %(email)s "
            "AND NOT EXISTS (SELECT 1 FROM users u WHERE LOWER(u.email) = ta.email)")
    return " UNION ALL ".join(parts)


def _person_state(cursor, email):
    """(found, archived) of the person a "user" audience points to."""
    email = str(email or "").strip().lower()
    cursor.execute("SELECT archived_at IS NOT NULL FROM users WHERE LOWER(email) = %s", (email,))
    row = cursor.fetchone()
    if row:
        return True, bool(row[0])
    cursor.execute("SELECT 1 FROM trainer_access WHERE revoked_at IS NULL AND email = %s", (email,))
    return cursor.fetchone() is not None, False


def preview(audience, email=None):
    """How many people would receive a message for these audiences, each counted once (nothing is
    written). `audience` is one name or a list."""
    ensure_tables_once()
    audiences = [audience] if isinstance(audience, str) else list(audience or [])
    audiences = audiences_of(type("A", (), {"audiences": audiences})())
    conn = get_connection()
    cursor = conn.cursor()
    try:
        email = str(email or "").strip().lower()
        extra = {}
        if "user" in audiences:
            found, archived = _person_state(cursor, email)
            extra = {"found": found, "archived": archived}
        cursor.execute(
            f"SELECT COUNT(*) FROM (SELECT email FROM ({_recipient_rows_sql(audiences)}) rows GROUP BY email) people",
            {"admin": ADMIN_EMAIL, "email": email})
        return {"count": cursor.fetchone()[0], **extra}
    finally:
        cursor.close()
        conn.close()


def send_admin_message(data, admin=""):
    """Creates (and so sends or schedules) a message of the studio: the recipients are fixed now, in one
    transaction, one per person even when several rules reach them. The same idempotency_key twice returns
    the first message instead of sending again."""
    ensure_tables_once()
    clean = _clean_message(data)
    audiences = clean["audiences"]
    conn = get_connection()
    cursor = conn.cursor()
    try:
        if clean["key"]:
            cursor.execute("SELECT id FROM inbox_messages WHERE idempotency_key = %s", (clean["key"],))
            existing = cursor.fetchone()
            if existing:
                return {"id": existing[0], "repeated": True, **_summary(cursor, existing[0])}
        email = str(data.email or "").strip().lower()
        if "user" in audiences:
            found, archived = _person_state(cursor, email)
            if not found:
                raise fail(422, "no_such_client", "There is no client with that email.")
            if archived:
                raise fail(422, "client_archived", "That client is archived and does not receive messages.")
        only_user = audiences == ["user"]
        legacy = "user" if only_user else next(item for item in audiences if item != "user")      # the old single column
        cursor.execute(
            """
            INSERT INTO inbox_messages (kind, type, title, body, translations, main_lang, audience, audiences, action_label, action_target,
                                        visible_from, expires_at, created_by, idempotency_key)
            VALUES ('admin', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
            """,
            ("direct" if only_user else "broadcast", clean["title"], clean["body"], Json(clean["translations"]),
             clean["main_lang"], legacy, Json(audiences), clean["label"], clean["target"], clean["visible_from"], clean["expires_at"],
             str(admin)[:120] or None, clean["key"]),
        )
        message_id = cursor.fetchone()[0]
        cursor.execute(
            f"""
            INSERT INTO inbox_recipients (message_id, user_id, recipient_email, source)
            SELECT %(id)s, MIN(user_id), email, CASE WHEN BOOL_AND(src = 'trainer') THEN '{TRAINERS_SOURCE}' END
            FROM ({_recipient_rows_sql(audiences)}) rows GROUP BY email
            """,
            {"id": message_id, "admin": ADMIN_EMAIL, "email": email})
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


def _like(text):
    """%, _ and \\ typed by the admin are searched literally."""
    return "%" + re.sub(r"([\\%_])", r"\\\1", str(text).strip().lower()) + "%"


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


STATUS_SQL = {
    "scheduled": "m.visible_from > %(now)s",
    "sent": "m.visible_from <= %(now)s AND (m.expires_at IS NULL OR m.expires_at > %(now)s)",
    "expired": "m.visible_from <= %(now)s AND m.expires_at IS NOT NULL AND m.expires_at <= %(now)s",
}


def list_admin(page=1, size=20, q="", status="", archived=False):
    """The studio's own messages (never the automatic ones), newest first: audience, status, recipients, how many
    read and, for a message to one person, who it went to. `q` searches the title (letters, % and _ are literal);
    `status` is scheduled | sent | expired. `archived` picks the history ("Sent") or the archive ("Archived").
    `total` counts what matches, so the pages follow the filters; `counts` is {active, archived} for the tabs."""
    ensure_tables_once()
    status = str(status or "").strip().lower()
    if status and status not in STATUS_SQL:
        raise fail(422, "invalid_status", "Unknown status.")
    size = max(1, min(int(size or 20), 100))
    page = max(1, int(page or 1))
    needle = str(q or "").strip()
    where = "m.kind = 'admin' AND m.archived_at IS " + ("NOT NULL" if archived else "NULL")
    params = {"now": _now(), "limit": size, "offset": (page - 1) * size}
    if needle:
        where += " AND LOWER(m.title) LIKE %(like)s"
        params["like"] = _like(needle)
    if status:
        where += f" AND {STATUS_SQL[status]}"
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(f"SELECT COUNT(*) FROM inbox_messages m WHERE {where}", params)
        total = cursor.fetchone()[0]
        cursor.execute(
            f"""
            SELECT m.id, m.title, m.audience, m.main_lang, m.visible_from, m.expires_at, m.created_at, m.created_by,
                   (SELECT COUNT(*) FROM inbox_recipients r WHERE r.message_id = m.id),
                   (SELECT COUNT(*) FROM inbox_recipients r WHERE r.message_id = m.id AND r.read_at IS NOT NULL),
                   CASE WHEN m.audience = 'user' THEN (SELECT r.recipient_email FROM inbox_recipients r WHERE r.message_id = m.id LIMIT 1) END,
                   m.audiences
            FROM inbox_messages m WHERE {where}
            ORDER BY m.id DESC LIMIT %(limit)s OFFSET %(offset)s
            """,
            params,
        )
        now = params["now"]
        items = [
            {"id": r[0], "title": r[1], "audience": r[2], "audiences": r[11] or [r[2]], "main_lang": r[3], "visible_from": _iso(r[4]), "expires_at": _iso(r[5]),
             "created_at": _iso(r[6]), "created_by": r[7], "status": _status(r[4], r[5], now), "recipients": r[8], "read": r[9],
             "person": r[10]}
            for r in cursor.fetchall()
        ]
        cursor.execute("SELECT COUNT(*) FILTER (WHERE archived_at IS NULL), COUNT(*) FILTER (WHERE archived_at IS NOT NULL) "
                       "FROM inbox_messages WHERE kind = 'admin'")
        active, archived_total = cursor.fetchone()
    finally:
        cursor.close()
        conn.close()
    return {"items": items, "total": total, "page": page, "pages": max(1, -(-total // size)),
            "counts": {"active": active, "archived": archived_total}}


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
                   m.visible_from, m.expires_at, m.created_at, m.created_by, m.archived_at, m.archived_by, m.audiences
            FROM inbox_messages m WHERE m.id = %s AND m.kind = 'admin'
            """, (message_id,))
        row = cursor.fetchone()
        if not row:
            raise fail(404, "not_found", "Message not found.")
        summary = _summary(cursor, message_id)
        cursor.execute("SELECT COUNT(*) FROM inbox_recipients WHERE message_id = %s AND read_at IS NOT NULL", (message_id,))
        read = cursor.fetchone()[0]
        detail = {
            "id": row[0], "title": row[1], "body": row[2], "translations": row[3] or {}, "main_lang": row[4], "audience": row[5], "audiences": row[14] or [row[5]],
            "action_label": row[6], "action_target": row[7], "visible_from": _iso(row[8]), "expires_at": _iso(row[9]),
            "created_at": _iso(row[10]), "created_by": row[11], "status": summary["status"], "recipients": summary["recipients"], "read": read,
            "archived": row[12] is not None, "archived_at": _iso(row[12]), "archived_by": row[13],
        }
        if row[5] == "user":
            cursor.execute("SELECT recipient_email, read_at, archived_at IS NOT NULL FROM inbox_recipients WHERE message_id = %s", (message_id,))
            detail["people"] = [{"email": r[0], "read": r[1] is not None, "read_at": _iso(r[1]), "archived_by_client": r[2]} for r in cursor.fetchall()]
        return detail
    finally:
        cursor.close()
        conn.close()


def _set_archived(message_id, archived, admin=""):
    """Archives or restores a message of the studio. Idempotent: repeating it changes nothing and writes no second audit
    row. Archived: it leaves the inbox AND the archive of every client and their numbers, stays in the studio's history
    under "Archived" with everything it had; restored: it is back for everybody who had it (their own archive state is
    untouched). One audit row (who, when, which message): no personal data."""
    ensure_tables_once()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT archived_at FROM inbox_messages WHERE id = %s AND kind = 'admin' FOR UPDATE", (message_id,))
        row = cursor.fetchone()
        if not row:
            raise fail(404, "not_found", "Message not found.")
        if (row[0] is not None) != archived:
            if archived:
                cursor.execute("UPDATE inbox_messages SET archived_at = %s, archived_by = %s WHERE id = %s",
                               (_now(), str(admin)[:120] or None, message_id))
            else:
                cursor.execute("UPDATE inbox_messages SET archived_at = NULL, archived_by = NULL WHERE id = %s", (message_id,))
            cursor.execute("INSERT INTO inbox_audit (action, message_id, admin_email) VALUES (%s, %s, %s)",
                           ("archive" if archived else "restore", message_id, str(admin)[:120] or None))
            logger.info("inbox message %s: %s", "archived" if archived else "restored", message_id)
        conn.commit()
        return {"ok": True}
    except HTTPException:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


def archive_admin(message_id, admin=""):
    return _set_archived(message_id, True, admin)


def restore_admin(message_id, admin=""):
    return _set_archived(message_id, False, admin)


# ----------------------------------------------------------------------------- HTTP
class PreviewPayload(BaseModel):
    audience: str | None = None            # the old single audience
    audiences: list[str] | None = None
    email: str | None = None


class MessagePayload(BaseModel):
    audience: str | None = None            # the old single audience
    audiences: list[str] | None = None     # one or several: all | active_pack | trainers | user
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
    """own_user_id(claims) -> users.id of the signed-in account (or None). `require_client` here is the
    dependency of "anyone who has an inbox": clients, the admin and trainers (trainers read and archive
    their messages in the same inbox; they can not delete them, nobody can)."""
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

    def trainer_without_profile(claims):
        """A trainer who never signed in on the site has no profile row yet: an empty inbox, not an error
        (what was sent to them waits by e-mail until the profile exists)."""
        import trainer_area
        return not own_user_id(claims) and trainer_area.is_active_trainer_email(claims.get("email"))

    # ---- the client
    @app.get("/inbox")
    def client_inbox(lang: str = "en", page: int = 1, filter: str = "all", size: int = PAGE_SIZE, claims=Depends(require_client)):
        _throttle("list", claims)
        if trainer_without_profile(claims):
            return {"items": [], "total": 0, "page": 1, "pages": 1, "unread": 0, "counts": {"inbox": 0, "unread": 0, "archived": 0}}
        return list_inbox(me(claims), claims, lang, page, filter, size)

    @app.get("/inbox/unread-count")
    def client_unread(claims=Depends(require_client)):
        _throttle("count", claims)
        if trainer_without_profile(claims):
            return {"unread": 0}
        return unread_count(me(claims), claims)

    @app.post("/inbox/read-all")
    def client_read_all(claims=Depends(require_client)):
        _throttle("act", claims)
        return mark_all_read(me(claims))

    @app.post("/inbox/{recipient_id}/read")
    def client_read(recipient_id: int, claims=Depends(require_client)):
        _throttle("act", claims)
        return mark_read(me(claims), recipient_id)

    @app.post("/inbox/archive-read")
    def client_archive_read(claims=Depends(require_client)):
        _throttle("act", claims)
        return archive_read(me(claims))

    @app.post("/inbox/{recipient_id}/archive")
    def client_archive(recipient_id: int, claims=Depends(require_client)):
        _throttle("act", claims)
        return archive_own(me(claims), recipient_id)

    @app.post("/inbox/{recipient_id}/unarchive")
    def client_unarchive(recipient_id: int, claims=Depends(require_client)):
        _throttle("act", claims)
        return unarchive_own(me(claims), recipient_id)

    @app.delete("/inbox/{recipient_id}")
    def client_delete_gone(recipient_id: int, claims=Depends(require_client)):
        """Messages can no longer be deleted: they are archived. (The route answers instead of vanishing, so an old
        page gets a clear message.)"""
        raise fail(410, "gone", "Messages can no longer be deleted: archive them instead (POST /inbox/{id}/archive).")

    @app.post("/inbox/{recipient_id}/actions/{action_type}")
    def client_action(recipient_id: int, action_type: str, lang: str = "en", claims=Depends(require_client)):
        _throttle("act", claims)
        return do_action(me(claims), claims, recipient_id, action_type, lang)

    # ---- the studio (Firebase ID token + administrator)
    @app.post("/admin/messages/preview", dependencies=admin)
    def admin_preview(data: PreviewPayload):
        return preview(audiences_of(data), data.email)

    @app.post("/admin/messages")
    def admin_send(data: MessagePayload, claims=Depends(require_admin)):
        return send_admin_message(data, str(claims.get("email", "")))

    @app.get("/admin/messages", dependencies=admin)
    def admin_list(page: int = 1, size: int = 20, q: str = "", status: str = "", archived: bool = False):
        return list_admin(page, size, q, status, archived)

    @app.get("/admin/messages/{message_id}", dependencies=admin)
    def admin_detail(message_id: int):
        return get_admin(message_id)

    @app.post("/admin/messages/{message_id}/archive")
    def admin_archive(message_id: int, claims=Depends(require_admin)):
        return archive_admin(message_id, str(claims.get("email", "")))

    @app.post("/admin/messages/{message_id}/restore")
    def admin_restore(message_id: int, claims=Depends(require_admin)):
        return restore_admin(message_id, str(claims.get("email", "")))

    @app.delete("/admin/messages/{message_id}", dependencies=admin)
    def admin_delete_gone(message_id: int):
        """Sent messages can no longer be deleted: they are archived (and can be restored)."""
        raise fail(410, "gone", "Messages can no longer be deleted: archive them instead (POST /admin/messages/{id}/archive).")

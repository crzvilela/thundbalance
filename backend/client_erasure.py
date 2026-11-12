"""Everything that belongs to a client, and how it leaves when the client is deleted (GDPR right to erasure).

WHAT A CLIENT LEAVES BEHIND (docs/DATA_RETENTION.md has the same list)
  deleted            sessions, client requests, reschedule requests, trial sessions with the client's e-mail, contact messages with
                     the client's e-mail, the client's inbox rows (by login and by e-mail) and the system messages that are left
                     without any recipient, the e-mail log of the client, every profile photo (in the database and on disk), the
                     calendar events, the Firebase account and the profile itself;
  anonymized, kept   the packs (user_plans): what was sold and for how much is accounting. The link to the client, the second person
                     (name, e-mail), the extra e-mail addresses and the shared-calendar addresses are removed;
  scrubbed           the client's address where it appears inside OTHER people's records (second person, extra recipients): only
                     that field is emptied, the record stays;
  stays              admin_audit_log (the admin's uid, the client's numeric id and the outcome: no personal data).

Nothing here writes a name, an address or a value of a row to a log or to the answer: only counts.
The state of a deletion that could not finish (the calendar or Firebase did not answer) is kept in client_erasure_pending (client id, the
step it stopped at, the TYPE of the error): the admin repeats the deletion, and the daily job (data_retention.py) repeats it too.
"""
import logging

from database import get_connection
from safe_log import safe_error

logger = logging.getLogger("thundbalance.erasure")

SYSTEM_CLAIMS = {"sub": "system", "email": ""}      # who a repeated deletion is attributed to in the audit log (a uid, never an address)
MAX_ATTEMPTS = 30                                    # a deletion that keeps failing is left for the admin after this many tries
ERASER = None                                        # set by client_lifecycle: perform_delete(client_id, claims)


def normalize(email):
    return " ".join(str(email or "").split()).lower()


# ------------------------------------------------------------------------------------------------------------------ schema
_ready = False


def ensure_schema():
    """Idempotent: the owner of an uploaded photo, packs that may lose their client, and the table of unfinished deletions."""
    global _ready
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS uploaded_files (
                name TEXT PRIMARY KEY, content_type TEXT NOT NULL, data BYTEA NOT NULL, size INTEGER NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW())
        """)
        cursor.execute("ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS owner_user_id INTEGER")
        cursor.execute("CREATE INDEX IF NOT EXISTS uploaded_files_owner ON uploaded_files (owner_user_id)")
        cursor.execute("ALTER TABLE user_plans ALTER COLUMN user_id DROP NOT NULL")          # an anonymized pack belongs to nobody
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS client_erasure_pending (
                client_id INTEGER PRIMARY KEY,
                stopped_at TEXT NOT NULL,
                error_type TEXT,
                attempts INTEGER NOT NULL DEFAULT 1,
                first_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW())
        """)
        conn.commit()
        _ready = True
    finally:
        cursor.close()
        conn.close()


def ensure_schema_once():
    if not _ready:
        ensure_schema()


# ------------------------------------------------------------------------------------------------------------ the inventory
def _count(cursor, sql, args):
    cursor.execute(sql, args)
    return int(cursor.fetchone()[0] or 0)


def _own_message_ids(cursor, client_id, email):
    cursor.execute(
        "SELECT DISTINCT message_id FROM inbox_recipients WHERE user_id = %s OR LOWER(recipient_email) = %s", (client_id, email)
    )
    return [row[0] for row in cursor.fetchall()]


def preview(cursor, client_id):
    """What deleting the client would remove, as COUNTS only (nothing personal), for the admin's confirmation screen.
    None when the client does not exist."""
    ensure_schema_once()
    cursor.execute("SELECT email, foto, firebase_uid FROM users WHERE id = %s", (client_id,))
    row = cursor.fetchone()
    if not row:
        return None
    email, photo, uid = normalize(row[0]), row[1], row[2]
    ids = _own_message_ids(cursor, client_id, email)
    cursor.execute(
        """
        SELECT COUNT(*) FROM inbox_messages m
        WHERE m.id = ANY(%s) AND m.kind = 'system'
          AND NOT EXISTS (SELECT 1 FROM inbox_recipients r WHERE r.message_id = m.id
                          AND NOT (r.user_id = %s OR LOWER(COALESCE(r.recipient_email, '')) = %s))
        """,
        (ids, client_id, email),
    )
    system_messages = int(cursor.fetchone()[0] or 0)
    return {
        "sessions": _count(cursor, "SELECT COUNT(*) FROM sessions WHERE user_id = %s", (client_id,)),
        "calendar_events": _count(
            cursor,
            "SELECT (SELECT COUNT(*) FROM sessions WHERE user_id = %s AND google_event_id IS NOT NULL)"
            " + (SELECT COUNT(*) FROM trial_sessions WHERE LOWER(email) = %s AND google_event_id IS NOT NULL)", (client_id, email)),
        "requests": _count(cursor, "SELECT COUNT(*) FROM client_requests WHERE user_id = %s", (client_id,)),
        "reschedule_requests": _count(cursor, "SELECT COUNT(*) FROM reschedule_requests WHERE user_id = %s", (client_id,)),
        "trial_sessions": _count(cursor, "SELECT COUNT(*) FROM trial_sessions WHERE LOWER(email) = %s", (email,)),
        "contact_messages": _count(cursor, "SELECT COUNT(*) FROM contact_messages WHERE LOWER(email) = %s", (email,)),
        "inbox_rows": _count(cursor, "SELECT COUNT(*) FROM inbox_recipients WHERE user_id = %s OR LOWER(recipient_email) = %s", (client_id, email)),
        "system_messages": system_messages,
        "emails_logged": _count(cursor, "SELECT COUNT(*) FROM email_log WHERE LOWER(destinatario) = %s", (email,)),
        "photos": _count(
            cursor, "SELECT COUNT(*) FROM uploaded_files WHERE owner_user_id = %s OR name = ANY(%s)",
            (client_id, [str(photo).rsplit("/", 1)[-1]] if str(photo or "").startswith("/uploads/") else [])),
        "packs_anonymized": _count(cursor, "SELECT COUNT(*) FROM user_plans WHERE user_id = %s", (client_id,)),
        "mentions_in_other_records": mentions(cursor, email),
        "login_account": bool(uid),
    }


def mentions(cursor, email):
    """In how many OTHER records the address appears as the second person or as an extra recipient (those fields are emptied)."""
    total = 0
    for table in ("user_plans", "client_requests", "trial_sessions"):
        total += _count(cursor, f"SELECT COUNT(*) FROM {table} WHERE LOWER(second_person_email) = %s", (email,))
    for table in ("user_plans", "trial_sessions", "reschedule_requests"):
        total += _count(
            cursor, f"SELECT COUNT(*) FROM {table} WHERE EXISTS (SELECT 1 FROM unnest(extra_emails) e WHERE LOWER(e) = %s)", (email,))
    return total


# ------------------------------------------------------------------------------------------------------------------ erasing
def scrub_other_records(cursor, email):
    """Empties the address (and the name that goes with it) where it appears inside other people's records. Returns how many fields."""
    changed = 0
    for table in ("user_plans", "client_requests", "trial_sessions"):
        cursor.execute(
            f"UPDATE {table} SET second_person_name = NULL, second_person_email = NULL WHERE LOWER(second_person_email) = %s", (email,))
        changed += cursor.rowcount
    for table in ("user_plans", "trial_sessions", "reschedule_requests"):
        cursor.execute(
            f"UPDATE {table} SET extra_emails = ARRAY(SELECT e FROM unnest(extra_emails) e WHERE LOWER(e) <> %s) "
            f"WHERE EXISTS (SELECT 1 FROM unnest(extra_emails) e WHERE LOWER(e) = %s)", (email, email))
        changed += cursor.rowcount
    like = "%" + email.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    for table in ("user_plans", "trial_sessions"):
        cursor.execute(f"SELECT id, calendar_extra FROM {table} WHERE LOWER(calendar_extra) LIKE %s", (like,))
        for row_id, text in cursor.fetchall():
            kept = [part.strip() for part in str(text).split(",") if part.strip() and part.strip().lower() != email]
            cursor.execute(f"UPDATE {table} SET calendar_extra = %s WHERE id = %s", (",".join(kept) or None, row_id))
            changed += 1
    return changed


def erase_database(cursor, client_id, email, photo=None):
    """Removes the client's rows from the database (the caller commits: it is ONE transaction). The profile (users) is not touched here:
    it goes last, once the login is gone. Returns a dict of COUNTS."""
    email = normalize(email)
    counts = {}
    message_ids = _own_message_ids(cursor, client_id, email)
    orphan_ids = []
    if message_ids:
        cursor.execute(
            """
            SELECT m.id FROM inbox_messages m
            WHERE m.id = ANY(%s) AND m.kind = 'system'
              AND NOT EXISTS (SELECT 1 FROM inbox_recipients r WHERE r.message_id = m.id
                              AND NOT (r.user_id = %s OR LOWER(COALESCE(r.recipient_email, '')) = %s))
            """,
            (message_ids, client_id, email),
        )
        orphan_ids = [row[0] for row in cursor.fetchall()]

    cursor.execute("SELECT id FROM trial_sessions WHERE LOWER(email) = %s", (email,))
    trial_ids = [str(row[0]) for row in cursor.fetchall()]

    cursor.execute("DELETE FROM reschedule_requests WHERE user_id = %s", (client_id,))
    counts["reschedule_requests"] = cursor.rowcount
    cursor.execute("DELETE FROM sessions WHERE user_id = %s", (client_id,))
    counts["sessions"] = cursor.rowcount
    cursor.execute("DELETE FROM client_requests WHERE user_id = %s", (client_id,))
    counts["requests"] = cursor.rowcount
    cursor.execute("DELETE FROM trial_sessions WHERE LOWER(email) = %s", (email,))
    counts["trial_sessions"] = cursor.rowcount
    cursor.execute("DELETE FROM contact_messages WHERE LOWER(email) = %s", (email,))
    counts["contact_messages"] = cursor.rowcount
    cursor.execute("DELETE FROM inbox_recipients WHERE user_id = %s OR LOWER(recipient_email) = %s", (client_id, email))
    counts["inbox_rows"] = cursor.rowcount
    counts["system_messages"] = 0
    if orphan_ids:
        cursor.execute(
            "DELETE FROM inbox_messages m WHERE m.id = ANY(%s) AND m.kind = 'system' "
            "AND NOT EXISTS (SELECT 1 FROM inbox_recipients r WHERE r.message_id = m.id)", (orphan_ids,))
        counts["system_messages"] = cursor.rowcount
    cursor.execute(
        "DELETE FROM email_log WHERE LOWER(destinatario) = %s OR (tipo LIKE 'trial%%' AND referencia = ANY(%s::text[]))", (email, trial_ids))
    counts["emails_logged"] = cursor.rowcount

    # photos: every one the client uploaded (they carry their owner) and the one the profile points to (older ones have no owner)
    names = []
    if str(photo or "").startswith("/uploads/"):
        names.append(str(photo).rsplit("/", 1)[-1])
    cursor.execute("DELETE FROM uploaded_files WHERE owner_user_id = %s OR name = ANY(%s)", (client_id, names))
    counts["photos"] = cursor.rowcount

    # the packs stay as an accounting record, without anything that identifies a person
    cursor.execute(
        """
        UPDATE user_plans SET user_id = NULL, active = FALSE, second_person_name = NULL, second_person_email = NULL,
               extra_emails = NULL, calendar_share = FALSE, calendar_extra = NULL, schedule = NULL
        WHERE user_id = %s
        """,
        (client_id,),
    )
    counts["packs_anonymized"] = cursor.rowcount
    counts["mentions_scrubbed"] = scrub_other_records(cursor, email)
    return counts


# ---------------------------------------------------------------------------------------- deletions that could not finish
def mark_pending(client_id, step, error_type=None):
    """Remembers that deleting this client stopped at `step` (a step name and the TYPE of the error: nothing personal)."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        ensure_schema_once()
        cursor.execute(
            """
            INSERT INTO client_erasure_pending (client_id, stopped_at, error_type) VALUES (%s, %s, %s)
            ON CONFLICT (client_id) DO UPDATE SET stopped_at = EXCLUDED.stopped_at, error_type = EXCLUDED.error_type,
                attempts = client_erasure_pending.attempts + 1, updated_at = NOW()
            """,
            (client_id, str(step)[:20], str(error_type or "")[:60] or None),
        )
        conn.commit()
    except Exception as error:  # noqa: BLE001 - never hide the real problem behind the marker
        logger.error("op=mark_pending error=%s", safe_error(error))
    finally:
        cursor.close()
        conn.close()


def clear_pending(client_id):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        ensure_schema_once()
        cursor.execute("DELETE FROM client_erasure_pending WHERE client_id = %s", (client_id,))
        conn.commit()
    except Exception as error:  # noqa: BLE001
        logger.error("op=clear_pending error=%s", safe_error(error))
    finally:
        cursor.close()
        conn.close()


def list_pending():
    conn = get_connection()
    cursor = conn.cursor()
    try:
        ensure_schema_once()
        cursor.execute("SELECT client_id, stopped_at, error_type, attempts, first_at, updated_at FROM client_erasure_pending ORDER BY first_at")
        return [{"client_id": r[0], "stopped_at": r[1], "error_type": r[2], "attempts": r[3],
                 "first_at": r[4].isoformat() if r[4] else None, "updated_at": r[5].isoformat() if r[5] else None} for r in cursor.fetchall()]
    finally:
        cursor.close()
        conn.close()


def retry_pending():
    """Repeats every deletion that stopped half way. Returns {"retried", "finished", "failed"} (counts). Safe to run any time: a deletion is
    repeatable and "not found" counts as done."""
    from fastapi import HTTPException
    result = {"retried": 0, "finished": 0, "failed": 0}
    if ERASER is None:
        return result
    for item in list_pending():
        if item["attempts"] >= MAX_ATTEMPTS:
            continue
        result["retried"] += 1
        try:
            ERASER(item["client_id"], SYSTEM_CLAIMS)
            result["finished"] += 1
        except HTTPException as error:
            if error.status_code == 404:                      # the profile is already gone: nothing is left to do
                clear_pending(item["client_id"])
                result["finished"] += 1
            else:
                result["failed"] += 1
        except Exception as error:  # noqa: BLE001
            logger.error("op=retry_pending error=%s", safe_error(error))
            result["failed"] += 1
    return result

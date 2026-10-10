"""email_log: one row per email the server tried to send.

Written by send_email() (emails/transport.py), so every sender is covered
without changes. Holds no message content and no secrets: kind, reference (for
example the trial session id), recipient, outcome and a short error code.
Logging never breaks sending: every function here swallows its own errors.
"""
import logging

logger = logging.getLogger("thundbalance.emails")

SENT = "enviado"
FAILED = "falhou"


def _connect():
    # imported here: the emails package must stay importable without a database
    from database import get_connection
    return get_connection()


def ensure_table():
    """Idempotent, run at startup (also on the production database)."""
    conn = _connect()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS email_log (
                id SERIAL PRIMARY KEY,
                tipo TEXT NOT NULL,
                referencia TEXT,
                destinatario TEXT NOT NULL,
                estado TEXT NOT NULL,
                erro TEXT,
                criado_em TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
            )
            """
        )
        cursor.execute("CREATE INDEX IF NOT EXISTS email_log_ref_idx ON email_log (tipo, referencia, id DESC)")
        conn.commit()
    finally:
        cursor.close()
        conn.close()


def record(kind, reference, recipient, ok, error=""):
    """Adds one row. Never raises."""
    if not kind:
        return
    try:
        conn = _connect()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "INSERT INTO email_log (tipo, referencia, destinatario, estado, erro) VALUES (%s, %s, %s, %s, %s)",
                (str(kind)[:60], None if reference is None else str(reference)[:60], str(recipient)[:254],
                 SENT if ok else FAILED, None if ok else str(error or "error")[:60]),
            )
            conn.commit()
        finally:
            cursor.close()
            conn.close()
    except Exception as error_:  # noqa: BLE001
        logger.error("email_log could not be written (%s)", type(error_).__name__)


def latest(kind, references):
    """{reference: {"status", "error", "at" (UTC datetime)}} for the newest row of
    `kind` per reference."""
    refs = [str(item) for item in references]
    if not refs:
        return {}
    try:
        conn = _connect()
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                SELECT DISTINCT ON (referencia) referencia, estado, erro, criado_em
                FROM email_log
                WHERE tipo = %s AND referencia = ANY(%s)
                ORDER BY referencia, id DESC
                """,
                (kind, refs),
            )
            return {row[0]: {"status": row[1], "error": row[2], "at": row[3]} for row in cursor.fetchall()}
        finally:
            cursor.close()
            conn.close()
    except Exception as error:  # noqa: BLE001 - a missing log must not break the trial list
        logger.error("email_log could not be read (%s)", type(error).__name__)
        return {}


def seconds_since_last(kind, reference):
    """Seconds since the newest row of `kind` for `reference` (None if none)."""
    try:
        conn = _connect()
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                SELECT EXTRACT(EPOCH FROM ((NOW() AT TIME ZONE 'UTC') - criado_em))
                FROM email_log WHERE tipo = %s AND referencia = %s
                ORDER BY id DESC LIMIT 1
                """,
                (kind, str(reference)),
            )
            row = cursor.fetchone()
            return float(row[0]) if row else None
        finally:
            cursor.close()
            conn.close()
    except Exception as error:  # noqa: BLE001
        logger.error("email_log could not be read (%s)", type(error).__name__)
        return None

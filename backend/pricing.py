"""Session type (individual | dual) and the TRIAL prices. The prices of the PACKS live in the catalogue (pack_catalog.py).

Trial prices are EUR per session and live in the small `pricing` table (kind 'trial', months 0), seeded once from SEED
below (idempotent: a row that already exists is never overwritten) and edited from Admin > Packs. The server always works
the price out from there and never trusts a value sent by the browser; the site reads them through GET /pricing.

    trial  individual 40    dual 50

(The `pricing` table also still holds the old per-duration pack prices. They are no longer read: the catalogue was seeded
from them once, and they are left as they were.)

A DUAL session is two people in the same session, same hour, same trainer. The second person's name and email are
required and kept on the pack / request / trial; nothing is ever sent to the second person.
"""
from decimal import Decimal

from fastapi import HTTPException

import validators

INDIVIDUAL, DUAL = "individual", "dual"
SESSION_TYPES = (INDIVIDUAL, DUAL)
PACK, TRIAL = "pack", "trial"
TRIAL_MONTHS = 0          # a trial has no duration; 0 is its row in the table

# (kind, session type, months, EUR per session): only the trial prices are seeded here
SEED = (
    (TRIAL, INDIVIDUAL, TRIAL_MONTHS, 40), (TRIAL, DUAL, TRIAL_MONTHS, 50),
)

# the columns added to the tables that carry a session type (idempotent, run at startup)
TYPE_COLUMNS = (
    "session_type TEXT NOT NULL DEFAULT 'individual'",
    "second_person_name TEXT",
    "second_person_email TEXT",
)
PRICE_COLUMNS = ("price_per_session NUMERIC(10,2)", "total_price NUMERIC(10,2)")
TABLES = {
    "user_plans": TYPE_COLUMNS + PRICE_COLUMNS,
    "client_requests": TYPE_COLUMNS,
    "trial_sessions": TYPE_COLUMNS + ("price_per_session NUMERIC(10,2)",),
}


def ensure_schema(cursor):
    """The pricing table with its prices, and the session-type columns. Idempotent."""
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS pricing (
            kind TEXT NOT NULL,
            session_type TEXT NOT NULL,
            months INTEGER NOT NULL,
            price NUMERIC(10,2) NOT NULL,
            PRIMARY KEY (kind, session_type, months)
        )
        """
    )
    for kind, session_type, months, price in SEED:
        cursor.execute(
            "INSERT INTO pricing (kind, session_type, months, price) VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
            (kind, session_type, months, price),
        )
    for table, columns in TABLES.items():
        for column in columns:
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column}")


def number(value):
    """A price as a plain number for JSON (65 or 62.5), None stays None."""
    if value is None:
        return None
    value = Decimal(value)
    return int(value) if value == value.to_integral_value() else float(value)


def money(value):
    """"€65" / "€62.50": how a price is written in emails and in the calendar."""
    value = number(value)
    if value is None:
        return ""
    return f"€{value:g}" if isinstance(value, int) or float(value).is_integer() else f"€{value:.2f}"


def normalize_type(value):
    """'individual' (also when nothing is sent) or 'dual'; anything else is a 422."""
    text = str(value if value is not None else INDIVIDUAL).strip().lower() or INDIVIDUAL
    if text not in SESSION_TYPES:
        raise HTTPException(status_code=422, detail={
            "code": "invalid_session_type", "field": "session_type",
            "message": "Tipo de sesión no válido. / Invalid session type.",
        })
    return text


def second_person(session_type, name, email):
    """(name, email) of the second person: required and checked for a dual session, (None, None) for an individual one
    (anything sent is ignored, so a pack never carries a stranger)."""
    if session_type != DUAL:
        return None, None
    try:
        return (
            validators.validate_name(name, "second_person_name", 100),
            validators.validate_email(email, "second_person_email"),
        )
    except validators.FieldError as error:
        raise validators.http_error(error) from None


def trial_price(cursor, session_type):
    """EUR of a trial session (None when the table has no row for it)."""
    cursor.execute(
        "SELECT price FROM pricing WHERE kind = %s AND session_type = %s AND months = %s",
        (TRIAL, session_type, TRIAL_MONTHS),
    )
    row = cursor.fetchone()
    return row[0] if row else None


def type_label(session_type, second_name=None):
    """"Dual (Ana)" / "Individual": the type as text. Used by the calendar and the emails."""
    if session_type == DUAL:
        return f"Dual ({second_name})" if second_name else "Dual"
    return "Individual"

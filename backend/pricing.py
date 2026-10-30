"""The ONE source of prices, and the session type (individual | dual).

Prices are EUR PER SESSION and live in the `pricing` table, seeded once from SEED below (idempotent: a row that
already exists is never overwritten, so a price edited in the database stays). Nothing else in the backend or the
site holds a price: the server always works the price out from (kind, session type, months) and never trusts a
value sent by the browser; the site reads the table through GET /pricing.

    pack   months 1 | 3 | 6   individual 65 | 60 | 55      dual 80 | 75 | 70 (one price for BOTH people)
    trial  (months 0)         individual 40                dual 50

Total of a pack = price per session x total number of sessions of the pack. The price per session and the total
are stored on the pack (user_plans) when it is created: packs that already exist keep what they have (their columns
stay empty) and nothing is ever recalculated.

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

# (kind, session type, months, EUR per session)
SEED = (
    (PACK, INDIVIDUAL, 1, 65), (PACK, INDIVIDUAL, 3, 60), (PACK, INDIVIDUAL, 6, 55),
    (PACK, DUAL, 1, 80), (PACK, DUAL, 3, 75), (PACK, DUAL, 6, 70),
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


def price_per_session(cursor, kind, session_type, months):
    """EUR per session for (kind, type, months), or None when no price is defined."""
    cursor.execute(
        "SELECT price FROM pricing WHERE kind = %s AND session_type = %s AND months = %s",
        (kind, session_type, months if kind == PACK else TRIAL_MONTHS),
    )
    row = cursor.fetchone()
    return row[0] if row else None


def pack_quote(cursor, session_type, months, total_sessions):
    """{"price_per_session", "total_price"} of a pack of `months` months with `total_sessions` sessions, worked out
    here and nowhere else. A duration without a price is a 422 (no price is ever invented)."""
    price = price_per_session(cursor, PACK, session_type, months)
    if price is None:
        raise HTTPException(status_code=422, detail={
            "code": "price_missing", "field": "plan_id",
            "message": f"No hay precio definido para {months} mes(es) ({session_type}). / No price is defined for {months} month(s) ({session_type}).",
        })
    return {"price_per_session": price, "total_price": price * int(total_sessions)}


def trial_price(cursor, session_type):
    """EUR of a trial session (None when the table has no row for it)."""
    return price_per_session(cursor, TRIAL, session_type, TRIAL_MONTHS)


def catalog(cursor):
    """Everything the site needs to show prices:
    {"packs": {"individual": {"1": 65, ...}, "dual": {...}}, "trial": {"individual": 40, "dual": 50}, "months": [1, 3, 6]}"""
    cursor.execute("SELECT kind, session_type, months, price FROM pricing ORDER BY months")
    packs = {kind: {} for kind in SESSION_TYPES}
    trial = {}
    months = set()
    for kind, session_type, count, price in cursor.fetchall():
        if kind == PACK and session_type in packs:
            packs[session_type][str(count)] = number(price)
            months.add(count)
        elif kind == TRIAL:
            trial[session_type] = number(price)
    return {"packs": packs, "trial": trial, "months": sorted(months)}


def unpriced_plan_months(cursor):
    """Durations (months) of the plans that have no price for some session type: those plans can not be sold."""
    cursor.execute(
        """
        SELECT DISTINCT p.duracao_meses FROM plans p
        WHERE EXISTS (
            SELECT 1 FROM unnest(%s::text[]) AS kind_type(session_type)
            WHERE NOT EXISTS (
                SELECT 1 FROM pricing x
                WHERE x.kind = 'pack' AND x.session_type = kind_type.session_type AND x.months = p.duracao_meses
            )
        )
        ORDER BY 1
        """,
        (list(SESSION_TYPES),),
    )
    return [row[0] for row in cursor.fetchall()]


def type_label(session_type, second_name=None):
    """"Dual (Ana)" / "Individual": the type as text. Used by the calendar and the emails."""
    if session_type == DUAL:
        return f"Dual ({second_name})" if second_name else "Dual"
    return "Individual"

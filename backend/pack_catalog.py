"""The catalogue of packs: the ONE place that says which packs exist, for how long and at what price.

A catalogue pack is: a name (one field, in whatever language the admin writes), a session type (individual | dual),
a number of WEEKS, the sessions per week a client may choose, a price per session and, optionally, a price for the
whole pack. Packs are never deleted: a pack that is not for sale any more is ARCHIVED (active = FALSE) and comes back
with restore. Archived packs disappear from the site and from every selector; the packs already sold keep working.

PRICES
  * several options of sessions per week -> the client chooses; total = price per session x weeks x chosen sessions
    (price_per_pack is not used and is stored empty);
  * one single option -> total = price_per_pack when the admin set one, otherwise price per session x weeks x sessions.
  The server works the total out here, from the catalogue, every time. A price sent by the browser is never used.

SOLD PACKS KEEP THEIR PRICE: when a pack is sold (packs.create_pack) the price per session, the total, the weeks and the
type are COPIED onto the client's pack (user_plans). Editing the catalogue afterwards never touches them.

THE `plans` TABLE still exists because every older pack, request and query points at it for the name and duration.
Each catalogue pack owns one `plans` row (catalog.plan_id) that is a SNAPSHOT of its name and weeks: when the name or the
weeks of a pack that was already sold or requested are edited, a NEW plans row is made and the catalogue points to it,
so the packs already sold keep the name and duration they were sold with. (A pack nobody used yet is edited in place.)

Trial prices (individual | dual) stay in the small `pricing` table (kind 'trial'), edited from the same screen.
"""
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException
from psycopg2.extras import Json as PgJson

import plans_schema
import pricing

WEEKDAY_OPTIONS = range(1, 6)              # sessions per week a pack may offer: 1 to 5 (Monday to Friday only; Saturday and Sunday never count)
MAX_WEEKS = 260
MAX_OBJECTIVE = 160                        # characters of the objective of a pack
MAX_BENEFITS = 8                           # benefits per pack
MAX_BENEFIT = 80                           # characters of one benefit
MAX_PRICE = Decimal("100000")
DEFAULT_OPTIONS = [1, 2, 3, 4, 5]          # what the site offered before the catalogue existed (1 to 5 per week)

# the packs of the first run: (session type, weeks, EUR per session). The prices are read from the old `pricing`
# table when it has them (so a price somebody edited there is kept); these figures are the fallback.
SEED = (
    (pricing.INDIVIDUAL, 4, 65), (pricing.INDIVIDUAL, 12, 60), (pricing.INDIVIDUAL, 24, 55),
    (pricing.DUAL, 4, 80), (pricing.DUAL, 12, 75), (pricing.DUAL, 24, 70),
)


def months_for(weeks):
    """The `plans.duracao_meses` of a pack: 4 weeks = 1 month, 12 = 3, 24 = 6; any other value is rounded to a month."""
    return max(1, (int(weeks) + 2) // 4)


def ensure_schema(cursor):
    """The catalogue table, its seed (first run only) and the columns of the sold packs and requests. Idempotent."""
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS pack_catalog (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            session_type TEXT NOT NULL,
            weeks INTEGER NOT NULL,
            sessions_per_week_options INTEGER[] NOT NULL,
            price_per_session NUMERIC(10,2) NOT NULL,
            price_per_pack NUMERIC(10,2),
            plan_id INTEGER,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            archived_at TIMESTAMP
        )
        """
    )
    # what the admin writes about a pack (optional: an older pack has none). One free text, not translated.
    for column in ("objective TEXT", "benefits JSONB"):
        cursor.execute(f"ALTER TABLE pack_catalog ADD COLUMN IF NOT EXISTS {column}")
    # a pack sold or requested remembers which catalogue pack it came from and the weeks it was sold with
    for table, columns in (
        ("user_plans", ("catalog_pack_id INTEGER", "weeks INTEGER")),
        ("client_requests", ("catalog_pack_id INTEGER",)),
    ):
        for column in columns:
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column}")
    cursor.execute("LOCK TABLE pack_catalog IN SHARE ROW EXCLUSIVE MODE")       # two servers starting together seed once
    cursor.execute("SELECT 1 FROM pack_catalog LIMIT 1")
    if not cursor.fetchone():
        _seed(cursor)


def _existing_price(cursor, session_type, months):
    cursor.execute(
        "SELECT price FROM pricing WHERE kind = 'pack' AND session_type = %s AND months = %s", (session_type, months)
    )
    row = cursor.fetchone()
    return row[0] if row else None


def _seed(cursor):
    """The six first packs. An individual pack takes over the existing `plans` row of the same number of weeks (so the
    packs already sold and requested keep pointing at the pack they are); the dual ones get their own plans row."""
    price_column = plans_schema.price_column(cursor)
    for order, (session_type, weeks, fallback) in enumerate(SEED, start=1):
        months = months_for(weeks)
        price = _existing_price(cursor, session_type, months)
        price = fallback if price is None else price
        plan_id, name = None, None
        if session_type == pricing.INDIVIDUAL:
            cursor.execute("SELECT id, nome FROM plans WHERE duration_weeks = %s ORDER BY id LIMIT 1", (weeks,))
            found = cursor.fetchone()
            if found:
                plan_id, name = found
        if plan_id is None:
            name = name or (f"{months} Month{'s' if months > 1 else ''} Pack")
            if session_type == pricing.DUAL:
                name = f"Dual {name}"
            plan_id = _new_plan(cursor, price_column, name, weeks, price)
        cursor.execute(
            """
            INSERT INTO pack_catalog (name, session_type, weeks, sessions_per_week_options, price_per_session, plan_id, sort_order)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (name, session_type, weeks, DEFAULT_OPTIONS, price, plan_id, order * 10),
        )


def _new_plan(cursor, price_column, name, weeks, price):
    # In some databases `plans.id` was created without a default (no serial / identity): then the id is given explicitly.
    cursor.execute(
        "SELECT column_default IS NOT NULL OR is_identity = 'YES' FROM information_schema.columns "
        "WHERE table_schema = current_schema() AND table_name = 'plans' AND column_name = 'id'"
    )
    row = cursor.fetchone()
    if row is None or row[0]:
        cursor.execute(
            f"INSERT INTO plans (nome, duracao_meses, {price_column}, duration_weeks) VALUES (%s, %s, %s, %s) RETURNING id",
            (name, months_for(weeks), price, weeks),
        )
    else:
        cursor.execute(
            f"INSERT INTO plans (id, nome, duracao_meses, {price_column}, duration_weeks) "
            "VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM plans), %s, %s, %s, %s) RETURNING id",
            (name, months_for(weeks), price, weeks),
        )
    return cursor.fetchone()[0]


# --------------------------------------------------------------------------------------------- reading
def _money(value):
    return pricing.number(value)


def _view(row, sold=None):
    (pack_id, name, session_type, weeks, options, per_session, per_pack, plan_id, active, order, created, archived,
     objective, benefits) = row
    view = {
        "id": pack_id, "name": name, "session_type": session_type, "weeks": weeks, "months": months_for(weeks),
        "sessions_per_week_options": list(options or []), "price_per_session": _money(per_session),
        "price_per_pack": _money(per_pack), "plan_id": plan_id, "active": bool(active), "sort_order": order,
        "created_at": created.isoformat() if created else None, "archived_at": archived.isoformat() if archived else None,
        "objective": objective or None, "benefits": [item for item in (benefits or []) if isinstance(item, str)],
    }
    view.update(_totals(view))
    if sold is not None:
        view["sold"] = sold
    return view


COLUMNS = ("id, name, session_type, weeks, sessions_per_week_options, price_per_session, price_per_pack, plan_id, "
           "active, sort_order, created_at, archived_at, objective, benefits")


def _totals(pack):
    """What the pack adds up to, worked out here and never stored: one line per option of sessions per week
    ({"per_week", "sessions", "total"}) and, when there is ONE option, the total sessions and the total price directly."""
    lines = []
    for per_week in pack["sessions_per_week_options"]:
        lines.append({"per_week": per_week, "sessions": pack["weeks"] * per_week, "total": _money(total_for(pack, per_week))})
    single = lines[0] if len(lines) == 1 else None
    return {"totals": lines, "total_sessions": single["sessions"] if single else None,
            "price_total": single["total"] if single else None}


def get(cursor, pack_id):
    cursor.execute(f"SELECT {COLUMNS} FROM pack_catalog WHERE id = %s", (pack_id,))
    row = cursor.fetchone()
    return _view(row) if row else None


def list_packs(cursor, include_archived=True):
    """Every pack, in the order of the catalogue, with how many times each was sold (admin screen)."""
    cursor.execute(
        f"""
        SELECT {COLUMNS},
               (SELECT COUNT(*) FROM user_plans up WHERE up.catalog_pack_id = c.id OR (up.catalog_pack_id IS NULL AND up.plan_id = c.plan_id
                    AND up.session_type = c.session_type))
        FROM pack_catalog c {'' if include_archived else 'WHERE c.active'}
        ORDER BY c.active DESC, c.sort_order, c.id
        """
    )
    return [_view(row[:-1], sold=row[-1]) for row in cursor.fetchall()]


def trial_prices(cursor):
    return {kind: _money(pricing.trial_price(cursor, kind)) for kind in pricing.SESSION_TYPES}


def public_catalog(cursor):
    """What the site and the selectors need: the packs on sale and the trial prices.
    {"packs": [{id, name, session_type, weeks, months, sessions_per_week_options, price_per_session, price_per_pack}],
     "trial": {"individual": 40, "dual": 50}}"""
    keys = ("id", "name", "session_type", "weeks", "months", "sessions_per_week_options", "price_per_session", "price_per_pack",
            "objective", "benefits", "totals", "total_sessions", "price_total")
    packs = [{key: pack[key] for key in keys} for pack in list_packs(cursor, include_archived=False)]
    return {"packs": packs, "trial": trial_prices(cursor)}


# --------------------------------------------------------------------------------------------- the sale
def total_for(pack, sessions_per_week):
    """EUR for the whole pack. One option and a pack price set: that price. Otherwise per session x weeks x sessions."""
    if len(pack["sessions_per_week_options"]) == 1 and pack["price_per_pack"] is not None:
        return Decimal(str(pack["price_per_pack"]))
    return Decimal(str(pack["price_per_session"])) * pack["weeks"] * int(sessions_per_week)


def sale(cursor, pack_id, sessions_per_week):
    """The catalogue pack as it is SOLD now: {"pack", "weeks", "total_sessions", "price_per_session", "total_price"}.
    Raises a 404 for an unknown pack, a 409 for an archived one and a 422 for sessions per week the pack does not offer.
    This is the only place a price is worked out for a sale; whatever the browser sent is never read."""
    pack = get(cursor, pack_id)
    if not pack:
        raise HTTPException(status_code=404, detail="Pack not found")
    if not pack["active"]:
        raise HTTPException(status_code=409, detail={
            "code": "pack_archived", "field": "pack_id",
            "message": "Este pack ya no está a la venta. / This pack is no longer on sale.",
        })
    if int(sessions_per_week) not in pack["sessions_per_week_options"]:
        raise HTTPException(status_code=422, detail={
            "code": "invalid_sessions_per_week", "field": "sessions_per_week",
            "message": "Este pack no ofrece ese número de sesiones por semana. / This pack does not offer that many sessions per week.",
        })
    total_sessions = pack["weeks"] * int(sessions_per_week)
    return {
        "pack": pack, "weeks": pack["weeks"], "months": pack["months"], "total_sessions": total_sessions,
        "price_per_session": Decimal(str(pack["price_per_session"])), "total_price": total_for(pack, sessions_per_week),
    }


def pack_for_request(cursor, plan_id, session_type):
    """The catalogue pack that an OLD request (made before the catalogue, it only knows its plan) stands for."""
    cursor.execute(
        "SELECT id FROM pack_catalog WHERE plan_id = %s AND session_type = %s ORDER BY id LIMIT 1", (plan_id, session_type)
    )
    row = cursor.fetchone()
    if row:
        return row[0]
    # a dual request made before the catalogue points at the (individual) plan of the same duration
    cursor.execute(
        """
        SELECT c.id FROM pack_catalog c JOIN plans p ON p.id = %s AND p.duration_weeks = c.weeks
        WHERE c.session_type = %s ORDER BY c.active DESC, c.id LIMIT 1
        """,
        (plan_id, session_type),
    )
    row = cursor.fetchone()
    return row[0] if row else None


# --------------------------------------------------------------------------------------------- writing
def _price(value, field, allow_none=False):
    if value is None or value == "":
        if allow_none:
            return None
        raise _invalid(field, "El precio es obligatorio. / The price is required.")
    try:
        number = Decimal(str(value)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        raise _invalid(field, "Precio no válido. / Invalid price.") from None
    if number < 0 or number > MAX_PRICE or Decimal(str(value)) != number:
        raise _invalid(field, "El precio debe ser >= 0 y tener como máximo 2 decimales. / The price must be >= 0 with at most 2 decimals.")
    return number


def _invalid(field, message):
    return HTTPException(status_code=422, detail={"code": f"invalid_{field}", "field": field, "message": message})


def clean(payload):
    """Validates a pack from the admin form. Returns the values ready to store."""
    name = " ".join(str(payload.get("name") or "").split())
    if not name or len(name) > 80:
        raise _invalid("name", "El nombre es obligatorio (máx. 80). / The name is required (max 80).")
    session_type = pricing.normalize_type(payload.get("session_type"))
    try:
        weeks = int(payload.get("weeks"))
    except (TypeError, ValueError):
        raise _invalid("weeks", "Las semanas deben ser un número entero >= 1. / Weeks must be a whole number >= 1.") from None
    if not 1 <= weeks <= MAX_WEEKS:
        raise _invalid("weeks", f"Las semanas deben estar entre 1 y {MAX_WEEKS}. / Weeks must be between 1 and {MAX_WEEKS}.")
    try:
        options = sorted({int(value) for value in (payload.get("sessions_per_week_options") or [])})
    except (TypeError, ValueError):
        raise _invalid("sessions_per_week_options", "Sesiones por semana no válidas. / Invalid sessions per week.") from None
    if not options or any(value not in WEEKDAY_OPTIONS for value in options):
        raise _invalid("sessions_per_week_options", "Elige entre 1 y 5 sesiones por semana (al menos una). / Choose 1 to 5 sessions per week (at least one).")
    per_session = _price(payload.get("price_per_session"), "price_per_session")
    # the pack price only exists with ONE option; with several the client chooses and the total is worked out
    per_pack = _price(payload.get("price_per_pack"), "price_per_pack", allow_none=True) if len(options) == 1 else None
    values = {"name": name, "session_type": session_type, "weeks": weeks, "options": options,
              "per_session": per_session, "per_pack": per_pack}
    # objective and benefits are optional; a body without them leaves what a pack already has (see update)
    if "objective" in payload:
        values["objective"] = clean_objective(payload.get("objective"))
    if "benefits" in payload:
        values["benefits"] = clean_benefits(payload.get("benefits"))
    return values


def _no_markup(text):
    return "<" not in text and ">" not in text and not any(ord(char) < 32 or ord(char) == 127 for char in text)


def clean_objective(value):
    """The objective of a pack: one short free text, max 160 characters, no HTML. Empty = none (None)."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise _invalid("objective", "El objetivo debe ser texto. / The objective must be text.")
    text = " ".join(value.split())
    if len(text) > MAX_OBJECTIVE:
        raise _invalid("objective", f"El objetivo admite como máximo {MAX_OBJECTIVE} caracteres. / The objective allows at most {MAX_OBJECTIVE} characters.")
    if not _no_markup(text):
        raise _invalid("objective", "El objetivo no admite < ni > (ni HTML). / The objective cannot contain < or > (no HTML).")
    return text or None


def clean_benefits(value):
    """The benefits of a pack: 0 to 8 short texts (max 80 characters each), no HTML, no repeats. Empty lines are dropped."""
    if value is None:
        return []
    if not isinstance(value, list):
        raise _invalid("benefits", "Los beneficios deben ser una lista. / The benefits must be a list.")
    items, seen = [], set()
    for entry in value:
        if not isinstance(entry, str):
            raise _invalid("benefits", "Cada beneficio debe ser texto. / Every benefit must be text.")
        text = " ".join(entry.split())
        if not text:
            continue
        if len(text) > MAX_BENEFIT:
            raise _invalid("benefits", f"Cada beneficio admite como máximo {MAX_BENEFIT} caracteres. / Every benefit allows at most {MAX_BENEFIT} characters.")
        if not _no_markup(text):
            raise _invalid("benefits", "Los beneficios no admiten < ni > (ni HTML). / Benefits cannot contain < or > (no HTML).")
        if text.casefold() in seen:
            raise _invalid("benefits", "Hay beneficios repetidos. / There are repeated benefits.")
        seen.add(text.casefold())
        items.append(text)
    if len(items) > MAX_BENEFITS:
        raise _invalid("benefits", f"Máximo {MAX_BENEFITS} beneficios. / At most {MAX_BENEFITS} benefits.")
    return items


def _plan_in_use(cursor, plan_id):
    cursor.execute(
        "SELECT EXISTS (SELECT 1 FROM user_plans WHERE plan_id = %s) OR EXISTS (SELECT 1 FROM client_requests WHERE plan_id = %s)",
        (plan_id, plan_id),
    )
    return cursor.fetchone()[0]


def _sync_plan(cursor, pack_id, plan_id, name, weeks, price):
    """Keeps the `plans` snapshot of the pack in step with its name and weeks (see the module text)."""
    price_column = plans_schema.price_column(cursor)
    if plan_id is not None:
        cursor.execute("SELECT nome, duration_weeks FROM plans WHERE id = %s", (plan_id,))
        current = cursor.fetchone()
        if current and current[0] == name and current[1] == weeks:
            return plan_id                                                   # nothing to change
        if current and not _plan_in_use(cursor, plan_id):
            cursor.execute(f"UPDATE plans SET nome = %s, duracao_meses = %s, duration_weeks = %s WHERE id = %s",
                           (name, months_for(weeks), weeks, plan_id))
            return plan_id
    return _new_plan(cursor, price_column, name, weeks, price)               # sold packs keep the old row


def create(cursor, payload):
    values = clean(payload)
    plan_id = _new_plan(cursor, plans_schema.price_column(cursor), values["name"], values["weeks"], values["per_session"])
    cursor.execute("SELECT COALESCE(MAX(sort_order), 0) + 10 FROM pack_catalog")
    order = cursor.fetchone()[0]
    cursor.execute(
        """
        INSERT INTO pack_catalog (name, session_type, weeks, sessions_per_week_options, price_per_session, price_per_pack, plan_id, sort_order,
                                  objective, benefits)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
        """,
        (values["name"], values["session_type"], values["weeks"], values["options"], values["per_session"], values["per_pack"], plan_id, order,
         values.get("objective"), PgJson(values["benefits"]) if values.get("benefits") else None),
    )
    return get(cursor, cursor.fetchone()[0])


def update(cursor, pack_id, payload):
    """Edits a pack. The packs already sold are not touched (they hold their own copy of the price, weeks and type)."""
    cursor.execute("SELECT plan_id FROM pack_catalog WHERE id = %s FOR UPDATE", (pack_id,))
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Pack not found")
    values = clean(payload)
    plan_id = _sync_plan(cursor, pack_id, row[0], values["name"], values["weeks"], values["per_session"])
    cursor.execute(
        """
        UPDATE pack_catalog SET name = %s, session_type = %s, weeks = %s, sessions_per_week_options = %s,
               price_per_session = %s, price_per_pack = %s, plan_id = %s
        WHERE id = %s
        """,
        (values["name"], values["session_type"], values["weeks"], values["options"], values["per_session"], values["per_pack"], plan_id, pack_id),
    )
    # the objective and the benefits are only overwritten when the body carries them (an older client keeps what is there)
    if "objective" in values:
        cursor.execute("UPDATE pack_catalog SET objective = %s WHERE id = %s", (values["objective"], pack_id))
    if "benefits" in values:
        cursor.execute("UPDATE pack_catalog SET benefits = %s WHERE id = %s",
                       (PgJson(values["benefits"]) if values["benefits"] else None, pack_id))
    return get(cursor, pack_id)


def set_archived(cursor, pack_id, archived):
    """Archive (off sale, nothing is deleted) or restore a pack."""
    cursor.execute(
        "UPDATE pack_catalog SET active = %s, archived_at = CASE WHEN %s THEN NOW() ELSE NULL END WHERE id = %s RETURNING id",
        (not archived, archived, pack_id),
    )
    if not cursor.fetchone():
        raise HTTPException(status_code=404, detail="Pack not found")
    return get(cursor, pack_id)


def set_trial_prices(cursor, individual, dual):
    """Saves the trial prices (individual | dual): the small `pricing` table, kind 'trial'."""
    for session_type, value in ((pricing.INDIVIDUAL, individual), (pricing.DUAL, dual)):
        price = _price(value, f"trial_{session_type}")
        cursor.execute(
            """
            INSERT INTO pricing (kind, session_type, months, price) VALUES ('trial', %s, %s, %s)
            ON CONFLICT (kind, session_type, months) DO UPDATE SET price = EXCLUDED.price
            """,
            (session_type, pricing.TRIAL_MONTHS, price),
        )
    return trial_prices(cursor)

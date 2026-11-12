"""The Pricing section of the landing page: Individual | Dual, three prices each (Monthly, Quarterly, Semiannual), written by hand.

The landing is ONE site for everybody (visitor, client, admin): its content comes from the public, read-only
`GET /landing-page/content?version=published` and nothing in the Pricing section depends on a token, a role or a profile.
The prices and features have no link with the catalogue of packs (Admin > Packs): creating, editing, archiving or deleting a
pack never changes the landing, and the landing never reads the catalogue.

STORED (in the landing content, `sections.<id>`):
    "plans":  the three text cards of always (name, period, description, features, button text, highlighted): they give the
              description, the button and the highlight of Monthly (plans[0]), Quarterly (plans[1]), Semiannual (plans[2]),
              the same for Individual and Dual.
    "prices": {"individual": [t0, t1, t2], "dual": [t0, t1, t2]}   with t = {"price": "...", "features": ["..."]}
              index 0 Monthly, 1 Quarterly, 2 Semiannual. A text is a plain string or an {"en", "es", "ca"} object.
LIMITS: price 60 characters; 0 to 10 features of up to 100 characters; no "<" or ">" anywhere.

MIGRATION (one time). Content written by the earlier versions of this section (a list `planItems` of catalogue packs, or the
manual `cards` of Prompt 60, or only the three text cards) is converted to `prices` by `migrate_version`:
  * the JSON as it was is first saved in a backup row (`backup-draft`, `backup-published`) that is never overwritten;
  * each card goes to its (type, price) place: by the catalogue pack it came from (4 / 12 / 24 weeks = Monthly / Quarterly /
    Semiannual), otherwise by its name; its price text is kept as the page showed it ("€65/session") and so are its features;
  * what does not fit (a second card for the same place, a card that is not Monthly, Quarterly or Semiannual) is NOT deleted:
    it stays in `sections.<id>.legacyCards` (and in the backup) and the migration reports it;
  * it only runs on a Pricing section WITHOUT `prices`, so running it again changes nothing.
"""
import re

from fastapi import HTTPException
from psycopg2.extras import Json as PgJson

import pack_catalog
import pricing

VERSIONS = ("draft", "published")                      # 'default_base' is the immutable snapshot of the first start: not touched
TYPES = ("individual", "dual")
TIERS = ("monthly", "quarterly", "semiannual")
PRICE_LIMIT = 60
FEATURE_LIMIT = 100
MAX_FEATURES = 10
TIER_BY_WEEKS = {4: "monthly", 12: "quarterly", 24: "semiannual"}
# a name that says which duration it is (checked in this order: "3 Months" must not be taken for Monthly)
NAME_TIERS = (
    ("quarterly", re.compile(r"quarter|3\s*months?|3\s*mes|trimest", re.I)),
    ("semiannual", re.compile(r"semi|6\s*months?|6\s*mes|semest|annual|anual", re.I)),
    ("monthly", re.compile(r"month|mensual|1\s*mes", re.I)),
)


# --------------------------------------------------------------------------------------------- validation
def _invalid(field, message):
    return HTTPException(status_code=422, detail={"code": "invalid_pricing", "field": field, "message": message})


def _strings(value):
    """The texts inside a field: a string, or the strings of an {en, es, ca} object. None when the shape is wrong."""
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict) and all(isinstance(item, str) for item in value.values()):
        return list(value.values())
    return None


def _check_text(field, value, limit):
    texts = _strings(value)
    if texts is None:
        raise _invalid(field, "Texto no válido. / Invalid text.")
    for text in texts:
        if "<" in text or ">" in text:
            raise _invalid(field, "No se admiten < ni > (ni HTML). / < and > (HTML) are not allowed.")
        if len(text) > limit:
            raise _invalid(field, f"Máximo {limit} caracteres. / At most {limit} characters.")


def validate_prices(prices):
    if not isinstance(prices, dict):
        raise _invalid("prices", "Precios no válidos. / Invalid prices.")
    for kind, tiers in prices.items():
        if kind not in TYPES or not isinstance(tiers, list) or len(tiers) > len(TIERS):
            raise _invalid("prices", "Precios no válidos. / Invalid prices.")
        for tier in tiers:
            if not isinstance(tier, dict):
                raise _invalid("prices", "Precios no válidos. / Invalid prices.")
            _check_text("price", tier.get("price"), PRICE_LIMIT)
            features = tier.get("features")
            if features is None:
                continue
            if not isinstance(features, list) or len(features) > MAX_FEATURES:
                raise _invalid("features", f"Máximo {MAX_FEATURES} características. / At most {MAX_FEATURES} features.")
            for item in features:
                _check_text("features", item, FEATURE_LIMIT)


def _pricing_sections(content):
    """The Pricing sections of a landing content: the ones typed "pricing" and the one called "pricing" in content saved before
    sections carried a type."""
    sections = content.get("sections") if isinstance(content, dict) else None
    return [section for key, section in (sections or {}).items()
            if isinstance(section, dict) and (section.get("type") == "pricing" or (key == "pricing" and "type" not in section))]


def validate_content(content):
    """Checks the prices of every Pricing section of a landing content (a section without `prices`, the old format during the
    migration, is accepted). Raises a 422."""
    for section in _pricing_sections(content):
        if "prices" in section:
            validate_prices(section["prices"])


# --------------------------------------------------------------------------------------------- migration
def _text(value):
    """The English (or only) text of a field, to read it."""
    if isinstance(value, dict):
        return str(value.get("en") or next(iter(value.values()), "") or "")
    return str(value or "")


def _price_text(price, period):
    """"€65" + "/session" as the page showed them: "€65/session" (per language when the suffix has languages)."""
    if isinstance(period, dict):
        return {lang: f"{_text(price)}{period.get(lang) or period.get('en') or ''}" for lang in ("en", "es", "ca")}
    return f"{_text(price)}{period or ''}"


def _short(value, limit):
    if isinstance(value, str):
        return value[:limit]
    if isinstance(value, dict):
        return {key: text[:limit] if isinstance(text, str) else "" for key, text in value.items()}
    return ""


def _features(*lists):
    for items in lists:
        if isinstance(items, list) and items:
            return [_short(item, FEATURE_LIMIT) for item in items if isinstance(item, (str, dict))][:MAX_FEATURES]
    return []


def _tier_of(name, weeks=None):
    if weeks in TIER_BY_WEEKS:
        return TIER_BY_WEEKS[weeks]
    for tier, pattern in NAME_TIERS:
        if pattern.search(_text(name)):
            return tier
    return None


def _items_from_catalog(packs, texts):
    """What the page drew when it listed every pack on sale (the oldest format): by type, in the order of the catalogue."""
    items = []
    for kind in TYPES:
        for position, pack in enumerate(p for p in packs if p["session_type"] == kind):
            items.append({"plan_id": pack["id"], "visible": True, "card": position if position < len(texts) else None})
    return items


def _candidates(section, packs, by_id):
    """The cards the section had, as {type, tier, price, features, raw}, whatever the earlier format was."""
    texts = section.get("plans") if isinstance(section.get("plans"), list) else []
    candidates = []
    cards = section.get("cards")
    if isinstance(cards, list):                                                  # Prompt 60: manual cards
        for card in cards:
            if not isinstance(card, dict):
                continue
            found = re.fullmatch(r"card-(\d+)", str(card.get("id", "")))
            pack = by_id.get(int(found.group(1))) if found else None
            kind = card.get("type") if card.get("type") in TYPES else (pack["session_type"] if pack else "individual")
            candidates.append({"type": kind, "tier": _tier_of(card.get("name"), pack["weeks"] if pack else None),
                               "price": _price_text(card.get("price"), card.get("period")),
                               "features": _features(card.get("features"), card.get("benefits")), "raw": card})
        return candidates
    items = section.get("planItems")                                             # Prompt 58: a list of catalogue packs
    if not isinstance(items, list):
        items = _items_from_catalog(packs, texts)                                # earlier still: every pack on sale
    for item in items:
        pack = by_id.get(item.get("plan_id")) if isinstance(item, dict) else None
        if not pack:
            continue                                                             # a pack that no longer exists: in silence
        index = item.get("card")
        text = texts[index] if isinstance(index, int) and 0 <= index < len(texts) and isinstance(texts[index], dict) else {}
        raw = {"id": f"card-{pack['id']}", "type": pack["session_type"], "name": pack["name"], "visible": item.get("visible") is not False}
        candidates.append({"type": pack["session_type"], "tier": _tier_of(pack["name"], pack["weeks"]),
                           "price": _price_text(pricing.money(pack["price_per_session"]), text.get("period", "")),
                           "features": _features(text.get("features"), pack.get("benefits")), "raw": raw})
    return candidates


def migrate_section(section, packs, by_id):
    """Converts one Pricing section without `prices`. Returns {"placed": n, "kept": [names]} or None when nothing was to do."""
    if "prices" in section:
        return None
    prices = {kind: [{"price": "", "features": []} for _ in TIERS] for kind in TYPES}
    taken, kept = set(), []
    for item in _candidates(section, packs, by_id):
        place = (item["type"], item["tier"])
        if item["tier"] is None or place in taken:
            kept.append(item["raw"])
            continue
        taken.add(place)
        prices[item["type"]][TIERS.index(item["tier"])] = {"price": _short(item["price"], PRICE_LIMIT), "features": item["features"]}
    section["prices"] = prices
    for key in ("cards", "planItems"):
        section.pop(key, None)
    if kept:
        section["legacyCards"] = kept                                            # kept, not drawn, never deleted
    return {"placed": len(taken), "kept": [_text(card.get("name")) for card in kept]}


def migrate_content(content, packs):
    """Converts every Pricing section without `prices`. Returns the list of reports (empty when nothing changed)."""
    by_id = {pack["id"]: pack for pack in packs}
    reports = []
    for section in _pricing_sections(content):
        report = migrate_section(section, packs, by_id)
        if report:
            reports.append(report)
    return reports


def _needs_migration(content):
    return any("prices" not in section for section in _pricing_sections(content))


def migrate_version(cursor, version):
    """One saved version of the landing content (draft | published). Saves the JSON as it was in `backup-<version>` first
    (never overwritten). Idempotent. Returns the reports ([] when nothing changed)."""
    cursor.execute("SELECT content FROM landing_page_content WHERE version = %s FOR UPDATE", (version,))
    row = cursor.fetchone()
    if not row or not isinstance(row[0], dict) or not _needs_migration(row[0]):
        return []
    content = row[0]
    cursor.execute(
        "INSERT INTO landing_page_content (version, content) VALUES (%s, %s) ON CONFLICT (version) DO NOTHING",
        (f"backup-{version}", PgJson(content)),
    )
    packs = pack_catalog.list_packs(cursor)                       # archived ones too: a card made from one still finds its type
    reports = migrate_content(content, packs)
    cursor.execute("UPDATE landing_page_content SET content = %s WHERE version = %s", (PgJson(content), version))   # updated_at stays
    return reports


def migrate_all(cursor):
    return {version: migrate_version(cursor, version) for version in VERSIONS}

"""The Pricing section of the landing page: a list of MANUAL cards.

Every card is written by hand in the landing editor and has nothing to do with the catalogue of packs (Admin > Packs):
changing or deleting a pack never changes the landing and the landing never reads the catalogue. The cards live in the
landing content (the editor's JSON), in `sections.<id>.cards`:

    {"id": "card-1", "visible": true, "highlighted": false,
     "name": "...", "price": "...", "period": "...", "tag": "...", "objective": "...", "duration": "...",
     "totalSessions": "...", "description": "...", "benefits": ["..."], "features": ["..."],
     "buttonText": "...", "nameStyle": {...}, "descriptionStyle": {...}, "periodStyle": {...}, "buttonTextStyle": {...}}

A text field is a plain string or a {"en", "es", "ca"} object (what a double click on the page writes for one language).

LIMITS (checked here when the draft is saved and again in the editor): name 60, price 40, objective 200, description 200,
duration / total sessions / tag / price suffix / button text 60; benefits and features: 0 to 10 items of up to 100 characters;
no "<" or ">" anywhere; at most 30 cards.

MIGRATION (one time). Before, the section listed catalogue packs (`planItems`: plan_id, visible, card) or, even earlier, drew
every pack on sale. A section WITHOUT `cards` is converted: every item becomes a manual card with the values the page showed
(the name, the price as "€65", the weeks and sessions per week, the total, the goal and the benefits of the pack, plus the
description, features, button and highlight of the text card it used), in the same order and with the same visibility. An item
whose pack no longer exists is dropped in silence. `planItems` is removed (it held the plan_id); the old `plans` text cards are
left untouched. A section that already has `cards` is never touched, so running it again changes nothing.
"""
import pack_catalog
import pricing
from fastapi import HTTPException

import re

VERSIONS = ("draft", "published")                      # 'default_base' is the immutable snapshot of the first start: not touched

TEXT_LIMITS = {"name": 60, "price": 40, "period": 60, "tag": 60, "objective": 200, "description": 200,
               "duration": 60, "totalSessions": 60, "buttonText": 60}
LIST_FIELDS = ("benefits", "features")
MAX_LIST = 10
MAX_ITEM = 100
MAX_CARDS = 30


# --------------------------------------------------------------------------------------------- validation
def _invalid(field, message):
    return HTTPException(status_code=422, detail={"code": "invalid_pricing_card", "field": field, "message": message})


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


def validate_card(card):
    if not isinstance(card, dict):
        raise _invalid("cards", "Tarjeta no válida. / Invalid card.")
    for field, limit in TEXT_LIMITS.items():
        _check_text(field, card.get(field), limit)
    for field in LIST_FIELDS:
        items = card.get(field)
        if items is None:
            continue
        if not isinstance(items, list) or len(items) > MAX_LIST:
            raise _invalid(field, f"Máximo {MAX_LIST} elementos. / At most {MAX_LIST} items.")
        for item in items:
            _check_text(field, item, MAX_ITEM)
    if "type" in card and card["type"] not in ("individual", "dual"):
        raise _invalid("type", "Tipo no válido. / Invalid type.")
    for field in ("visible", "highlighted"):
        if field in card and not isinstance(card[field], bool):
            raise _invalid(field, "Valor no válido. / Invalid value.")
    if "id" in card and (not isinstance(card["id"], str) or len(card["id"]) > 64):
        raise _invalid("id", "Identificador no válido. / Invalid id.")


def validate_content(content):
    """Checks the manual cards of every Pricing section of a landing content (a section without `cards`, the old format
    during the migration, is accepted). Raises a 422."""
    sections = content.get("sections") if isinstance(content, dict) else None
    for section in (sections or {}).values():
        if not isinstance(section, dict) or section.get("type") != "pricing" or "cards" not in section:
            continue
        cards = section["cards"]
        if not isinstance(cards, list) or len(cards) > MAX_CARDS:
            raise _invalid("cards", f"Máximo {MAX_CARDS} tarjetas. / At most {MAX_CARDS} cards.")
        for card in cards:
            validate_card(card)


# --------------------------------------------------------------------------------------------- migration
def _ml(en, es, ca):
    return {"en": en, "es": es, "ca": ca}


def _join(parts):
    """Joins {en, es, ca} texts with ' · ' (parts that are empty are skipped)."""
    parts = [part for part in parts if part]
    return {lang: " · ".join(part[lang] for part in parts) for lang in ("en", "es", "ca")} if parts else ""


def _duration(pack):
    weeks = pack["weeks"]
    options = pack["sessions_per_week_options"]
    first = _ml(f"{weeks} weeks", f"{weeks} semanas", f"{weeks} setmanes")
    if len(options) == 1:
        n = options[0]
        second = _ml(f"{n} sessions a week", f"{n} sesiones por semana", f"{n} sessions per setmana")
    else:
        listed = " / ".join(str(value) for value in options)
        second = _ml(f"choose {listed} sessions a week", f"elige {listed} sesiones por semana", f"tria {listed} sessions per setmana")
    return _join([first, second])


def _total(pack):
    parts = []
    if len(pack["sessions_per_week_options"]) == 1:
        n = pack["weeks"] * pack["sessions_per_week_options"][0]
        parts.append(_ml(f"{n} sessions in total", f"{n} sesiones en total", f"{n} sessions en total"))
        if pack["price_per_pack"] is not None:
            price = pricing.money(pack["price_per_pack"])
            parts.append(_ml(f"Pack price {price}", f"Precio del pack {price}", f"Preu del pack {price}"))
    if pack["session_type"] == "dual":
        parts.append(_ml("one price for both people", "un solo precio para las dos personas", "un sol preu per a les dues persones"))
    return _join(parts)


def _shorten(value, limit):
    """A migrated text never exceeds its limit (a longer one is cut, never rejected)."""
    if isinstance(value, str):
        return value[:limit]
    if isinstance(value, dict):
        return {key: text[:limit] if isinstance(text, str) else "" for key, text in value.items()}
    return value


def card_from_pack(pack, old):
    """The manual card with the values the page showed for this catalogue pack. `old` is the text card it used (or {})."""
    own = isinstance(old, dict) and bool(old)
    card = {
        "id": f"card-{pack['id']}", "type": pack["session_type"], "visible": True, "highlighted": bool(old.get("highlighted")) if own else False,
        "name": pack["name"], "price": pricing.money(pack["price_per_session"]), "period": old.get("period", ""),
        "tag": "", "objective": pack.get("objective") or "", "duration": _duration(pack), "totalSessions": _total(pack),
        "description": old.get("description", "") if own else "", "benefits": list(pack.get("benefits") or []),
        "features": list(old.get("features") or []) if own else [], "buttonText": old.get("buttonText", ""),
    }
    for style in ("descriptionStyle", "periodStyle", "buttonTextStyle"):
        if isinstance(old.get(style), dict):
            card[style] = old[style]
    for field, limit in TEXT_LIMITS.items():
        card[field] = _shorten(card[field], limit)
    for field in LIST_FIELDS:
        card[field] = [_shorten(item, MAX_ITEM) for item in card[field]][:MAX_LIST]
    return card


def items_from_catalog(packs, cards):
    """What the page drew when it listed every pack on sale (the oldest format): by type, in the order of the catalogue."""
    items = []
    for session_type in ("individual", "dual"):
        for position, pack in enumerate(p for p in packs if p["session_type"] == session_type):
            items.append({"plan_id": pack["id"], "visible": True, "card": position if position < cards else None})
    return items


def migrate_content(content, packs):
    """Gives every Pricing section without `cards` its manual cards. Returns True when something changed."""
    changed = False
    by_id = {pack["id"]: pack for pack in packs}
    sections = content.get("sections") if isinstance(content, dict) else None
    for section in (sections or {}).values():
        if not (isinstance(section, dict) and section.get("type") == "pricing") or "cards" in section:
            continue
        texts = section.get("plans") if isinstance(section.get("plans"), list) else []
        items = section.get("planItems")
        if not isinstance(items, list):
            items = items_from_catalog(packs, len(texts))
        last = texts[-1] if texts else {}
        cards, seen = [], set()
        for item in items:
            pack = by_id.get(item.get("plan_id")) if isinstance(item, dict) else None
            if not pack or pack["id"] in seen:                      # a pack that no longer exists disappears in silence
                continue
            seen.add(pack["id"])
            index = item.get("card")
            old = texts[index] if isinstance(index, int) and 0 <= index < len(texts) and isinstance(texts[index], dict) else None
            card = card_from_pack(pack, old if old else {"period": last.get("period", ""), "buttonText": last.get("buttonText", "")})
            if old is None:
                card["description"], card["features"], card["highlighted"] = "", [], False
            card["visible"] = item.get("visible") is not False
            cards.append(card)
        section["cards"] = cards
        section.pop("planItems", None)
        changed = True
    return changed


def type_cards(content, packs):
    """Gives every manual card without a `type` (individual | dual) one: the type of the pack it was made from (its id is
    `card-<pack id>`), otherwise individual. The page has the Individual | Dual selector again and filters the cards by it.
    Runs only on cards that have no type, so it changes nothing the second time. Returns True when something changed."""
    kinds = {pack["id"]: pack["session_type"] for pack in packs}
    changed = False
    sections = content.get("sections") if isinstance(content, dict) else None
    for section in (sections or {}).values():
        if not (isinstance(section, dict) and section.get("type") == "pricing" and isinstance(section.get("cards"), list)):
            continue
        for card in section["cards"]:
            if isinstance(card, dict) and "type" not in card:
                found = re.fullmatch(r"card-(\d+)", str(card.get("id", "")))
                card["type"] = kinds.get(int(found.group(1)), "individual") if found else "individual"
                changed = True
    return changed


def migrate_version(cursor, version):
    """One saved version of the landing content (draft | published). Idempotent."""
    cursor.execute("SELECT content FROM landing_page_content WHERE version = %s FOR UPDATE", (version,))
    row = cursor.fetchone()
    if not row or not isinstance(row[0], dict):
        return False
    content = row[0]
    packs = pack_catalog.list_packs(cursor, include_archived=False)
    migrated = migrate_content(content, packs)
    typed = type_cards(content, pack_catalog.list_packs(cursor))
    if not (migrated or typed):
        return False
    from psycopg2.extras import Json as PgJson
    cursor.execute("UPDATE landing_page_content SET content = %s WHERE version = %s", (PgJson(content), version))   # updated_at stays
    return True


def migrate_all(cursor):
    return [version for version in VERSIONS if migrate_version(cursor, version)]

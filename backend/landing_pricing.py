"""Which packs the Pricing section of the landing page shows.

Before: the Pricing section drew every pack on sale of the catalogue, so a new pack appeared on the landing by itself.
Now: the section keeps its own list in the landing content (the editor's JSON, `sections.<id>.planItems`):

    "planItems": [{"plan_id": 7, "visible": true, "card": 0}, ...]       (the order of the list is the order on the page)

  plan_id  the catalogue pack (pack_catalog.id); its name, price, goal and benefits are read live from the catalogue
  visible  false = kept in the list but not drawn
  card     the index in `sections.<id>.plans` of the text card (description, features, button, highlight) this plan
           uses, or null for a plain card

Creating a pack never touches this list. The admin adds a pack to the landing from the editor ("Añadir plan").

MIGRATION (one time): a Pricing section that has no `planItems` yet gets the list that reproduces what the page showed
until now: the packs on sale, by type, in the order of the catalogue, each one with the card that had its position. It
only runs on a section WITHOUT the key, so running it again (every start of the server) changes nothing.
"""
import pack_catalog

VERSIONS = ("draft", "published")                      # 'default_base' is the immutable snapshot of the first start: not touched


def items_from_catalog(packs, cards):
    """The list that shows what the Pricing section drew before this list existed (the old behaviour, written down)."""
    items = []
    for session_type in ("individual", "dual"):
        for position, pack in enumerate(p for p in packs if p["session_type"] == session_type):
            items.append({"plan_id": pack["id"], "visible": True, "card": position if position < cards else None})
    return items


def migrate_content(content, packs):
    """Gives every Pricing section without a list its list. Returns True when something changed."""
    changed = False
    sections = content.get("sections") if isinstance(content, dict) else None
    for section in (sections or {}).values():
        if isinstance(section, dict) and section.get("type") == "pricing" and "planItems" not in section:
            cards = section.get("plans")
            section["planItems"] = items_from_catalog(packs, len(cards) if isinstance(cards, list) else 0)
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
    if not migrate_content(content, packs):
        return False
    from psycopg2.extras import Json as PgJson
    cursor.execute("UPDATE landing_page_content SET content = %s WHERE version = %s", (PgJson(content), version))   # updated_at stays
    return True


def migrate_all(cursor):
    return [version for version in VERSIONS if migrate_version(cursor, version)]

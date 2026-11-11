"""Personalising the admin panel: names, order and visibility of the menu, the Overview cards and the page titles
(docs/ADMIN_UI_SETTINGS.md).

ONE configuration for the whole studio, kept in a single row (admin_ui_settings.key = 'panel'):

    {"menu":     [{"key", "label"?, "hidden"?}],
     "overview": [{"key", "title"?, "hidden"?}],
     "pages":    {"<pageKey>": {"title"?, "subtitle"?}},
     "version":  N}

- Only a CLOSED list of keys can be customised (MENU_KEYS / OVERVIEW_KEYS / PAGE_KEYS below, mirrored by src/admin/uiRegistry.js).
  Nothing else is ever stored: no HTML, no free text outside those fields, no unknown field.
- Texts: label / title up to 30 characters, subtitle up to 120; trimmed, no "<" or ">", no control characters; the whole
  configuration at most 8 KB.
- Protections: the Overview item and the access to "Personalizar panel" can never be hidden, and at least 3 menu areas stay visible.
- Concurrency: PUT sends the `version` it loaded; if it is not the stored one the answer is 409. A configuration that does not exist
  has version 0.
- No configuration = the original panel. DELETE removes the row.
The endpoints are admin only (require_admin). Nothing here is logged with names or texts.
"""
import json
import re

from fastapi import Body, Depends, HTTPException
from psycopg2.extras import Json as PgJson

from database import get_connection

PANEL_KEY = "panel"

# The closed registry (keep in step with src/admin/uiRegistry.js).
MENU_KEYS = (
    "overview", "requests", "trials", "messages", "sent-messages", "clients", "calendar", "schedule", "trainers", "plans", "videos",
    "landing", "customize",
)
OVERVIEW_KEYS = ("stat_clients", "stat_sessions", "stat_pending", "week", "pending", "business", "upcoming", "quick")
PAGE_KEYS = ("overview", "requests", "trials", "messages", "sent-messages", "clients", "calendar", "schedule", "trainers", "plans", "videos")

PROTECTED_MENU_KEYS = ("overview", "customize")      # never hidden
MIN_VISIBLE_AREAS = 3                                # menu areas (everything but "customize") that must stay visible
LABEL_MAX = 30
SUBTITLE_MAX = 120
MAX_BYTES = 8 * 1024
MAX_ITEMS = 50

_ready = False


def _bad(code, message, status=422, **extra):
    return HTTPException(status_code=status, detail={"code": code, "message": message, **extra})


def ensure_table():
    """Idempotent: the single-row table of the panel configuration."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS admin_ui_settings ("
            "key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by INTEGER NULL)")
        conn.commit()
    finally:
        cursor.close()
        conn.close()


def ensure_table_once():
    global _ready
    if not _ready:
        ensure_table()
        _ready = True


# ---------------------------------------------------------------------------------------------- validation
def clean_text(value, limit, field):
    """The text trimmed and with runs of spaces collapsed, or None when it is empty. 422 when it is not a string, is longer than
    `limit`, or has "<", ">" or a control character."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise _bad("invalid_text", f"{field} must be a text.", field=field)
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise _bad("control_characters", f"{field} has control characters.", field=field)
    if "<" in value or ">" in value:
        raise _bad("html_not_allowed", f"{field} cannot contain '<' or '>'.", field=field)
    text = re.sub(r" +", " ", value).strip()
    if len(text) > limit:
        raise _bad("text_too_long", f"{field} is longer than {limit} characters.", field=field, limit=limit)
    return text or None


def _only_fields(entry, allowed, where):
    if not isinstance(entry, dict):
        raise _bad("invalid_format", f"Each item of {where} must be an object.", field=where)
    unknown = set(entry) - set(allowed)
    if unknown:
        raise _bad("unknown_field", f"Unknown field in {where}.", field=where)


def _items(raw, registry, where, text_field):
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > MAX_ITEMS:
        raise _bad("invalid_format", f"{where} must be a short list.", field=where)
    seen, result = set(), []
    for entry in raw:
        _only_fields(entry, ("key", text_field, "hidden"), where)
        key = entry.get("key")
        if key not in registry:
            raise _bad("unknown_key", f"Unknown key in {where}.", field=where)
        if key in seen:
            raise _bad("duplicate_key", f"A key is repeated in {where}.", field=where)
        seen.add(key)
        hidden = entry.get("hidden", False)
        if not isinstance(hidden, bool):
            raise _bad("invalid_format", f"hidden must be true or false in {where}.", field=where)
        item = {"key": key}
        text = clean_text(entry.get(text_field), LABEL_MAX, f"{where}.{text_field}")
        if text:
            item[text_field] = text
        if hidden:
            item["hidden"] = True
        result.append(item)
    return result


def validate(payload):
    """The configuration normalised (without `version`), or a 422. The protection rules are checked here too."""
    if not isinstance(payload, dict):
        raise _bad("invalid_format", "The configuration must be an object.")
    unknown = set(payload) - {"menu", "overview", "pages", "version"}
    if unknown:
        raise _bad("unknown_field", "Unknown field in the configuration.")
    menu = _items(payload.get("menu"), MENU_KEYS, "menu", "label")
    overview = _items(payload.get("overview"), OVERVIEW_KEYS, "overview", "title")

    pages_raw = payload.get("pages") or {}
    if not isinstance(pages_raw, dict) or len(pages_raw) > MAX_ITEMS:
        raise _bad("invalid_format", "pages must be an object.", field="pages")
    pages = {}
    for key, entry in pages_raw.items():
        if key not in PAGE_KEYS:
            raise _bad("unknown_key", "Unknown key in pages.", field="pages")
        _only_fields(entry, ("title", "subtitle"), "pages")
        page = {}
        title = clean_text(entry.get("title"), LABEL_MAX, "pages.title")
        subtitle = clean_text(entry.get("subtitle"), SUBTITLE_MAX, "pages.subtitle")
        if title:
            page["title"] = title
        if subtitle:
            page["subtitle"] = subtitle
        if page:
            pages[key] = page

    hidden = {item["key"] for item in menu if item.get("hidden")}
    if hidden & set(PROTECTED_MENU_KEYS):
        raise _bad("protected_item", "The Overview item and the access to customise the panel cannot be hidden.", field="menu")
    visible_areas = [key for key in MENU_KEYS if key != "customize" and key not in hidden]
    if len(visible_areas) < MIN_VISIBLE_AREAS:
        raise _bad("too_few_visible", f"At least {MIN_VISIBLE_AREAS} menu areas must stay visible.", field="menu", minimum=MIN_VISIBLE_AREAS)

    value = {"menu": menu, "overview": overview, "pages": pages}
    if len(json.dumps(value, ensure_ascii=False).encode("utf-8")) > MAX_BYTES:
        raise _bad("too_large", "The configuration is too large (8 KB at most).")
    return value


def _version_of(payload):
    version = payload.get("version") if isinstance(payload, dict) else None
    if isinstance(version, bool) or not isinstance(version, int) or version < 0:
        raise _bad("invalid_version", "version must be the number of the configuration that was loaded (0 when there was none).")
    return version


# ---------------------------------------------------------------------------------------------- storage
def load(cursor):
    cursor.execute("SELECT value FROM admin_ui_settings WHERE key = %s", (PANEL_KEY,))
    row = cursor.fetchone()
    return row[0] if row else None


def register_ui_settings_routes(app, require_admin):
    admin = [Depends(require_admin)]

    @app.get("/admin/ui-settings", dependencies=admin)
    def get_ui_settings():
        """The saved configuration (with its version), or {} when none was ever saved."""
        ensure_table_once()
        conn = get_connection()
        cursor = conn.cursor()
        try:
            return load(cursor) or {}
        finally:
            cursor.close()
            conn.close()

    @app.put("/admin/ui-settings", dependencies=admin)
    def put_ui_settings(payload: dict = Body(...)):
        """Validates and saves. `version` must be the one that was loaded: otherwise 409 (somebody saved in the meantime)."""
        ensure_table_once()
        sent_version = _version_of(payload)
        value = validate(payload)
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT value FROM admin_ui_settings WHERE key = %s FOR UPDATE", (PANEL_KEY,))
            row = cursor.fetchone()
            stored_version = int((row[0] or {}).get("version", 0)) if row else 0
            if sent_version != stored_version:
                conn.rollback()
                raise _bad("version_conflict", "The panel settings were changed by someone else. Reload and try again.", status=409,
                           current_version=stored_version)
            value["version"] = stored_version + 1
            if row:
                cursor.execute("UPDATE admin_ui_settings SET value = %s, updated_at = NOW() WHERE key = %s", (PgJson(value), PANEL_KEY))
            else:
                cursor.execute(
                    "INSERT INTO admin_ui_settings (key, value) VALUES (%s, %s) ON CONFLICT (key) DO NOTHING", (PANEL_KEY, PgJson(value)))
                if cursor.rowcount != 1:                       # somebody inserted the first one at the same moment
                    conn.rollback()
                    raise _bad("version_conflict", "The panel settings were changed by someone else. Reload and try again.", status=409,
                               current_version=1)
            conn.commit()
            return value
        except HTTPException:
            raise
        except Exception as error:
            conn.rollback()
            raise HTTPException(status_code=500, detail=f"Could not save the panel settings ({type(error).__name__}).") from error
        finally:
            cursor.close()
            conn.close()

    @app.delete("/admin/ui-settings", dependencies=admin)
    def delete_ui_settings():
        """Back to the original panel: the row is removed."""
        ensure_table_once()
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("DELETE FROM admin_ui_settings WHERE key = %s", (PANEL_KEY,))
            deleted = cursor.rowcount > 0
            conn.commit()
            return {"deleted": deleted}
        finally:
            cursor.close()
            conn.close()

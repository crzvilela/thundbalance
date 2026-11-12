"""Size limits of the landing page content (PUT /landing-page/content/draft, /publish, /footer).

The editor sends the whole content as one JSON document. Only the admin can save it, but nothing stopped a document of hundreds of
megabytes, a list of a million items or a nesting that makes every reader slow. The limits below are generous: the content of today is
about 16 KB, 8 levels deep, lists of at most 5 items, texts of at most 300 characters (see test_landing_limits.py, which also checks that
the default content and the stored one pass). Raises HTTP 422 with a clear message in Spanish and English.
LANDING_LIMITS=off switches them off (emergency only).
"""
import json
import os

from fastapi import HTTPException

MAX_BYTES = 128 * 1024        # the whole document (today ~16 KB)
MAX_DEPTH = 12                # levels of nesting (today 8)
MAX_LIST = 100                # items in one list (today 5)
MAX_KEYS = 200                # keys in one object (today 16)
MAX_KEY = 100                 # characters of a key
MAX_STRING = 2000             # characters of a text (today 279)
MAX_URL = 500                 # characters of an address / link / image path (today 114)
URL_STARTS = ("http://", "https://", "/uploads/", "data:", "mailto:", "tel:")


def enabled():
    return os.getenv("LANDING_LIMITS", "").strip().lower() not in ("off", "false", "0", "no")


def _refuse(code, message_es, message_en, path):
    shown = path or "content"
    raise HTTPException(status_code=422, detail={"code": code, "message": f"{message_es} / {message_en}", "path": shown[:200]})


def _path(parts):
    return ".".join(str(part) for part in parts)


def validate_structure(content, what="content"):
    """Raises 422 when `content` (any JSON value) is too big, too deep, or holds a list, object or text over the limits."""
    if not enabled():
        return content
    size = len(json.dumps(content, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    if size > MAX_BYTES:
        _refuse("landing_too_large", f"El contenido es demasiado grande ({size // 1024} KB; máximo {MAX_BYTES // 1024} KB).",
                f"The content is too large ({size // 1024} KB; the limit is {MAX_BYTES // 1024} KB).", what)
    stack = [(content, 1, [what])]
    while stack:
        value, depth, path = stack.pop()
        if depth > MAX_DEPTH:
            _refuse("landing_too_deep", f"El contenido tiene demasiados niveles (máximo {MAX_DEPTH}).",
                    f"The content is nested too deeply (the limit is {MAX_DEPTH} levels).", _path(path))
        if isinstance(value, dict):
            if len(value) > MAX_KEYS:
                _refuse("landing_too_many_items", f"Un bloque tiene demasiados campos (máximo {MAX_KEYS}).",
                        f"A block has too many fields (the limit is {MAX_KEYS}).", _path(path))
            for key, item in value.items():
                if len(str(key)) > MAX_KEY:
                    _refuse("landing_text_too_long", f"Un nombre de campo supera {MAX_KEY} caracteres.",
                            f"A field name is longer than {MAX_KEY} characters.", _path(path))
                stack.append((item, depth + 1, path + [key]))
        elif isinstance(value, list):
            if len(value) > MAX_LIST:
                _refuse("landing_too_many_items", f"Una lista tiene demasiados elementos (máximo {MAX_LIST}).",
                        f"A list has too many items (the limit is {MAX_LIST}).", _path(path))
            for index, item in enumerate(value):
                stack.append((item, depth + 1, path + [index]))
        elif isinstance(value, str):
            limit = MAX_URL if value.startswith(URL_STARTS) else MAX_STRING
            if len(value) > limit:
                _refuse("landing_text_too_long", f"Un texto o enlace supera {limit} caracteres.",
                        f"A text or link is longer than {limit} characters.", _path(path))
    return content

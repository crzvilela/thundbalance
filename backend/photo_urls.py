"""Which addresses may be saved as a client's photo (users.foto).

The admin panel and the client area show users.foto as an image. If a client could save ANY address there, the browser of whoever
opens the panel would call that server (a tracking pixel: "the admin looked at the panel just now"). So only two kinds of address are
kept, everything else is ignored:
  - a file of our own uploads:  /uploads/<name>   (also with the address of our own API in front of it);
  - a photo of a Google account: https://lh3.googleusercontent.com/...   (what Google sign-in gives).
The Content-Security-Policy of the site (vercel.json) allows images from the same two places and nothing else.
"""
import logging
import os
import re
from urllib.parse import urlparse

from database import get_connection
from safe_log import safe_error

logger = logging.getLogger("thundbalance.photos")

MAX_LENGTH = 500
UPLOAD_PATH = re.compile(r"^/uploads/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$")
GOOGLE_PHOTO_HOST = re.compile(r"^lh[0-9]+\.googleusercontent\.com$")
OWN_API_HOSTS = {"thundbalance.onrender.com", "thundbalance-api.onrender.com"}
LOCAL_HOSTS = {"localhost", "127.0.0.1"}


def own_hosts():
    """The hosts of our own API: the production ones, the ones named in PUBLIC_API_URL / CORS_ORIGINS-free settings, and localhost while
    developing."""
    hosts = set(OWN_API_HOSTS)
    extra = urlparse(os.getenv("PUBLIC_API_URL", "").strip()).hostname
    if extra:
        hosts.add(extra.lower())
    if (os.getenv("ENV") or os.getenv("ENVIRONMENT") or "").strip().lower() in ("dev", "development", "local"):
        hosts |= LOCAL_HOSTS
    return hosts


def clean_photo_url(value):
    """The address if it may be saved as a photo, else None (the field is ignored: the registration still works)."""
    text = str(value or "").strip()
    if not text or len(text) > MAX_LENGTH or any(ord(char) < 33 or ord(char) == 127 for char in text):
        return None
    if text.startswith("/"):
        return text if UPLOAD_PATH.match(text) else None          # "//host/..." is not a path of ours
    try:
        parsed = urlparse(text)
        host = (parsed.hostname or "").lower()
        port = parsed.port
    except ValueError:
        return None
    if parsed.username is not None or parsed.password is not None or not host:
        return None
    if parsed.scheme == "https" and port is None and GOOGLE_PHOTO_HOST.match(host):
        return text
    if host in own_hosts() and parsed.scheme in ("https", "http") and UPLOAD_PATH.match(parsed.path) and not parsed.query:
        if parsed.scheme == "http" and host not in LOCAL_HOSTS:
            return None
        return text
    return None


def clean_stored_photos():
    """Run at startup (idempotent): a saved address that would not be accepted today is emptied. A photo of our own uploads is never
    touched. Returns the number of addresses emptied (only the count is logged)."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id, foto FROM users WHERE foto IS NOT NULL AND foto <> ''")
        bad = [row[0] for row in cursor.fetchall() if clean_photo_url(row[1]) is None]
        if bad:
            cursor.execute("UPDATE users SET foto = NULL WHERE id = ANY(%s)", (bad,))
        conn.commit()
        if bad:
            logger.info("op=clean_stored_photos emptied=%d", len(bad))
        return len(bad)
    except Exception as error:  # noqa: BLE001
        conn.rollback()
        logger.error("op=clean_stored_photos error=%s", safe_error(error))
        return 0
    finally:
        cursor.close()
        conn.close()

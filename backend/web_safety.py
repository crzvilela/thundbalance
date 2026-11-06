"""Protections of the API that do not belong to one feature.

- security headers on every answer (and a locked-down policy on the uploaded files);
- a small per-IP rate limit on the public routes that work with a link token;
- uploaded images kept in the database (the disk of the host is wiped at each deploy) and served from /uploads/{name};
- the same content check for every image upload;
- optional error reporting (Sentry) when SENTRY_DSN is set. No personal data is sent.
"""
import logging
import mimetypes
import os
import threading
import time

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse, Response

from database import get_connection

logger = logging.getLogger("thundbalance.safety")

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
}
# Whatever is served from /uploads can never run a script or load anything, even if the file is not what it says it is.
UPLOAD_HEADERS = {"Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'none'; sandbox"}

IMAGE_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif"}
# Not allowed: .svg (it can carry scripts).


# ----------------------------------------------------------------------------------------------- rate limit
class RateLimit:
    """Sliding window per key, in memory (one process: enough to stop a script from guessing links)."""

    def __init__(self, limit, window_seconds):
        self.limit, self.window = limit, window_seconds
        self.hits = {}
        self.lock = threading.Lock()

    def too_many(self, key):
        now = time.monotonic()
        with self.lock:
            recent = [moment for moment in self.hits.get(key, []) if now - moment < self.window]
            if len(recent) >= self.limit:
                self.hits[key] = recent
                return True
            recent.append(now)
            self.hits[key] = recent
            if len(self.hits) > 5000:                      # never grows without limit
                for stale in [name for name, moments in self.hits.items() if not moments or now - moments[-1] > self.window]:
                    self.hits.pop(stale, None)
            return False


# the public routes that act on a link token: nobody needs more than a few tries per minute
TOKEN_PREFIXES = ("/trial-sessions/confirmation/", "/reschedule-response/")
token_limit = RateLimit(limit=int(os.getenv("TOKEN_RATE_LIMIT", "40")), window_seconds=300)


def client_ip(request):
    forwarded = request.headers.get("x-forwarded-for", "")
    return (forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "")) or "unknown"


def register_safety(app):
    @app.middleware("http")
    async def safety(request: Request, call_next):
        path = request.url.path
        if path.startswith(TOKEN_PREFIXES) and token_limit.too_many(client_ip(request)):
            return JSONResponse({"detail": "Too many requests. Please try again in a few minutes."}, status_code=429,
                                headers={"Retry-After": "300", **SECURITY_HEADERS})
        response = await call_next(request)
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        if path.startswith("/uploads/"):
            for name, value in UPLOAD_HEADERS.items():
                response.headers[name] = value
        return response


# ----------------------------------------------------------------------------------------------- images
def check_image(filename, contents):
    """The extension of a valid image (jpg, png, webp or gif), checked against the first bytes of the file. HTTP 400 otherwise."""
    extension = os.path.splitext(filename or "")[1].lower()
    if extension not in IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Use a JPG, PNG, WebP or GIF image")
    head = contents[:12]
    valid = (
        (extension in (".jpg", ".jpeg") and head.startswith(b"\xff\xd8\xff"))
        or (extension == ".png" and head.startswith(b"\x89PNG\r\n\x1a\n"))
        or (extension == ".webp" and head[:4] == b"RIFF" and head[8:12] == b"WEBP")
        or (extension == ".gif" and head[:4] == b"GIF8")
    )
    if not contents or not valid:
        raise HTTPException(status_code=400, detail="Invalid image file")
    return extension


# ----------------------------------------------------------------------------------------------- stored files
def ensure_upload_table():
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS uploaded_files (
                name TEXT PRIMARY KEY,
                content_type TEXT NOT NULL,
                data BYTEA NOT NULL,
                size INTEGER NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """
        )
        conn.commit()
    finally:
        cursor.close()
        conn.close()


def save_upload(name, contents):
    """Keeps an uploaded image in the database under `name` (<uuid>.<ext>) and returns its public path."""
    content_type = IMAGE_TYPES.get(os.path.splitext(name)[1].lower(), "application/octet-stream")
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO uploaded_files (name, content_type, data, size) VALUES (%s, %s, %s, %s) "
            "ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, content_type = EXCLUDED.content_type, size = EXCLUDED.size",
            (name, content_type, contents, len(contents)),
        )
        conn.commit()
    finally:
        cursor.close()
        conn.close()
    return f"/uploads/{name}"


def register_upload_routes(app, upload_dir):
    @app.on_event("startup")
    def _ensure_uploads():
        try:
            ensure_upload_table()
        except Exception as error:  # noqa: BLE001
            logger.error("uploaded_files table could not be created: %s", type(error).__name__)

    # Declared BEFORE the static mount, so the database wins; old files (and videos) still come from the disk.
    @app.get("/uploads/{name}")
    def serve_upload(name: str):
        if "/" in name or "\\" in name or name.startswith("."):
            raise HTTPException(status_code=404, detail="Not found")
        try:
            conn = get_connection()
            cursor = conn.cursor()
            try:
                cursor.execute("SELECT content_type, data FROM uploaded_files WHERE name = %s", (name,))
                row = cursor.fetchone()
            finally:
                cursor.close()
                conn.close()
        except Exception:  # noqa: BLE001 - the database is down: try the disk
            row = None
        if row:
            return Response(content=bytes(row[1]), media_type=row[0], headers={"Cache-Control": "public, max-age=31536000, immutable"})
        path = os.path.join(upload_dir, name)
        if os.path.isfile(path):
            from fastapi.responses import FileResponse
            return FileResponse(path, media_type=mimetypes.guess_type(path)[0] or "application/octet-stream")
        raise HTTPException(status_code=404, detail="Not found")


# ----------------------------------------------------------------------------------------------- error reporting
def start_error_reporting():
    dsn = os.getenv("SENTRY_DSN", "").strip()
    if not dsn:
        return False
    try:
        import sentry_sdk
    except ImportError:
        logger.warning("SENTRY_DSN is set but sentry-sdk is not installed")
        return False
    sentry_sdk.init(
        dsn=dsn, environment=os.getenv("SENTRY_ENVIRONMENT", "production"),
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0")),
        send_default_pii=False,                      # no IPs, cookies, headers or bodies: they hold names and e-mails
        max_request_body_size="never",
    )
    logger.info("Error reporting: enabled")
    return True

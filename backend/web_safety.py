"""Protections of the API that do not belong to one feature.

- security headers on every answer (and a locked-down policy on the uploaded files);
- a small per-IP rate limit on the public routes that work with a link token;
- uploaded images kept in the database (the disk of the host is wiped at each deploy) and served from /uploads/{name};
- the same content check for every image upload;
- optional error reporting (Sentry) when SENTRY_DSN is set. No personal data is sent;
- the real client IP behind the proxy (get_client_ip), the CORS origins for production / development (cors_origins) and the content
  check of uploaded videos (check_video).
"""
import ipaddress
import logging
import mimetypes
import os
import threading
import uuid
import time

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

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

def env_int(name, default, minimum=1):
    """An integer setting from the environment (a bad or missing value is the default; never below `minimum`)."""
    try:
        value = int(os.getenv(name, "").strip() or default)
    except ValueError:
        value = default
    return max(minimum, value)


# ----------------------------------------------------------------------------------------------- the client's IP
# How many proxies sit between the internet and this server AND append to X-Forwarded-For (Render's: 1 by default). Every proxy adds
# the address it received the request from at the END of the header, so the entries on the left can be written by the client (anyone can
# send "X-Forwarded-For: 1.2.3.4") and only the last `TRUSTED_PROXY_HOPS` entries are trustworthy. The client's address is therefore
# the entry that is `hops` from the end: the LAST one when there is one proxy, never the first. With 0 the header is ignored.
TRUSTED_PROXY_HOPS = env_int("TRUSTED_PROXY_HOPS", 1, minimum=0)
_chain_logged = False


def get_client_ip(request, hops=None):
    """THE client address every rate limit uses (one function, so no limiter trusts the header differently):
    the entry `hops` from the end of X-Forwarded-For (the one the proxy appended), else the address of the connection. An entry that is
    not an IP address is never used. Returns "unknown" when there is nothing."""
    global _chain_logged
    hops = TRUSTED_PROXY_HOPS if hops is None else hops
    peer = (request.client.host if request.client else "") or "unknown"
    entries = [part.strip() for part in request.headers.get("x-forwarded-for", "").split(",") if part.strip()]
    if not _chain_logged and entries:
        _chain_logged = True
        logger.info("X-Forwarded-For arrives with %d entries (TRUSTED_PROXY_HOPS=%d)", len(entries), hops)       # a count, never an address
    if hops >= 1 and len(entries) >= hops:
        try:
            return str(ipaddress.ip_address(entries[-hops]))
        except ValueError:
            pass
    return peer


# ----------------------------------------------------------------------------------------------- CORS
PRODUCTION_ORIGIN = "https://thundbalance.vercel.app"
DEVELOPMENT_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173")


def is_development():
    """True only when ENV / ENVIRONMENT says so (dev, development, local). Not set = production."""
    value = (os.getenv("ENV") or os.getenv("ENVIRONMENT") or "").strip().lower()
    return value in ("dev", "development", "local")


def _is_local_origin(origin):
    host = origin.split("://", 1)[-1].split("/", 1)[0].rsplit("@", 1)[-1]
    host = host.rsplit(":", 1)[0] if not host.startswith("[") else host.split("]")[0] + "]"
    return host in ("localhost", "127.0.0.1", "[::1]", "0.0.0.0")


def cors_origins(extra=None, development=None):
    """The browser origins allowed to call this API: the production site plus the ones listed in CORS_ORIGINS (comma separated: the own
    domain when there is one); localhost / 127.0.0.1 only in development. Never "*" and never anything that is not http(s)."""
    development = is_development() if development is None else development
    raw = os.getenv("CORS_ORIGINS", "") if extra is None else extra
    origins = [PRODUCTION_ORIGIN]
    for item in str(raw).split(","):
        origin = item.strip().rstrip("/")
        if not origin or origin == "*" or not origin.startswith(("https://", "http://")):
            continue
        if _is_local_origin(origin) and not development:
            continue                                   # a localhost origin from the environment does not count in production either
        origins.append(origin)
    if development:
        origins.extend(DEVELOPMENT_ORIGINS)
    return list(dict.fromkeys(origins))


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


class SharedRateLimit:
    """Sliding window per key kept in the database (table rate_limit_hits), so the count survives a restart of the server and is
    the same for every instance. If the database does not answer it falls back to a window in memory: a limit that does not work
    must never take the site down."""

    def __init__(self, bucket, limit, window_seconds):
        self.bucket, self.limit, self.window = bucket, limit, window_seconds
        self._memory = RateLimit(limit, window_seconds)

    _table_ready = False

    def too_many(self, key):
        key = str(key)[:200]
        try:
            if not SharedRateLimit._table_ready:          # created on first use: it works even before the startup hook ran
                ensure_rate_limit_table()
                SharedRateLimit._table_ready = True
            conn = get_connection()
            try:
                cursor = conn.cursor()
                cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"{self.bucket}:{key}",))
                cursor.execute(
                    "DELETE FROM rate_limit_hits WHERE bucket = %s AND key = %s AND hit_at < NOW() - make_interval(secs => %s)",
                    (self.bucket, key, self.window),
                )
                cursor.execute("SELECT COUNT(*) FROM rate_limit_hits WHERE bucket = %s AND key = %s", (self.bucket, key))
                if cursor.fetchone()[0] >= self.limit:
                    conn.commit()
                    return True
                cursor.execute("INSERT INTO rate_limit_hits (bucket, key) VALUES (%s, %s)", (self.bucket, key))
                conn.commit()
                return False
            finally:
                conn.close()
        except Exception as error:  # noqa: BLE001
            logger.warning("rate limit '%s' used the memory window: %s", self.bucket, type(error).__name__)
            return self._memory.too_many(key)

    def clear(self):
        """Forgets every hit of this limit (tests)."""
        self._memory.hits.clear()
        try:
            conn = get_connection()
            try:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM rate_limit_hits WHERE bucket = %s", (self.bucket,))
                conn.commit()
            finally:
                conn.close()
        except Exception:  # noqa: BLE001
            pass


def ensure_rate_limit_table():
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS rate_limit_hits (id BIGSERIAL PRIMARY KEY, bucket TEXT NOT NULL, key TEXT NOT NULL, "
            "hit_at TIMESTAMP NOT NULL DEFAULT NOW())"
        )
        cursor.execute("CREATE INDEX IF NOT EXISTS rate_limit_hits_lookup ON rate_limit_hits (bucket, key, hit_at)")
        cursor.execute("DELETE FROM rate_limit_hits WHERE hit_at < NOW() - INTERVAL '1 day'")       # nothing older is ever needed
        conn.commit()
    finally:
        conn.close()


# the public routes that act on a link token: nobody needs more than a few tries per minute
TOKEN_PREFIXES = ("/trial-sessions/confirmation/", "/reschedule-response/")
token_limit = SharedRateLimit("token", limit=env_int("TOKEN_RATE_LIMIT", 40), window_seconds=env_int("TOKEN_RATE_WINDOW_SECONDS", 300))


def register_safety(app):
    @app.middleware("http")
    async def safety(request: Request, call_next):
        path = request.url.path
        if path == "/landing-page/upload-video" and request.method == "POST":
            # refused from the header, before the body is received (the multipart envelope adds a little to the file)
            try:
                declared = int(request.headers.get("content-length", "0") or 0)
            except ValueError:
                declared = 0
            if declared > MAX_VIDEO_BYTES + 2 * VIDEO_CHUNK_BYTES:
                return JSONResponse({"detail": f"Video is too large (max {MAX_VIDEO_BYTES // (1024 * 1024)} MB)"}, status_code=413,
                                    headers=SECURITY_HEADERS)
        if path.startswith(TOKEN_PREFIXES) and await run_in_threadpool(token_limit.too_many, get_client_ip(request)):
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


# ----------------------------------------------------------------------------------------------- videos
VIDEO_CONTENT_TYPES = {
    ".mp4": ("video/mp4", "video/x-m4v"),
    ".mov": ("video/quicktime",),
    ".webm": ("video/webm",),
}
_ISO_BOX_TYPES = (b"moov", b"mdat", b"wide", b"free", b"skip", b"pnot")       # a QuickTime file may start with one of these instead of "ftyp"


def video_kind(head):
    """What the first bytes of a file say it is: "iso" (MP4 / MOV: an "ftyp" box, or an old QuickTime atom), "webm" (the EBML header) or
    None. This is the file's own signature, not what the upload says about it."""
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return "webm"
    if len(head) >= 12 and head[4:8] == b"ftyp":
        return "iso"
    if len(head) >= 8 and head[4:8] in _ISO_BOX_TYPES:
        return "iso"
    return None


def check_video(filename, content_type, contents):
    """The extension of a valid video (mp4, mov or webm). The extension, the declared Content-Type and the real signature of the file
    (magic bytes) must agree: otherwise HTTP 415. A missing or generic Content-Type (application/octet-stream) is accepted when the
    extension and the signature agree: some browsers send nothing for .mov."""
    extension = os.path.splitext(filename or "")[1].lower()
    if extension not in VIDEO_CONTENT_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported video type: use MP4, MOV or WebM")
    kind = video_kind(bytes(contents[:16]))
    if kind is None or (kind == "webm") != (extension == ".webm"):
        raise HTTPException(status_code=415, detail="The file is not a valid video of the type its name says")
    declared = (content_type or "").split(";", 1)[0].strip().lower()
    if declared and declared != "application/octet-stream" and declared not in VIDEO_CONTENT_TYPES[extension]:
        raise HTTPException(status_code=415, detail="The declared content type does not match the video")
    return extension


MAX_VIDEO_BYTES = 300 * 1024 * 1024    # the largest video that can be uploaded
VIDEO_CHUNK_BYTES = 1024 * 1024        # the upload is read 1 MB at a time: a big file is never held in memory


async def store_video(file, upload_dir, max_bytes=None, chunk_size=None):
    """Stores an uploaded video in `upload_dir` and returns the stored file name (<uuid>.<ext>: the name sent by the user is never used).

    The file is read in chunks and written to a temporary file next to the final one; the type is checked on the first chunk (415) and
    the size while it grows (413 as soon as it passes `max_bytes`, without reading the rest). Only a valid video is moved to its final
    name; the temporary file is always removed when something fails. `file` is a Starlette UploadFile (filename, content_type, async read)."""
    max_bytes = MAX_VIDEO_BYTES if max_bytes is None else max_bytes
    chunk_size = VIDEO_CHUNK_BYTES if chunk_size is None else chunk_size
    extension = os.path.splitext(file.filename or "")[1].lower()
    if extension not in VIDEO_CONTENT_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported video type: use MP4, MOV or WebM")
    # hidden name: /uploads/{name} never serves a name that starts with a dot, so a half-written file can not be read
    temporary = os.path.join(upload_dir, f".upload-{uuid.uuid4().hex}.part")
    final_name = f"{uuid.uuid4().hex}{extension}"
    try:
        total = 0
        with open(temporary, "wb") as output:
            first = True
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                if first:
                    check_video(file.filename, file.content_type, chunk)        # the signature, on the first bytes (415)
                    first = False
                total += len(chunk)
                if total > max_bytes:
                    raise HTTPException(status_code=413, detail=f"Video is too large (max {max_bytes // (1024 * 1024)} MB)")
                output.write(chunk)
            if first:
                raise HTTPException(status_code=415, detail="The file is not a valid video of the type its name says")
        os.replace(temporary, os.path.join(upload_dir, final_name))
        temporary = None
        return final_name
    finally:
        if temporary and os.path.exists(temporary):
            try:
                os.remove(temporary)
            except OSError:
                logger.error("A temporary upload file could not be removed")


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
        # whose photo it is (a profile photo): when the client is deleted every photo of theirs goes, and a new photo replaces the old one
        cursor.execute("ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS owner_user_id INTEGER")
        cursor.execute("CREATE INDEX IF NOT EXISTS uploaded_files_owner ON uploaded_files (owner_user_id)")
        conn.commit()
    finally:
        cursor.close()
        conn.close()


_upload_table_ready = False


def delete_stored_photo(photo, upload_dir=None):
    """Removes the file a "/uploads/<name>" address points to, from the database and from the disk. Anything else is ignored."""
    text = str(photo or "")
    if not text.startswith("/uploads/"):
        return
    name = os.path.basename(text)
    if not name or name.startswith("."):
        return
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM uploaded_files WHERE name = %s", (name,))
        conn.commit()
    finally:
        cursor.close()
        conn.close()
    if upload_dir:
        path = os.path.join(upload_dir, name)
        try:
            if os.path.isfile(path):
                os.remove(path)
        except OSError:
            logger.error("A stored photo could not be removed from the disk")


def save_upload(name, contents, owner_user_id=None):
    """Keeps an uploaded image in the database under `name` (<uuid>.<ext>) and returns its public path. With `owner_user_id` (a profile
    photo) the image remembers whose it is and the owner's previous photos are removed: one photo per person."""
    global _upload_table_ready
    if not _upload_table_ready:
        ensure_upload_table()
        _upload_table_ready = True
    content_type = IMAGE_TYPES.get(os.path.splitext(name)[1].lower(), "application/octet-stream")
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO uploaded_files (name, content_type, data, size, owner_user_id) VALUES (%s, %s, %s, %s, %s) "
            "ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, content_type = EXCLUDED.content_type, size = EXCLUDED.size, "
            "owner_user_id = EXCLUDED.owner_user_id",
            (name, content_type, contents, len(contents), owner_user_id),
        )
        if owner_user_id is not None:
            cursor.execute("DELETE FROM uploaded_files WHERE owner_user_id = %s AND name <> %s", (owner_user_id, name))
        conn.commit()
    finally:
        cursor.close()
        conn.close()
    return f"/uploads/{name}"


def register_upload_routes(app, upload_dir):
    @app.on_event("startup")
    def _ensure_uploads():
        for name, create in (("uploaded_files", ensure_upload_table), ("rate_limit_hits", ensure_rate_limit_table)):
            try:
                create()
            except Exception as error:  # noqa: BLE001
                logger.error("%s table could not be created: %s", name, type(error).__name__)

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

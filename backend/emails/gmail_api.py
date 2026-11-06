"""The 'gmail_api' mail provider: emails leave from pt@thundbalance.com through the Gmail API (HTTPS, works on Render's free plan).

It uses the SAME service account as the Google Calendar, with domain-wide delegation: the credentials act as MAIL_FROM_EMAIL
(`with_subject`) with the scope https://www.googleapis.com/auth/gmail.send, and the message goes out with
users.messages.send(userId="me"). The delegation (scopes calendar + gmail.send) and the Gmail API are switched on in Google
Workspace, outside the code.

Environment variables (values are never logged):
  MAIL_PROVIDER     'gmail_api' | 'legacy' (default 'legacy': the Apps Script, until this one has been validated)
  MAIL_FROM_EMAIL   pt@thundbalance.com  (also the identity of the delegation)
  MAIL_FROM_NAME    ThundBalance
  MAIL_REPLY_TO     pt@thundbalance.com

The message is multipart/alternative (plain text + HTML) inside multipart/mixed when it carries an attachment (the .ics), with
the subject and the sender name encoded as UTF-8 (accents, ñ, ç), a Message-ID at thundbalance.com and the extra recipients in Bcc.

Nothing here logs a recipient, a name, a subject or a body: only the TYPE of an error. A temporary error (429, 5xx, the network)
is retried with a growing wait. When Google refuses the delegation (not switched on yet) the result says "delegation" and the
central sender (transport.send_email) uses the legacy provider for that email instead, remembering it for the admin's warning.
"""
import base64
import logging
import os
import socket
import threading
import time
from email import encoders
from email.header import Header
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, formatdate, make_msgid

logger = logging.getLogger("thundbalance.emails")

SCOPE = "https://www.googleapis.com/auth/gmail.send"
PROVIDERS = ("gmail_api", "legacy")
DEFAULT_FROM = "pt@thundbalance.com"
DEFAULT_NAME = "ThundBalance"
MESSAGE_ID_DOMAIN = "thundbalance.com"
TIMEOUT_SECONDS = 15
BACKOFF_SECONDS = (1.0, 3.0, 8.0)          # waits before the 2nd, 3rd and 4th attempt of a temporary error
DELEGATION_RETRY_SECONDS = 300             # after a refusal the delegation is not asked again for this long
MAX_MESSAGE_BYTES = 20 * 1024 * 1024


def _env(name, default=""):
    value = os.getenv(name, "").strip().strip("'\"").strip()
    return value or default


def provider():
    """'gmail_api' or 'legacy' (anything else, or nothing, is 'legacy')."""
    value = _env("MAIL_PROVIDER").lower()
    return value if value in PROVIDERS else "legacy"


def from_email():
    return _env("MAIL_FROM_EMAIL", DEFAULT_FROM)


def from_name():
    return _env("MAIL_FROM_NAME", DEFAULT_NAME)


def reply_to_default():
    return _env("MAIL_REPLY_TO", DEFAULT_FROM)


# ---------------------------------------------------------------------------------------------- the message
def build_message(to, subject, html, text, reply_to=None, attachments=None, cc=None, bcc=None):
    """The raw RFC 822 message (bytes). `to`, `cc`, `bcc` are lists of already validated addresses."""
    alternative = MIMEMultipart("alternative")
    alternative.attach(MIMEText(text or "", "plain", "utf-8"))
    alternative.attach(MIMEText(html or "", "html", "utf-8"))
    if attachments:
        message = MIMEMultipart("mixed")
        message.attach(alternative)
        for item in attachments:
            data = item["data"] if isinstance(item["data"], bytes) else str(item["data"]).encode("utf-8")
            maintype, _, subtype = str(item.get("content_type", "application/octet-stream")).partition("/")
            part = MIMEBase(maintype or "application", (subtype or "octet-stream").split(";")[0])
            if "method=" in str(item.get("content_type", "")).lower():
                part.set_param("method", str(item["content_type"]).lower().split("method=")[1].split(";")[0].strip().upper())
            part.set_payload(data)
            encoders.encode_base64(part)
            part.add_header("Content-Disposition", "attachment", filename=str(item["filename"]))
            message.attach(part)
    else:
        message = alternative
    message["From"] = formataddr((str(Header(from_name(), "utf-8")), from_email()))
    message["To"] = ", ".join(to)
    if cc:
        message["Cc"] = ", ".join(cc)
    if bcc:
        message["Bcc"] = ", ".join(bcc)                       # Gmail delivers to Bcc and removes the header from the copies
    message["Reply-To"] = reply_to or reply_to_default()
    message["Subject"] = str(Header(subject, "utf-8"))
    message["Date"] = formatdate(localtime=False)
    message["Message-ID"] = make_msgid(domain=MESSAGE_ID_DOMAIN)
    return message.as_bytes()


def encode(raw):
    """base64url, as users.messages.send wants it."""
    return base64.urlsafe_b64encode(raw).decode("ascii")


# ---------------------------------------------------------------------------------------------- credentials and client
_lock = threading.Lock()
_cache = {"base": None, "subject": None, "credentials": None}
_local = threading.local()
_delegation = {"failed_at": None, "error": None}        # a refusal of the delegation, remembered for a while
_fallback = {"active": False, "error": None, "at": None}  # for the admin's warning: the last email went the old way


def _credentials():
    """The service account acting as MAIL_FROM_EMAIL with the gmail.send scope (cached until the key or the identity change)."""
    import google_calendar                                    # the same service account as the calendar
    base = google_calendar._shared_credentials()
    subject = from_email()
    with _lock:
        if _cache["base"] is not base or _cache["subject"] != subject:
            _cache.update(base=base, subject=subject, credentials=base.with_scopes([SCOPE]).with_subject(subject))
            _local.__dict__.clear()
        return _cache["credentials"]


def _service():
    import google_auth_httplib2
    import httplib2
    from googleapiclient.discovery import build
    credentials = _credentials()
    if getattr(_local, "credentials", None) is not credentials or getattr(_local, "service", None) is None:
        http = google_auth_httplib2.AuthorizedHttp(credentials, http=httplib2.Http(timeout=TIMEOUT_SECONDS))
        _local.service = build("gmail", "v1", http=http, cache_discovery=False)
        _local.credentials = credentials
    return _local.service


def reset():
    """Forgets the cached credentials, client and remembered refusals (tests, or after the key / identity changed)."""
    with _lock:
        _cache.update(base=None, subject=None, credentials=None)
        _delegation.update(failed_at=None, error=None)
        _fallback.update(active=False, error=None, at=None)
    _local.__dict__.clear()


# ---------------------------------------------------------------------------------------------- errors
def classify(error):
    """A short SAFE code for a failure (never a message, an address or a token):
    'delegation'  Google refuses to act as the sender (delegation / scope not switched on, Gmail API off): use the legacy provider
    'rejected'    Gmail refused this message (a bad header or address: the caller may retry without the Bcc)
    'timeout' | 'unreachable' | 'http_<status>'   transport problems."""
    from google.auth.exceptions import RefreshError, TransportError
    from googleapiclient.errors import HttpError
    if isinstance(error, RefreshError):
        return "delegation"
    if isinstance(error, HttpError):
        status = int(getattr(getattr(error, "resp", None), "status", 0) or 0)
        if status in (401, 403):
            return "delegation"
        if status == 400:
            text = str(getattr(error, "reason", "") or "") + " " + str(getattr(error, "error_details", "") or "")
            return "delegation" if "failedprecondition" in text.lower().replace(" ", "") else "rejected"
        return f"http_{status}" if status else "unreachable"
    if isinstance(error, (TimeoutError, socket.timeout)):
        return "timeout"
    if isinstance(error, (TransportError, OSError, ConnectionError)) or type(error).__name__ in ("ServerNotFoundError", "HttpLib2Error"):
        return "unreachable"
    return "error"


def _temporary(code):
    return code == "unreachable" or code == "http_429" or (code.startswith("http_5") and code[5:].isdigit())


# ---------------------------------------------------------------------------------------------- sending
def deliver(to, subject, html, text, reply_to=None, attachments=None, cc=None, bcc=None, sleep=None):
    """Sends one message through the Gmail API. Returns (ok, error): error is '' or a code from classify() / 'invalid_input'.
    Never raises. A temporary error is retried with BACKOFF_SECONDS; a refused delegation is remembered for
    DELEGATION_RETRY_SECONDS so the next emails do not wait for Google again."""
    now = time.monotonic()
    failed_at = _delegation["failed_at"]
    if failed_at is not None and now - failed_at < DELEGATION_RETRY_SECONDS:
        return False, "delegation"
    try:
        raw = build_message(to, subject, html, text, reply_to, attachments, cc, bcc)
    except Exception as error:  # noqa: BLE001 - a bad header, an attachment without data...
        logger.error("Email could not be built (%s)", type(error).__name__)
        return False, "invalid_input"
    if len(raw) > MAX_MESSAGE_BYTES:
        return False, "invalid_input"
    body = {"raw": encode(raw)}
    attempt = 0
    while True:
        try:
            _service().users().messages().send(userId="me", body=body).execute()
            _delegation.update(failed_at=None, error=None)
            return True, ""
        except Exception as error:  # noqa: BLE001 - mail problems never propagate
            code = classify(error)
            if code == "delegation":
                _delegation.update(failed_at=time.monotonic(), error=type(error).__name__)
                logger.error("Gmail API refused the delegation (%s)", type(error).__name__)
                return False, "delegation"
            if _temporary(code) and attempt < len(BACKOFF_SECONDS):
                logger.warning("Gmail API temporary error (%s); retrying", code)
                (sleep or time.sleep)(BACKOFF_SECONDS[attempt])
                attempt += 1
                continue
            logger.error("Gmail API send failed (%s)", code)
            return False, code


# ---------------------------------------------------------------------------------------------- the admin's warning
def note_fallback(error="delegation"):
    """The last email had to go the old way: the admin sees "Envío por dominio no configurado"."""
    _fallback.update(active=True, error=error, at=time.time())


def clear_fallback():
    _fallback.update(active=False, error=None, at=None)


def status():
    """{"provider", "from", "fallback_active", "fallback_error"} for the panel. No secret, no recipient."""
    return {
        "provider": provider(), "from": from_email(),
        "fallback_active": bool(_fallback["active"]) and provider() == "gmail_api", "fallback_error": _fallback["error"],
    }

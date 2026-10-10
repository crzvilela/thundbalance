"""Sending: the same method the trial-request notice already used.

The backend posts JSON to a Google Apps Script web app (docs/trial-email.gs),
which sends the message with GmailApp from mailsthundbalance@gmail.com. This
works on Render's free plan, which blocks SMTP. Environment variables (the
same ones as before, values never logged):

  TRIAL_EMAIL_WEBHOOK_URL     the Apps Script web app URL. Unset = nothing is sent.
  TRIAL_EMAIL_WEBHOOK_SECRET  shared secret the script checks.

A failed send never raises: send_email() returns an EmailResult and
send_email_async() runs it on a small worker pool, so an email problem can not
break the request that triggered it.
"""
import base64
import json
import logging
import os
import re
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from . import log as email_log

logger = logging.getLogger("thundbalance.emails")

SENDER_NAME = "ThundBalance"
DEFAULT_REPLY_TO = "info@thundbalance.com"
MAX_SUBJECT = 200
MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024

_ADDRESS = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$")
_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="email")


@dataclass(frozen=True)
class EmailResult:
    ok: bool
    error: str = ""   # short, safe reason; never contains addresses, URLs or secrets

    def __bool__(self):
        return self.ok


def _clean_header(value, label):
    text = str(value or "").strip()
    if "\r" in text or "\n" in text or "\x00" in text:
        raise ValueError(f"{label} contains a line break")
    return text


def validate_address(value, label="address"):
    text = _clean_header(value, label)
    if len(text) > 254 or not _ADDRESS.match(text):
        raise ValueError(f"{label} is not a valid email address")
    return text


def _addresses(value, label):
    if not value:
        return []
    items = [value] if isinstance(value, str) else list(value)
    return [validate_address(item, label) for item in items]


def mask(address):
    """a***@example.com, for logs."""
    name, _, domain = str(address).partition("@")
    return f"{name[:1]}***@{domain}" if domain else "***"


def build_payload(to, subject, html, text, reply_to=None, attachments=None, cc=None, extra=None, language=None):
    """Validated JSON for the Apps Script. Raises ValueError on bad input."""
    recipients = _addresses(to, "to")
    if not recipients:
        raise ValueError("to is empty")
    subject = _clean_header(subject, "subject")
    if not subject or len(subject) > MAX_SUBJECT:
        raise ValueError("subject is empty or too long")
    files = []
    for item in attachments or []:
        data = item["data"] if isinstance(item["data"], bytes) else str(item["data"]).encode("utf-8")
        if len(data) > MAX_ATTACHMENT_BYTES:
            raise ValueError("attachment too large")
        files.append({
            "name": _clean_header(item["filename"], "attachment name"),
            "type": _clean_header(item.get("content_type", "application/octet-stream"), "attachment type"),
            "data": base64.b64encode(data).decode("ascii"),
        })
    payload = {
        "secret": os.getenv("TRIAL_EMAIL_WEBHOOK_SECRET", "").strip(),
        "to": ",".join(recipients),
        "cc": ",".join(_addresses(cc, "cc")),
        "subject": subject,
        "html": html,
        "text": text,
        "replyTo": validate_address(reply_to or DEFAULT_REPLY_TO, "reply_to"),
        "name": SENDER_NAME,
        "attachments": files,
    }
    if language:
        payload["language"] = _clean_header(language, "language")[:5]
    if extra:
        payload.update(extra)
    return payload


def _deliver(to, subject, html, text, reply_to=None, attachments=None, cc=None, extra=None, kind="", lang=""):
    """Does the sending (see send_email). Returns an EmailResult; never raises."""
    url = os.getenv("TRIAL_EMAIL_WEBHOOK_URL", "").strip()
    if not url:
        logger.warning("Email not sent: TRIAL_EMAIL_WEBHOOK_URL is not set")
        return EmailResult(False, "not_configured")
    try:
        payload = build_payload(to, subject, html, text, reply_to, attachments, cc, extra, language=lang if lang in ("en", "es", "ca") else None)
    except (ValueError, KeyError, TypeError) as error:
        logger.error("Email rejected before sending: %s", error)
        return EmailResult(False, "invalid_input")

    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        logger.error("Email service answered HTTP %s", error.code)
        return EmailResult(False, f"http_{error.code}")
    except Exception as error:  # noqa: BLE001 - an email problem must never propagate
        logger.error("Email service unreachable (%s)", type(error).__name__)
        return EmailResult(False, "unreachable")

    try:
        answer = json.loads(body)
    except ValueError:
        answer = {}
    if answer.get("ok") is True:
        # one line per email: type, language, truncated recipient (no content, no secrets)
        line = f"Email sent: kind={kind or '-'} lang={lang or '-'} to={mask(payload['to'].split(',')[0])}"
        print(line, flush=True)
        logger.info(line)
        return EmailResult(True)
    reason = str(answer.get("error") or "rejected")[:40]
    logger.error("Email service refused the message: %s", re.sub(r"[^\w .:-]", "", reason))
    return EmailResult(False, "rejected")


def send_email(to, subject, html, text, reply_to=None, attachments=None, cc=None, extra=None,
               kind="", lang="", reference=None):
    """Send now (blocking, up to 20 s) and report; never raises.

    kind / lang label the log line, and kind / reference (for example the trial
    session id) label the row written to email_log, which is added for every
    email with a kind: sent or failed, with a short error code.

    attachments: list of {"filename", "content_type", "data" (bytes)}.
    extra: additional JSON fields for the script (used to keep the old
    trial-notice format working until the script is updated).
    """
    result = _deliver(to, subject, html, text, reply_to, attachments, cc, extra, kind, lang)
    if kind:
        recipient = to if isinstance(to, str) else ",".join(str(item) for item in (to or []))
        email_log.record(kind, reference, recipient, result.ok, result.error)
    return result


def send_email_async(*args, on_done=None, **kwargs):
    """send_email() in the background. Returns a Future whose result is the
    EmailResult; on_done(result) is called when it finishes (use it to warn the admin)."""
    def run():
        result = send_email(*args, **kwargs)
        if on_done:
            try:
                on_done(result)
            except Exception:  # noqa: BLE001
                logger.exception("Email on_done callback failed")
        return result

    return _pool.submit(run)

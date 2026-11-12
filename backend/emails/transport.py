"""Sending: the same method the trial-request notice already used.

The backend posts JSON to a Google Apps Script web app (docs/trial-email.gs),
which sends the message with GmailApp from mailsthundbalance@gmail.com. This
works on Render's free plan, which blocks SMTP. Environment variables (the
same ones as before, values never logged):

  TRIAL_EMAIL_WEBHOOK_URL     the Apps Script web app URL. Unset = nothing is sent.
  TRIAL_EMAIL_WEBHOOK_SECRET  shared secret the script checks.

Two providers (MAIL_PROVIDER, see gmail_api.py): 'legacy' is the Apps Script above (the default, until the other has been
validated) and 'gmail_api' sends from pt@thundbalance.com through the Gmail API with the calendar's service account. With
'gmail_api', an email whose delegation is refused (not switched on yet) goes out by the legacy provider instead and the admin
sees a warning. send_email() is the one function every email goes through, with the same signature for both.

A failed send never raises: send_email() returns an EmailResult and
send_email_async() runs it on a small worker pool, so an email problem can not
break the request that triggered it.
"""
import base64
import json
import logging

from safe_log import log_error
import os
import re
import socket
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from . import gmail_api
from . import log as email_log

logger = logging.getLogger("thundbalance.emails")

SENDER_NAME = "ThundBalance"
DEFAULT_REPLY_TO = "pt@thundbalance.com"   # MAIL_REPLY_TO overrides it (gmail_api.reply_to_default)
MAX_SUBJECT = 200
MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024

# One automatic retry (so at most 2 attempts) for a failure that happened BEFORE
# the message was handed to Gmail, such as the script being unreachable or
# answering ok:false. A read timeout is not retried: the script may already have
# sent it, and a second send would be a duplicate.
RETRY_DELAY_SECONDS = 4.0
MAX_ATTEMPTS = 2
RETRYABLE = {"unreachable", "rejected", "http_429", "http_500", "http_502", "http_503", "http_504"}

_ADDRESS = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$")
_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="email")


@dataclass(frozen=True)
class EmailResult:
    ok: bool
    error: str = ""   # short, safe reason; never contains addresses, URLs or secrets
    bcc_dropped: bool = False   # the message went to its main recipient but NOT to the extra (BCC) ones
    provider: str = ""          # 'gmail_api' | 'legacy': the way this message actually left
    fallback: bool = False      # 'gmail_api' was wanted but the delegation is not active: it went by 'legacy'

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


def build_payload(to, subject, html, text, reply_to=None, attachments=None, cc=None, extra=None, language=None, bcc=None):
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
        "bcc": ",".join(_addresses(bcc, "bcc")),         # the extra recipients: hidden from the main recipient and from each other
        "subject": subject,
        "html": html,
        "text": text,
        "replyTo": validate_address(reply_to or gmail_api.reply_to_default(), "reply_to"),
        "name": gmail_api.from_name() or SENDER_NAME,
        "attachments": files,
    }
    if language:
        payload["language"] = _clean_header(language, "language")[:5]
    if extra:
        payload.update(extra)
    return payload


def _deliver(to, subject, html, text, reply_to=None, attachments=None, cc=None, extra=None, kind="", lang="", bcc=None):
    """Does the sending (see send_email). Returns an EmailResult; never raises."""
    url = os.getenv("TRIAL_EMAIL_WEBHOOK_URL", "").strip()
    if not url:
        logger.warning("Email not sent: TRIAL_EMAIL_WEBHOOK_URL is not set")
        return EmailResult(False, "not_configured")
    try:
        payload = build_payload(to, subject, html, text, reply_to, attachments, cc, extra, language=lang if lang in ("en", "es", "ca") else None, bcc=bcc)
    except (ValueError, KeyError, TypeError) as error:
        log_error(error, op="email_rejected", logger=logger)
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
        cause = getattr(error, "reason", error)
        if isinstance(cause, (TimeoutError, socket.timeout)):
            logger.error("Email service did not answer in time")
            return EmailResult(False, "timeout")
        logger.error("Email service unreachable (%s)", type(error).__name__)
        return EmailResult(False, "unreachable")

    try:
        answer = json.loads(body)
    except ValueError:
        # An HTML page instead of JSON: the script is not deployed for "anyone",
        # or Google asks for authorization again.
        logger.error("Email service answered something that is not JSON")
        return EmailResult(False, "invalid_response")
    if not isinstance(answer, dict):
        return EmailResult(False, "invalid_response")
    if answer.get("ok") is True:
        # one line per email: type, language, truncated recipient (no content, no secrets)
        line = f"Email sent: kind={kind or '-'} lang={lang or '-'} to={mask(payload['to'].split(',')[0])}"
        print(line, flush=True)
        logger.info(line)
        return EmailResult(True)
    reason = str(answer.get("error") or "rejected")[:40]
    logger.error("Email service refused the message: %s", re.sub(r"[^\w .:-]", "", reason))
    return EmailResult(False, "unauthorized" if reason == "unauthorized" else "rejected")


def _gmail_deliver(to, subject, html, text, reply_to, attachments, cc, bcc, kind, lang):
    """One attempt through the Gmail API. Returns an EmailResult (error 'delegation' = Google refuses to act as the sender)."""
    try:
        recipients = _addresses(to, "to")
        if not recipients:
            raise ValueError("to is empty")
        subject = _clean_header(subject, "subject")
        if not subject or len(subject) > MAX_SUBJECT:
            raise ValueError("subject is empty or too long")
        reply = validate_address(reply_to, "reply_to") if reply_to else None
        copies, blind = _addresses(cc, "cc"), _addresses(bcc, "bcc")
        files = [{"filename": _clean_header(item["filename"], "attachment name"),
                  "content_type": _clean_header(item.get("content_type", "application/octet-stream"), "attachment type"),
                  "data": item["data"]} for item in attachments or []]
    except (ValueError, KeyError, TypeError) as error:
        log_error(error, op="email_rejected", logger=logger)
        return EmailResult(False, "invalid_input", provider="gmail_api")
    ok, error = gmail_api.deliver(recipients, subject, html, text, reply, files, copies, blind)
    if ok:
        line = f"Email sent: kind={kind or '-'} lang={lang or '-'} via=gmail_api to={mask(recipients[0])}"
        print(line, flush=True)
        logger.info(line)
        return EmailResult(True, provider="gmail_api")
    return EmailResult(False, error, provider="gmail_api")


def _dispatch(to, subject, html, text, reply_to=None, attachments=None, cc=None, extra=None, kind="", lang="", bcc=None):
    """One attempt with the provider MAIL_PROVIDER names. With 'gmail_api' and a refused delegation, THIS email goes by the
    legacy provider and the fallback is remembered for the admin's warning (only the error type is logged)."""
    if gmail_api.provider() != "gmail_api":
        result = _deliver(to, subject, html, text, reply_to, attachments, cc, extra, kind, lang, bcc)
        return EmailResult(result.ok, result.error, result.bcc_dropped, "legacy", False)
    result = _gmail_deliver(to, subject, html, text, reply_to, attachments, cc, bcc, kind, lang)
    if result.error == "delegation":
        gmail_api.note_fallback("delegation")
        logger.warning("Email goes by the legacy provider (the domain delegation is not active)")
        legacy = _deliver(to, subject, html, text, reply_to, attachments, cc, extra, kind, lang, bcc)
        return EmailResult(legacy.ok, legacy.error, legacy.bcc_dropped, "legacy", True)
    if result.ok:
        gmail_api.clear_fallback()
    return result


def send_email(to, subject, html, text, reply_to=None, attachments=None, cc=None, extra=None,
               kind="", lang="", reference=None, bcc=None):
    """Send now (blocking, up to 20 s) and report; never raises.

    kind / lang label the log line, and kind / reference (for example the trial
    session id) label the row written to email_log, which is added for every
    email with a kind: sent or failed, with a short error code.

    attachments: list of {"filename", "content_type", "data" (bytes)}.
    bcc: extra recipients added by the admin, in blind copy. If the message is refused WITH them, it is sent once more
    WITHOUT them, so a problem with an extra address never stops the main recipient from getting it
    (the result says bcc_dropped).
    extra: additional JSON fields for the script (used to keep the old
    trial-notice format working until the script is updated).
    """
    result = _dispatch(to, subject, html, text, reply_to, attachments, cc, extra, kind, lang, bcc)
    attempts = 1
    # a refusal WITH extra recipients is not retried as it is: it goes straight to the fallback below (without them)
    while not result.ok and result.error in RETRYABLE and attempts < MAX_ATTEMPTS and not (bcc and result.error == "rejected") and result.provider != "gmail_api":
        logger.warning("Email attempt %s failed (%s); retrying once", attempts, result.error)
        time.sleep(RETRY_DELAY_SECONDS)
        attempts += 1
        result = _dispatch(to, subject, html, text, reply_to, attachments, cc, extra, kind, lang, bcc)
    if not result.ok and bcc and result.error in ("rejected", "invalid_input"):
        logger.warning("Email refused with extra recipients (%s); sending it without them", result.error)
        result = _dispatch(to, subject, html, text, reply_to, attachments, cc, extra, kind, lang, None)
        if result.ok:
            result = EmailResult(True, bcc_dropped=True, provider=result.provider, fallback=result.fallback)
    if kind:
        recipient = to if isinstance(to, str) else ",".join(str(item) for item in (to or []))
        email_log.record(kind, reference, recipient, result.ok, result.error, lang=lang or None)
    return result


def send_email_async(*args, on_done=None, **kwargs):
    """send_email() in the background. Returns a Future whose result is the
    EmailResult; on_done(result) is called when it finishes (use it to warn the admin)."""
    def run():
        result = send_email(*args, **kwargs)
        if on_done:
            try:
                on_done(result)
            except Exception as callback_error:  # noqa: BLE001
                log_error(callback_error, op="email_on_done", logger=logger)
        return result

    return _pool.submit(run)

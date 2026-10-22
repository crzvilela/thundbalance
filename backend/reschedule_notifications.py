"""Sends the reschedule-request emails and tells the caller how it went.

Same transport as every other email (the Google Apps Script web app, TRIAL_EMAIL_WEBHOOK_URL) and
the same rules: sending runs in the background, every message is written to email_log, and a
failure NEVER breaks the request: the caller gets {"sent": False, "problem": ...} so the panel can
warn and offer "reenviar".

Every sender takes the context dict of reschedule_requests and returns a Future (or None when the
e-mail is not configured).
"""
import logging
import os

from client_lang import resolve_client_lang
from emails import send_email_async
from emails.reschedule_emails import (
    client_reschedule_approved, client_reschedule_counter, client_reschedule_rejected, client_session_moved,
    language_of, staff_counter_answer, staff_reschedule_requested,
)
from emails.transport import validate_address
from trial_notifications import studio_address

logger = logging.getLogger("thundbalance.reschedule")
WAIT_SECONDS = 25


def _configured():
    return bool(os.getenv("TRIAL_EMAIL_WEBHOOK_URL", "").strip())


def _staff(build, ctx, kind):
    if not _configured():
        return None
    try:
        subject, html, text = build()
        try:
            reply_to = validate_address(ctx.get("client_email"), "reply_to")
        except ValueError:
            reply_to = None
        return send_email_async(studio_address(), subject, html, text, reply_to=reply_to, kind=kind, lang="es", reference=ctx.get("id"))
    except Exception as error:  # noqa: BLE001 - never break the request
        logger.error("studio email %s could not be built (%s)", kind, type(error).__name__)
        return None


def _client(build, ctx, kind):
    if not _configured():
        return None
    try:
        to = validate_address(ctx.get("client_email"), "client email")
        ctx["lang"] = resolve_client_lang(booking_lang=ctx.get("lang"), email=to)     # the request's own, else the profile's, else English
        subject, html, text = build()
        return send_email_async(to, subject, html, text, kind=kind, lang=language_of(ctx), reference=ctx.get("id"))
    except Exception as error:  # noqa: BLE001
        logger.error("client email %s could not be built (%s)", kind, type(error).__name__)
        return None


def staff_requested(ctx):
    return _staff(lambda: staff_reschedule_requested(ctx), ctx, "reschedule_requested")


def staff_counter_accepted(ctx):
    return _staff(lambda: staff_counter_answer(ctx, True), ctx, "reschedule_counter_accepted")


def staff_counter_declined(ctx):
    return _staff(lambda: staff_counter_answer(ctx, False), ctx, "reschedule_counter_declined")


def client_approved(ctx):
    return _client(lambda: client_reschedule_approved(ctx), ctx, "reschedule_approved")


def client_rejected(ctx):
    return _client(lambda: client_reschedule_rejected(ctx), ctx, "reschedule_rejected")


def client_counter(ctx):
    return _client(lambda: client_reschedule_counter(ctx), ctx, "reschedule_counter")


def session_moved(ctx):
    return _client(lambda: client_session_moved(ctx), ctx, "reschedule_moved")


def wait(future):
    """{"sent": bool, "problem": str} for the Future of an email (None = e-mail not configured)."""
    if future is None:
        return {"sent": False, "problem": "not_configured"}
    try:
        result = future.result(timeout=WAIT_SECONDS)
        return {"sent": bool(result.ok), "problem": "" if result.ok else str(result.error)}
    except Exception:  # noqa: BLE001 - timeout or worker error
        return {"sent": False, "problem": "timeout"}

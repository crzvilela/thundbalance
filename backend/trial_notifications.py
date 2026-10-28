"""E-mail notices to the studio about a trial session (requested, confirmed
or declined by the client).

Built with the shared email base (backend/emails) and delivered the way it
always was: through the Google Apps Script web app (docs/TRIAL_EMAIL_SETUP.md),
so it works on hosts that block SMTP (Render free). Configuration, all optional:

  TRIAL_EMAIL_WEBHOOK_URL     the Apps Script web app URL. Unset = no e-mail.
  TRIAL_EMAIL_WEBHOOK_SECRET  shared secret the script checks.
  TRIAL_NOTIFY_TO             recipient of the other studio notices (default info@thundbalance.com).
  TEAM_NOTIFICATION_EMAILS    who gets the "new trial session request" notice: addresses separated by commas
                              (default pt@thundbalance.com and info@thundbalance.com), ONE email with all of
                              them in "to". An invalid address is ignored; if none is valid the default is used.

Sending runs in the background and never raises, so a mail problem can not make
a booking fail.
"""
import logging
import os

from emails import send_email_async
from emails.transport import validate_address
from emails.trial_emails import staff_trial_confirmed, staff_trial_declined, staff_trial_requested

DEFAULT_RECIPIENT = "info@thundbalance.com"
DEFAULT_TEAM_NOTIFICATION = ("pt@thundbalance.com", "info@thundbalance.com")

logger = logging.getLogger("thundbalance.trial_notifications")


def studio_address():
    """Where the studio's notices go (TRIAL_NOTIFY_TO, default info@thundbalance.com)."""
    return os.getenv("TRIAL_NOTIFY_TO", DEFAULT_RECIPIENT).strip() or DEFAULT_RECIPIENT


def team_notification_addresses():
    """The addresses of the "new trial session request" notice: TEAM_NOTIFICATION_EMAILS (comma separated), else
    pt@ and info@. A wrong address never stops the notice or the booking: it is dropped (only the COUNT is logged,
    never the address) and, if nothing valid is left, the default list is used."""
    raw = os.getenv("TEAM_NOTIFICATION_EMAILS", "")
    valid, wrong = [], 0
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        try:
            address = validate_address(item, "email").lower()
        except ValueError:
            wrong += 1
            continue
        if address not in valid:
            valid.append(address)
    if wrong:
        logger.warning("TEAM_NOTIFICATION_EMAILS has %s invalid address(es): ignored", wrong)
    return valid or list(DEFAULT_TEAM_NOTIFICATION)


def _team_notification_failed(result):
    """Called when the background send is done. Only the kind of error, never the content."""
    if not result.ok:
        logger.error("team notification failed: %s", result.error)


def _send(build, trial, kind, legacy=False, to=None):
    if not os.getenv("TRIAL_EMAIL_WEBHOOK_URL", "").strip():
        return None
    try:
        subject, html, text = build()
        try:
            reply_to = validate_address(trial.get("email"), "reply_to")
        except ValueError:
            reply_to = None  # falls back to info@
    except Exception as error:  # noqa: BLE001 - never break the booking
        print(f"Trial notification could not be built: {type(error).__name__}")
        return None
    # "trial" keeps the previous Apps Script version working (it sends its own
    # plain-text notice) until docs/trial-email.gs is updated in Google.
    extra = {"trial": trial} if legacy else None
    # Studio emails are Spanish only, and each event sends exactly one.
    try:
        return send_email_async(to or studio_address(), subject, html, text, reply_to=reply_to, extra=extra, kind=kind, lang="es",
                                reference=trial.get("id"), on_done=_team_notification_failed)
    except Exception as error:  # noqa: BLE001 - the booking and the client's own email must not fail
        logger.error("team notification failed: %s", type(error).__name__)
        return None


def notify_trial_requested(trial):
    """`trial` is a dict with the request's fields (see create_trial_session)."""
    # After the booking is saved, in the background, one email to the whole team; Reply-To is the client.
    try:
        return _send(lambda: staff_trial_requested(trial), trial, "staff_trial_requested", legacy=True,
                     to=team_notification_addresses())
    except Exception as error:  # noqa: BLE001
        logger.error("team notification failed: %s", type(error).__name__)
        return None


def notify_trial_confirmed(trial, calendar_ok=True):
    return _send(lambda: staff_trial_confirmed(trial, calendar_ok), trial, "staff_trial_confirmed")


def notify_trial_declined(trial):
    return _send(lambda: staff_trial_declined(trial), trial, "staff_trial_declined")

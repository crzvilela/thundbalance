"""E-mail notice sent to the studio when a trial session is requested.

Built with the shared email base (backend/emails) and delivered the way it
always was: through the Google Apps Script web app (docs/TRIAL_EMAIL_SETUP.md),
so it works on hosts that block SMTP (Render free). Configuration, all optional:

  TRIAL_EMAIL_WEBHOOK_URL     the Apps Script web app URL. Unset = no e-mail.
  TRIAL_EMAIL_WEBHOOK_SECRET  shared secret the script checks.
  TRIAL_NOTIFY_TO             recipient (default info@thundbalance.com).

Sending runs in the background and never raises, so a mail problem can not make
a booking fail.
"""
import os

from emails import send_email_async
from emails.transport import validate_address
from emails.trial_emails import staff_trial_requested

DEFAULT_RECIPIENT = "info@thundbalance.com"


def notify_trial_requested(trial):
    """`trial` is a dict with the request's fields (see create_trial_session)."""
    if not os.getenv("TRIAL_EMAIL_WEBHOOK_URL", "").strip():
        return None
    recipient = os.getenv("TRIAL_NOTIFY_TO", DEFAULT_RECIPIENT).strip() or DEFAULT_RECIPIENT
    try:
        subject, html, text = staff_trial_requested(trial)
        try:
            reply_to = validate_address(trial.get("email"), "reply_to")
        except ValueError:
            reply_to = None  # falls back to info@
    except Exception as error:  # noqa: BLE001 - never break the booking
        print(f"Trial notification could not be built: {type(error).__name__}")
        return None
    # "trial" keeps the previous Apps Script version working (it sends its own
    # plain-text notice) until docs/trial-email.gs is updated in Google.
    return send_email_async(recipient, subject, html, text, reply_to=reply_to, extra={"trial": trial})

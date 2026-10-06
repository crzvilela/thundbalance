"""E-mail notification sent to the studio when a trial session is requested.

The message is delivered through a small Google Apps Script web app (see
docs/TRIAL_EMAIL_SETUP.md), so it works on hosts that block SMTP (Render free)
and needs no access to the studio's own mailbox. Configuration, all optional:

  TRIAL_EMAIL_WEBHOOK_URL     the Apps Script web app URL. Unset = no e-mail.
  TRIAL_EMAIL_WEBHOOK_SECRET  shared secret the script checks.
  TRIAL_NOTIFY_TO             recipient (default info@thundbalance.com).

Sending runs in a background thread and never raises, so a mail problem can
not make a booking fail.
"""
import json
import os
import threading
import urllib.request

DEFAULT_RECIPIENT = "info@thundbalance.com"


def _send(payload):
    url = os.getenv("TRIAL_EMAIL_WEBHOOK_URL", "").strip()
    if not url:
        return
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8", "replace")
            if '"ok":true' not in body.replace(" ", ""):
                print(f"Trial notification e-mail was not accepted: {body[:200]}")
    except Exception as error:  # noqa: BLE001 - never break the booking
        print(f"Trial notification e-mail failed: {error}")


def notify_trial_requested(trial):
    """`trial` is a dict with the request's fields (see create_trial_session)."""
    if not os.getenv("TRIAL_EMAIL_WEBHOOK_URL", "").strip():
        return
    payload = {
        "secret": os.getenv("TRIAL_EMAIL_WEBHOOK_SECRET", "").strip(),
        "to": os.getenv("TRIAL_NOTIFY_TO", DEFAULT_RECIPIENT).strip() or DEFAULT_RECIPIENT,
        "trial": trial,
    }
    threading.Thread(target=_send, args=(payload,), daemon=True).start()

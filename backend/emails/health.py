"""Is the email channel working? Used by the admin panel and at startup.

check_ready() asks the Google Apps Script to prove it is reachable, that the
shared secret matches and (when the script supports it) how much of the daily
Gmail quota is left, WITHOUT sending anything. Nothing here returns a secret.
"""
import json
import os
import socket
import threading
import urllib.error
import urllib.request

from . import transport

REASONS = {
    "not_configured": "TRIAL_EMAIL_WEBHOOK_URL is not set",
    "secret_missing": "TRIAL_EMAIL_WEBHOOK_SECRET is not set",
    "unauthorized": "the secret in Render does not match the one in the Google script",
    "invalid_response": "the script answered a web page instead of JSON (not deployed for anyone, or it needs authorization)",
    "unreachable": "the Google script could not be reached",
    "timeout": "the Google script did not answer in time",
    "daily_quota_exhausted": "the Gmail daily sending limit was reached",
}


def check_ready(timeout=12):
    """{"email_ready": bool, "reason": str, "quota": int | None}. Never raises."""
    url = os.getenv("TRIAL_EMAIL_WEBHOOK_URL", "").strip()
    if not url:
        return {"email_ready": False, "reason": "not_configured", "quota": None}
    secret = os.getenv("TRIAL_EMAIL_WEBHOOK_SECRET", "").strip()
    if not secret:
        return {"email_ready": False, "reason": "secret_missing", "quota": None}
    request = urllib.request.Request(
        url, data=json.dumps({"secret": secret, "ping": True}).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return {"email_ready": False, "reason": f"http_{error.code}", "quota": None}
    except Exception as error:  # noqa: BLE001
        cause = getattr(error, "reason", error)
        timed_out = isinstance(cause, (TimeoutError, socket.timeout))
        return {"email_ready": False, "reason": "timeout" if timed_out else "unreachable", "quota": None}
    try:
        answer = json.loads(body)
    except ValueError:
        return {"email_ready": False, "reason": "invalid_response", "quota": None}
    if not isinstance(answer, dict):
        return {"email_ready": False, "reason": "invalid_response", "quota": None}
    if answer.get("error") == "unauthorized":
        return {"email_ready": False, "reason": "unauthorized", "quota": None}
    quota = answer.get("quota")
    quota = quota if isinstance(quota, int) else None
    if answer.get("ok") is True:
        if quota is not None and quota <= 0:
            return {"email_ready": False, "reason": "daily_quota_exhausted", "quota": quota}
        return {"email_ready": True, "reason": "ok", "quota": quota}
    # The secret was accepted (otherwise "unauthorized"), but this version of the
    # script does not know "ping": reachable and authenticated, quota unknown.
    return {"email_ready": True, "reason": "ok_script_without_ping", "quota": None}


def describe(reason):
    if reason in ("ok", "ok_script_without_ping"):
        return "OK"
    if reason.startswith("http_"):
        return f"the Google script answered HTTP {reason[5:]}"
    return REASONS.get(reason, reason)


def log_startup_status():
    """Prints one line, "Email: OK" or "Email: NÃO configurado (motivo)". The
    check runs in the background so startup never waits for Google."""
    def run():
        status = check_ready()
        if status["email_ready"]:
            print("Email: OK", flush=True)
        else:
            print(f"Email: NÃO configurado ({describe(status['reason'])})", flush=True)

    threading.Thread(target=run, name="email-startup-check", daemon=True).start()


def send_test(to):
    """Sends a short test email to `to` and reports. Returns an EmailResult."""
    from .template import heading, paragraph
    from .texts import spanish_email

    address = transport.validate_address(to, "to")
    subject, html, text = spanish_email(
        "Prueba de envío de ThundBalance",
        lambda: [
            heading("Prueba de envío"),
            paragraph("Si lees esto, el envío de emails de ThundBalance funciona."),
            paragraph("Este mensaje lo ha pedido el administrador desde el panel.", muted=True),
        ],
    )
    return transport.send_email(address, subject, html, text, kind="email_test", lang="es", reference=None)

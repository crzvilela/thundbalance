"""Who gets copies of the studio's emails, and validation of recipient lists."""
import contextvars
import os
from contextlib import contextmanager

from fastapi import HTTPException

from .transport import validate_address

# Where every internal notice goes (trial, pack request, reschedule, contact messages, new client) and what is pre-filled in
# "Enviar confirmación a". Override on the server with TEAM_NOTIFICATION_EMAILS="a@x.com,b@x.com".
DEFAULT_TEAM_EMAILS = ("pt@thundbalance.com",)
MAX_RECIPIENTS = 10


def clean_recipients(addresses, exclude=()):
    """Validated, lower-cased, de-duplicated list (order kept), without the
    addresses in `exclude`. Raises ValueError on a bad address or too many."""
    skip = {str(item).strip().lower() for item in exclude if item}
    result = []
    for item in addresses or []:
        text = str(item or "").strip()
        if not text:
            continue
        try:
            address = validate_address(text, "email").lower()
        except ValueError:
            raise ValueError(f"Not a valid email address: {text[:80].replace(chr(10), ' ')}") from None
        if address not in result and address not in skip:
            result.append(address)
    if len(result) > MAX_RECIPIENTS:
        raise ValueError(f"At most {MAX_RECIPIENTS} extra recipients are allowed.")
    return result


def team_emails():
    """The team addresses: TEAM_NOTIFICATION_EMAILS if set (and valid), else the older TEAM_EMAILS, else pt@."""
    for name in ("TEAM_NOTIFICATION_EMAILS", "TEAM_EMAILS"):
        raw = os.getenv(name, "").strip()
        if raw:
            try:
                parsed = clean_recipients(raw.split(","))
                if parsed:
                    return parsed
            except ValueError:
                print(f"{name} is not valid; using the default team addresses")
    return list(DEFAULT_TEAM_EMAILS)


# ---------------------------------------------------------------- the extra recipients of an admin action
# Every email the admin triggers goes to the CLIENT (always, fixed) and, in BLIND copy, to the extra recipients the admin adds
# in the box "Añadir más destinatarios": at most MAX_EXTRA, valid, lower case, no duplicates. The client never sees them and
# they do not see each other. The list is also kept with the action (`extra_emails`) for the calendar invitations.
MAX_EXTRA = 5


def parse_extra(values, client_email=None):
    """The validated extra recipients (lower case, no duplicates, never the client's own address). Raises a 422 with the code
    `invalid_extra_recipients` for a bad address or more than MAX_EXTRA. Nothing about the addresses goes to the logs."""
    cleaned = []
    for item in values or []:
        text = str(item or "").strip()
        if not text:
            continue
        try:
            address = validate_address(text, "email").lower()
        except ValueError:
            raise HTTPException(status_code=422, detail={
                "code": "invalid_extra_recipients", "field": "extra_recipients",
                "message": "Hay un destinatario con un email no válido. / One of the extra recipients is not a valid email.",
            }) from None
        if address not in cleaned:
            cleaned.append(address)
    skip = str(client_email or "").strip().lower()
    cleaned = [address for address in cleaned if address != skip]
    if len(cleaned) > MAX_EXTRA:
        raise HTTPException(status_code=422, detail={
            "code": "too_many_extra_recipients", "field": "extra_recipients",
            "message": f"Máximo {MAX_EXTRA} destinatarios extra. / At most {MAX_EXTRA} extra recipients.",
        })
    return cleaned


_scope = contextvars.ContextVar("extra_recipients", default=())


@contextmanager
def extra_scope(addresses):
    """While an admin action runs, the emails TO THE CLIENT it sends carry these addresses in BCC (client_extra())."""
    token = _scope.set(tuple(addresses or ()))
    try:
        yield
    finally:
        _scope.reset(token)


def client_extra():
    """The extra recipients of the action being run (empty outside one). Only emails to the client use it."""
    return list(_scope.get())

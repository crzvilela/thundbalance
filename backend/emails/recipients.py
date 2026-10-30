"""Who gets copies of the studio's emails, and validation of recipient lists."""
import os

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

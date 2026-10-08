"""Who gets copies of the studio's emails, and validation of recipient lists."""
import os

from .transport import validate_address

# Pre-filled in the "Enviar confirmación a" field. Override on the server with
# TEAM_EMAILS="a@x.com,b@x.com".
DEFAULT_TEAM_EMAILS = ("info@thundbalance.com", "pt@thundbalance.com")
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
    """The default team addresses: TEAM_EMAILS if set (and valid), else the constants."""
    raw = os.getenv("TEAM_EMAILS", "").strip()
    if raw:
        try:
            parsed = clean_recipients(raw.split(","))
            if parsed:
                return parsed
        except ValueError:
            print("TEAM_EMAILS is not valid; using the default team addresses")
    return list(DEFAULT_TEAM_EMAILS)

"""Email base for the ThundBalance backend. Every email goes through this package."""
from .dates import BilingualDate, format_date_bilingual, madrid_to_utc, parse_madrid, to_madrid
from .ics import build_ics
from .template import (
    Block, Raw, bilingual_subject, button, heading, highlight_box, key_value, logo_url,
    notice, paragraph, render_email, sessions_table, site_url,
)
from .texts import bilingual_email, spanish_email, tr
from .transport import EmailResult, send_email, send_email_async

__all__ = [
    "BilingualDate", "Block", "EmailResult", "Raw", "bilingual_email", "bilingual_subject",
    "build_ics", "button", "format_date_bilingual", "heading", "highlight_box", "key_value",
    "logo_url", "madrid_to_utc", "notice", "paragraph", "parse_madrid", "render_email",
    "send_email", "send_email_async", "sessions_table", "site_url", "spanish_email", "to_madrid", "tr",
]

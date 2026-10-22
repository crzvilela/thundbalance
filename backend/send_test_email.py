"""Send the example email (every component, in ONE language, with a .ics attached).

    python send_test_email.py destino@example.com [en|es|ca]      # English by default

Uses the same environment variables as the real emails:
TRIAL_EMAIL_WEBHOOK_URL and TRIAL_EMAIL_WEBHOOK_SECRET (set them in your shell
for this run; the values are never printed). Optional: SITE_URL, EMAIL_LOGO_URL.
"""
import logging
import sys

from emails import send_email
from emails.samples import sample_all_components, sample_ics


def main():
    if len(sys.argv) not in (2, 3) or (len(sys.argv) == 3 and sys.argv[2] not in ("en", "es", "ca")):
        print("Usage: python send_test_email.py destino@example.com [en|es|ca]")
        return 2
    lang = sys.argv[2] if len(sys.argv) == 3 else "en"
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    subject, html, text = sample_all_components(lang)
    result = send_email(
        sys.argv[1], subject, html, text,
        attachments=[{"filename": "thundbalance-demo.ics", "content_type": "text/calendar", "data": sample_ics().encode("utf-8")}],
        kind="email_test", lang=lang,
    )
    print("Sent." if result.ok else f"NOT sent: {result.error}")
    return 0 if result.ok else 1


if __name__ == "__main__":
    sys.exit(main())

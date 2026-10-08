"""Send the example email (every component, ES + EN, with a .ics attached).

    python send_test_email.py destino@example.com

Uses the same environment variables as the real emails:
TRIAL_EMAIL_WEBHOOK_URL and TRIAL_EMAIL_WEBHOOK_SECRET (set them in your shell
for this run; the values are never printed). Optional: SITE_URL, EMAIL_LOGO_URL.
"""
import logging
import sys

from emails import send_email
from emails.samples import sample_all_components, sample_ics


def main():
    if len(sys.argv) != 2:
        print("Usage: python send_test_email.py destino@example.com")
        return 2
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    subject, html, text = sample_all_components()
    result = send_email(
        sys.argv[1], subject, html, text,
        attachments=[{"filename": "thundbalance-demo.ics", "content_type": "text/calendar", "data": sample_ics().encode("utf-8")}],
    )
    print("Sent." if result.ok else f"NOT sent: {result.error}")
    return 0 if result.ok else 1


if __name__ == "__main__":
    sys.exit(main())

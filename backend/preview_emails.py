"""Write example emails as HTML files, to open in a browser.

    python preview_emails.py        # -> backend/email_previews/*.html

The logo is read from ../public/email-logo.png so it shows before the file is deployed.
"""
import os
import pathlib

from emails.samples import sample_all_components
from emails.trial_emails import (
    client_trial_approved, client_trial_cancelled, client_trial_rejected, staff_trial_requested,
)
from datetime import datetime

here = pathlib.Path(__file__).resolve().parent
os.environ.setdefault("EMAIL_LOGO_URL", (here.parent / "public" / "email-logo.png").as_uri())

out = here / "email_previews"
out.mkdir(exist_ok=True)

start = datetime(2026, 10, 12, 9, 0)
examples = {
    "components": sample_all_components(),
    "trial-approved": client_trial_approved("Ana", start, "Carles"),
    "trial-rejected": client_trial_rejected("Ana", "Ese día el estudio está cerrado."),
    "trial-cancelled": client_trial_cancelled("Ana", start),
    "staff-trial-requested": staff_trial_requested({
        "full_name": "Ana García", "email": "ana@example.com", "phone": "+34 600 000 000",
        "age": 31, "birth_date": "1995-03-02", "goal": "Lose weight, Build muscle",
        "experience": "Beginner", "session_date": "2026-10-12", "session_time": "09:00",
    }),
}
for name, (subject, html, text) in examples.items():
    (out / f"{name}.html").write_text(html, encoding="utf-8")
    (out / f"{name}.txt").write_text(f"Subject: {subject}\n\n{text}", encoding="utf-8")
    print(f"{name}.html  —  {subject}")
print(f"\nOpen the files in: {out}")

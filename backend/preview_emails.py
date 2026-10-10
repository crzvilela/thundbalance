"""Write example emails as HTML files, to open in a browser.

    python preview_emails.py        # -> backend/email_previews/*.html

The logo is read from ../public/email-logo.png so it shows before the file is deployed.
"""
import os
import pathlib

from emails.pack_emails import build_pack_email
from emails.samples import sample_all_components
from emails.trial_emails import (
    client_trial_approved, client_trial_cancelled, client_trial_confirmed, client_trial_received,
    staff_trial_confirmed, staff_trial_declined, staff_trial_requested,
)
from datetime import datetime

here = pathlib.Path(__file__).resolve().parent
os.environ.setdefault("EMAIL_LOGO_URL", (here.parent / "public" / "email-logo.png").as_uri())

out = here / "email_previews"
out.mkdir(exist_ok=True)

start = datetime(2026, 10, 12, 9, 0)
SAMPLE_TRIAL = {
    "full_name": "Ana García", "email": "ana@example.com", "phone": "+34 600 000 000",
    "age": 31, "birth_date": "1995-03-02", "goal": "Lose weight, Build muscle",
    "experience": "Beginner", "session_date": "2026-10-12", "session_time": "09:00", "trainer": "Carles",
}
examples = {
    "components": sample_all_components(),
    "pack-summary": build_pack_email({
        "client_name": "Ana García", "client_email": "ana@example.com", "plan_name": "Monthly Plan",
        "sessions_per_week": 2, "days": ["Monday", "Wednesday"], "trainer": "Carles",
        "sessions": [{"id": n, "start": datetime(2026, 10, 12 + 2 * (n - 1) + (n - 1) // 2 * 3 - (n - 1) // 2 * 0, 9), "trainer": "Carles", "number": f"{n}/4"} for n in range(1, 5)],
    }),
    "staff-trial-confirmed": staff_trial_confirmed(SAMPLE_TRIAL),
    "staff-trial-confirmed-calendar-failed": staff_trial_confirmed(SAMPLE_TRIAL, calendar_ok=False),
    "staff-trial-declined": staff_trial_declined(SAMPLE_TRIAL),
    "staff-trial-requested": staff_trial_requested({
        "full_name": "Ana García", "email": "ana@example.com", "phone": "+34 600 000 000",
        "age": 31, "birth_date": "1995-03-02", "goal": "Lose weight, Build muscle",
        "experience": "Beginner", "session_date": "2026-10-12", "session_time": "09:00",
    }),
}
# the client's trial emails, one file per language (each is written entirely in it)
for lang in ("en", "es", "ca"):
    examples[f"client-trial-received-{lang}"] = client_trial_received("Ana", start, lang)
    examples[f"client-trial-approved-{lang}"] = client_trial_approved("Ana", start, "Carles", "TOKEN-DE-EJEMPLO", lang)
    examples[f"client-trial-confirmed-{lang}"] = client_trial_confirmed("Ana", start, "Carles", 15, lang)[:3]
    examples[f"client-trial-cancelled-{lang}"] = client_trial_cancelled("Ana", start, lang)

for name, (subject, html, text) in examples.items():
    (out / f"{name}.html").write_text(html, encoding="utf-8")
    (out / f"{name}.txt").write_text(f"Subject: {subject}\n\n{text}", encoding="utf-8")
    print(f"{name}.html  —  {subject}")
print(f"\nOpen the files in: {out}")

"""Write example emails as HTML files, to open in a browser.

    python preview_emails.py        # -> backend/email_previews/*.html

EVERY email a client can receive is written three times (-en, -es, -ca), each entirely in its language. The ones for the
team (info@, pt@) are written once, in Spanish. The logo is read from ../public/email-logo.png so it shows before the
file is deployed. The credentials in the examples are made up.
"""
import os
import pathlib
from datetime import datetime

from emails.pack_emails import build_pack_email
from emails.reschedule_emails import (
    client_reschedule_approved, client_reschedule_counter, client_reschedule_rejected, client_session_moved,
    staff_counter_answer, staff_reschedule_requested,
)
from emails.samples import sample_all_components
from emails.trial_emails import (
    client_trial_approved, client_trial_cancelled, client_trial_confirmed, client_trial_received,
    staff_trial_confirmed, staff_trial_declined, staff_trial_requested,
)
from emails.welcome_emails import build_staff_client_created, build_welcome_email

here = pathlib.Path(__file__).resolve().parent
os.environ.setdefault("EMAIL_LOGO_URL", (here.parent / "public" / "email-logo.png").as_uri())

out = here / "email_previews"
out.mkdir(exist_ok=True)

LANGUAGES = ("en", "es", "ca")
start = datetime(2026, 10, 12, 9, 0)
SAMPLE_TRIAL = {
    "full_name": "Ana García", "email": "ana@example.com", "phone": "+34 600 000 000",
    "age": 31, "birth_date": "1995-03-02", "goal": "Lose weight, Build muscle",
    "experience": "Beginner", "session_date": "2026-10-12", "session_time": "09:00", "trainer": "Carles",
}
SAMPLE_PACK = {
    "client_name": "Ana García", "client_email": "ana@example.com", "plan_name": "Monthly Plan",
    "sessions_per_week": 2, "days": ["Monday", "Wednesday"], "trainer": "Carles",
    "calendar_links": {"google": "https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fexample.com%2Ffeed.ics",
                       "https": "https://example.com/feed.ics"},
    "sessions": [{"id": n, "start": datetime(2026, 10, 12 + 2 * (n - 1) + (n - 1) // 2, 9), "trainer": "Carles", "number": f"{n}/4"}
                 for n in range(1, 5)],
}
SAMPLE_RESCHEDULE = {
    "id": 7, "client_name": "Ana García", "client_email": "ana@example.com", "number": "3/8", "trainer": "Matilda",
    "original_date": "2026-11-16", "original_time": "10:00", "requested_date": "2026-11-18", "requested_time": "11:00",
    "session_date": "2026-11-18", "session_time": "11:00", "counter_date": "2026-11-19", "counter_time": "12:00",
    "client_note": "I have a trip", "admin_note": "Free slot that day", "token": "EXAMPLE-TOKEN",
}

examples = {
    "staff-trial-confirmed": staff_trial_confirmed(SAMPLE_TRIAL),
    "staff-trial-confirmed-calendar-failed": staff_trial_confirmed(SAMPLE_TRIAL, calendar_ok=False),
    "staff-trial-declined": staff_trial_declined(SAMPLE_TRIAL),
    "staff-trial-requested": staff_trial_requested(SAMPLE_TRIAL),
    "staff-pack-summary": build_pack_email(SAMPLE_PACK, team_subject=True),
    "staff-client-created": build_staff_client_created("Ana García", "ana@example.com", SAMPLE_PACK),
    "staff-reschedule-requested": staff_reschedule_requested(SAMPLE_RESCHEDULE),
    "staff-reschedule-counter-accepted": staff_counter_answer(SAMPLE_RESCHEDULE, True),
}
for lang in LANGUAGES:
    ctx = {**SAMPLE_RESCHEDULE, "lang": lang}
    examples[f"client-components-{lang}"] = sample_all_components(lang)
    examples[f"client-pack-summary-{lang}"] = build_pack_email(SAMPLE_PACK, lang=lang)
    examples[f"client-welcome-{lang}"] = build_welcome_email("Ana García", "ana@example.com", "Ab3-9xQ-77-EXAMPLE", None, lang)[:3]
    examples[f"client-welcome-with-pack-{lang}"] = build_welcome_email("Ana García", "ana@example.com", "Ab3-9xQ-77-EXAMPLE", SAMPLE_PACK, lang)[:3]
    examples[f"client-trial-received-{lang}"] = client_trial_received("Ana", start, lang)
    examples[f"client-trial-approved-{lang}"] = client_trial_approved("Ana", start, "Carles", "TOKEN-DE-EJEMPLO", lang)
    examples[f"client-trial-confirmed-{lang}"] = client_trial_confirmed("Ana", start, "Carles", 15, lang)[:3]
    examples[f"client-trial-cancelled-{lang}"] = client_trial_cancelled("Ana", start, lang)[:3]
    examples[f"client-reschedule-approved-{lang}"] = client_reschedule_approved(ctx)
    examples[f"client-reschedule-rejected-{lang}"] = client_reschedule_rejected(ctx)
    examples[f"client-reschedule-counter-{lang}"] = client_reschedule_counter(ctx)
    examples[f"client-session-moved-{lang}"] = client_session_moved(ctx)

# files of an older run (the previous bilingual names) are removed so the folder shows only what exists today
for old in list(out.glob("*.html")) + list(out.glob("*.txt")):
    if old.stem not in examples:
        old.unlink()

for name, (subject, html, text) in examples.items():
    (out / f"{name}.html").write_text(html, encoding="utf-8")
    (out / f"{name}.txt").write_text(f"Subject: {subject}\n\n{text}", encoding="utf-8")
    print(f"{name}.html  —  {subject}")
print(f"\nOpen the files in: {out}")

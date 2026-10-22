"""Example emails used by send_test_email.py, preview_emails.py and the tests."""
from datetime import datetime

from .ics import build_ics
from .template import (
    Raw, button, heading, highlight_box, key_value, notice, paragraph, sessions_table, site_url,
)
from .texts import localized_email, tr


def sample_sessions():
    return [
        {"start": datetime(2026, 10, 12, 9, 0), "trainer": "Carles"},
        {"start": datetime(2026, 10, 14, 18, 0), "trainer": "Matilda"},
    ]


def sample_all_components(lang="en"):
    """A client email showing every component, in ONE language (en | es | ca)."""
    def build(lang):
        return [
            heading(tr(lang, "test_title")),
            paragraph(tr(lang, "greeting", name="Ana <b>&</b> Co")),   # escaped on purpose
            paragraph(tr(lang, "test_body")),
            key_value([(tr(lang, "lbl_plan"), "Pack 10"), (tr(lang, "lbl_trainer"), "Carles"), (tr(lang, "lbl_empty"), "")]),
            highlight_box("usuario: ana@example.com\ncontraseña: Ab3-9xQ-77", label=tr(lang, "test_credentials")),
            sessions_table(sample_sessions(), lang),
            notice(tr(lang, "test_notice"), tone="warning"),
            button("", "", site_url(), label=tr(lang, "test_button")),
        ]
    return localized_email(lang, "test_subject", build, title_key="test_title")


def sample_ics():
    events = [
        {"id": f"sample-{n}", "start": s["start"], "summary": f"ThundBalance · {s['trainer']}",
         "description": "ThundBalance, Carrer de Pallars 286; Barcelona",
         "location": "ThundBalance, Carrer de Pallars 286, 08005 Barcelona"}
        for n, s in enumerate(sample_sessions(), 1)
    ]
    return build_ics(events)

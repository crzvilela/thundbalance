"""Emails about a client's request to delete their account (privacy.py).

To the team: Spanish, the name of the client and the date only. To the client: a short confirmation in their language."""
from .template import heading, key_value, notice, paragraph
from .texts import localized_email, spanish_email, tr


def _one_line(value, limit=80):
    return " ".join(str(value or "").split())[:limit]


def team_deletion_request(name, day):
    """(subject, html, text) for the studio: a client asked to delete their account. No other data."""
    def build():
        return [
            heading(tr("es", "staff_pv_title")),
            key_value([(tr("es", "staff_pv_lbl_client"), _one_line(name)), (tr("es", "staff_pv_lbl_date"), str(day))]),
            paragraph(tr("es", "staff_pv_body")),
        ]
    return spanish_email(tr("es", "staff_pv_subject", name=_one_line(name)), build, title=tr("es", "staff_pv_title"))


def client_deletion_received(name, lang=None):
    """(subject, html, text) for the client, entirely in ONE language (en | es | ca; English when missing)."""
    def build(lang):
        return [
            heading(tr(lang, "pv_client_title")),
            paragraph(tr(lang, "greeting", name=_one_line(name))),
            paragraph(tr(lang, "pv_client_body")),
            notice(tr(lang, "pv_client_note")),
        ]
    return localized_email(lang, "pv_client_subject", build, title_key="pv_client_title")

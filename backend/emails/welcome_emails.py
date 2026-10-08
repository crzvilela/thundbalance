"""Welcome email for a client created by the admin, and the copy for the studio.

The client email contains the generated password (that is its purpose); the
studio copy never does.
"""
from .pack_emails import build_pack_ics, render_pack_summary_block
from .template import button, heading, highlight_box, key_value, notice, paragraph, site_url
from .texts import bilingual_email, spanish_email, tr


def _one_line(value, limit=80):
    return " ".join(str(value or "").split())[:limit]


def build_welcome_email(name, email, password, pack_summary=None):
    """(subject, html, text, ics_text_or_None). Spanish first, English below.
    With pack_summary (see pack_emails.py) the pack summary block is included
    and a .ics with every session is returned for attaching."""
    def build(lang):
        blocks = [
            heading(tr(lang, "welcome_title")),
            paragraph(tr(lang, "greeting", name=_one_line(name))),
            paragraph(tr(lang, "welcome_body")),
            highlight_box(
                f"{tr(lang, 'welcome_email_label')}: {email}\n{tr(lang, 'welcome_password_label')}: {password}",
                label=tr(lang, "welcome_access"),
            ),
            button(tr("es", "welcome_login"), tr("en", "welcome_login"), f"{site_url()}/login"),
            notice(tr(lang, "welcome_password_note")),
        ]
        if pack_summary:
            blocks += [paragraph(tr(lang, "welcome_pack_intro")), render_pack_summary_block(pack_summary, lang)]
        return blocks

    subject, html, text = bilingual_email("welcome_subject", build, title_key="welcome_title")
    return subject, html, text, (build_pack_ics(pack_summary) if pack_summary else None)


def build_staff_client_created(name, email, pack_summary=None):
    """(subject, html, text) for info@: a client was created. Spanish, no password."""
    def build():
        rows = [
            (tr("es", "lbl_name"), _one_line(name)),
            (tr("es", "lbl_email"), email),
            (tr("es", "lbl_plan"), tr("es", "staff_client_pack") + f": {pack_summary['plan_name']}" if pack_summary else tr("es", "staff_client_nopack")),
        ]
        if pack_summary:
            rows.append((tr("es", "lbl_sessions"), len(pack_summary["sessions"])))
        return [
            heading(tr("es", "staff_client_title")),
            key_value(rows),
            paragraph(tr("es", "staff_client_note"), muted=True),
        ]
    return spanish_email(tr("es", "staff_client_subject", name=_one_line(name)), build)

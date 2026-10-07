"""The trial-session emails: the notice to the studio and the three to the client."""
from .dates import format_date_bilingual, parse_madrid
from .template import button, heading, key_value, notice, paragraph, sessions_table, site_url
from .texts import bilingual_email, spanish_email, tr


def _one_line(value, limit=120):
    """Single-line text for subjects (no line breaks, no runs of spaces)."""
    return " ".join(str(value or "").split())[:limit]


# ------------------------------------------------------------ to the studio

def staff_trial_requested(trial):
    """(subject, html, text) for info@: a visitor asked for a trial session.
    `trial` is the dict built in create_trial_session (Spanish only)."""
    when = parse_madrid(trial.get("session_date"), trial.get("session_time") or "00:00")
    day = format_date_bilingual(when)
    age = trial.get("age")
    birth = trial.get("birth_date")
    if birth and age is not None:
        birth = f"{birth} ({tr('es', 'years', n=age)})"
    subject = tr("es", "staff_trial_subject", name=_one_line(trial.get("full_name")), date=trial.get("session_date") or "", time=trial.get("session_time") or "")

    def build():
        return [
            heading(tr("es", "staff_trial_title")),
            key_value([
                (tr("es", "lbl_name"), trial.get("full_name")),
                (tr("es", "lbl_email"), trial.get("email")),
                (tr("es", "lbl_phone"), trial.get("phone")),
                (tr("es", "lbl_birth"), birth),
                (tr("es", "lbl_goals"), trial.get("goal")),
                (tr("es", "lbl_experience"), trial.get("experience")),
                (tr("es", "lbl_date"), f"{day.weekday_es} {day.date_es}"),
                (tr("es", "lbl_time"), day.time),
            ]),
            paragraph(tr("es", "staff_trial_manage"), muted=True),
            button(tr("es", "staff_trial_button"), "", f"{site_url()}/admin/trials", only="es"),
        ]

    return spanish_email(
        subject, build,
        preheader=tr("es", "staff_trial_pre", name=_one_line(trial.get("full_name")), date=day.date_es, time=day.time),
    )


# ------------------------------------------------------------ to the client

def client_trial_approved(name, start, trainer):
    def build(lang):
        return [
            heading(tr(lang, "trial_approved_title")),
            paragraph(tr(lang, "greeting", name=name)),
            paragraph(tr(lang, "trial_approved_body")),
            sessions_table([{"start": start, "trainer": trainer}], lang),
            paragraph(tr(lang, "trial_approved_note"), muted=True),
        ]
    return bilingual_email("trial_approved_subject", build, title_key="trial_approved_title")


def client_trial_rejected(name, reason=""):
    def build(lang):
        blocks = [
            heading(tr(lang, "trial_rejected_title")),
            paragraph(tr(lang, "greeting", name=name)),
            paragraph(tr(lang, "trial_rejected_body")),
        ]
        if reason:
            blocks.append(notice(tr(lang, "trial_rejected_reason", reason=reason)))
        blocks.append(button(tr("es", "trial_rejected_button"), tr("en", "trial_rejected_button"), f"{site_url()}/trial-session"))
        return blocks
    return bilingual_email("trial_rejected_subject", build, title_key="trial_rejected_title")


def client_trial_cancelled(name, start):
    day = format_date_bilingual(start)

    def build(lang):
        return [
            heading(tr(lang, "trial_cancelled_title")),
            paragraph(tr(lang, "greeting", name=name)),
            paragraph(tr(lang, "trial_cancelled_body", when=day.es if lang == "es" else day.en)),
            button(tr("es", "trial_cancelled_button"), tr("en", "trial_cancelled_button"), f"{site_url()}/trial-session"),
        ]
    return bilingual_email("trial_cancelled_subject", build, title_key="trial_cancelled_title")

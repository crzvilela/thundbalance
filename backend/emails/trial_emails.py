"""The trial-session emails.

To the studio (Spanish only): a request arrived, the client confirmed, the
client declined.  To the client (Spanish, then English): request received,
approved (with the confirm / can't-attend links), confirmed (with the .ics),
cancelled.
"""
from .dates import format_date_bilingual, parse_madrid
from .ics import build_ics
from .template import (
    STUDIO_PLACE, button, heading, key_value, link_line, notice, paragraph, sessions_table, site_url,
)
from .texts import localized_email, normalize_language, spanish_email, tr


def _one_line(value, limit=120):
    """Single-line text for subjects (no line breaks, no runs of spaces)."""
    return " ".join(str(value or "").split())[:limit]


def confirmation_url(token, action=None, lang=None):
    """Public confirmation page; ?lang=xx makes it open in the email's language
    (used only when the visitor has no language saved in the browser)."""
    base = f"{site_url()}/trial-session/confirm/{token}"
    params = [f"action={action}"] if action else []
    if lang:
        params.append(f"lang={lang}")
    return f"{base}?{'&'.join(params)}" if params else base


# ------------------------------------------------------------ to the studio

def _staff_rows(trial, day):
    age = trial.get("age")
    birth = trial.get("birth_date")
    if birth and age is not None:
        birth = f"{birth} ({tr('es', 'years', n=age)})"
    return [
        (tr("es", "lbl_name"), trial.get("full_name")),
        (tr("es", "lbl_email"), trial.get("email")),
        (tr("es", "lbl_phone"), trial.get("phone")),
        (tr("es", "lbl_birth"), birth),
        (tr("es", "lbl_goals"), trial.get("goal")),
        (tr("es", "lbl_experience"), trial.get("experience")),
        (tr("es", "lbl_trainer"), trial.get("trainer")),
        (tr("es", "lbl_date"), f"{day.weekday_es} {day.date_es}"),
        (tr("es", "lbl_time"), day.time),
    ]


def _trial_day(trial):
    return format_date_bilingual(parse_madrid(trial.get("session_date"), trial.get("session_time") or "00:00"))


def staff_trial_requested(trial):
    """(subject, html, text) for info@: a visitor asked for a trial session.
    `trial` is the dict built in create_trial_session."""
    day = _trial_day(trial)
    name = _one_line(trial.get("full_name"))
    subject = tr("es", "staff_trial_subject", name=name, date=trial.get("session_date") or "", time=trial.get("session_time") or "")

    def build():
        return [
            heading(tr("es", "staff_trial_title")),
            key_value(_staff_rows(trial, day)),
            paragraph(tr("es", "staff_trial_manage"), muted=True),
            button(tr("es", "staff_trial_button"), "", f"{site_url()}/admin/trials", only="es"),
        ]

    return spanish_email(subject, build, preheader=tr("es", "staff_trial_pre", name=name, date=day.date_es, time=day.time))


def staff_trial_confirmed(trial, calendar_ok=True):
    """The client pressed "Confirm". If the Google event could not be created,
    the email says so and asks for it to be added by hand."""
    day = _trial_day(trial)
    name = _one_line(trial.get("full_name"))
    subject = tr("es", "staff_confirmed_subject", name=name, date=trial.get("session_date") or "", time=trial.get("session_time") or "")

    def build():
        blocks = [heading(tr("es", "staff_confirmed_title")), key_value(_staff_rows(trial, day))]
        if not calendar_ok:
            blocks.append(notice(tr("es", "staff_calendar_failed"), tone="warning"))
        blocks.append(button(tr("es", "staff_trial_button"), "", f"{site_url()}/admin/trials", only="es"))
        return blocks

    return spanish_email(subject, build, preheader=tr("es", "staff_confirmed_pre", name=name, date=day.date_es, time=day.time))


def staff_trial_declined(trial):
    day = _trial_day(trial)
    name = _one_line(trial.get("full_name"))
    subject = tr("es", "staff_declined_subject", name=name, date=trial.get("session_date") or "", time=trial.get("session_time") or "")

    def build():
        return [
            heading(tr("es", "staff_declined_title")),
            key_value(_staff_rows(trial, day)),
            paragraph(tr("es", "staff_declined_note"), muted=True),
            button(tr("es", "staff_trial_button"), "", f"{site_url()}/admin/trials", only="es"),
        ]

    return spanish_email(subject, build, preheader=tr("es", "staff_declined_pre", name=name, date=day.date_es, time=day.time))


# ------------------------------------------------------------ to the client
# Every function takes `lang` ("en" | "es" | "ca"): the email is then written
# entirely in that language. lang=None (rows saved before the language was
# stored) keeps the older Spanish + English layout.

def _button(lang, key, url):
    if lang:
        return button("", "", url, label=tr(lang, key))
    return button(tr("es", key), tr("en", key), url)


def _link(lang, key, url):
    if lang:
        return link_line("", "", url, label=tr(lang, key))
    return link_line(tr("es", key), tr("en", key), url)


def client_trial_received(name, start, lang=None):
    """We got the request; the team will be in touch. Shows the day and time asked for."""
    lang = normalize_language(lang)
    day = format_date_bilingual(start)

    def build(l):
        return [
            heading(tr(l, "trial_received_title")),
            paragraph(tr(l, "greeting", name=name)),
            paragraph(tr(l, "trial_received_body")),
            key_value([(tr(l, "trial_received_asked"), day.full(l))]),
        ]
    return localized_email(lang, "trial_received_subject", build, title_key="trial_received_title")


def client_trial_approved(name, start, trainer, token, lang=None):
    """Approved by the admin: asks the client to confirm (primary) or say they can't come."""
    lang = normalize_language(lang)

    def build(l):
        return [
            heading(tr(l, "trial_approved_title")),
            paragraph(tr(l, "greeting", name=name)),
            paragraph(tr(l, "trial_approved_body")),
            sessions_table([{"start": start, "trainer": trainer}], l),
            key_value([(tr(l, "lbl_place"), STUDIO_PLACE)]),
            _button(lang, "trial_approved_confirm", confirmation_url(token, lang=lang)),
            _link(lang, "trial_approved_decline", confirmation_url(token, "decline", lang=lang)),
            paragraph(tr(l, "trial_approved_note"), muted=True),
        ]
    return localized_email(lang, "trial_approved_subject", build, title_key="trial_approved_title")


def client_trial_confirmed(name, start, trainer, trial_id, lang=None):
    """Confirmation with the calendar file. Returns (subject, html, text, ics_text)."""
    lang = normalize_language(lang)

    def build(l):
        return [
            heading(tr(l, "trial_confirmed_title")),
            paragraph(tr(l, "greeting", name=name)),
            paragraph(tr(l, "trial_confirmed_body")),
            sessions_table([{"start": start, "trainer": trainer}], l),
            key_value([(tr(l, "lbl_place"), STUDIO_PLACE)]),
            paragraph(tr(l, "trial_confirmed_note"), muted=True),
        ]
    subject, html, text = localized_email(lang, "trial_confirmed_subject", build, title_key="trial_confirmed_title")
    ics = build_ics([{
        "id": f"trial-{trial_id}",
        "start": start,
        "summary": {"es": "ThundBalance · Sesión de prueba", "ca": "ThundBalance · Sessió de prova",
                    "en": "ThundBalance · Trial session"}.get(lang, "ThundBalance · Sesión de prueba / Trial session"),
        "description": (f"{ {'es': 'Entrenador', 'ca': 'Entrenador'}.get(lang, 'Trainer') if lang else 'Entrenador / Trainer'}: {trainer}") if trainer else "",
        "location": STUDIO_PLACE,
    }])
    return subject, html, text, ics


def client_trial_cancelled(name, start, lang=None):
    lang = normalize_language(lang)
    day = format_date_bilingual(start)

    def build(l):
        return [
            heading(tr(l, "trial_cancelled_title")),
            paragraph(tr(l, "greeting", name=name)),
            paragraph(tr(l, "trial_cancelled_body", when=day.full(l))),
            _button(lang, "trial_cancelled_button", f"{site_url()}/trial-session" + (f"?lang={lang}" if lang else "")),
        ]
    return localized_email(lang, "trial_cancelled_subject", build, title_key="trial_cancelled_title")

"""Email texts, one dictionary per language, and the helper that joins them.

Client emails: Spanish first, then English below a thin line.
Staff emails (info@, pt@): Spanish only (TEXTS_ES).
{placeholders} are filled by tr(); the values are escaped later by the components.
"""
from .template import bilingual_subject, render_email

TEXTS_ES = {
    "greeting": "Hola {name},",
    "view_site": "Ver en la web",
    # client: trial session
    "trial_approved_subject": "Tu sesión de prueba está confirmada",
    "trial_approved_title": "Sesión de prueba confirmada",
    "trial_approved_body": "Tu sesión de prueba está reservada. Estos son los detalles:",
    "trial_approved_note": "Si no puedes venir, responde a este email y buscamos otro horario.",
    "trial_rejected_subject": "Sobre tu sesión de prueba",
    "trial_rejected_title": "No podemos ofrecerte ese horario",
    "trial_rejected_body": "Lamentablemente no podemos ofrecerte el horario que pediste. Puedes solicitar otro día u hora en nuestra web.",
    "trial_rejected_reason": "Motivo: {reason}",
    "trial_rejected_button": "Pedir otro horario",
    "trial_cancelled_subject": "Tu sesión de prueba ha sido cancelada",
    "trial_cancelled_title": "Sesión de prueba cancelada",
    "trial_cancelled_body": "Tu sesión de prueba del {when} ha sido cancelada. Puedes solicitar una nueva en nuestra web.",
    "trial_cancelled_button": "Pedir una nueva",
    # staff: new trial request
    "staff_trial_subject": "Nueva sesión de prueba: {name} — {date} {time}",
    "staff_trial_title": "Nueva solicitud de sesión de prueba",
    "staff_trial_pre": "{name} ha pedido una sesión de prueba para el {date} a las {time}.",
    "staff_trial_manage": "Gestiónala desde el panel de administración.",
    "staff_trial_button": "Abrir el panel",
    "lbl_name": "Nombre", "lbl_email": "Email", "lbl_phone": "Teléfono",
    "lbl_birth": "Fecha de nacimiento", "lbl_goals": "Objetivos", "lbl_experience": "Experiencia",
    "lbl_date": "Fecha solicitada", "lbl_time": "Hora solicitada",
    "years": "{n} años",
    # test email
    "test_subject": "Email de prueba",
    "test_title": "Email de prueba",
    "test_body": "Si ves este mensaje con fondo negro, el logo y el botón, la base de emails funciona.",
    "test_credentials": "Datos de acceso (ejemplo)",
    "test_notice": "Este aviso es solo un ejemplo del componente.",
    "test_button": "Abrir ThundBalance",
}

TEXTS_EN = {
    "greeting": "Hi {name},",
    "view_site": "View on the website",
    "trial_approved_subject": "Your trial session is confirmed",
    "trial_approved_title": "Trial session confirmed",
    "trial_approved_body": "Your trial session is booked. Here are the details:",
    "trial_approved_note": "If you can't make it, reply to this email and we'll find another time.",
    "trial_rejected_subject": "About your trial session",
    "trial_rejected_title": "We can't offer that time",
    "trial_rejected_body": "Unfortunately we can't offer the time you asked for. You can request another day or time on our website.",
    "trial_rejected_reason": "Reason: {reason}",
    "trial_rejected_button": "Request another time",
    "trial_cancelled_subject": "Your trial session was cancelled",
    "trial_cancelled_title": "Trial session cancelled",
    "trial_cancelled_body": "Your trial session on {when} has been cancelled. You can request a new one on our website.",
    "trial_cancelled_button": "Request a new one",
    "test_subject": "Test email",
    "test_title": "Test email",
    "test_body": "If this message shows a black background, the logo and the button, the email base works.",
    "test_credentials": "Access details (example)",
    "test_notice": "This notice is just an example of the component.",
    "test_button": "Open ThundBalance",
}

TEXTS = {"es": TEXTS_ES, "en": TEXTS_EN}


def tr(lang, key, **values):
    """Text for `key` in `lang`, with {placeholders} filled in. A missing key
    in English falls back to Spanish."""
    text = TEXTS[lang].get(key)
    if text is None:
        text = TEXTS_ES[key]
    return text.format(**values) if values else text


def bilingual_email(subject_key, build, title_key=None, preheader=None, **values):
    """Join the two languages into one client email.

    `build(lang)` returns the list of blocks for that language (use tr(lang, key)
    for the texts). Returns (subject, html, text); the subject is "ES / EN".
    """
    subject = bilingual_subject(tr("es", subject_key, **values), tr("en", subject_key, **values))
    title = subject if not title_key else bilingual_subject(tr("es", title_key), tr("en", title_key))
    html, text = render_email(
        title=title,
        blocks=build("es"),
        blocks_after_separator=build("en"),
        preheader=preheader or tr("es", subject_key, **values),
        lang="es",
    )
    return subject, html, text


def spanish_email(subject, build, title=None, preheader=""):
    """Spanish-only email (staff). `build()` returns the blocks."""
    html, text = render_email(title=title or subject, blocks=build(), preheader=preheader, lang="es")
    return subject, html, text

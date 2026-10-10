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
    "lbl_place": "Lugar",
    "place_value": "ThundBalance, Carrer de Pallars 286, 08005 Barcelona",
    "trial_received_subject": "Hemos recibido tu solicitud",
    "trial_received_title": "Solicitud recibida",
    "trial_received_body": "Hemos recibido tu solicitud de sesión de prueba. Nuestro equipo la revisará y se pondrá en contacto contigo.",
    "trial_received_asked": "Día y hora solicitados:",
    "trial_approved_subject": "Confirma tu sesión de prueba",
    "trial_approved_title": "Tu sesión de prueba está aprobada",
    "trial_approved_body": "Hemos aprobado tu sesión de prueba. Confírmala para reservar tu hueco:",
    "trial_approved_note": "Tu hueco queda reservado, pero necesitamos que confirmes tu asistencia.",
    "trial_approved_confirm": "Confirmar mi sesión",
    "trial_approved_decline": "No puedo asistir",
    "trial_confirmed_subject": "Sesión de prueba confirmada",
    "trial_confirmed_title": "Sesión de prueba confirmada",
    "trial_confirmed_body": "¡Todo listo! Tu sesión de prueba está confirmada. Adjuntamos el evento para que lo añadas a tu calendario.",
    "trial_confirmed_note": "Si cambia algo, responde a este email.",
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
    "staff_confirmed_subject": "Sesión de prueba CONFIRMADA: {name} — {date} {time}",
    "staff_confirmed_title": "El cliente ha confirmado su sesión de prueba",
    "staff_confirmed_pre": "{name} confirmó su sesión del {date} a las {time}.",
    "staff_declined_subject": "Sesión de prueba DECLINADA: {name} — {date} {time}",
    "staff_declined_title": "El cliente no puede asistir a su sesión de prueba",
    "staff_declined_pre": "{name} declinó su sesión del {date} a las {time}.",
    "staff_declined_note": "El hueco ha quedado libre. Si había un evento en el calendario, se ha eliminado.",
    "staff_calendar_failed": "No se pudo crear el evento en Google Calendar. Créalo a mano; el panel muestra el aviso.",
    "lbl_trainer": "Entrenador",
    "lbl_name": "Nombre", "lbl_email": "Email", "lbl_phone": "Teléfono",
    "lbl_birth": "Fecha de nacimiento", "lbl_goals": "Objetivos", "lbl_experience": "Experiencia",
    "lbl_date": "Fecha solicitada", "lbl_time": "Hora solicitada",
    "years": "{n} años",
    # pack summary
    "pack_subject": "Tu pack de entrenamiento",
    "pack_title": "Tu pack está listo",
    "pack_intro": "Hemos preparado tu pack de entrenamiento. Aquí tienes el resumen y todas las sesiones.",
    "pack_ics_note": "Adjuntamos un archivo .ics: ábrelo para añadir todas tus sesiones al calendario con un clic.",
    "pack_sessions_title": "Tus sesiones",
    "lbl_plan": "Plan", "lbl_start": "Empieza", "lbl_end": "Termina (última sesión)",
    "lbl_per_week": "Sesiones por semana", "lbl_days": "Días de entrenamiento", "lbl_total": "Total de sesiones",
    # welcome (new client created by the admin)
    "welcome_subject": "Tu perfil en ThundBalance",
    "welcome_title": "Tu perfil está creado",
    "welcome_body": "Hemos creado tu perfil en ThundBalance. Estos son tus datos de acceso:",
    "welcome_access": "Datos de acceso",
    "welcome_email_label": "Email",
    "welcome_password_label": "Contraseña",
    "welcome_login": "Iniciar sesión",
    "welcome_password_note": "Para cambiar tu contraseña, inicia sesión y ve a la sección Perfil, donde podrás cambiarla.",
    "welcome_pack_intro": "Ya tienes tu pack preparado. Aquí tienes el resumen y todas las sesiones:",
    "staff_client_subject": "Nuevo cliente creado: {name}",
    "staff_client_title": "Se ha creado un cliente nuevo",
    "staff_client_note": "Se le han enviado sus credenciales por email. Esta copia no incluye la contraseña.",
    "staff_client_pack": "Pack asignado",
    "staff_client_nopack": "Sin pack (lo elegirá en la web)",
    "lbl_sessions": "Sesiones",
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
    "lbl_place": "Place",
    "place_value": "ThundBalance, Carrer de Pallars 286, 08005 Barcelona",
    "trial_received_subject": "We received your request",
    "trial_received_title": "Request received",
    "trial_received_body": "We have received your trial session request. Our team will review it and get in touch with you.",
    "trial_received_asked": "Requested day and time:",
    "trial_approved_subject": "Confirm your trial session",
    "trial_approved_title": "Your trial session is approved",
    "trial_approved_body": "We have approved your trial session. Confirm it to secure your spot:",
    "trial_approved_note": "Your spot is held, but we need you to confirm you will attend.",
    "trial_approved_confirm": "Confirm my session",
    "trial_approved_decline": "I can't make it",
    "trial_confirmed_subject": "Trial session confirmed",
    "trial_confirmed_title": "Trial session confirmed",
    "trial_confirmed_body": "All set! Your trial session is confirmed. The event is attached so you can add it to your calendar.",
    "trial_confirmed_note": "If anything changes, reply to this email.",
    "trial_cancelled_subject": "Your trial session was cancelled",
    "trial_cancelled_title": "Trial session cancelled",
    "trial_cancelled_body": "Your trial session on {when} has been cancelled. You can request a new one on our website.",
    "trial_cancelled_button": "Request a new one",
    "pack_subject": "Your training pack",
    "pack_title": "Your pack is ready",
    "pack_intro": "We have set up your training pack. Here is the summary and every session.",
    "pack_ics_note": "A .ics file is attached: open it to add all your sessions to your calendar with one click.",
    "pack_sessions_title": "Your sessions",
    "lbl_plan": "Plan", "lbl_start": "Starts", "lbl_end": "Ends (last session)",
    "lbl_per_week": "Sessions per week", "lbl_days": "Training days", "lbl_total": "Total sessions",
    "welcome_subject": "Your ThundBalance profile",
    "welcome_title": "Your profile is ready",
    "welcome_body": "We have created your ThundBalance profile. Here are your login details:",
    "welcome_access": "Login details",
    "welcome_email_label": "Email",
    "welcome_password_label": "Password",
    "welcome_login": "Log in",
    "welcome_password_note": "To change your password, log in and go to the Profile section, where you can change it.",
    "welcome_pack_intro": "Your pack is ready. Here is the summary and every session:",
    "test_subject": "Test email",
    "test_title": "Test email",
    "test_body": "If this message shows a black background, the logo and the button, the email base works.",
    "test_credentials": "Access details (example)",
    "test_notice": "This notice is just an example of the component.",
    "test_button": "Open ThundBalance",
}

TEXTS_CA = {
    "greeting": "Hola {name},",
    "lbl_place": "Lloc",
    "place_value": "ThundBalance, Carrer de Pallars 286, 08005 Barcelona",
    "trial_received_subject": "Hem rebut la teva sol·licitud",
    "trial_received_title": "Sol·licitud rebuda",
    "trial_received_body": "Hem rebut la teva sol·licitud de sessió de prova. El nostre equip la revisarà i es posarà en contacte amb tu.",
    "trial_received_asked": "Dia i hora sol·licitats:",
    "trial_approved_subject": "Confirma la teva sessió de prova",
    "trial_approved_title": "La teva sessió de prova està aprovada",
    "trial_approved_body": "Hem aprovat la teva sessió de prova. Confirma-la per reservar el teu lloc:",
    "trial_approved_note": "El teu lloc queda reservat, però necessitem que confirmis que hi assistiràs.",
    "trial_approved_confirm": "Confirmar la meva sessió",
    "trial_approved_decline": "No hi puc assistir",
    "trial_confirmed_subject": "Sessió de prova confirmada",
    "trial_confirmed_title": "Sessió de prova confirmada",
    "trial_confirmed_body": "Tot a punt! La teva sessió de prova està confirmada. T'adjuntem l'esdeveniment perquè l'afegeixis al teu calendari.",
    "trial_confirmed_note": "Si canvia alguna cosa, respon a aquest email.",
    "trial_cancelled_subject": "La teva sessió de prova ha estat cancel·lada",
    "trial_cancelled_title": "Sessió de prova cancel·lada",
    "trial_cancelled_body": "La teva sessió de prova del {when} ha estat cancel·lada. Pots sol·licitar-ne una de nova a la nostra web.",
    "trial_cancelled_button": "Demanar-ne una de nova",
}

TEXTS = {"es": TEXTS_ES, "en": TEXTS_EN, "ca": TEXTS_CA}
LANGUAGES = ("en", "es", "ca")


def normalize_language(value):
    """'en' | 'es' | 'ca' for a known value, otherwise None (never guesses)."""
    code = str(value or "").strip().lower()[:2]
    return code if code in LANGUAGES else None


def tr(lang, key, **values):
    """Text for `key` in `lang`, with {placeholders} filled in. A missing key
    in English falls back to Spanish."""
    text = TEXTS[lang].get(key)
    if text is None:
        text = TEXTS_ES[key]
    return text.format(**values) if values else text


def localized_email(lang, subject_key, build, title_key=None, **values):
    """A client email entirely in ONE language (subject, title, body, buttons,
    dates, plain text, <html lang>). With lang=None (records saved before the
    language was stored) it falls back to the older ES + EN layout.

    `build(l)` returns the blocks for language l (use tr(l, key))."""
    lang = normalize_language(lang)
    if lang is None:
        return bilingual_email(subject_key, build, title_key=title_key, **values)
    subject = tr(lang, subject_key, **values)
    title = tr(lang, title_key) if title_key else subject
    html, text = render_email(title=title, blocks=build(lang), preheader=subject, lang=lang)
    return subject, html, text


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

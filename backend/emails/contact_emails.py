"""E-mail to the studio when someone writes through the website's contact form."""
from .dates import format_date_bilingual, parse_madrid
from .template import button, heading, highlight_box, key_value, paragraph, site_url
from .texts import spanish_email


def _one_line(value, limit=120):
    return " ".join(str(value or "").split())[:limit]


def staff_contact_message(message):
    """(subject, html, text) for info@. `message` has name, email, message and
    created (a datetime, optional). Replying to this e-mail answers the sender."""
    name = _one_line(message.get("name"))
    when = message.get("created")
    sent = ""
    if when is not None:
        day = format_date_bilingual(parse_madrid(when.strftime("%Y-%m-%d"), when.strftime("%H:%M")))
        sent = f"{day.weekday_es} {day.date_es}, {day.time}"
    subject = f"Nuevo mensaje de contacto: {name}"

    def build():
        return [
            heading("Nuevo mensaje de contacto"),
            key_value([("Nombre", name), ("Email", message.get("email")), ("Recibido", sent)]),
            highlight_box(message.get("message") or "", label="Mensaje", mono=False),
            paragraph("Puedes responder directamente a este correo: la respuesta llega a quien escribió.", muted=True),
            button("Ver en el panel", "", f"{site_url()}/admin/messages", only="es"),
        ]

    return spanish_email(subject, build, preheader=f"{name}: {' '.join(str(message.get('message') or '').split())[:90]}")

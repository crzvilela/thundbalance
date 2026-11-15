"""E-mails of the error monitoring (monitoring.py). To the team only, in Spanish. They carry the TYPE of the error, WHERE it happens and
HOW MANY times: never a name, an address, a message of a user or any other personal data."""
from .template import heading, key_value, notice, paragraph
from .texts import spanish_email


def _rows(items):
    return [(f"{item['count']}×  {'Web' if item['source'] == 'frontend' else 'Servidor'}", f"{item['error_type']} · {item['where'] or item['route'] or '-'}") for item in items]


def digest_email(items):
    """(subject, html, text): the kinds of error that appeared since the last summary."""
    subject = f"Resumen diario · {len(items)} error{'es' if len(items) != 1 else ''} nuevo{'s' if len(items) != 1 else ''}"

    def build():
        return [
            heading("Errores nuevos desde el último resumen"),
            key_value(_rows(items)),
            paragraph("Revísalos en el panel de administración, en «Estado del sistema». Allí puedes marcarlos como vistos o resueltos.", muted=True),
        ]
    return spanish_email(subject, build, title="Resumen diario de errores")


def spike_email(count, minutes, items):
    """(subject, html, text): more than the allowed number of server errors in a few minutes."""
    subject = f"Alerta · {count} errores del servidor en {minutes} minutos"

    def build():
        blocks = [
            heading("Pico de errores del servidor"),
            paragraph(f"Se han registrado {count} respuestas con error del servidor en los últimos {minutes} minutos. Si la web no responde bien, avisa a quien la mantiene."),
        ]
        if items:
            blocks.append(key_value(_rows(items)))
        blocks.append(notice("Este aviso se envía como máximo una vez cada 6 horas.", tone="info"))
        return blocks
    return spanish_email(subject, build, title="Alerta de errores")

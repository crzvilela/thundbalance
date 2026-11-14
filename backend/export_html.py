"""The export of a client's data as ONE readable page: a self-contained .html file (privacy.py builds the data; this only writes it).

The data comes from privacy.build_export, the same dict the JSON file is made of, so the two formats can never differ in content.
The page is written in the language of the client (es | en | ca): human names for every field and value (no ids, no field names of the
database), dates in words, simple tables, only the sections that have data. It is safe to open by double click:
  * EVERY text that comes from the database is escaped (a name or a message with "<script>" is shown as text, it never runs);
  * the file has no script, no image, no font, no link and no other external resource: only HTML and an embedded stylesheet, and a
    Content-Security-Policy in the file itself (default-src 'none') so that nothing external could load even by mistake;
  * clean look for the screen and for printing / saving as PDF (white page, dark text, page breaks before the big sections).
"""
import re
from datetime import date, datetime
from html import escape

from emails.dates import MONTHS_CA, MONTHS_EN, MONTHS_ES, WEEKDAYS_CA, WEEKDAYS_EN, WEEKDAYS_ES, _ca_month

LANGUAGES = ("es", "en", "ca")
STUDIO = "ThundBalance"
BIG_SECTION_ROWS = 12                      # a table longer than this starts on a new page when printed

TEXTS = {
    "es": {
        "title": "Copia de tus datos", "exported": "Fecha de la exportación", "client": "Cliente", "empty": "—", "yes": "Sí", "no": "No",
        "intro": "Estos son los datos personales que ThundBalance conserva sobre ti. Puedes imprimir esta página o guardarla como PDF.",
        "personal": "Datos personales", "packs": "Mis packs", "sessions": "Mis sesiones", "reschedule": "Solicitudes de reprogramación",
        "inbox": "Mensajes recibidos", "contact": "Mis mensajes de contacto", "requests_trials": "Solicitudes y pruebas (trial)",
        "pack_requests": "Solicitudes de pack", "trials": "Sesiones de prueba", "emails": "Emails enviados",
        "emails_note": "Se indica el tipo y la fecha de cada email. El asunto y el texto no se guardan.",
        "name": "Nombre", "email": "Correo electrónico", "phone": "Teléfono", "phone_cc": "Prefijo", "city": "Ciudad", "address": "Dirección",
        "postal": "Código postal", "tax_type": "Tipo de documento", "tax_id": "Documento", "country": "País", "language": "Idioma",
        "registered": "Registrado el", "photo": "Foto de perfil", "photo_yes": "Sí (incluida en el archivo JSON técnico)",
        "pack": "Pack", "type": "Tipo", "status": "Estado", "start": "Inicio", "end": "Fin", "per_week": "Sesiones por semana", "days": "Días",
        "time": "Hora", "trainer": "Entrenador", "price_session": "Precio por sesión", "price_total": "Precio total", "weeks": "Semanas",
        "second": "Segunda persona", "extra": "Otros correos", "created": "Creado el", "replaced": "Sustituido el", "active": "Activo",
        "date": "Fecha", "number": "Nº", "rescheduled": "Reprogramada", "cancelled": "Cancelada el", "original": "Fecha actual",
        "requested": "Fecha solicitada", "your_note": "Tu nota", "studio_note": "Nota del estudio", "counter": "Contrapropuesta", "decided": "Resuelta el",
        "title_col": "Título", "message": "Mensaje", "read": "Leído el", "subject": "Asunto", "reason": "Motivo del rechazo", "goal": "Objetivo",
        "experience": "Experiencia", "age": "Edad", "birth": "Fecha de nacimiento", "sent": "Fecha", "kind": "Tipo", "state": "Estado",
        "individual": "Individual", "dual": "Dual", "generated": "Generado por ThundBalance",
    },
    "en": {
        "title": "Copy of your data", "exported": "Date of the export", "client": "Client", "empty": "—", "yes": "Yes", "no": "No",
        "intro": "This is the personal data ThundBalance holds about you. You can print this page or save it as a PDF.",
        "personal": "Personal data", "packs": "My packs", "sessions": "My sessions", "reschedule": "Reschedule requests",
        "inbox": "Messages received", "contact": "My contact messages", "requests_trials": "Requests and trial sessions",
        "pack_requests": "Pack requests", "trials": "Trial sessions", "emails": "Emails sent",
        "emails_note": "The type and the date of each email are listed. The subject and the text are not stored.",
        "name": "Name", "email": "Email", "phone": "Phone", "phone_cc": "Country code", "city": "City", "address": "Address",
        "postal": "Postal code", "tax_type": "Document type", "tax_id": "Document", "country": "Country", "language": "Language",
        "registered": "Registered on", "photo": "Profile photo", "photo_yes": "Yes (included in the technical JSON file)",
        "pack": "Pack", "type": "Type", "status": "Status", "start": "Start", "end": "End", "per_week": "Sessions per week", "days": "Days",
        "time": "Time", "trainer": "Trainer", "price_session": "Price per session", "price_total": "Total price", "weeks": "Weeks",
        "second": "Second person", "extra": "Other emails", "created": "Created on", "replaced": "Replaced on", "active": "Active",
        "date": "Date", "number": "No.", "rescheduled": "Rescheduled", "cancelled": "Cancelled on", "original": "Current date",
        "requested": "Requested date", "your_note": "Your note", "studio_note": "Studio note", "counter": "Counter-proposal", "decided": "Decided on",
        "title_col": "Title", "message": "Message", "read": "Read on", "subject": "Subject", "reason": "Reason for rejection", "goal": "Goal",
        "experience": "Experience", "age": "Age", "birth": "Date of birth", "sent": "Date", "kind": "Type", "state": "State",
        "individual": "Individual", "dual": "Dual", "generated": "Generated by ThundBalance",
    },
    "ca": {
        "title": "Còpia de les teves dades", "exported": "Data de l'exportació", "client": "Client", "empty": "—", "yes": "Sí", "no": "No",
        "intro": "Aquestes són les dades personals que ThundBalance conserva sobre tu. Pots imprimir aquesta pàgina o desar-la com a PDF.",
        "personal": "Dades personals", "packs": "Els meus packs", "sessions": "Les meves sessions", "reschedule": "Sol·licituds de reprogramació",
        "inbox": "Missatges rebuts", "contact": "Els meus missatges de contacte", "requests_trials": "Sol·licituds i proves (trial)",
        "pack_requests": "Sol·licituds de pack", "trials": "Sessions de prova", "emails": "Emails enviats",
        "emails_note": "S'indica el tipus i la data de cada email. L'assumpte i el text no es guarden.",
        "name": "Nom", "email": "Correu electrònic", "phone": "Telèfon", "phone_cc": "Prefix", "city": "Ciutat", "address": "Adreça",
        "postal": "Codi postal", "tax_type": "Tipus de document", "tax_id": "Document", "country": "País", "language": "Idioma",
        "registered": "Registrat el", "photo": "Foto de perfil", "photo_yes": "Sí (inclosa a l'arxiu JSON tècnic)",
        "pack": "Pack", "type": "Tipus", "status": "Estat", "start": "Inici", "end": "Fi", "per_week": "Sessions per setmana", "days": "Dies",
        "time": "Hora", "trainer": "Entrenador", "price_session": "Preu per sessió", "price_total": "Preu total", "weeks": "Setmanes",
        "second": "Segona persona", "extra": "Altres correus", "created": "Creat el", "replaced": "Substituït el", "active": "Actiu",
        "date": "Data", "number": "Núm.", "rescheduled": "Reprogramada", "cancelled": "Cancel·lada el", "original": "Data actual",
        "requested": "Data sol·licitada", "your_note": "La teva nota", "studio_note": "Nota de l'estudi", "counter": "Contraproposta", "decided": "Resolta el",
        "title_col": "Títol", "message": "Missatge", "read": "Llegit el", "subject": "Assumpte", "reason": "Motiu del rebuig", "goal": "Objectiu",
        "experience": "Experiència", "age": "Edat", "birth": "Data de naixement", "sent": "Data", "kind": "Tipus", "state": "Estat",
        "individual": "Individual", "dual": "Dual", "generated": "Generat per ThundBalance",
    },
}

LANGUAGE_NAMES = {"es": "Español", "en": "English", "ca": "Català"}

# values the database stores in English, written in the language of the client (anything unknown is shown tidied up, never hidden)
STATUS = {
    "es": {"booked": "Reservada", "cancelled": "Cancelada", "canceled": "Cancelada", "completed": "Completada", "pending": "Pendiente", "approved": "Aprobada",
           "rejected": "Rechazada", "confirmed": "Confirmada", "declined": "Rechazada por el cliente", "archived": "Archivada", "active": "Activo", "replaced": "Sustituido",
           "countered": "Contrapropuesta", "accepted": "Aceptada", "sent": "Enviado", "failed": "Fallido", "no_show": "No asistió", "expired": "Caducada"},
    "en": {"booked": "Booked", "cancelled": "Cancelled", "canceled": "Cancelled", "completed": "Completed", "pending": "Pending", "approved": "Approved",
           "rejected": "Rejected", "confirmed": "Confirmed", "declined": "Declined by the client", "archived": "Archived", "active": "Active", "replaced": "Replaced",
           "countered": "Counter-proposal", "accepted": "Accepted", "sent": "Sent", "failed": "Failed", "no_show": "No show", "expired": "Expired"},
    "ca": {"booked": "Reservada", "cancelled": "Cancel·lada", "canceled": "Cancel·lada", "completed": "Completada", "pending": "Pendent", "approved": "Aprovada",
           "rejected": "Rebutjada", "confirmed": "Confirmada", "declined": "Rebutjada pel client", "archived": "Arxivada", "active": "Actiu", "replaced": "Substituït",
           "countered": "Contraproposta", "accepted": "Acceptada", "sent": "Enviat", "failed": "Fallit", "no_show": "No hi va assistir", "expired": "Caducada"},
}
EMAIL_KINDS = {
    "es": {"pack_summary": "Resumen de tu pack", "welcome": "Bienvenida", "trial": "Sesión de prueba", "trial_approved": "Sesión de prueba aprobada", "session": "Sesión",
           "reschedule": "Cambio de fecha", "deletion_request": "Solicitud de eliminación", "system": "Aviso", "password": "Contraseña"},
    "en": {"pack_summary": "Your pack summary", "welcome": "Welcome", "trial": "Trial session", "trial_approved": "Trial session approved", "session": "Session",
           "reschedule": "Date change", "deletion_request": "Deletion request", "system": "Notice", "password": "Password"},
    "ca": {"pack_summary": "Resum del teu pack", "welcome": "Benvinguda", "trial": "Sessió de prova", "trial_approved": "Sessió de prova aprovada", "session": "Sessió",
           "reschedule": "Canvi de data", "deletion_request": "Sol·licitud d'eliminació", "system": "Avís", "password": "Contrasenya"},
}
WEEKDAY_NAMES = {"es": WEEKDAYS_ES, "en": WEEKDAYS_EN, "ca": WEEKDAYS_CA}
MONTH_NAMES = {"es": MONTHS_ES, "en": MONTHS_EN, "ca": MONTHS_CA}


def esc(value):
    """Everything that comes from the database goes through here: it can never become markup."""
    return escape("" if value is None else str(value), quote=True)


def _tidy(value):
    return re.sub(r"\s+", " ", str(value or "").replace("_", " ").replace("-", " ")).strip().capitalize()


def _word(table, lang, value):
    key = str(value or "").strip().lower().replace(" ", "_")
    return table[lang].get(key) or _tidy(value)


def _parse(value):
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", ""))
    except ValueError:
        try:
            return datetime.combine(date.fromisoformat(text[:10]), datetime.min.time())
        except ValueError:
            return None


def day_text(lang, value):
    """"14 de noviembre de 2026" / "14 November 2026" / "14 de novembre de 2026"; the value as it came when it is not a date."""
    moment = _parse(value)
    if moment is None:
        return "" if value in (None, "") else str(value)
    index = moment.month - 1
    if lang == "es":
        return f"{moment.day} de {MONTHS_ES[index]} de {moment.year}"
    if lang == "ca":
        return f"{moment.day} {_ca_month(index)} de {moment.year}"
    return f"{moment.day} {MONTHS_EN[index]} {moment.year}"


def moment_text(lang, value):
    """A date with its time when the value has one ("14 de noviembre de 2026, 18:30")."""
    moment = _parse(value)
    if moment is None:
        return day_text(lang, value)
    has_time = len(str(value)) > 10 and (moment.hour or moment.minute)
    return f"{day_text(lang, value)}, {moment:%H:%M}" if has_time else day_text(lang, value)


def clock(value):
    return str(value or "")[:5]


def money(value):
    if value in (None, ""):
        return ""
    number = float(value)
    return f"{number:.0f} €" if number == int(number) else f"{number:.2f} €".replace(".", ",")


def days_text(lang, value):
    names = {english.lower(): local for english, local in zip(WEEKDAYS_EN, WEEKDAY_NAMES[lang])}
    parts = [part.strip() for part in re.split(r"[,;]", str(value or "")) if part.strip()]
    return ", ".join(names.get(part.lower(), part).capitalize() for part in parts)


def _table(headers, rows):
    head = "".join(f"<th>{esc(label)}</th>" for label in headers)
    body = "".join("<tr>" + "".join(f'<td data-label="{esc(label)}">{esc(cell)}</td>' for label, cell in zip(headers, row)) + "</tr>" for row in rows)
    return f'<div class="scroll"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'


def _section(title, content, rows=0, note=""):
    css = "big" if rows > BIG_SECTION_ROWS else ""
    return f'<section class="{css}"><h2>{esc(title)}</h2>{content}{f'<p class="note">{esc(note)}</p>' if note else ""}</section>'


STYLE = """
*{box-sizing:border-box}
body{margin:0;background:#fff;color:#1a1a1a;font:16px/1.5 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:980px;margin:0 auto;padding:28px 18px 60px}
header{border-bottom:2px solid #1a1a1a;padding-bottom:16px;margin-bottom:24px}
.studio{font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:#555;margin:0}
h1{font-size:30px;margin:6px 0 10px}
.meta{margin:0;color:#444;font-size:15px}
.intro{color:#444;margin:0 0 8px}
h2{font-size:20px;margin:34px 0 10px;border-bottom:1px solid #ccc;padding-bottom:6px}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{border:1px solid #d4d4d4;padding:7px 9px;text-align:left;vertical-align:top;white-space:pre-wrap;word-break:break-word}
th{background:#f3f3f3;font-weight:600}
dl{display:grid;grid-template-columns:minmax(120px,220px) 1fr;gap:6px 16px;margin:0}
dt{font-weight:600;color:#333}
dd{margin:0;white-space:pre-wrap;word-break:break-word}
.note{color:#555;font-size:13px;margin:8px 0 0}
footer{margin-top:40px;color:#777;font-size:12px;border-top:1px solid #ddd;padding-top:10px}
@media (max-width:640px){
 main{padding:18px 12px 40px}h1{font-size:24px}dl{grid-template-columns:1fr}dt{margin-top:6px}
 table,thead,tbody,tr,th,td{display:block}thead{display:none}
 tr{border:1px solid #d4d4d4;margin-bottom:10px;border-radius:6px;overflow:hidden}
 td{border:0;border-bottom:1px solid #eee}td::before{content:attr(data-label) ": ";font-weight:600}
}
@media print{
 body{background:#fff;color:#000;font-size:12px}main{max-width:none;padding:0}
 th{background:none;border-bottom:2px solid #000}th,td{border-color:#999}
 section{break-inside:auto}section.big{break-before:page}tr{break-inside:avoid}h2{break-after:avoid}
 .scroll{overflow:visible}
}
"""


def _list(lang, rows):
    """Key / value pairs of the personal data (empty values are left out)."""
    items = "".join(f"<dt>{esc(label)}</dt><dd>{esc(value)}</dd>" for label, value in rows if value not in (None, ""))
    return f"<dl>{items}</dl>"


def render_html(data, lang):
    """The whole page as text, for `data` (privacy.build_export) in `lang` (es | en | ca; Spanish for anything else)."""
    lang = lang if lang in LANGUAGES else "es"
    t = TEXTS[lang]
    profile = data.get("profile") or {}
    sections = []

    sections.append(_section(t["personal"], _list(lang, [
        (t["name"], profile.get("name")), (t["email"], profile.get("email")), (t["phone"], profile.get("phone")),
        (t["phone_cc"], profile.get("phone_country_code")), (t["city"], profile.get("city")), (t["address"], profile.get("address")),
        (t["postal"], profile.get("postal_code")), (t["tax_type"], profile.get("tax_id_type")), (t["tax_id"], profile.get("tax_id")),
        (t["country"], profile.get("country")), (t["language"], LANGUAGE_NAMES.get(profile.get("language"), "")),
        (t["registered"], day_text(lang, profile.get("created_at"))),
        (t["photo"], t["photo_yes"] if data.get("photo") else ""),
    ])))

    def second(row):
        return " · ".join(part for part in (row.get("second_person_name"), row.get("second_person_email")) if part)

    packs = data.get("packs") or []
    if packs:
        rows = [[p.get("pack"), t["dual" if p.get("session_type") == "dual" else "individual"], t["active"] if p.get("active") else _word(STATUS, lang, p.get("status") or "replaced"),
                 day_text(lang, p.get("start_date")), day_text(lang, p.get("end_date")), p.get("sessions_per_week"), days_text(lang, p.get("preferred_days")),
                 clock(p.get("preferred_time")), p.get("trainer"), money(p.get("price_per_session")), money(p.get("total_price")), second(p),
                 ", ".join(p.get("extra_emails") or []), day_text(lang, p.get("created_at"))] for p in packs]
        headers = [t[key] for key in ("pack", "type", "status", "start", "end", "per_week", "days", "time", "trainer", "price_session", "price_total", "second", "extra", "created")]
        sections.append(_section(t["packs"], _table(headers, rows), len(rows)))

    sessions = data.get("sessions") or []
    if sessions:
        rows = [[day_text(lang, s.get("date")), clock(s.get("time")), _word(STATUS, lang, s.get("status")), s.get("number"), s.get("trainer"),
                 t["yes"] if s.get("rescheduled") else "", moment_text(lang, s.get("cancelled_at"))] for s in sessions]
        headers = [t[key] for key in ("date", "time", "status", "number", "trainer", "rescheduled", "cancelled")]
        sections.append(_section(t["sessions"], _table(headers, rows), len(rows)))

    reschedule = data.get("reschedule_requests") or []
    if reschedule:
        rows = [[f"{day_text(lang, r.get('original_date'))} {clock(r.get('original_time'))}".strip(), f"{day_text(lang, r.get('requested_date'))} {clock(r.get('requested_time'))}".strip(),
                 r.get("client_note"), _word(STATUS, lang, r.get("status")), r.get("admin_note"),
                 f"{day_text(lang, r.get('counter_date'))} {clock(r.get('counter_time'))}".strip(), moment_text(lang, r.get("decided_at"))] for r in reschedule]
        headers = [t[key] for key in ("original", "requested", "your_note", "status", "studio_note", "counter", "decided")]
        sections.append(_section(t["reschedule"], _table(headers, rows), len(rows)))

    inbox = data.get("inbox") or []
    if inbox:
        rows = [[moment_text(lang, m.get("created_at")), m.get("title"), m.get("body"), moment_text(lang, m.get("read_at"))] for m in inbox]
        sections.append(_section(t["inbox"], _table([t[key] for key in ("date", "title_col", "message", "read")], rows), len(rows)))

    contact = data.get("contact_messages") or []
    if contact:
        rows = [[moment_text(lang, m.get("created_at")), m.get("subject"), m.get("message"), m.get("phone")] for m in contact]
        sections.append(_section(t["contact"], _table([t[key] for key in ("date", "subject", "message", "phone")], rows), len(rows)))

    pack_requests, trials = data.get("pack_requests") or [], data.get("trial_sessions") or []
    if pack_requests or trials:
        parts, count = [], 0
        if pack_requests:
            rows = [[moment_text(lang, r.get("created_at")), r.get("pack"), t["dual" if r.get("session_type") == "dual" else "individual"], r.get("sessions_per_week"),
                     days_text(lang, r.get("preferred_days")), clock(r.get("preferred_time")), _word(STATUS, lang, r.get("status")), day_text(lang, r.get("start_date")),
                     r.get("trainer"), r.get("rejection_reason"), second(r)] for r in pack_requests]
            headers = [t[key] for key in ("date", "pack", "type", "per_week", "days", "time", "status", "start", "trainer", "reason", "second")]
            parts.append(f"<h3>{esc(t['pack_requests'])}</h3>" + _table(headers, rows))
            count += len(rows)
        if trials:
            rows = [[moment_text(lang, r.get("created_at")), day_text(lang, r.get("date")), clock(r.get("time")), _word(STATUS, lang, r.get("status")), r.get("trainer"),
                     t["dual" if r.get("session_type") == "dual" else "individual"], r.get("goal"), r.get("experience"), r.get("age"), day_text(lang, r.get("birth_date")),
                     r.get("phone"), second(r), money(r.get("price_per_session"))] for r in trials]
            headers = [t[key] for key in ("created", "date", "time", "status", "trainer", "type", "goal", "experience", "age", "birth", "phone", "second", "price_session")]
            parts.append(f"<h3>{esc(t['trials'])}</h3>" + _table(headers, rows))
            count += len(rows)
        sections.append(_section(t["requests_trials"], "".join(parts), count))

    emails = data.get("emails_sent") or []
    if emails:
        rows = [[moment_text(lang, e.get("sent_at")), _word(EMAIL_KINDS, lang, e.get("type")), _word(STATUS, lang, e.get("state"))] for e in emails]
        sections.append(_section(t["emails"], _table([t[key] for key in ("sent", "kind", "state")], rows), len(rows), t["emails_note"]))

    exported = day_text(lang, (data.get("export") or {}).get("generated_at"))
    title = f"{STUDIO} · {t['title']}"
    return (
        f'<!DOCTYPE html>\n<html lang="{lang}"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">'
        f"<title>{esc(title)}</title><style>{STYLE}</style></head><body><main>"
        f'<header><p class="studio">{esc(STUDIO)}</p><h1>{esc(t["title"])}</h1>'
        f'<p class="meta">{esc(t["exported"])}: {esc(exported)} · {esc(t["client"])}: {esc(profile.get("name"))}</p></header>'
        f'<p class="intro">{esc(t["intro"])}</p>' + "".join(sections) +
        f'<footer>{esc(t["generated"])}</footer></main></body></html>'
    )

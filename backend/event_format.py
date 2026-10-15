"""The one place that decides how a calendar event LOOKS: title, description,
colour, times and the private tag that marks it as created by this app.

Every path that creates, edits or synchronises an event (new pack, renewal,
approved request, new client with a pack, trial confirmation, "Sincronizar con
calendario", rescheduling) goes through build_session_event() or
build_trial_event(), so the format can not drift between them.

Titles
  pack session   "David Madrenas 2/8"      (name + last surname + x/n, no "PT")
  trial session  "Trial Session - David Madrenas"
The x/n of a pack session is the number stored when the pack was created
(sessions.session_number): it is FIXED, cancelling a session never renumbers
the others.

No tax id and no postal address ever go into an event.
"""
from datetime import datetime, timedelta

TIMEZONE = "Europe/Madrid"
LOCATION = "ThundBalance Personal Training Studio"
SESSION_MINUTES = 60

# Private extended properties on every event the app creates, so a future
# clean-up can find exactly those events (events.list privateExtendedProperty=app=thundbalance).
APP_PROPERTY = "app"
APP_VALUE = "thundbalance"
SESSION_PROPERTY = "thundbalance_session_id"
TRIAL_PROPERTY = "thundbalance_trial_id"

TRAINER_COLORS = {"Carles": "1", "David": "2", "Guille": "3", "Matilda": "4"}
TRIAL_COLOR = "10"

_WEEKDAYS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


def display_name(full_name):
    """"David Madrenas Pérez" -> "David Pérez"; one single name stays as it is.

    First name + LAST surname, as asked: "{Nome} {Último sobrenome}"."""
    parts = str(full_name or "").split()
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    return f"{parts[0]} {parts[-1]}"


def session_title(full_name, session_number=None):
    name = display_name(full_name)
    number = str(session_number or "").strip()
    return f"{name} {number}".strip() if number else name


def trial_title(full_name):
    name = display_name(full_name)
    return f"Trial Session - {name}" if name else "Trial Session"


def _day_text(session_date):
    day = datetime.fromisoformat(str(session_date)[:10])
    return f"{_WEEKDAYS_ES[day.weekday()]} {day.strftime('%d/%m/%Y')}"


def _hours_text(session_time):
    start = datetime.strptime(str(session_time)[:5], "%H:%M")
    end = start + timedelta(minutes=SESSION_MINUTES)
    return f"{start:%H:%M} - {end:%H:%M}"


def _lines(pairs):
    """"Label: value" lines; a line without a value is left out."""
    return "\n".join(f"{label}: {value}" for label, value in pairs if str(value or "").strip())


def session_description(client_name, client_email, client_phone, session_date, session_time,
                        trainer_name, pack_name, session_number):
    pack = " · ".join(
        part for part in (
            str(pack_name or "").strip(),
            f"sesión {str(session_number).strip()}" if str(session_number or "").strip() else "",
        ) if part
    )
    return _lines([
        ("Cliente", client_name),
        ("Email", client_email),
        ("Teléfono", client_phone),
        ("Día", _day_text(session_date)),
        ("Horario", _hours_text(session_time)),
        ("Entrenador", trainer_name),
        ("Pack", pack),
    ])


def trial_description(full_name, email, phone, session_date, session_time, trainer_name,
                      goal=None, experience=None):
    return _lines([
        ("Cliente", full_name),
        ("Email", email),
        ("Teléfono", phone),
        ("Día", _day_text(session_date)),
        ("Horario", _hours_text(session_time)),
        ("Entrenador", trainer_name),
        ("Pack", "Trial Session"),
        ("Objetivos", goal),
        ("Experiencia", experience),
    ])


def event_times(session_date, session_time):
    start = datetime.fromisoformat(f"{str(session_date)[:10]} {str(session_time)[:5]}")
    end = start + timedelta(minutes=SESSION_MINUTES)
    return (
        {"dateTime": start.isoformat(), "timeZone": TIMEZONE},
        {"dateTime": end.isoformat(), "timeZone": TIMEZONE},
    )


def build_session_event(*, client_name, client_email=None, client_phone=None, session_date, session_time,
                        trainer_name=None, pack_name=None, session_number=None, session_id=None):
    """Body of the Google event of one pack session (no "id": the caller adds
    the deterministic one)."""
    start, end = event_times(session_date, session_time)
    private = {APP_PROPERTY: APP_VALUE}
    if session_id is not None:
        private[SESSION_PROPERTY] = str(session_id)
    return {
        "summary": session_title(client_name, session_number),
        "location": LOCATION,
        "description": session_description(
            client_name, client_email, client_phone, session_date, session_time,
            trainer_name, pack_name, session_number,
        ),
        "colorId": TRAINER_COLORS.get(trainer_name, "1"),
        "start": start,
        "end": end,
        "extendedProperties": {"private": private},
    }


def build_trial_event(*, full_name, email=None, phone=None, session_date, session_time,
                      trainer_name=None, goal=None, experience=None, trial_id=None):
    """Body of the Google event of a CONFIRMED trial session."""
    start, end = event_times(session_date, session_time)
    private = {APP_PROPERTY: APP_VALUE}
    if trial_id is not None:
        private[TRIAL_PROPERTY] = str(trial_id)
    return {
        "summary": trial_title(full_name),
        "location": LOCATION,
        "description": trial_description(
            full_name, email, phone, session_date, session_time, trainer_name, goal, experience,
        ),
        "colorId": TRIAL_COLOR,
        "start": start,
        "end": end,
        "extendedProperties": {"private": private},
    }


def differs(existing, wanted):
    """True when an event already in Google does not show what `wanted` says
    (title, description, start or end). Used by "Sincronizar" to decide
    whether to update, so a second press changes nothing."""
    if (existing.get("summary") or "") != wanted["summary"]:
        return True
    if (existing.get("description") or "").strip() != wanted["description"].strip():
        return True
    for key in ("start", "end"):
        if str((existing.get(key) or {}).get("dateTime") or "")[:16] != wanted[key]["dateTime"][:16]:
            return True
    return False

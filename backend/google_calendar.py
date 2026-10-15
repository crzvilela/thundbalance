"""The ONLY module that talks to Google Calendar.

Which calendar? The id comes from ONE environment variable, GOOGLE_CALENDAR_ID,
read in ONE place (get_calendar_id). There is no default and no id anywhere in
the code. For the studio the value is the calendar's own email
(pt@thundbalance.com): it is used exactly as written (trimmed), without
checking it for a "@group.calendar.google.com" ending.

The word "primary" is refused on purpose: for a service account "primary" is
the service account's OWN empty calendar, never the one of pt@. Share the
calendar with the service account (Configuración > Compartir con personas
concretas > "Hacer cambios en eventos") and put its id in GOOGLE_CALENDAR_ID.

Event titles and descriptions are built in event_format.py.
"""
import base64
import json
import os

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

import event_format

SCOPES = [
    "https://www.googleapis.com/auth/calendar"
]

CALENDAR_ENV = "GOOGLE_CALENDAR_ID"

# Next to this file, so it works no matter which folder the server starts in.
SERVICE_ACCOUNT_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "credentials.json"
)


class CalendarNotConfigured(RuntimeError):
    """GOOGLE_CALENDAR_ID is missing or unusable. The message never contains the id."""


def _read_env(name):
    """Value of an environment variable, tolerating stray spaces or a
    different capitalisation in the NAME (easy to get wrong in a dashboard)."""

    for key, value in os.environ.items():
        if key.strip().upper() == name:
            return value

    return ""


def get_calendar_id():
    """The calendar id, read from GOOGLE_CALENDAR_ID every time (so a changed
    variable needs no code change). Trimmed, used otherwise as is.

    Raises CalendarNotConfigured when it is empty or "primary"."""
    # Spaces, line breaks or quotes pasted around the value are not part of it.
    value = _read_env(CALENDAR_ENV).strip().strip("'\"").strip()
    if not value:
        raise CalendarNotConfigured(f"la variable {CALENDAR_ENV} no está definida o está vacía")
    if value.lower() == "primary":
        raise CalendarNotConfigured(
            f'{CALENDAR_ENV} no puede ser "primary": para una cuenta de servicio es SU propio '
            "calendario, no el de pt@. Usa el email/ID del calendario compartido"
        )
    return value


def mask_calendar_id(calendar_id):
    """Only the last 6 characters, e.g. "…ce.com"."""
    return f"…{calendar_id[-6:]}"


def describe_target():
    """Which calendar this server writes to (masked), for logs and the panel:
    {"configured": bool, "calendar": "…ce.com" | None, "reason": text | None}."""
    try:
        return {"configured": True, "calendar": mask_calendar_id(get_calendar_id()), "reason": None}
    except CalendarNotConfigured as error:
        return {"configured": False, "calendar": None, "reason": str(error)}


def http_status(error):
    """HTTP status of a Google API error (None for anything else)."""
    return getattr(getattr(error, "resp", None), "status", None)


STATUS_HINTS = {
    401: "credenciales rechazadas",
    403: 'falta el permiso "Hacer cambios en eventos" para la cuenta de servicio',
    404: "ID de calendario incorrecto o calendario no compartido con la cuenta de servicio",
    429: "demasiadas peticiones, reintenta en un momento",
}


def describe_error(error):
    """Short, safe text for a failure (never a token, an id or a message body)."""
    if isinstance(error, CalendarNotConfigured):
        return f"Calendar no configurado: {error}"[:200]
    status = http_status(error)
    if status:
        hint = STATUS_HINTS.get(int(status))
        return f"Google Calendar HTTP {status}" + (f" ({hint})" if hint else "")
    return f"{type(error).__name__}"


def load_credentials():
    """Service-account credentials for the calendar.

    On a server (Render) the key is NOT stored as a file in the code: put the
    full JSON in the GOOGLE_CREDENTIALS_JSON environment variable (plain JSON,
    or the same JSON encoded as base64). Locally, credentials.json is used.
    """

    raw = _read_env("GOOGLE_CREDENTIALS_JSON").strip().strip('"').strip("'").strip()

    if raw:
        if not raw.startswith("{"):
            raw = base64.b64decode(raw).decode("utf-8")

        # strict=False tolerates real line breaks inside the private key.
        return service_account.Credentials.from_service_account_info(
            json.loads(raw, strict=False),
            scopes=SCOPES
        )

    if not os.path.exists(SERVICE_ACCOUNT_FILE):
        # Names only, never values: helps spot a mistyped variable name.
        similar = sorted(
            key for key in os.environ
            if "GOOGLE" in key.upper() or "CRED" in key.upper()
        )
        raise RuntimeError(
            "Google Calendar is not configured on this server: the "
            "GOOGLE_CREDENTIALS_JSON environment variable is empty or missing "
            f"(similar variable names seen: {similar or 'none'}). Set it to the "
            "full contents of credentials.json and redeploy."
        )

    return service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE,
        scopes=SCOPES
    )


def get_calendar_service():

    credentials = load_credentials()

    return build(
        "calendar",
        "v3",
        credentials=credentials
    )


def status_line():
    """One line for the startup log: "Calendar: OK (…ce.com)" when the
    calendar can be read, otherwise "Calendar: NÃO configurado (motivo)".
    Only reads the calendar's metadata; never raises, never prints the id."""
    target = describe_target()
    if not target["configured"]:
        return f"Calendar: NÃO configurado ({target['reason']})"
    try:
        check_access()
    except Exception as error:  # noqa: BLE001 - the server must start anyway
        return f"Calendar: NÃO configurado ({describe_error(error)}) [{target['calendar']}]"
    return f"Calendar: OK ({target['calendar']})"


def check_access():
    """Reads the calendar's metadata (nothing is changed). Raises the Google
    error when the id is wrong (404) or the calendar is not shared (403/404)."""
    calendar_id = get_calendar_id()
    return get_calendar_service().calendars().get(calendarId=calendar_id).execute()


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

def _insert(service, body, event_id):
    """Inserts an event with a deterministic id and returns (id, created).

    A 409 means "already there" (this very session was created before):
    nothing is duplicated and created is False. If somebody deleted it in
    Google its id is still reserved, so it is brought back (created is True)."""
    calendar_id = get_calendar_id()
    if event_id:
        body = {**body, "id": event_id}
    try:
        created_event = service.events().insert(calendarId=calendar_id, body=body).execute()
    except HttpError as error:
        if http_status(error) == 409 and event_id:
            existing = service.events().get(calendarId=calendar_id, eventId=event_id).execute()
            if existing.get("status") == "cancelled":
                service.events().update(
                    calendarId=calendar_id, eventId=event_id, body={**body, "status": "confirmed"}
                ).execute()
                print("EVENT RESTORED:", event_id)
                return event_id, True
            print("EVENT ALREADY EXISTED:", event_id)
            return event_id, False
        raise
    print("EVENT CREATED:", created_event["id"])
    return created_event["id"], True


def create_calendar_event_status(
    trainer_name,
    client_name,
    client_email,
    session_date,
    session_time,
    session_number=None,
    event_id=None,
    session_id=None,
    client_phone=None,
    pack_name=None
):
    """Creates the event of a client session. Returns (event_id, created).

    event_id (base32hex, derived from the session id) makes the call
    idempotent: a second call for the same session finds the event already
    there (HTTP 409) and returns created=False instead of a duplicate."""
    body = event_format.build_session_event(
        client_name=client_name, client_email=client_email, client_phone=client_phone,
        session_date=session_date, session_time=session_time, trainer_name=trainer_name,
        pack_name=pack_name, session_number=session_number, session_id=session_id,
    )
    return _insert(get_calendar_service(), body, event_id)


def create_calendar_event(*args, **kwargs):
    """Same as create_calendar_event_status, returning only the event id."""
    return create_calendar_event_status(*args, **kwargs)[0]


def get_calendar_event(event_id):
    return get_calendar_service().events().get(
        calendarId=get_calendar_id(), eventId=event_id
    ).execute()


def delete_calendar_event(
    event_id
):

    service = get_calendar_service()

    service.events().delete(
        calendarId=get_calendar_id(),
        eventId=event_id
    ).execute()

    print("EVENT DELETED:", event_id)


def update_calendar_event(
    event_id,
    session_date,
    session_time,
    **details
):
    """Moves an event to a new day / hour. With the session's details
    (client_name, client_email, client_phone, trainer_name, pack_name,
    session_number) the title and description are rewritten as well, so a
    moved event never keeps the old "Día" and "Horario" lines."""

    service = get_calendar_service()

    if details:
        body = event_format.build_session_event(
            session_date=session_date, session_time=session_time, **details
        )
        # Keep what the event already has: the colour is the trainer's, the
        # private tag is added only if missing.
        body = {key: body[key] for key in ("summary", "description", "start", "end", "extendedProperties")}
    else:
        start, end = event_format.event_times(session_date, session_time)
        body = {"start": start, "end": end}

    print("EVENT ID:", event_id)
    print("UPDATING EVENT...")

    service.events().patch(
        calendarId=get_calendar_id(),
        eventId=event_id,
        body=body
    ).execute()

    print("EVENT UPDATED:", event_id)


def patch_calendar_event(event_id, body):
    """Applies the fields of `body` (built by event_format) to an event."""
    get_calendar_service().events().patch(
        calendarId=get_calendar_id(), eventId=event_id, body=body
    ).execute()
    print("EVENT UPDATED:", event_id)


# ---------------------------------------------------------------------------
# Trial sessions: the event exists only once the client has CONFIRMED.
# ---------------------------------------------------------------------------

def create_trial_session_event(
    full_name,
    email,
    phone,
    goal,
    experience,
    session_date,
    session_time,
    trainer_name=None,
    event_id=None,
    trial_id=None
):
    """Creates the event of a confirmed trial session ("Trial Session - Ana
    Ruiz") and returns its id. With a deterministic event_id calling it twice
    finds the first event instead of creating a second one."""

    body = event_format.build_trial_event(
        full_name=full_name, email=email, phone=phone, session_date=session_date,
        session_time=session_time, trainer_name=trainer_name, goal=goal,
        experience=experience, trial_id=trial_id,
    )
    return _insert(get_calendar_service(), body, event_id)[0]


def update_trial_session_event(
    event_id,
    full_name,
    email,
    phone,
    goal,
    experience,
    session_date,
    session_time,
    trainer_name=None,
    trial_id=None
):
    """Rewrites title, description and time of an existing trial event (the
    same event: confirming never creates a second one). Raises if the event
    does not exist any more; the caller decides what to do then."""

    body = event_format.build_trial_event(
        full_name=full_name, email=email, phone=phone, session_date=session_date,
        session_time=session_time, trainer_name=trainer_name, goal=goal,
        experience=experience, trial_id=trial_id,
    )
    patch_calendar_event(event_id, {
        key: body[key] for key in ("summary", "description", "start", "end", "colorId", "extendedProperties")
    })


def clear_calendar():
    """Deletes the events THIS APP created (tagged app=thundbalance).

    Events somebody added by hand in the calendar are never touched: the
    calendar is the studio's real, shared one."""

    service = get_calendar_service()
    calendar_id = get_calendar_id()
    page_token = None
    deleted = 0

    while True:
        response = service.events().list(
            calendarId=calendar_id,
            privateExtendedProperty=f"{event_format.APP_PROPERTY}={event_format.APP_VALUE}",
            maxResults=250,
            pageToken=page_token
        ).execute()

        for event in response.get("items", []):

            try:

                service.events().delete(
                    calendarId=calendar_id,
                    eventId=event["id"]
                ).execute()

                deleted += 1

            except Exception:

                pass

        page_token = response.get("nextPageToken")

        if not page_token:
            break

    print("GOOGLE CALENDAR CLEARED (events created by the app):", deleted)
    return deleted


def list_calendar_events(time_min, time_max):
    """Events between two RFC3339 instants, in Europe/Madrid time.

    Recurring events are expanded and results are paginated until Google has
    no more pages, so a busy month is returned completely.
    """

    service = get_calendar_service()
    calendar_id = get_calendar_id()
    events = []
    page_token = None

    while True:
        response = service.events().list(
            calendarId=calendar_id,
            timeMin=time_min,
            timeMax=time_max,
            singleEvents=True,
            orderBy="startTime",
            timeZone="Europe/Madrid",
            maxResults=250,
            pageToken=page_token
        ).execute()

        events.extend(response.get("items", []))
        page_token = response.get("nextPageToken")

        if not page_token:
            return events

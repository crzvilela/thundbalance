"""Feature switches read from the environment.

CLIENT_CALENDAR_ENABLED (default: off) controls everything that puts sessions in the
CLIENT's own calendar:
  - the subscription feed (/calendar/feed/{token}.ics) and the endpoints that give,
    regenerate or download calendar links and .ics files of the client area;
  - the .ics attached to the pack, welcome and trial emails, the "Add to Google
    Calendar" button, the subscription link and every sentence that talks about them;
  - the calendar buttons and menus of the "My Sessions" page and the dashboard;
  - the "client calendar" state and "copy calendar link" button of the admin panel.
The code stays in place: turning the variable on (true / 1 / yes / on) brings it all back.

The studio's own Google Calendar (the events the app creates for pt@) has nothing to do
with this switch.
"""
import os

TRUE_VALUES = ("1", "true", "yes", "on")


def _hours_from_environment(name, default, lowest=1, highest=24 * 14):
    """A whole number of hours from the environment, or `default` when it is missing or not sensible."""
    try:
        value = int(os.getenv(name, "").strip())
    except ValueError:
        return default
    return value if lowest <= value <= highest else default


# How long before a session the client may still ask to change its date, and the time a client has to answer a proposal
# of the studio (the proposal expires that many hours before the session). THE one place of this number: the backend, the
# page (GET /features), the texts and the e-mails all follow it. RESCHEDULE_MIN_HOURS_BEFORE in the environment changes it.
RESCHEDULE_MIN_HOURS_BEFORE = _hours_from_environment("RESCHEDULE_MIN_HOURS_BEFORE", 24)


def reschedule_min_hours_before():
    """Read at every call (so a test, or the environment at start-up, can change RESCHEDULE_MIN_HOURS_BEFORE)."""
    return RESCHEDULE_MIN_HOURS_BEFORE


def client_calendar_enabled():
    """Read at every call, so changing the variable needs no code change."""
    return os.getenv("CLIENT_CALENDAR_ENABLED", "").strip().lower() in TRUE_VALUES

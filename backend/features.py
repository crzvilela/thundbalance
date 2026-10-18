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


def client_calendar_enabled():
    """Read at every call, so changing the variable needs no code change."""
    return os.getenv("CLIENT_CALENDAR_ENABLED", "").strip().lower() in TRUE_VALUES

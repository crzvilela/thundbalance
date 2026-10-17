"""Titles of the calendar events a CLIENT receives (the .ics attached to the
emails and the subscription feed). One place, so every path writes the same text.

    "ThundBalance · Sesión con Matilda 1/12"      a pack session (position/total of its pack)
    "ThundBalance · Trial Session con Matilda"    a trial session

The studio's own Google Calendar uses event_format.session_title / trial_title
("Ana Ruiz 1/12", "Trial Session - Ana Ruiz"); the x/n is the same number
(sessions.session_number), which is FIXED when the pack is created: cancelling a
session never renumbers the others.

SEQUENCE: calendar apps replace an event they already have only when its SEQUENCE
grows. A change of title is a change of the event, so TITLE_VERSION is added to the
SEQUENCE of every pack session. Raise it by one whenever the title format changes
again: events already added to a client's calendar then update by themselves (the
.ics of the email and the feed always compute the same number for the same session).
"""

TITLE_VERSION = 1
BRAND = "ThundBalance"


def _first_name(full_name):
    parts = str(full_name or "").split()
    return parts[0] if parts else ""


def client_session_title(trainer_name, session_number=None):
    """"ThundBalance · Sesión con Matilda 1/12"; without a trainer or a number
    those parts are simply left out."""
    title = f"{BRAND} · Sesión"
    trainer = _first_name(trainer_name)
    if trainer:
        title += f" con {trainer}"
    number = str(session_number or "").strip()
    if number:
        title += f" {number}"
    return title


def client_trial_title(trainer_name):
    """"ThundBalance · Trial Session con Matilda"."""
    trainer = _first_name(trainer_name)
    return f"{BRAND} · Trial Session" + (f" con {trainer}" if trainer else "")


def session_sequence(feed_sequence=0):
    """SEQUENCE of a pack session: its own counter (bumped on cancel/move) plus the title version."""
    return int(feed_sequence or 0) + TITLE_VERSION

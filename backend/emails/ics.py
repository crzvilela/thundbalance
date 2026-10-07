"""Minimal iCalendar (RFC 5545) writer, no dependencies.

Times are written in UTC ("...Z"), converted from Europe/Madrid, which avoids
needing a VTIMEZONE block.
"""
from datetime import datetime, timedelta, timezone

from .dates import madrid_to_utc

PRODID = "-//ThundBalance//Emails//ES"
UID_DOMAIN = "thundbalance.com"


def _escape(text):
    """TEXT value escaping (RFC 5545 3.3.11); newlines become \\n."""
    return (
        str(text).replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
        .replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\\n")
    )


def _fold(line):
    """Fold to at most 75 octets per line, never splitting a UTF-8 character."""
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return line
    parts, current, size = [], "", 0
    for char in line:
        width = len(char.encode("utf-8"))
        limit = 75 if not parts else 74  # continuation lines start with a space
        if size + width > limit:
            parts.append(current)
            current, size = "", 0
        current += char
        size += width
    parts.append(current)
    return "\r\n ".join(parts)


def _utc(moment):
    return madrid_to_utc(moment).strftime("%Y%m%dT%H%M%SZ")


def build_ics(events, stamp=None):
    """iCalendar text for a list of events.

    Each event is a dict: id (used for the stable UID "{id}@thundbalance.com"),
    start (naive = Madrid time, or aware), optional end (default start + 1 h),
    summary, optional description, location, url.
    """
    stamp = (stamp or datetime.now(timezone.utc)).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", f"PRODID:{PRODID}", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"]
    for event in events:
        start = event["start"]
        end = event.get("end") or (start + timedelta(hours=1))
        lines += [
            "BEGIN:VEVENT",
            f"UID:{event['id']}@{UID_DOMAIN}",
            f"DTSTAMP:{stamp}",
            f"DTSTART:{_utc(start)}",
            f"DTEND:{_utc(end)}",
            f"SUMMARY:{_escape(event['summary'])}",
        ]
        if event.get("description"):
            lines.append(f"DESCRIPTION:{_escape(event['description'])}")
        if event.get("location"):
            lines.append(f"LOCATION:{_escape(event['location'])}")
        if event.get("url"):
            lines.append(f"URL:{event['url']}")
        lines += ["STATUS:CONFIRMED", "SEQUENCE:0", "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(line) for line in lines) + "\r\n"

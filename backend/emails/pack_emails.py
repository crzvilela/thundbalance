"""Email with a client's pack: plan, period, schedule, every session, and a
.ics with all of them.

    summary = {
        "client_name", "client_email", "plan_name", "sessions_per_week",
        "days": ["Monday", ...],             # English weekday names, as stored
        "trainer": "Carles",
        "sessions": [{"id": 7, "start": datetime (Madrid), "trainer": "Carles", "number": "3/12"}, ...],
    }

render_pack_summary_block(summary, lang) -> Block   (HTML + text, reusable in other emails)
send_pack_summary_email(summary, ...)   -> PackEmailResult
"""
import logging
from dataclasses import dataclass, field

from .dates import WEEKDAYS_CA, WEEKDAYS_EN, WEEKDAYS_ES, format_date_bilingual
from .ics import build_ics
from calendar_titles import client_session_title, session_sequence
from client_lang import resolve_client_lang
from features import client_calendar_enabled
from .recipients import clean_recipients
from .session_kind import kind_rows
from .template import Block, STUDIO_PLACE, button, heading, highlight_box, key_value, link_line, paragraph, sessions_table
from .texts import localized_email, normalize_language, tr
from .transport import send_email_async, validate_address

logger = logging.getLogger("thundbalance.emails")

ICS_PLACE = "ThundBalance, Carrer de Pallars 286, Barcelona"
SEND_TIMEOUT = 40  # seconds to wait for the sends before reporting

# One shape for every email that carries a pack's .ics (pack email, welcome email).
ICS_FILENAME = "thundbalance-sesiones.ics"
ICS_CONTENT_TYPE = "text/calendar"   # METHOD:PUBLISH is inside the file; Gmail shows "Add to calendar"


def pack_ics_attachment(summary, lang=None):
    """The attachment dict send_email() expects, for a pack summary (its text in `lang`); None when the
    client calendar is switched off (CLIENT_CALENDAR_ENABLED)."""
    if not client_calendar_enabled():
        return None
    return {
        "filename": ICS_FILENAME,
        "content_type": ICS_CONTENT_TYPE,
        "data": build_pack_ics(summary, lang).encode("utf-8"),
    }


def _one_line(value, limit=80):
    return " ".join(str(value or "").split())[:limit]


def _join(blocks):
    return Block("".join(block.html for block in blocks), "\n".join(block.text for block in blocks))


def _ordered_sessions(summary):
    return sorted(summary["sessions"], key=lambda item: item["start"])


def _day_names(days, lang):
    names = {"es": WEEKDAYS_ES, "ca": WEEKDAYS_CA}.get(lang, WEEKDAYS_EN)
    order = {name: index for index, name in enumerate(WEEKDAYS_EN)}
    known = sorted((day for day in days if day in order), key=lambda day: order[day])
    return ", ".join(names[order[day]].capitalize() for day in known)


def _day_label(moment, lang):
    """"Lunes, 12 de octubre de 2026" / "Monday, 12 October 2026" / "Dilluns, 12 d'octubre de 2026": the day in `lang`
    (own tables, nothing depends on the server's locale)."""
    day = format_date_bilingual(moment)
    return f"{day.weekday(lang).capitalize()}, {day.date(lang)}"


def render_pack_summary_block(summary, lang="en"):
    """Pack summary (key-value rows) followed by the table of every session, ordered by date, with the weekdays, months and
    dates in `lang` (en | es | ca). Returns one Block."""
    lang = normalize_language(lang) or "en"
    sessions = _ordered_sessions(summary)
    return _join([
        key_value([
            (tr(lang, "lbl_plan"), summary.get("plan_name")),
            *([(tr(lang, "lbl_duration"), tr(lang, "dur_weeks", n=summary["duration_weeks"]))] if summary.get("duration_weeks") else []),
            (tr(lang, "lbl_start"), _day_label(sessions[0]["start"], lang)),
            (tr(lang, "lbl_end"), _day_label(sessions[-1]["start"], lang)),
            (tr(lang, "lbl_per_week"), summary.get("sessions_per_week")),
            (tr(lang, "lbl_days"), _day_names(summary.get("days") or [], lang)),
            (tr(lang, "lbl_total"), len(sessions)),
            *kind_rows(lang, summary, total=True),
        ]),
        paragraph(tr(lang, "pack_sessions_title")),
        sessions_table([{"start": item["start"], "trainer": item.get("trainer")} for item in sessions], lang),
    ])


def build_pack_ics(summary, lang=None):
    """One 60-minute event per session, Europe/Madrid, UID {id}@thundbalance.com. Its text is in `lang` (one language)."""
    lang = normalize_language(lang or summary.get("lang")) or "en"
    return build_ics([
        {
            "id": f"session-{item['id']}",
            "start": item["start"],
            "summary": client_session_title(item.get("trainer"), item.get("number")),
            "sequence": session_sequence(item.get("feed_sequence", 0)),
            "description": f"{tr(lang, 'lbl_trainer')}: {item['trainer']}" if item.get("trainer") else "",
            "location": ICS_PLACE,
        }
        for item in _ordered_sessions(summary)
    ])


def render_calendar_links_block(links, lang="es"):
    """"Add to my Google Calendar" button, ".ics" link, the feed URL to copy
    (Apple Calendar / Outlook) and the refresh-delay notice. `links` is the
    dict of calendar_feed.feed_urls(); without it the block is empty."""
    if not links:
        return Block("", "")
    return _join([
        button(None, None, links["google"], label=tr(lang, "cal_add_google")),
        link_line(None, None, links["https"], label=tr(lang, "cal_download_ics")),
        highlight_box(links["https"], label=tr(lang, "cal_other_apps")),
        paragraph(tr(lang, "cal_delay_note"), muted=True),
    ])


def build_pack_email(summary, team_subject=False, lang=None):
    """(subject, html, text) entirely in ONE language: the client's (`lang`, else summary["lang"], else English). The team
    copy (team_subject) is in Spanish, its subject also carries the client's name, and it has no calendar subscription
    link (that link belongs to the client).
    summary["calendar_links"] (optional) adds the calendar buttons."""
    lang = "es" if team_subject else (normalize_language(lang or summary.get("lang")) or "en")
    calendar_on = client_calendar_enabled()
    links = None if team_subject or not calendar_on else summary.get("calendar_links")

    def build(lang):
        blocks = [
            heading(tr(lang, "pack_title")),
            paragraph(tr(lang, "greeting", name=_one_line(summary.get("client_name")))),
            paragraph(tr(lang, "pack_intro")),
            render_pack_summary_block(summary, lang),
            key_value([(tr(lang, "lbl_place"), STUDIO_PLACE)]),
        ]
        if calendar_on:          # nothing about calendars when the client calendar is off
            blocks += [paragraph(tr(lang, "pack_ics_note")), render_calendar_links_block(links, lang)]
        return blocks
    subject, html, text = localized_email(lang, "pack_subject", build, title_key="pack_title")
    if team_subject:
        subject = f"{subject} — {_one_line(summary.get('client_name'))}"
    return subject, html, text


@dataclass
class PackEmailResult:
    sent_to: list = field(default_factory=list)
    failed: list = field(default_factory=list)
    problem: str = ""     # short safe reason when something could not be sent

    @property
    def ok(self):
        return bool(self.sent_to) and not self.failed and not self.problem


def send_pack_summary_email(summary, to_client=True, extra_recipients=()):
    """Sends the pack email: to the client (if to_client) and, in a second
    message whose subject names the client, to the extra recipients. Both
    messages carry the same .ics. Never raises; waits for the answer so the
    caller can tell the admin what happened."""
    result = PackEmailResult()
    try:
        client_email = None
        if to_client:
            try:
                client_email = validate_address(summary.get("client_email"), "client email").lower()
            except ValueError:
                result.problem = "client_email_invalid"
        extras = clean_recipients(extra_recipients, exclude=[client_email] if client_email else [])

        jobs = []   # (addresses, future)
        if client_email:
            lang = resolve_client_lang(booking_lang=summary.get("lang"), email=client_email)     # the client's language, one language
            attachment = pack_ics_attachment(summary, lang)
            subject, html, text = build_pack_email(summary, lang=lang)
            jobs.append(([client_email], send_email_async(client_email, subject, html, text, attachments=[attachment] if attachment else None, kind="pack_summary", lang=lang)))
        if extras:
            attachment = pack_ics_attachment(summary, "es")
            subject, html, text = build_pack_email(summary, team_subject=True)               # the team's copy: Spanish
            jobs.append((extras, send_email_async(extras, subject, html, text, attachments=[attachment] if attachment else None, kind="pack_summary_team", lang="es")))
        if not jobs and not result.problem:
            result.problem = "no_recipients"

        for addresses, future in jobs:
            try:
                answer = future.result(timeout=SEND_TIMEOUT)
            except Exception:  # noqa: BLE001 - timeout or worker error
                answer = None
            if answer is not None and answer.ok:
                result.sent_to += addresses
            else:
                result.failed += addresses
                result.problem = result.problem or (answer.error if answer is not None else "timeout")
    except ValueError as error:
        result.problem = "invalid_recipients"
        logger.error("Pack email not sent: %s", error)
    except Exception as error:  # noqa: BLE001
        result.problem = "error"
        logger.error("Pack email failed (%s)", type(error).__name__)
    return result

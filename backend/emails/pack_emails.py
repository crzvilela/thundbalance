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

from .dates import WEEKDAYS_EN, WEEKDAYS_ES, format_date_bilingual
from .ics import build_ics
from .recipients import clean_recipients
from .template import Block, STUDIO_PLACE, heading, key_value, paragraph, sessions_table
from .texts import bilingual_email, tr
from .transport import send_email_async, validate_address

logger = logging.getLogger("thundbalance.emails")

ICS_PLACE = "ThundBalance, Carrer de Pallars 286, Barcelona"
SEND_TIMEOUT = 40  # seconds to wait for the sends before reporting


def _one_line(value, limit=80):
    return " ".join(str(value or "").split())[:limit]


def _join(blocks):
    return Block("".join(block.html for block in blocks), "\n".join(block.text for block in blocks))


def _ordered_sessions(summary):
    return sorted(summary["sessions"], key=lambda item: item["start"])


def _day_names(days, lang):
    names = WEEKDAYS_ES if lang == "es" else WEEKDAYS_EN
    order = {name: index for index, name in enumerate(WEEKDAYS_EN)}
    known = sorted((day for day in days if day in order), key=lambda day: order[day])
    return ", ".join(names[order[day]].capitalize() for day in known)


def render_pack_summary_block(summary, lang="es"):
    """Pack summary (key-value rows) followed by the table of every session,
    ordered by date. Returns one Block."""
    sessions = _ordered_sessions(summary)
    first = format_date_bilingual(sessions[0]["start"])
    last = format_date_bilingual(sessions[-1]["start"])
    pick = (lambda d: d.date_es) if lang == "es" else (lambda d: d.date_en)
    return _join([
        key_value([
            (tr(lang, "lbl_plan"), summary.get("plan_name")),
            (tr(lang, "lbl_start"), f"{first.weekday_es.capitalize() if lang == 'es' else first.weekday_en}, {pick(first)}"),
            (tr(lang, "lbl_end"), f"{last.weekday_es.capitalize() if lang == 'es' else last.weekday_en}, {pick(last)}"),
            (tr(lang, "lbl_per_week"), summary.get("sessions_per_week")),
            (tr(lang, "lbl_days"), _day_names(summary.get("days") or [], lang)),
            (tr(lang, "lbl_total"), len(sessions)),
        ]),
        paragraph(tr(lang, "pack_sessions_title")),
        sessions_table([{"start": item["start"], "trainer": item.get("trainer")} for item in sessions], lang),
    ])


def build_pack_ics(summary):
    """One 60-minute event per session, Europe/Madrid, UID {id}@thundbalance.com."""
    return build_ics([
        {
            "id": f"session-{item['id']}",
            "start": item["start"],
            "summary": " · ".join(
                part for part in ("ThundBalance", f"Sesión {item['number']}" if item.get("number") else "", item.get("trainer")) if part
            ),
            "description": f"Entrenador / Trainer: {item['trainer']}" if item.get("trainer") else "",
            "location": ICS_PLACE,
        }
        for item in _ordered_sessions(summary)
    ])


def build_pack_email(summary, team_subject=False):
    """(subject, html, text): Spanish first, English below. With team_subject
    the subject also carries the client's name."""
    def build(lang):
        return [
            heading(tr(lang, "pack_title")),
            paragraph(tr(lang, "greeting", name=_one_line(summary.get("client_name")))),
            paragraph(tr(lang, "pack_intro")),
            render_pack_summary_block(summary, lang),
            key_value([(tr(lang, "lbl_place"), STUDIO_PLACE)]),
            paragraph(tr(lang, "pack_ics_note"), muted=True),
        ]
    subject, html, text = bilingual_email("pack_subject", build, title_key="pack_title")
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

        attachment = {
            "filename": "thundbalance-sesiones.ics",
            "content_type": "text/calendar",
            "data": build_pack_ics(summary).encode("utf-8"),
        }
        jobs = []   # (addresses, future)
        if client_email:
            subject, html, text = build_pack_email(summary)
            jobs.append(([client_email], send_email_async(client_email, subject, html, text, attachments=[attachment])))
        if extras:
            subject, html, text = build_pack_email(summary, team_subject=True)
            jobs.append((extras, send_email_async(extras, subject, html, text, attachments=[attachment])))
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

"""The reschedule-request emails.

To the studio (Spanish only): a request arrived, the client answered a proposal.
To the client (ONE language each, the one saved with the request, English by default):
approved, rejected, a proposal with two buttons, or "the studio moved your session".
No calendar files and no calendar buttons: nothing about the client's calendar.

`ctx` is the dict built by reschedule_requests._context / _moved_context.
"""
from .dates import format_date_bilingual, parse_madrid
from .template import STUDIO_PLACE, button, heading, key_value, paragraph, site_url
from .texts import localized_email, normalize_language, spanish_email, tr

DEFAULT_LANGUAGE = "en"


def language_of(ctx):
    return normalize_language(ctx.get("lang")) or DEFAULT_LANGUAGE


def _one_line(value, limit=120):
    return " ".join(str(value or "").split())[:limit]


def _day(day, time):
    return format_date_bilingual(parse_madrid(day, time))


def _when(lang, day, time):
    return _day(day, time).full(lang)


def _button(lang, key, url):
    return button("", "", url, label=tr(lang, key))


def response_url(token, action=None, lang=None):
    """The public page that answers a proposal. Opening it decides NOTHING: the buttons on the page do."""
    params = [f"action={action}"] if action else []
    if lang:
        params.append(f"lang={lang}")
    base = f"{site_url()}/reschedule-response/{token}"
    return f"{base}?{'&'.join(params)}" if params else base


# ------------------------------------------------------------ to the studio (Spanish)

def staff_reschedule_requested(ctx):
    name = _one_line(ctx.get("client_name"))
    subject = tr("es", "rs_staff_req_subject", name=name, number=ctx.get("number") or "")

    def build():
        original, wanted = _day(ctx["original_date"], ctx["original_time"]), _day(ctx["requested_date"], ctx["requested_time"])
        return [
            heading(tr("es", "rs_staff_req_title")),
            key_value([
                (tr("es", "rs_lbl_client"), f"{name} · {ctx.get('client_email')}"),
                (tr("es", "rs_lbl_session"), ctx.get("number")),
                (tr("es", "lbl_trainer"), ctx.get("trainer")),
                (tr("es", "rs_lbl_original"), f"{original.weekday_es} {original.date_es}, {original.time}"),
                (tr("es", "rs_lbl_requested"), f"{wanted.weekday_es} {wanted.date_es}, {wanted.time}"),
                (tr("es", "rs_lbl_note"), ctx.get("client_note")),
            ]),
            paragraph(tr("es", "rs_staff_req_manage"), muted=True),
            button(tr("es", "rs_staff_button"), "", f"{site_url()}/admin/calendar?tab=requests", only="es"),
        ]
    return spanish_email(subject, build, preheader=subject)


def staff_counter_answer(ctx, accepted):
    name = _one_line(ctx.get("client_name"))
    prefix = "rs_staff_acc" if accepted else "rs_staff_dec"
    subject = tr("es", f"{prefix}_subject", name=name, number=ctx.get("number") or "")

    def build():
        proposed = _day(ctx["counter_date"], ctx["counter_time"])
        return [
            heading(tr("es", f"{prefix}_title")),
            key_value([
                (tr("es", "rs_lbl_client"), f"{name} · {ctx.get('client_email')}"),
                (tr("es", "rs_lbl_session"), ctx.get("number")),
                (tr("es", "rs_lbl_proposed"), f"{proposed.weekday_es} {proposed.date_es}, {proposed.time}"),
            ]),
            paragraph(tr("es", f"{prefix}_note"), muted=True),
            button(tr("es", "rs_staff_button"), "", f"{site_url()}/admin/calendar?tab=requests", only="es"),
        ]
    return spanish_email(subject, build, preheader=subject)


# ------------------------------------------------------------ to the client (one language)

def _greeting(lang, ctx):
    first = (str(ctx.get("client_name") or "").split() or [""])[0]
    return paragraph(tr(lang, "greeting", name=first))


def client_reschedule_approved(ctx):
    """The session moved to the requested day and hour."""
    lang = language_of(ctx)

    def build(l):
        return [
            heading(tr(l, "rs_ok_title")), _greeting(l, ctx), paragraph(tr(l, "rs_ok_body")),
            key_value([
                (tr(l, "rs_lbl_new"), _when(l, ctx["session_date"], ctx["session_time"])),
                (tr(l, "rs_lbl_old"), _when(l, ctx["original_date"], ctx["original_time"])),
                (tr(l, "lbl_trainer"), ctx.get("trainer")),
                (tr(l, "lbl_place"), STUDIO_PLACE),
            ]),
        ]
    return localized_email(lang, "rs_ok_subject", build, title_key="rs_ok_title")


def client_session_moved(ctx):
    """The studio moved the session without a request."""
    lang = language_of(ctx)

    def build(l):
        blocks = [
            heading(tr(l, "rs_moved_title")), _greeting(l, ctx), paragraph(tr(l, "rs_moved_body")),
            key_value([
                (tr(l, "rs_lbl_new"), _when(l, ctx["session_date"], ctx["session_time"])),
                (tr(l, "rs_lbl_old"), _when(l, ctx["original_date"], ctx["original_time"])),
                (tr(l, "lbl_trainer"), ctx.get("trainer")),
                (tr(l, "lbl_place"), STUDIO_PLACE),
            ]),
        ]
        if ctx.get("admin_note"):
            blocks.append(key_value([(tr(l, "rs_lbl_reason"), ctx["admin_note"])]))
        return blocks
    return localized_email(lang, "rs_moved_subject", build, title_key="rs_moved_title")


def client_reschedule_rejected(ctx):
    """The session stays as it was; the studio's reason is shown when there is one."""
    lang = language_of(ctx)

    def build(l):
        blocks = [
            heading(tr(l, "rs_no_title")), _greeting(l, ctx), paragraph(tr(l, "rs_no_body")),
            key_value([(tr(l, "rs_lbl_old"), _when(l, ctx["original_date"], ctx["original_time"]))]),
        ]
        if ctx.get("admin_note"):
            blocks.append(key_value([(tr(l, "rs_lbl_reason"), ctx["admin_note"])]))
        return blocks
    return localized_email(lang, "rs_no_subject", build, title_key="rs_no_title")


def client_reschedule_counter(ctx):
    """A proposal with two buttons. The buttons open the public page: the answer is decided there, by a click."""
    lang = language_of(ctx)

    def build(l):
        blocks = [
            heading(tr(l, "rs_counter_title")), _greeting(l, ctx), paragraph(tr(l, "rs_counter_body")),
            key_value([
                (tr(l, "rs_lbl_old"), _when(l, ctx["original_date"], ctx["original_time"])),
                (tr(l, "rs_lbl_new"), _when(l, ctx["counter_date"], ctx["counter_time"])),
                (tr(l, "lbl_trainer"), ctx.get("trainer")),
            ]),
        ]
        if ctx.get("admin_note"):
            blocks.append(key_value([(tr(l, "rs_lbl_reason"), ctx["admin_note"])]))
        blocks += [
            _button(l, "rs_counter_accept", response_url(ctx["token"], "accept", lang)),
            _button(l, "rs_counter_decline", response_url(ctx["token"], "decline", lang)),
            paragraph(tr(l, "rs_counter_note"), muted=True),
        ]
        return blocks
    return localized_email(lang, "rs_counter_subject", build, title_key="rs_counter_title")

"""Emails to the client about their trial session (received, approved,
confirmed, cancelled). Built with the shared base in backend/emails and sent
through the same Apps Script channel as every other email, in the background.
Failures are logged and never raised.
"""
from client_lang import resolve_client_lang
from emails import send_email_async
from emails.dates import parse_madrid
from emails.trial_emails import (
    client_trial_approved, client_trial_cancelled, client_trial_confirmed, client_trial_received,
)


def _lang(to, lang):
    """The language of an email to the client: the booking's own, else the client's profile, else English."""
    return resolve_client_lang(booking_lang=lang, email=to)


def _send(to, built, kind, lang, reference=None, **options):
    subject, html, text = built[:3]
    return send_email_async(to, subject, html, text, kind=kind, lang=lang, reference=reference, **options)


def send_trial_received(to, name, date_text, time_text, lang=None, reference=None, details=None):
    """details: {session_type, second_person_name, price_per_session} of the trial (nothing is sent to the second person)."""
    lang = _lang(to, lang)
    return _send(to, client_trial_received(name, parse_madrid(date_text, time_text), lang, details), "trial_received", lang, reference)


def send_trial_approved(to, name, date_text, time_text, trainer, token, lang=None, reference=None, details=None):
    lang = _lang(to, lang)
    return _send(to, client_trial_approved(name, parse_madrid(date_text, time_text), trainer, token, lang, details), "trial_approved", lang, reference)


def send_trial_confirmed(to, name, date_text, time_text, trainer, trial_id, lang=None, reference=None, details=None):
    lang = _lang(to, lang)
    built = client_trial_confirmed(name, parse_madrid(date_text, time_text), trainer, trial_id, lang, details)
    options = {}
    if built[3]:           # None when the client calendar is off
        options["attachments"] = [{"filename": "thundbalance-sesion-de-prueba.ics", "content_type": "text/calendar", "data": built[3].encode("utf-8")}]
    return _send(to, built, "trial_confirmed", lang, reference, **options)


def send_trial_cancelled(to, name, date_text, time_text, lang=None, reference=None,
                         trial_id=None, trainer=None, sequence=1):
    """With trial_id (the session had been confirmed) the email carries a calendar file that
    cancels the event the client had added."""
    lang = _lang(to, lang)
    built = client_trial_cancelled(name, parse_madrid(date_text, time_text), lang, trial_id, trainer, sequence)
    options = {}
    if built[3]:
        options["attachments"] = [{"filename": "thundbalance-sesion-de-prueba-cancelada.ics",
                                   "content_type": "text/calendar; method=CANCEL", "data": built[3].encode("utf-8")}]
    return _send(to, built, "trial_cancelled", lang, reference, **options)

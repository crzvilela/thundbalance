"""Emails to the client about their trial session (received, approved,
confirmed, cancelled). Built with the shared base in backend/emails and sent
through the same Apps Script channel as every other email, in the background.
Failures are logged and never raised.
"""
from emails import send_email_async
from emails.dates import parse_madrid
from emails.trial_emails import (
    client_trial_approved, client_trial_cancelled, client_trial_confirmed, client_trial_received,
)


def _send(to, built, **options):
    subject, html, text = built[:3]
    return send_email_async(to, subject, html, text, **options)


def send_trial_received(to, name, date_text, time_text):
    return _send(to, client_trial_received(name, parse_madrid(date_text, time_text)))


def send_trial_approved(to, name, date_text, time_text, trainer, token):
    return _send(to, client_trial_approved(name, parse_madrid(date_text, time_text), trainer, token))


def send_trial_confirmed(to, name, date_text, time_text, trainer, trial_id):
    built = client_trial_confirmed(name, parse_madrid(date_text, time_text), trainer, trial_id)
    attachment = {"filename": "thundbalance-sesion-de-prueba.ics", "content_type": "text/calendar", "data": built[3].encode("utf-8")}
    return _send(to, built, attachments=[attachment])


def send_trial_cancelled(to, name, date_text, time_text):
    return _send(to, client_trial_cancelled(name, parse_madrid(date_text, time_text)))

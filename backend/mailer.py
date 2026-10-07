"""Emails to clients about their trial-session request (approved, declined,
cancelled). Built with the shared base in backend/emails and sent through the
same Apps Script channel as every other email (see emails/transport.py), so
they work on Render's free plan. Failures are logged and never raised.
"""
from emails import send_email_async
from emails.dates import parse_madrid
from emails.trial_emails import client_trial_approved, client_trial_cancelled, client_trial_rejected


def _send(to, built):
    subject, html, text = built
    return send_email_async(to, subject, html, text)


def send_trial_approved(to, name, date_text, time_text, trainer):
    return _send(to, client_trial_approved(name, parse_madrid(date_text, time_text), trainer))


def send_trial_rejected(to, name, reason):
    return _send(to, client_trial_rejected(name, reason or ""))


def send_trial_cancelled(to, name, date_text, time_text):
    return _send(to, client_trial_cancelled(name, parse_madrid(date_text, time_text)))

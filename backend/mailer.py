"""Emails to clients about their trial-session request.

Sent through Gmail SMTP with an app password, configured with the environment
variables MAIL_USER and MAIL_PASSWORD. Without them nothing is sent (and
nothing breaks). Sending happens in a background thread, so a slow or failing
mail server can never make an approval fail.
"""
import os
import smtplib
import threading
import traceback
from datetime import datetime
from email.message import EmailMessage
from html import escape

MAIL_USER = os.getenv("MAIL_USER", "")
MAIL_PASSWORD = os.getenv("MAIL_PASSWORD", "").replace(" ", "")
MAIL_FROM_NAME = os.getenv("MAIL_FROM_NAME", "Thundbalance")
SITE_URL = os.getenv("SITE_URL", "https://thundbalance.vercel.app")

_DAYS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
_DAYS_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _when(date_text, time_text):
    try:
        day = datetime.strptime(str(date_text)[:10], "%Y-%m-%d")
    except ValueError:
        return f"{date_text} {time_text}", f"{date_text} {time_text}"
    stamp = day.strftime("%d/%m/%Y")
    return (
        f"{_DAYS_EN[day.weekday()]} {stamp} at {time_text}",
        f"{_DAYS_ES[day.weekday()]} {stamp} a las {time_text}",
    )


def _page(title_en, title_es, body_en, body_es):
    def block(title, body):
        return (
            f'<h2 style="margin:0 0 8px;font-size:20px;color:#10b981">{title}</h2>'
            f'<p style="margin:0 0 20px;line-height:1.6;color:#e5e7eb">{body}</p>'
        )
    return (
        '<div style="background:#0a0a0a;padding:32px 16px;font-family:system-ui,Arial,sans-serif">'
        '<div style="max-width:520px;margin:0 auto;background:#111;border:1px solid #222;'
        'border-radius:16px;padding:28px">'
        '<p style="margin:0 0 20px;font-size:13px;letter-spacing:.2em;color:#9ca3af">THUNDBALANCE</p>'
        + block(title_es, body_es)
        + '<hr style="border:none;border-top:1px solid #222;margin:8px 0 20px">'
        + block(title_en, body_en)
        + f'<p style="margin:0;font-size:12px;color:#6b7280">{escape(SITE_URL)}</p>'
        '</div></div>'
    )


def _send(to, subject, html, text):
    if not (MAIL_USER and MAIL_PASSWORD and to):
        print("Email not sent (MAIL_USER / MAIL_PASSWORD not set or no address).")
        return
    try:
        message = EmailMessage()
        message["From"] = f"{MAIL_FROM_NAME} <{MAIL_USER}>"
        message["To"] = to
        message["Subject"] = subject
        message.set_content(text)
        message.add_alternative(html, subtype="html")
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=15) as server:
            server.login(MAIL_USER, MAIL_PASSWORD)
            server.send_message(message)
    except Exception:
        traceback.print_exc()


def _send_in_background(*args):
    threading.Thread(target=_send, args=args, daemon=True).start()


def _plain(*parts):
    return "\n\n".join(parts)


def send_trial_approved(to, name, date_text, time_text, trainer):
    en, es = _when(date_text, time_text)
    n = escape(name or "")
    t = escape(trainer or "")
    html = _page(
        "Your trial session is confirmed", "Tu sesión de prueba está confirmada",
        f"Hi {n}, your trial session is booked for <b>{en}</b> with <b>{t}</b>. See you there!",
        f"Hola {n}, tu sesión de prueba está reservada para el <b>{es}</b> con <b>{t}</b>. ¡Te esperamos!",
    )
    text = _plain(
        f"Hola {name}, tu sesión de prueba está reservada: {es}, con {trainer}. ¡Te esperamos!",
        f"Hi {name}, your trial session is booked: {en}, with {trainer}. See you there!",
    )
    _send_in_background(to, "Tu sesión de prueba está confirmada · Trial session confirmed", html, text)


def send_trial_rejected(to, name, reason):
    n = escape(name or "")
    why_en = f" Reason: {escape(reason)}." if reason else ""
    why_es = f" Motivo: {escape(reason)}." if reason else ""
    html = _page(
        "About your trial session request", "Sobre tu solicitud de sesión de prueba",
        f"Hi {n}, unfortunately we cannot offer the time you asked for.{why_en} "
        "You are welcome to request another day or time on our website.",
        f"Hola {n}, lamentablemente no podemos ofrecerte el horario que pediste.{why_es} "
        "Puedes solicitar otro día u hora en nuestra web.",
    )
    text = _plain(
        f"Hola {name}, no podemos ofrecerte el horario solicitado.{why_es} Puedes pedir otro en {SITE_URL}.",
        f"Hi {name}, we cannot offer the requested time.{why_en} You can request another at {SITE_URL}.",
    )
    _send_in_background(to, "Sobre tu sesión de prueba · About your trial session", html, text)


def send_trial_cancelled(to, name, date_text, time_text):
    en, es = _when(date_text, time_text)
    n = escape(name or "")
    html = _page(
        "Your trial session was cancelled", "Tu sesión de prueba ha sido cancelada",
        f"Hi {n}, your trial session on <b>{en}</b> has been cancelled. "
        "You can request a new one on our website.",
        f"Hola {n}, tu sesión de prueba del <b>{es}</b> ha sido cancelada. "
        "Puedes solicitar una nueva en nuestra web.",
    )
    text = _plain(
        f"Hola {name}, tu sesión de prueba del {es} ha sido cancelada. Solicita otra en {SITE_URL}.",
        f"Hi {name}, your trial session on {en} was cancelled. Request a new one at {SITE_URL}.",
    )
    _send_in_background(to, "Sesión de prueba cancelada · Trial session cancelled", html, text)

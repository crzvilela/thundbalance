"""The Gmail API mail provider: the message (UTF-8, multipart, Bcc, Message-ID), the retries, the fallback to the legacy
provider when the delegation is not active, the admin's test endpoint and that nothing personal reaches the logs.

    python -m unittest test_gmail_api -v

Gmail is faked (no network): the service object is replaced; the legacy Apps Script is a local fake server.
"""
import base64
import email
import json
import logging
import os
import threading
import unittest
from email import policy
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest import mock

import testsafety  # noqa: F401
from fastapi import HTTPException
from googleapiclient.errors import HttpError

import admin_api
import main
from emails import gmail_api, health, transport

RECEIVED = []


class Script(BaseHTTPRequestHandler):
    def do_POST(self):
        RECEIVED.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"ok": true}')

    def log_message(self, *args):
        pass


class Response:
    def __init__(self, status):
        self.status, self.reason = status, "x"


def http_error(status):
    return HttpError(Response(status), b"{}")


class FakeService:
    """Stands in for gmail users().messages().send(userId, body).execute()."""
    def __init__(self, failures=()):
        self.failures = list(failures)
        self.sent = []
        self.user = None
        self.pending = None

    def users(self):
        return self

    def messages(self):
        return self

    def send(self, userId, body):
        self.user = userId
        self.pending = body
        return self

    def execute(self):
        if self.failures:
            raise self.failures.pop(0)
        self.sent.append(self.pending)
        return {"id": "1"}


def parsed(service):
    raw = base64.urlsafe_b64decode(service.sent[-1]["raw"])
    return email.message_from_bytes(raw, policy=policy.default)


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), Script)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        RECEIVED.clear()
        gmail_api.reset()
        self.env = mock.patch.dict(os.environ, {
            "MAIL_PROVIDER": "gmail_api", "MAIL_FROM_EMAIL": "pt@thundbalance.com", "MAIL_FROM_NAME": "ThundBalance",
            "MAIL_REPLY_TO": "pt@thundbalance.com",
            "TRIAL_EMAIL_WEBHOOK_URL": f"http://127.0.0.1:{self.server.server_port}/exec", "TRIAL_EMAIL_WEBHOOK_SECRET": "s"})
        self.env.start()
        self.service = FakeService()
        self.patch = mock.patch.object(gmail_api, "_service", lambda: self.service)
        self.patch.start()
        self.nosleep = mock.patch.object(gmail_api.time, "sleep", lambda *_: None)
        self.nosleep.start()

    def tearDown(self):
        self.nosleep.stop()
        self.patch.stop()
        self.env.stop()
        gmail_api.reset()


class Message(Base):
    def test_utf8_subject_and_body_and_headers(self):
        subject = "Confirmación de sesión — Reservació d'ñ ç"
        result = transport.send_email("cliente@example.com", subject, "<p>Hola, sesión con ñ y ç</p>", "Hola ñ ç", bcc=["extra@example.com"])
        self.assertTrue(result.ok)
        self.assertEqual((result.provider, result.fallback), ("gmail_api", False))
        self.assertEqual(self.service.user, "me")
        msg = parsed(self.service)
        self.assertEqual(msg["Subject"], subject)
        self.assertEqual(msg["From"], "ThundBalance <pt@thundbalance.com>")
        self.assertEqual(msg["Reply-To"], "pt@thundbalance.com")
        self.assertEqual(msg["To"], "cliente@example.com")
        self.assertEqual(msg["Bcc"], "extra@example.com")
        self.assertTrue(msg["Message-ID"].endswith("@thundbalance.com>"))
        self.assertEqual(msg.get_content_type(), "multipart/alternative")
        self.assertIn("ñ y ç", msg.get_body(("html",)).get_content())
        self.assertIn("ñ ç", msg.get_body(("plain",)).get_content())

    def test_attachment_makes_it_multipart_mixed(self):
        transport.send_email("cliente@example.com", "Hola", "<p>x</p>", "x",
                             attachments=[{"filename": "sesion.ics", "content_type": "text/calendar; method=REQUEST", "data": "BEGIN:VCALENDAR\nEND:VCALENDAR"}])
        msg = parsed(self.service)
        self.assertEqual(msg.get_content_type(), "multipart/mixed")
        self.assertEqual([part.get_filename() for part in msg.iter_attachments()], ["sesion.ics"])

    def test_raw_is_base64url(self):
        transport.send_email("cliente@example.com", "Hola", "<p>ñññ???>>></p>", "x")
        raw = self.service.sent[0]["raw"]
        self.assertNotIn("+", raw)
        self.assertNotIn("/", raw)

    def test_header_injection_is_refused_without_sending(self):
        result = transport.send_email("cliente@example.com", "Hola\r\nBcc: a@b.co", "<p>x</p>", "x")
        self.assertFalse(result.ok)
        self.assertEqual(self.service.sent, [])


class Reliability(Base):
    def test_retries_a_429_and_a_5xx_then_succeeds(self):
        self.service.failures = [http_error(429), http_error(503)]
        result = transport.send_email("cliente@example.com", "Hola", "<p>x</p>", "x")
        self.assertTrue(result.ok)
        self.assertEqual(len(self.service.sent), 1)

    def test_gives_up_after_the_backoff_list_and_does_not_fall_back(self):
        self.service.failures = [http_error(500)] * 10
        result = transport.send_email("cliente@example.com", "Hola", "<p>x</p>", "x")
        self.assertFalse(result.ok)
        self.assertFalse(result.fallback)
        self.assertEqual(RECEIVED, [])

    def test_delegation_refused_falls_back_to_legacy_and_flags_the_warning(self):
        self.service.failures = [http_error(403)]
        result = transport.send_email("cliente@example.com", "Hola", "<p>x</p>", "x")
        self.assertTrue(result.ok)
        self.assertEqual((result.provider, result.fallback), ("legacy", True))
        self.assertEqual(len(RECEIVED), 1)
        self.assertTrue(gmail_api.status()["fallback_active"])
        # the refusal is remembered: the next email does not ask Google again
        self.service.failures = [AssertionError("must not be called")]
        again = transport.send_email("cliente@example.com", "Hola 2", "<p>x</p>", "x")
        self.assertTrue(again.ok and again.fallback)
        self.assertEqual(len(RECEIVED), 2)

    def test_refresh_error_counts_as_delegation(self):
        from google.auth.exceptions import RefreshError
        self.service.failures = [RefreshError("unauthorized_client")]
        result = transport.send_email("cliente@example.com", "Hola", "<p>x</p>", "x")
        self.assertEqual((result.provider, result.fallback), ("legacy", True))

    def test_success_clears_the_warning(self):
        gmail_api.note_fallback()
        self.assertTrue(gmail_api.status()["fallback_active"])
        transport.send_email("cliente@example.com", "Hola", "<p>x</p>", "x")
        self.assertFalse(gmail_api.status()["fallback_active"])

    def test_default_provider_is_legacy(self):
        with mock.patch.dict(os.environ, {"MAIL_PROVIDER": ""}):
            self.assertEqual(gmail_api.provider(), "legacy")
            result = transport.send_email("cliente@example.com", "Hola", "<p>x</p>", "x")
        self.assertEqual((result.provider, result.ok), ("legacy", True))
        self.assertEqual(self.service.sent, [])


class Logs(Base):
    def test_no_personal_data_in_logs(self):
        self.service.failures = [http_error(403)]
        with self.assertLogs("thundbalance.emails", level="DEBUG") as logs:
            transport.send_email("secreto.persona@example.com", "Asunto privado", "<p>Cuerpo privado</p>", "Cuerpo privado")
            logging.getLogger("thundbalance.emails").info("end")
        text = "\n".join(logs.output)
        for private in ("secreto.persona", "Asunto privado", "Cuerpo privado"):
            self.assertNotIn(private, text)


class AdminTest(Base):
    def endpoint(self, path, method):
        for route in main.app.routes:
            if getattr(route, "path", None) == path and method in getattr(route, "methods", ()):
                return route.endpoint
        raise LookupError(path)

    def test_test_endpoint_reports_provider_and_rate_limits_at_five(self):
        call = self.endpoint("/admin/email/test", "POST")
        payload = admin_api.EmailTestPayload(to="prueba@example.com")
        claims = {"email": "rate-limit-admin@example.com"}
        first = call(payload, claims=claims)
        self.assertEqual((first["sent"], first["provider"], first["fallback"]), (True, "gmail_api", False))
        for _ in range(4):
            call(payload, claims=claims)
        with self.assertRaises(HTTPException) as caught:
            call(payload, claims=claims)
        self.assertEqual(caught.exception.status_code, 429)

    def test_test_endpoint_tells_about_the_fallback(self):
        self.service.failures = [http_error(403)]
        result = self.endpoint("/admin/email/test", "POST")(admin_api.EmailTestPayload(to="prueba@example.com"), claims={"email": "fb-admin@example.com"})
        self.assertEqual((result["sent"], result["provider"], result["fallback"]), (True, "legacy", True))

    def test_health_includes_the_provider_state(self):
        gmail_api.note_fallback()
        with mock.patch.object(health, "check_ready", lambda: {"email_ready": True, "reason": "ok"}):
            status = self.endpoint("/admin/email/health", "GET")()
        self.assertTrue(status["fallback_active"])
        self.assertEqual(status["provider"], "gmail_api")


if __name__ == "__main__":
    unittest.main()

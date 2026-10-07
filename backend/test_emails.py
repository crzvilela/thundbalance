"""Tests for the email base:  python -m unittest test_emails -v

A local fake of the Apps Script web app stands in for Google, so nothing is
really sent and no secret is needed.
"""
import json
import os
import threading
import unittest
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

from emails import (
    build_ics, format_date_bilingual, madrid_to_utc, paragraph, render_email, send_email, send_email_async,
)
from emails.samples import sample_all_components, sample_ics
from emails.transport import build_payload
from emails.trial_emails import client_trial_approved, staff_trial_requested

RECEIVED = []


class FakeScript(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        RECEIVED.append(body)
        ok = body.get("secret") == "right-secret"
        answer = json.dumps({"ok": True} if ok else {"ok": False, "error": "unauthorized"}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(answer)

    def log_message(self, *args):
        pass


class EmailTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), FakeScript)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}/exec"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        RECEIVED.clear()
        os.environ["TRIAL_EMAIL_WEBHOOK_URL"] = self.url
        os.environ["TRIAL_EMAIL_WEBHOOK_SECRET"] = "right-secret"

    # ----- dates
    def test_dates_are_bilingual_and_use_madrid_time(self):
        d = format_date_bilingual(datetime(2026, 10, 12, 9, 5))
        self.assertEqual(d.es, "lunes 12 de octubre de 2026, 09:05")
        self.assertEqual(d.en, "Monday 12 October 2026, 09:05")
        # 07:00 UTC in July is 09:00 in Madrid (summer), in January 08:00.
        self.assertEqual(format_date_bilingual(datetime(2026, 7, 1, 7, tzinfo=timezone.utc)).time, "09:00")
        self.assertEqual(format_date_bilingual(datetime(2026, 1, 1, 7, tzinfo=timezone.utc)).time, "08:00")

    def test_madrid_daylight_saving_edges(self):
        # last Sunday of March 2026 is the 29th; of October the 25th
        self.assertEqual(madrid_to_utc(datetime(2026, 3, 28, 12)).hour, 11)
        self.assertEqual(madrid_to_utc(datetime(2026, 3, 29, 12)).hour, 10)
        self.assertEqual(madrid_to_utc(datetime(2026, 10, 24, 12)).hour, 10)
        self.assertEqual(madrid_to_utc(datetime(2026, 10, 25, 12)).hour, 11)

    # ----- ics
    def test_ics_is_valid_enough(self):
        ics = sample_ics()
        self.assertTrue(ics.startswith("BEGIN:VCALENDAR\r\n") and ics.endswith("END:VCALENDAR\r\n"))
        self.assertNotIn("\n", ics.replace("\r\n", ""))          # CRLF only
        for line in ics.split("\r\n"):
            self.assertLessEqual(len(line.encode("utf-8")), 75)
        self.assertIn("METHOD:PUBLISH", ics)
        self.assertIn("UID:sample-1@thundbalance.com", ics)
        self.assertIn("DTSTART:20261012T070000Z", ics)            # 09:00 Madrid (summer) = 07:00Z
        self.assertIn("\\,", ics)                                 # commas escaped
        unfolded = ics.replace("\r\n ", "")
        self.assertIn("Carrer de Pallars 286\\; Barcelona", unfolded)

    def test_ics_uid_is_stable(self):
        e = [{"id": 7, "start": datetime(2026, 1, 5, 10), "summary": "x"}]
        a = build_ics(e, stamp=datetime(2026, 1, 1, tzinfo=timezone.utc))
        b = build_ics(e, stamp=datetime(2026, 2, 1, tzinfo=timezone.utc))
        self.assertIn("UID:7@thundbalance.com", a)
        self.assertEqual(a.split("DTSTAMP")[0], b.split("DTSTAMP")[0])

    # ----- templates
    def test_html_is_black_bilingual_and_escaped(self):
        subject, html, text = sample_all_components()
        self.assertIn(" / ", subject)
        self.assertIn('bgcolor="#000000"', html)
        self.assertIn("color-scheme", html)
        self.assertIn("email-logo.png", html)
        self.assertIn("max-width:600px", html)
        self.assertIn("Test email", html)
        self.assertIn("Email de prueba", html)
        self.assertLess(html.index("Email de prueba"), html.index("Test email"))   # ES first
        self.assertNotIn("<b>&</b>", html)                                          # user text escaped
        self.assertIn("&lt;b&gt;&amp;&lt;/b&gt;", html)
        self.assertIn("Abrir ThundBalance / Open ThundBalance", html)
        self.assertIn("Abrir ThundBalance / Open ThundBalance", text)

    def test_user_text_cannot_inject_html(self):
        html, _ = render_email("t", [paragraph('<script>alert(1)</script>')])
        self.assertNotIn("<script>", html)

    def test_trial_emails(self):
        subject, html, _ = client_trial_approved("Ana", datetime(2026, 10, 12, 9), "Carles")
        self.assertIn("confirmada / Your trial session is confirmed", subject)
        self.assertIn("Lunes", html)
        self.assertIn("Monday", html)
        subject, html, text = staff_trial_requested({
            "full_name": "Ana\r\nBcc: x@y.z", "email": "a@b.co", "session_date": "2026-10-12", "session_time": "09:00"})
        self.assertNotIn("\n", subject)
        self.assertNotIn("Your trial", html)                                        # staff: Spanish only

    # ----- sending
    def test_send_ok_and_payload(self):
        subject, html, text = sample_all_components()
        result = send_email("ana@example.com", subject, html, text, cc="b@example.com",
                            attachments=[{"filename": "a.ics", "content_type": "text/calendar", "data": b"x"}])
        self.assertTrue(result.ok)
        sent = RECEIVED[0]
        self.assertEqual(sent["replyTo"], "info@thundbalance.com")
        self.assertEqual(sent["name"], "ThundBalance")
        self.assertEqual(sent["attachments"][0]["name"], "a.ics")

    def test_wrong_secret_does_not_raise(self):
        os.environ["TRIAL_EMAIL_WEBHOOK_SECRET"] = "wrong"
        result = send_email("ana@example.com", "S", "<p>x</p>", "x")
        self.assertFalse(result.ok)
        self.assertEqual(result.error, "rejected")

    def test_unreachable_and_unconfigured_do_not_raise(self):
        os.environ["TRIAL_EMAIL_WEBHOOK_URL"] = "http://127.0.0.1:9/none"
        self.assertEqual(send_email("ana@example.com", "S", "x", "x").error, "unreachable")
        del os.environ["TRIAL_EMAIL_WEBHOOK_URL"]
        self.assertEqual(send_email("ana@example.com", "S", "x", "x").error, "not_configured")

    def test_header_injection_and_bad_addresses_are_refused(self):
        for to, subject in [("ana@example.com\r\nBcc: x@y.z", "S"), ("not-an-address", "S"), ("ana@example.com", "Hi\nBcc: x@y.z")]:
            self.assertEqual(send_email(to, subject, "x", "x").error, "invalid_input")
        self.assertEqual(RECEIVED, [])
        with self.assertRaises(ValueError):
            build_payload("ana@example.com", "S", "x", "x", reply_to="a@b.co\nx")

    def test_async_calls_back_and_never_raises(self):
        done = threading.Event()
        seen = []
        future = send_email_async("ana@example.com", "S", "<p>x</p>", "x", on_done=lambda r: (seen.append(r), done.set()))
        self.assertTrue(future.result(timeout=10).ok)
        self.assertTrue(done.wait(5))
        os.environ["TRIAL_EMAIL_WEBHOOK_SECRET"] = "wrong"
        self.assertFalse(send_email_async("ana@example.com", "S", "x", "x").result(timeout=10).ok)


if __name__ == "__main__":
    unittest.main()

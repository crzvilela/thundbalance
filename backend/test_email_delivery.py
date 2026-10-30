"""Email delivery: the "request received" email never depends on luck.

    python -m unittest test_email_delivery -v

Covers: one retry for a temporary failure (and no retry for a permanent one),
a booking that is never broken by an email problem, the email_log row of every
attempt, the panel's "resend request received", and the health check.
The Google script is a local fake; the local database is used and cleaned.
"""
import io
import json
import os
import threading
import unittest
from contextlib import redirect_stdout
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from types import SimpleNamespace

import admin_api
import main
from database import get_connection
from emails import health, transport

DOMAIN = "@test-delivery.example"
SECRET = "right-secret"
STATE = {"calls": [], "mode": "ok", "fail_first": 0}


class FakeScript(BaseHTTPRequestHandler):
    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        mode = STATE["mode"]
        if mode == "html":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"<html>Authorization required</html>")
            return
        if data.get("secret") != SECRET:
            return self.answer(200, {"ok": False, "error": "unauthorized"})
        if data.get("ping"):
            return self.answer(200, {"ok": True, "ping": True, "quota": 77})
        STATE["calls"].append(data)
        if STATE["fail_first"] > 0:
            STATE["fail_first"] -= 1
            return self.answer(500, {})
        if mode == "down":
            return self.answer(500, {})
        if mode == "refuse":
            return self.answer(200, {"ok": False, "error": "Service invoked too many times"})
        self.answer(200, {"ok": True})

    def answer(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    def log_message(self, *args):
        pass


def endpoint(path, method):
    for route in main.app.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", ()):
            return route.endpoint
    raise LookupError(path)


def log_rows(kind=None, reference=None):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT tipo, referencia, estado, erro FROM email_log WHERE destinatario LIKE %s OR destinatario = %s ORDER BY id",
        (f"%{DOMAIN}", "pt@thundbalance.com"),
    )
    rows = [r for r in cur.fetchall() if (kind is None or r[0] == kind) and (reference is None or r[1] == str(reference))]
    conn.close()
    return rows


class Delivery(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.ensure_trial_session_fields()
        from emails.log import ensure_table
        ensure_table()
        cls.server = HTTPServer(("127.0.0.1", 0), FakeScript)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}/exec"
        transport.RETRY_DELAY_SECONDS = 0.05

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.cleanup()

    @classmethod
    def cleanup(cls):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        ids = [str(r[0]) for r in cur.fetchall()]
        if ids:
            cur.execute("DELETE FROM email_log WHERE referencia = ANY(%s)", (ids,))
        cur.execute("DELETE FROM email_log WHERE destinatario LIKE %s OR tipo = 'email_test'", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        conn.commit()
        conn.close()

    def setUp(self):
        STATE.update(calls=[], mode="ok", fail_first=0)
        os.environ["TRIAL_EMAIL_WEBHOOK_URL"] = self.url
        os.environ["TRIAL_EMAIL_WEBHOOK_SECRET"] = SECRET
        os.environ["TEAM_NOTIFICATION_EMAILS"] = "pt@thundbalance.com"
        self.cleanup()
        main._trial_hits.clear()

    def tearDown(self):
        self.cleanup()

    def drain(self):
        import time
        transport._pool.submit(lambda: None).result(timeout=15)
        transport._pool.submit(lambda: None).result(timeout=15)
        time.sleep(0.3)

    def book(self, email, lang="en"):
        day = date.today() + timedelta(days=9)
        while day.weekday() > 4:
            day += timedelta(days=1)
        request = SimpleNamespace(headers={}, client=SimpleNamespace(host="127.0.0.1"))
        payload = main.TrialSessionCreate(
            full_name="Ana García", email=email, phone="600123456", goals=["Lose weight"], experience="Beginner",
            session_date=day.isoformat(), session_time="10:00", lang=lang)
        with redirect_stdout(io.StringIO()):
            result = endpoint("/trial-sessions", "POST")(payload, request)
            self.drain()
        return result

    def send(self, to=f"retry{DOMAIN}"):
        return transport.send_email(to, "Subject", "<p>Hi</p>", "Hi", kind="test_kind", lang="en", reference="t1")

    # ----- retries
    def test_temporary_failure_is_retried_once_and_then_sent(self):
        STATE["fail_first"] = 1
        with redirect_stdout(io.StringIO()):
            result = self.send()
        self.assertTrue(result.ok)
        self.assertEqual(len(STATE["calls"]), 2, "exactly two attempts")
        self.assertEqual([r[2] for r in log_rows("test_kind")], ["enviado"], "one row, the final outcome")

    def test_two_failures_are_logged_as_failed_after_exactly_two_attempts(self):
        STATE["mode"] = "down"
        with redirect_stdout(io.StringIO()):
            result = self.send()
        self.assertFalse(result.ok)
        self.assertEqual(result.error, "http_500")
        self.assertEqual(len(STATE["calls"]), 2)
        self.assertEqual(log_rows("test_kind"), [("test_kind", "t1", "falhou", "http_500")])

    def test_script_that_refuses_is_retried_once(self):
        STATE["mode"] = "refuse"
        with redirect_stdout(io.StringIO()):
            result = self.send()
        self.assertEqual((result.ok, result.error, len(STATE["calls"])), (False, "rejected", 2))

    def test_wrong_secret_is_permanent_and_not_retried(self):
        os.environ["TRIAL_EMAIL_WEBHOOK_SECRET"] = "wrong"
        with redirect_stdout(io.StringIO()):
            result = self.send()
        self.assertEqual((result.ok, result.error), (False, "unauthorized"))
        self.assertEqual(len(STATE["calls"]), 0)   # the fake answers before recording
        self.assertEqual(log_rows("test_kind")[0][3], "unauthorized")

    def test_a_web_page_instead_of_json_is_reported(self):
        STATE["mode"] = "html"
        with redirect_stdout(io.StringIO()):
            result = self.send()
        self.assertEqual((result.ok, result.error), (False, "invalid_response"))

    def test_missing_configuration_is_reported_not_raised(self):
        os.environ["TRIAL_EMAIL_WEBHOOK_URL"] = ""
        with redirect_stdout(io.StringIO()):
            result = self.send()
        self.assertEqual((result.ok, result.error), (False, "not_configured"))

    # ----- a booking is never broken by email
    def test_booking_succeeds_and_failure_is_visible_when_email_is_down(self):
        STATE["mode"] = "down"
        result = self.book(f"down{DOMAIN}")
        self.assertTrue(result["trial_id"])
        received = log_rows("trial_received", result["trial_id"])
        self.assertEqual([(r[2], r[3]) for r in received], [("falhou", "http_500")])

    def test_panel_shows_status_and_resend_works_after_credentials_are_back(self):
        STATE["mode"] = "down"
        trial_id = self.book(f"panel{DOMAIN}", lang="ca")["trial_id"]
        listing = endpoint("/admin/trial-sessions", "GET")()
        card = next(item for item in listing if item["id"] == trial_id)
        self.assertEqual(card["received_email"]["status"], "failed")
        self.assertEqual(card["received_email"]["error"], "http_500")

        STATE.update(mode="ok", calls=[])
        # the one-minute guard: pretend the failed attempt was a while ago
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("UPDATE email_log SET criado_em = criado_em - INTERVAL '5 minutes' WHERE referencia = %s", (str(trial_id),))
        conn.commit()
        conn.close()
        with redirect_stdout(io.StringIO()):
            out = endpoint("/admin/trial-sessions/{trial_id}/resend-received", "POST")(trial_id)
            self.drain()
        self.assertTrue(out["email"]["sent"])
        sent = [c for c in STATE["calls"] if f"panel{DOMAIN}" in c["to"]]
        self.assertEqual(len(sent), 1, "one email to the client")
        self.assertEqual(sent[0]["language"], "ca", "in the language of the booking")
        card = next(item for item in endpoint("/admin/trial-sessions", "GET")() if item["id"] == trial_id)
        self.assertEqual(card["received_email"]["status"], "sent")
        # a second click right away is refused (one per minute)
        with self.assertRaises(Exception) as caught:
            endpoint("/admin/trial-sessions/{trial_id}/resend-received", "POST")(trial_id)
        self.assertEqual(getattr(caught.exception, "status_code", None), 429)

    # ----- health
    def test_health_ready_with_quota(self):
        status = health.check_ready()
        self.assertEqual((status["email_ready"], status["reason"], status["quota"]), (True, "ok", 77))

    def test_health_reports_wrong_secret_without_exposing_it(self):
        os.environ["TRIAL_EMAIL_WEBHOOK_SECRET"] = "wrong-value-123"
        status = health.check_ready()
        self.assertEqual((status["email_ready"], status["reason"]), (False, "unauthorized"))
        self.assertNotIn("wrong-value-123", json.dumps(status))
        self.assertNotIn(self.url, json.dumps(status))

    def test_health_reports_missing_url_and_unreachable(self):
        os.environ["TRIAL_EMAIL_WEBHOOK_URL"] = ""
        self.assertEqual(health.check_ready()["reason"], "not_configured")
        os.environ["TRIAL_EMAIL_WEBHOOK_URL"] = "http://127.0.0.1:9/exec"
        self.assertEqual(health.check_ready(timeout=3)["reason"], "unreachable")

    def test_startup_line(self):
        out = io.StringIO()
        with redirect_stdout(out):
            health.log_startup_status()
            for thread in threading.enumerate():
                if thread.name == "email-startup-check":
                    thread.join(15)
        self.assertIn("Email: OK", out.getvalue())
        os.environ["TRIAL_EMAIL_WEBHOOK_URL"] = ""
        out = io.StringIO()
        with redirect_stdout(out):
            health.log_startup_status()
            for thread in threading.enumerate():
                if thread.name == "email-startup-check":
                    thread.join(15)
        self.assertIn("Email: NÃO configurado", out.getvalue())

    def test_admin_endpoints_health_and_test_email(self):
        self.assertTrue(endpoint("/admin/email/health", "GET")()["email_ready"])
        with redirect_stdout(io.StringIO()):
            out = endpoint("/admin/email/test", "POST")(admin_api.EmailTestPayload(to=f"probe{DOMAIN}"))
        self.assertEqual(out, {"sent": True, "problem": ""})
        self.assertEqual(len([c for c in STATE["calls"] if f"probe{DOMAIN}" in c["to"]]), 1)
        with self.assertRaises(Exception) as caught:
            endpoint("/admin/email/test", "POST")(admin_api.EmailTestPayload(to="not-an-email"))
        self.assertEqual(getattr(caught.exception, "status_code", None), 422)


if __name__ == "__main__":
    unittest.main()

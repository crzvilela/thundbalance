"""One email per recipient, written entirely in the language the site had:

    python -m unittest test_trial_languages -v

Google Mail is a local fake server (every message that would be sent lands in
RECEIVED); the Google Calendar is faked. The local database is used and cleaned.
"""
import base64
import io
import json
import os
import re
import threading
import unittest
from contextlib import redirect_stdout
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from types import SimpleNamespace

import admin_api
import main
import trial_confirmation as tc
from database import get_connection
from emails.dates import format_date_bilingual

RECEIVED = []
DOMAIN = "@test-lang.example"

# words that only appear in one language of the trial emails
MARKERS = {
    "en": {"received": "We have received your trial session request", "approved": "Confirm my session",
           "confirmed": "All set!", "subject_received": "We received your request"},
    "es": {"received": "Hemos recibido tu solicitud de sesión de prueba", "approved": "Confirmar mi sesión",
           "confirmed": "¡Todo listo!", "subject_received": "Hemos recibido tu solicitud"},
    "ca": {"received": "Hem rebut la teva sol·licitud de sessió de prova", "approved": "Confirmar la meva sessió",
           "confirmed": "Tot a punt!", "subject_received": "Hem rebut la teva sol·licitud"},
}


class FakeScript(BaseHTTPRequestHandler):
    def do_POST(self):
        RECEIVED.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"ok": true}')

    def log_message(self, *args):
        pass


def endpoint(path, method):
    for route in main.app.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", ()):
            return route.endpoint
    raise LookupError(path)


def plain(html):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))


class Languages(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.ensure_trial_session_fields()
        cls.server = HTTPServer(("127.0.0.1", 0), FakeScript)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        os.environ["TRIAL_EMAIL_WEBHOOK_URL"] = f"http://127.0.0.1:{cls.server.server_port}/exec"
        os.environ["TRIAL_EMAIL_WEBHOOK_SECRET"] = "right-secret"
        os.environ["TRIAL_NOTIFY_TO"] = "info@thundbalance.com"
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active AND nome IN ('Guille','Matilda') ORDER BY id LIMIT 1")
        row = cur.fetchone()
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 1")
        cls.trainer_id = (row or cur.fetchone())[0]
        conn.close()

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
        cur.execute("DELETE FROM email_log WHERE destinatario LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        conn.commit()
        conn.close()

    def setUp(self):
        RECEIVED.clear()
        self.cleanup()
        main._trial_hits.clear()
        self.events = []
        self._orig = (tc.create_trial_session_event, tc.delete_calendar_event)
        tc.create_trial_session_event = lambda *a, **k: (self.events.append(a), f"evt-{len(self.events)}")[1]
        tc.delete_calendar_event = lambda event_id: None

    def tearDown(self):
        tc.create_trial_session_event, tc.delete_calendar_event = self._orig
        self.cleanup()

    # ----- helpers
    def day(self, offset):
        day = date.today() + timedelta(days=offset)
        while day.weekday() > 4:
            day += timedelta(days=1)
        return day

    def book(self, lang, email, offset=12, hour="10:00"):
        request = SimpleNamespace(headers={}, client=SimpleNamespace(host="127.0.0.1"))
        payload = main.TrialSessionCreate(
            full_name="Ana García", email=email, phone="600123456", goals=["Lose weight"],
            experience="Beginner", session_date=self.day(offset).isoformat(), session_time=hour, lang=lang)
        out = io.StringIO()
        with redirect_stdout(out):
            result = endpoint("/trial-sessions", "POST")(payload, request)
            self.wait_for_mail()
        return result, out.getvalue()

    def wait_for_mail(self):
        from emails.transport import _pool
        _pool.submit(lambda: None).result(timeout=10)       # the pool has 2 workers: drain it
        _pool.submit(lambda: None).result(timeout=10)
        import time
        time.sleep(0.4)

    def to(self, address):
        return [m for m in RECEIVED if address in m["to"].split(",")]

    def row(self, trial_id):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT lang, status, confirmation_token FROM trial_sessions WHERE id = %s", (trial_id,))
        data = cur.fetchone()
        conn.close()
        return data

    # ----- tests
    def test_one_client_email_and_one_team_email_per_booking_in_each_language(self):
        for lang in ("en", "es", "ca"):
            RECEIVED.clear()
            main._trial_hits.clear()
            email = f"{lang}{DOMAIN}"
            result, log = self.book(lang, email)
            self.assertEqual(self.row(result["trial_id"])[0], lang)

            client, team = self.to(email), self.to("info@thundbalance.com")
            self.assertEqual((len(client), len(team), len(RECEIVED)), (1, 1, 2), lang)

            # the client's email: ONE language everywhere
            message = client[0]
            marks = MARKERS[lang]
            self.assertEqual(message["subject"], marks["subject_received"])
            self.assertNotIn(" / ", message["subject"])
            self.assertIn(f'<html lang="{lang}"', message["html"])
            self.assertIn(f'content="{lang}"', message["html"])
            self.assertEqual(message["language"], lang)
            self.assertIn(marks["received"], plain(message["html"]))
            self.assertIn(marks["received"], message["text"])
            for other, other_marks in MARKERS.items():
                if other != lang:
                    self.assertNotIn(other_marks["received"], plain(message["html"]), f"{lang} email has {other} text")
                    self.assertNotIn(other_marks["received"], message["text"])
            self.assertEqual(plain(message["html"]).count(marks["received"]), 1)   # not repeated

            # the team's email: Spanish only, once
            staff = team[0]
            self.assertTrue(staff["subject"].startswith("Nueva sesión de prueba"))
            self.assertIn('<html lang="es"', staff["html"])
            self.assertNotIn("We have received", plain(staff["html"]))

            # one log line per email, truncated recipient, no content
            lines = [line for line in log.splitlines() if line.startswith("Email sent:")]
            self.assertEqual(len(lines), 2)
            self.assertTrue(any(f"kind=trial_received lang={lang} to=" in line for line in lines))
            self.assertTrue(any("kind=staff_trial_requested lang=es to=" in line for line in lines))
            self.assertTrue(all("@" in line and f"{lang}{DOMAIN}" not in line for line in lines))   # masked

    def test_approval_and_confirmation_emails_follow_the_language(self):
        for lang in ("en", "es", "ca"):
            RECEIVED.clear()
            main._trial_hits.clear()
            email = f"flow-{lang}{DOMAIN}"
            result, _ = self.book(lang, email, offset=15, hour={"en": "11:00", "es": "12:00", "ca": "13:00"}[lang])
            trial_id = result["trial_id"]
            RECEIVED.clear()

            endpoint("/admin/trial-sessions/{trial_id}/approve", "POST")(
                trial_id, admin_api.TrialApprovePayload(trainer_id=self.trainer_id))
            self.wait_for_mail()
            approved = self.to(email)
            self.assertEqual(len(approved), 1, lang)
            self.assertEqual(len(RECEIVED), 1)                      # nothing else was sent
            html = approved[0]["html"]
            self.assertIn(f'<html lang="{lang}"', html)
            self.assertIn(MARKERS[lang]["approved"], plain(html))
            self.assertNotIn(" / ", approved[0]["subject"])
            self.assertIn(f"?lang={lang}\"", html)                   # confirm link opens in this language
            self.assertIn(f"action=decline&amp;lang={lang}", html)
            for other, other_marks in MARKERS.items():
                if other != lang:
                    self.assertNotIn(other_marks["approved"], plain(html))

            token = self.row(trial_id)[2]
            RECEIVED.clear()
            endpoint("/trial-sessions/confirmation/{token}/confirm", "POST")(token)
            self.wait_for_mail()
            confirmed = self.to(email)
            self.assertEqual((len(confirmed), len(self.to("info@thundbalance.com"))), (1, 1), lang)
            message = confirmed[0]
            self.assertIn(MARKERS[lang]["confirmed"], plain(message["html"]))
            self.assertIn(f'<html lang="{lang}"', message["html"])
            self.assertNotIn(" / ", message["subject"])
            self.assertEqual(message["attachments"][0]["name"], "thundbalance-sesion-de-prueba.ics")
            ics = base64.b64decode(message["attachments"][0]["data"]).decode()
            self.assertEqual(ics.count("BEGIN:VEVENT"), 1)
            for other, other_marks in MARKERS.items():
                if other != lang:
                    self.assertNotIn(other_marks["confirmed"], plain(message["html"]))

    def test_unknown_language_is_stored_as_english(self):
        for number, value in enumerate(("fr", "", None, "EN-gb;drop")):
            main._trial_hits.clear()
            result, _ = self.book(value, f"unknown{number}{DOMAIN}", offset=20 + number)
            self.assertEqual(self.row(result["trial_id"])[0], "en", repr(value))

    def test_rows_from_before_keep_the_older_bilingual_email(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status, lang) "
            "VALUES ('Old Row', %s, '600', 'Lose weight', 'Beginner', %s, '12:00', 'Pending', NULL) RETURNING id",
            (f"old{DOMAIN}", self.day(25)))
        trial_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        endpoint("/admin/trial-sessions/{trial_id}/approve", "POST")(
            trial_id, admin_api.TrialApprovePayload(trainer_id=self.trainer_id))
        self.wait_for_mail()
        message = self.to(f"old{DOMAIN}")[0]
        self.assertIn(" / ", message["subject"])                     # unchanged ES / EN layout
        self.assertEqual(len(self.to(f"old{DOMAIN}")), 1)

    def test_the_column_default_is_english_and_old_rows_stay_untouched(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT column_default FROM information_schema.columns WHERE table_name = 'trial_sessions' AND column_name = 'lang'")
        self.assertIn("'en'", cur.fetchone()[0])
        conn.close()

    def test_catalan_dates_do_not_depend_on_the_server_locale(self):
        cases = {
            datetime(2026, 1, 5, 9): "dilluns 5 de gener de 2026, 09:00",
            datetime(2026, 3, 6, 9): "divendres 6 de març de 2026, 09:00",
            datetime(2026, 4, 6, 18): "dilluns 6 d'abril de 2026, 18:00",
            datetime(2026, 8, 15, 12): "dissabte 15 d'agost de 2026, 12:00",
            datetime(2026, 10, 12, 9): "dilluns 12 d'octubre de 2026, 09:00",
            datetime(2026, 12, 25, 7): "divendres 25 de desembre de 2026, 07:00",
        }
        for moment, expected in cases.items():
            self.assertEqual(format_date_bilingual(moment).ca, expected)
        self.assertEqual(format_date_bilingual(datetime(2026, 10, 12, 9)).es, "lunes 12 de octubre de 2026, 09:00")


if __name__ == "__main__":
    unittest.main()

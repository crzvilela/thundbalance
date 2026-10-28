"""The "new trial session request" notice to the team:

    python -m unittest test_team_notification -v

Who gets it (TEAM_NOTIFICATION_EMAILS, default pt@ and info@, one email), what it says (Spanish only), that a
wrong address or a failing send never breaks anything, and that nothing personal reaches a log. The e-mail
service (Google Apps Script) is replaced by a small local server.
"""
import contextlib
import io
import json
import logging
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

import trial_notifications

NAME, EMAIL, PHONE = "Ana Maria Prueba Lopez", "ana.prueba@example.org", "+34 612 345 678"
TRIAL = {
    "id": 4242, "full_name": NAME, "email": EMAIL, "phone": PHONE, "age": 30, "birth_date": "1996-03-01",
    "goal": "Perder peso, Ganar músculo", "experience": "Intermedio", "session_date": "2026-11-02", "session_time": "09:00",
}


class Script(BaseHTTPRequestHandler):
    received = []
    answer = {"ok": True}

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        Script.received.append(body)
        data = json.dumps(Script.answer).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


class TeamNotification(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), Script)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        Script.received = []
        Script.answer = {"ok": True}
        self._env = dict(os.environ)
        os.environ["TRIAL_EMAIL_WEBHOOK_URL"] = f"http://127.0.0.1:{self.server.server_port}/exec"
        os.environ["TRIAL_EMAIL_WEBHOOK_SECRET"] = "secret"
        os.environ.pop("TEAM_NOTIFICATION_EMAILS", None)
        os.environ["TRIAL_NOTIFY_TO"] = "someone.else@example.org"          # the OTHER notices: must not change the result

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._env)

    def send(self):
        future = trial_notifications.notify_trial_requested(dict(TRIAL))
        self.assertIsNotNone(future)
        return future.result(timeout=30)

    # ------------------------------------------------------------ recipients
    def test_default_recipients_are_pt_and_info_in_one_email(self):
        self.assertEqual(trial_notifications.team_notification_addresses(), ["pt@thundbalance.com", "info@thundbalance.com"])
        result = self.send()
        self.assertTrue(result.ok)
        self.assertEqual(len(Script.received), 1)                                  # ONE email
        self.assertEqual(Script.received[0]["to"], "pt@thundbalance.com,info@thundbalance.com")

    def test_the_list_comes_from_the_environment(self):
        os.environ["TEAM_NOTIFICATION_EMAILS"] = " Uno@Example.org , dos@example.org,uno@example.org "
        self.assertEqual(trial_notifications.team_notification_addresses(), ["uno@example.org", "dos@example.org"])
        self.send()
        self.assertEqual(Script.received[0]["to"], "uno@example.org,dos@example.org")

    def test_a_wrong_address_never_stops_the_notice(self):
        os.environ["TEAM_NOTIFICATION_EMAILS"] = "bueno@example.org, esto no es un email, @@, a@b"
        self.assertEqual(trial_notifications.team_notification_addresses(), ["bueno@example.org"])
        os.environ["TEAM_NOTIFICATION_EMAILS"] = "nada valido, ???"
        self.assertEqual(trial_notifications.team_notification_addresses(), list(trial_notifications.DEFAULT_TEAM_NOTIFICATION))
        os.environ["TEAM_NOTIFICATION_EMAILS"] = "x@example.org\nBcc: otro@example.org"      # header injection
        self.assertNotIn("otro@example.org", trial_notifications.team_notification_addresses())
        os.environ["TEAM_NOTIFICATION_EMAILS"] = "nada valido"
        result = self.send()                                                       # still sent, to the default list
        self.assertTrue(result.ok)
        self.assertEqual(Script.received[0]["to"], "pt@thundbalance.com,info@thundbalance.com")

    # --------------------------------------------------------------- content
    def test_the_email_is_in_spanish_with_the_right_data_and_replies_to_the_client(self):
        self.send()
        message = Script.received[0]
        self.assertEqual(message["subject"], "Nueva solicitud de Trial Session - Ana Lopez")
        self.assertEqual(message["replyTo"], EMAIL)
        self.assertEqual(message["language"], "es")
        html, text = message["html"], message["text"]
        self.assertIn('<html lang="es"', html)
        for expected in (NAME, EMAIL, PHONE, "Perder peso, Ganar músculo", "Intermedio", "lunes 2 de noviembre de 2026, 09:00",
                         "Ver en el panel de administración", "/admin/trials"):
            self.assertIn(expected, html, expected)
        for expected in (EMAIL, PHONE, "lunes 2 de noviembre de 2026, 09:00"):
            self.assertIn(expected, text, expected)
        self.assertNotIn("We have received", html)                                 # Spanish only

    # -------------------------------------------------------------- failures
    def test_a_failing_send_never_raises_and_logs_no_personal_data(self):
        Script.answer = {"ok": False, "error": "quota"}
        captured = io.StringIO()
        handler = logging.StreamHandler(captured)
        logging.getLogger().addHandler(handler)
        previous = logging.getLogger().level
        logging.getLogger().setLevel(logging.DEBUG)
        try:
            with contextlib.redirect_stdout(io.StringIO()) as printed:
                result = self.send()
        finally:
            logging.getLogger().removeHandler(handler)
            logging.getLogger().setLevel(previous)
        self.assertFalse(result.ok)
        log = captured.getvalue() + printed.getvalue()
        self.assertIn("team notification failed", log)
        for secret in (NAME, "Ana", "Lopez", EMAIL, "ana.prueba", PHONE, "612 345", "Perder peso"):
            self.assertNotIn(secret, log, secret)

    def test_the_service_being_down_does_not_raise(self):
        os.environ["TRIAL_EMAIL_WEBHOOK_URL"] = "http://127.0.0.1:9/none"
        result = self.send()
        self.assertFalse(result.ok)

    def test_anything_going_wrong_while_building_or_sending_is_swallowed(self):
        original = trial_notifications.send_email_async
        trial_notifications.send_email_async = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("pool is closed"))
        try:
            self.assertIsNone(trial_notifications.notify_trial_requested(dict(TRIAL)))       # no exception: the booking goes on
        finally:
            trial_notifications.send_email_async = original
        self.assertIsNone(trial_notifications.notify_trial_requested({"id": 1}))              # a broken trial dict neither

    def test_no_webhook_configured_means_no_email_and_no_error(self):
        os.environ["TRIAL_EMAIL_WEBHOOK_URL"] = ""
        self.assertIsNone(trial_notifications.notify_trial_requested(dict(TRIAL)))
        self.assertEqual(Script.received, [])

    # ------------------------------------------------------- other notices
    def test_the_other_studio_notices_still_use_their_own_setting(self):
        self.assertEqual(trial_notifications.studio_address(), "someone.else@example.org")


if __name__ == "__main__":
    unittest.main()

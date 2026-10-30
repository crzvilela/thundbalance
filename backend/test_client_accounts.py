"""Tests for creating clients from the admin panel:

    python -m unittest test_client_accounts -v

Firebase and the Google Calendar are faked (no real account or event is
created); Google Mail is a local fake server. The local database is used and
cleaned up. Passwords must never appear in the database, logs or responses.
"""
import base64
import os
import io
import json
import logging
import threading
import time
import unittest

import plans_schema
from contextlib import redirect_stdout
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer

from fastapi import HTTPException

import client_accounts
import firebase_accounts as accounts
import main
import google_fakes
import packs
from database import get_connection

os.environ["CLIENT_CALENDAR_ENABLED"] = "true"      # these tests look at the calendar parts of the emails

RECEIVED = []
DOMAIN = "@test-clients.example"


class FakeScript(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        RECEIVED.append(body)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps({"ok": body.get("secret") == "right-secret"}).encode())

    def log_message(self, *args):
        pass


def endpoint(path, method):
    for route in main.app.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", ()):
            return route.endpoint
    raise LookupError(path)


class LogCatcher(logging.Handler):
    def __init__(self):
        super().__init__()
        self.lines = []

    def emit(self, record):
        self.lines.append(record.getMessage())


def settle():
    """Waits until the e-mails queued in the background (2 workers) have been sent to the fake server."""
    from emails.transport import _pool
    _pool.submit(lambda: None).result(timeout=120)
    _pool.submit(lambda: None).result(timeout=120)
    time.sleep(0.3)


class Accounts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import os
        main.ensure_trial_session_fields()
        main.ensure_user_account_fields()
        main.ensure_calendar_sync_columns()
        main.ensure_session_pack_column()
        cls.server = HTTPServer(("127.0.0.1", 0), FakeScript)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        os.environ["TRIAL_EMAIL_WEBHOOK_URL"] = f"http://127.0.0.1:{cls.server.server_port}/exec"
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 1")
        cls.trainer_id = cur.fetchone()[0]
        cur.execute(f"INSERT INTO plans (nome, {plans_schema.price_column(cur)}, duracao_meses, duration_weeks) VALUES ('TEST accounts 2 weeks', 0, 1, 2) RETURNING id")
        cls.plan_id = cur.fetchone()[0]
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.cleanup()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM plans WHERE id = %s", (cls.plan_id,))
        conn.commit()
        conn.close()

    @classmethod
    def cleanup(cls):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        ids = [row[0] for row in cur.fetchall()]
        if ids:
            cur.execute("DELETE FROM sessions WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM user_plans WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM users WHERE id = ANY(%s)", (ids,))
        conn.commit()
        conn.close()

    def setUp(self):
        import os
        settle()                            # e-mails of the previous test must not land in this test's list
        RECEIVED.clear()
        os.environ["TRIAL_EMAIL_WEBHOOK_SECRET"] = "right-secret"
        self.cleanup()
        self.firebase = {}          # email -> uid  (the fake Firebase)
        self.passwords = []         # every password handed to the fake Firebase
        self.deleted_logins, self.deleted_events, self.set_calls = [], [], []
        self.firebase_lock = threading.Lock()
        self.events = []
        self._restore_gc = google_fakes.delegate_to_packs()
        self._orig = (accounts.create_login, accounts.set_password, accounts.delete_login,
                      packs.create_calendar_event, packs.delete_calendar_event)

        def create_login(email, password, name):
            with self.firebase_lock:
                if email in self.firebase:
                    raise accounts.EmailAlreadyRegistered(email)
                self.passwords.append(password)
                uid = f"fake-uid-{len(self.firebase) + 1}"
                self.firebase[email] = uid
                return uid

        def delete_login(uid):
            self.deleted_logins.append(uid)
            with self.firebase_lock:
                for email in [e for e, u in self.firebase.items() if u == uid]:
                    del self.firebase[email]
            return True

        accounts.create_login = create_login
        accounts.set_password = lambda uid, password: (self.set_calls.append((uid, password)), self.passwords.append(password))
        accounts.delete_login = delete_login
        packs.create_calendar_event = lambda *a, **k: (self.events.append(a), f"evt-{len(self.events)}")[1]
        packs.delete_calendar_event = lambda event_id: self.deleted_events.append(event_id)

        self.logs = LogCatcher()
        logging.getLogger().addHandler(self.logs)
        logging.getLogger().setLevel(logging.INFO)

    def tearDown(self):
        (accounts.create_login, accounts.set_password, accounts.delete_login,
         packs.create_calendar_event, packs.delete_calendar_event) = self._orig
        self._restore_gc()
        logging.getLogger().removeHandler(self.logs)
        self.cleanup()

    # ----- helpers
    def create(self, email="ana" + DOMAIN, pack=False, **extra):
        pack_data = None
        if pack:
            start = date.today() + timedelta(days=30)
            while start.weekday() != 0:
                start += timedelta(days=1)
            pack_data = client_accounts.ClientPack(
                plan_id=self.plan_id, sessions_per_week=2, preferred_days="Monday,Wednesday",
                preferred_time="09:00", trainer_id=self.trainer_id, start_date=start.isoformat())
        result = endpoint("/admin/clients", "POST")(client_accounts.CreateClient(
            name="Ana García", email=email, phone="600123456", country_code="+34",
            city="Barcelona", address="Carrer X 1", postal_code="08005", pack=pack_data, **extra))
        settle()                           # the e-mail to the studio goes out in the background: wait for it
        return result

    def stored_lang(self, email):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT lang FROM users WHERE email = %s", (email,))
        row = cur.fetchone()
        conn.close()
        return row[0] if row else None

    def db_user(self, email):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id, nome, firebase_uid, must_change_password, telefone, codigo_pais, cidade, morada, cep FROM users WHERE email = %s", (email,))
        row = cur.fetchone()
        conn.close()
        return row

    def assert_password_nowhere(self, response=None):
        self.assertTrue(self.passwords)
        everything = json.dumps(response, default=str) if response is not None else ""
        conn = get_connection()
        cur = conn.cursor()
        for password in set(self.passwords):
            self.assertNotIn(password, everything)
            for line in self.logs.lines:
                self.assertNotIn(password, line)
            for table in ("users", "user_plans", "sessions", "trial_sessions", "client_requests"):
                cur.execute(f"SELECT COUNT(*) FROM {table} t WHERE t::text LIKE %s", (f"%{password}%",))
                self.assertEqual(cur.fetchone()[0], 0, table)
        conn.close()

    # ----- tests
    def test_password_generator(self):
        seen = set()
        for _ in range(400):
            password = accounts.generate_password()
            seen.add(password)
            self.assertEqual(len(password), 12)
            self.assertTrue(any(c.isupper() for c in password))
            self.assertTrue(any(c.islower() for c in password))
            self.assertTrue(any(c.isdigit() for c in password))
            self.assertFalse(set(password) & set("0O1lI"))
        self.assertGreater(len(seen), 395)

    def test_create_without_pack(self):
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            result = self.create()
        user = self.db_user("ana" + DOMAIN)
        self.assertEqual((user[1], user[2], user[3]), ("Ana García", "fake-uid-1", True))
        self.assertEqual(user[4:], ("+34600123456", "+34", "Barcelona", "Carrer X 1", "08005"))
        self.assertTrue(result["email"]["sent"])
        self.assertIsNone(result["pack"])
        self.assertEqual(self.events, [])

        client = next(m for m in RECEIVED if m["to"] == "ana" + DOMAIN)
        team = next(m for m in RECEIVED if m["to"] == "pt@thundbalance.com")
        password = self.passwords[0]
        self.assertEqual(client["subject"], "Your ThundBalance profile")      # no language chosen: English, only English
        self.assertIn(password, client["html"])
        self.assertIn(password, client["text"])
        self.assertIn("Log in", client["html"])
        self.assertIn("/login", client["html"])
        self.assertIn("To change your password, log in and go to the Profile section, where you can change it.", client["html"])
        self.assertNotIn("Para cambiar tu contraseña", client["html"])
        self.assertNotIn("Iniciar sesión", client["html"])
        self.assertIn('<html lang="en"', client["html"])
        self.assertEqual(team["subject"].split(":")[0], "Nuevo cliente creado")   # the studio's copy: Spanish
        self.assertIn("monospace", client["html"].lower())
        self.assertEqual(client["attachments"], [])
        self.assertNotIn(password, json.dumps(team))               # the studio copy has no password
        self.assertIn("Ana García", team["subject"])
        self.assert_password_nowhere(result)
        self.assertNotIn(password, buffer.getvalue())

    def test_create_with_pack_sends_summary_and_ics(self):
        result = self.create(pack=True)
        self.assertEqual(result["pack"]["total_sessions"], 4)
        self.assertEqual(len(self.events), 4)
        user_id = self.db_user("ana" + DOMAIN)[0]
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM sessions WHERE user_id = %s AND status = 'Booked'", (user_id,))
        self.assertEqual(cur.fetchone()[0], 4)
        cur.execute("SELECT COUNT(*) FROM user_plans WHERE user_id = %s AND active", (user_id,))
        self.assertEqual(cur.fetchone()[0], 1)
        conn.close()
        client = next(m for m in RECEIVED if m["to"] == "ana" + DOMAIN)
        self.assertIn("TEST accounts 2 weeks", client["html"])
        self.assertIn("Your sessions", client["html"])
        ics = base64.b64decode(client["attachments"][0]["data"]).decode()
        self.assertEqual(ics.count("BEGIN:VEVENT"), 4)
        self.assert_password_nowhere(result)

    def test_duplicate_email_in_database(self):
        self.create()
        calls = len(self.firebase)
        with self.assertRaises(HTTPException) as caught:
            self.create(email="ANA" + DOMAIN)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertIn("Ya existe una cuenta", caught.exception.detail)
        self.assertIn("already exists", caught.exception.detail)
        self.assertEqual(len(self.firebase), calls)

    def test_duplicate_email_in_firebase_rolls_back(self):
        self.firebase["ana" + DOMAIN] = "someone-else"
        with self.assertRaises(HTTPException) as caught:
            self.create(pack=True)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertIsNone(self.db_user("ana" + DOMAIN))
        self.assertEqual(len(self.deleted_events), len(self.events))     # calendar events removed
        self.assertEqual(self.deleted_logins, [])                          # the other account is untouched

    def test_database_failure_removes_the_firebase_account(self):
        real = client_accounts.get_connection

        class Proxy:
            def __init__(self, conn):
                self.conn = conn

            def __getattr__(self, name):
                return getattr(self.conn, name)

            def commit(self):
                raise RuntimeError("disk full")

        client_accounts.get_connection = lambda: Proxy(real())
        try:
            with self.assertRaises(HTTPException) as caught:
                self.create(pack=True)
        finally:
            client_accounts.get_connection = real
        self.assertEqual(caught.exception.status_code, 500)
        self.assertEqual(self.deleted_logins, ["fake-uid-1"])
        self.assertEqual(self.firebase, {})
        self.assertIsNone(self.db_user("ana" + DOMAIN))
        self.assertEqual(sorted(self.deleted_events), sorted(f"evt-{n}" for n in range(1, 5)))
        self.assertNotIn("disk full", caught.exception.detail)

    def test_calendar_failure_does_not_stop_the_client_or_the_pack(self):
        count = []

        def flaky(*a, **k):
            count.append(1)
            if len(count) == 2:
                raise RuntimeError("calendar down")
            return k.get("event_id") or f"evt-{len(count)}"

        packs.create_calendar_event = flaky
        result = self.create(pack=True)
        self.assertEqual(result["pack"]["total_sessions"], 4)
        self.assertEqual(result["pack"]["calendar_failed"], 1)
        user = self.db_user("ana" + DOMAIN)
        self.assertIsNotNone(user)                                    # the client exists
        self.assertEqual(self.deleted_events, [])
        self.assertEqual(len(self.firebase), 1)

    def test_double_submit_creates_one_client(self):
        outcomes = []
        barrier = threading.Barrier(2)

        def attempt():
            barrier.wait()
            try:
                outcomes.append(("ok", self.create()))
            except HTTPException as error:
                outcomes.append(("error", error.status_code))

        threads = [threading.Thread(target=attempt) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(sorted(kind for kind, _ in outcomes), ["error", "ok"])
        self.assertEqual([code for kind, code in outcomes if kind == "error"], [409])
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM users WHERE email = %s", ("ana" + DOMAIN,))
        self.assertEqual(cur.fetchone()[0], 1)
        conn.close()
        self.assertEqual(len(self.firebase), 1)

    def test_email_failure_still_creates_the_client(self):
        import os
        os.environ["TRIAL_EMAIL_WEBHOOK_SECRET"] = "wrong"
        result = self.create()
        self.assertFalse(result["email"]["sent"])
        self.assertTrue(result["email"]["problem"])
        self.assertIsNotNone(self.db_user("ana" + DOMAIN))
        self.assert_password_nowhere(result)

    def test_validation(self):
        for name, email in (("", "x" + DOMAIN), ("Ana", "not-an-email"), ("Ana", "a@b.co\nBcc: x@y.z")):
            with self.assertRaises(HTTPException) as caught:
                endpoint("/admin/clients", "POST")(client_accounts.CreateClient(name=name, email=email))
            self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(self.firebase, {})

    def test_resend_credentials(self):
        created = self.create(pack=True)
        resend = endpoint("/admin/clients/{client_id}/resend-credentials", "POST")
        RECEIVED.clear()
        result = resend(created["id"])
        self.assertTrue(result["email"]["sent"])
        (uid, new_password), = self.set_calls
        self.assertEqual(uid, "fake-uid-1")
        self.assertNotEqual(new_password, self.passwords[0])
        client = next(m for m in RECEIVED if m["to"] == "ana" + DOMAIN)
        self.assertIn(new_password, client["html"])
        self.assertIn("Your sessions", client["html"])              # the pack summary is repeated
        self.assertEqual(base64.b64decode(client["attachments"][0]["data"]).decode().count("BEGIN:VEVENT"), 4)
        self.assert_password_nowhere(result)

        endpoint("/me/password-changed", "POST")({"sub": "fake-uid-1", "email": "ana" + DOMAIN})
        with self.assertRaises(HTTPException) as caught:
            resend(created["id"])
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(len(self.set_calls), 1)

    def test_the_client_gets_everything_in_the_language_the_admin_chose(self):
        expected = {
            "ca": ("El teu perfil a ThundBalance", "Iniciar sessió", "Les teves sessions", "Dilluns"),
            "es": ("Tu perfil en ThundBalance", "Iniciar sesión", "Tus sesiones", "Lunes"),
            "en": ("Your ThundBalance profile", "Log in", "Your sessions", "Monday"),
        }
        for lang, (subject, button, sessions, weekday) in expected.items():
            RECEIVED.clear()
            self.cleanup()                    # the previous language's sessions must not collide with this pack
            email = f"{lang}1" + DOMAIN
            created = self.create(email=email, pack=True, lang=lang)
            self.assertEqual(self.db_user(email)[0] is not None and self.stored_lang(email), lang)
            client = next(m for m in RECEIVED if m["to"] == email)
            team = next(m for m in RECEIVED if m["to"] == "pt@thundbalance.com")
            self.assertEqual(client["subject"], subject)
            self.assertNotIn(" / ", client["subject"])
            self.assertIn(f'<html lang="{lang}"', client["html"])
            self.assertIn(button, client["html"])
            self.assertIn(sessions, client["html"])
            self.assertIn(weekday, client["html"])
            for other, words in expected.items():
                if other != lang:
                    for word in (words[0], words[1], words[2]):
                        self.assertNotIn(word, client["html"], (lang, other))
            self.assertEqual(team["subject"].split(":")[0], "Nuevo cliente creado")     # the team: Spanish only, whatever the client's language
            RECEIVED.clear()
            endpoint("/admin/clients/{client_id}/resend-credentials", "POST")(created["id"])
            settle()
            again = next(m for m in RECEIVED if m["to"] == email)
            self.assertEqual(again["subject"], subject)                               # the resend goes in the same language
            self.assertIn(f'<html lang="{lang}"', again["html"])
            self.assertIn(sessions, again["html"])

    def test_unknown_language_in_the_panel_is_ignored(self):
        self.create(email="fr1" + DOMAIN, lang="fr")
        self.assertIsNone(self.stored_lang("fr1" + DOMAIN))
        client = next(m for m in RECEIVED if m["to"] == "fr1" + DOMAIN)
        self.assertEqual(client["subject"], "Your ThundBalance profile")             # nothing saved: English

    def test_the_client_changes_only_their_own_language(self):
        import client_lang
        self.create(email="own1" + DOMAIN, lang="es")
        self.create(email="own2" + DOMAIN, lang="es")
        save = endpoint("/me/language", "PUT")
        self.assertEqual(save(client_lang.LanguagePayload(lang="CA "), {"sub": "fake-uid-1", "email": "own1" + DOMAIN}), {"lang": "ca"})
        self.assertEqual(self.stored_lang("own1" + DOMAIN), "ca")
        self.assertEqual(self.stored_lang("own2" + DOMAIN), "es")                    # nobody else's
        with self.assertRaises(HTTPException) as caught:
            save(client_lang.LanguagePayload(lang="fr"), {"sub": "fake-uid-1", "email": "own1" + DOMAIN})
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(self.stored_lang("own1" + DOMAIN), "ca")
        with self.assertRaises(HTTPException) as caught:
            save(client_lang.LanguagePayload(lang="es"), {"sub": "nobody", "email": "nobody" + DOMAIN})
        self.assertEqual(caught.exception.status_code, 404)

    def test_language_order_booking_then_profile_then_english(self):
        import client_lang
        self.create(email="ord1" + DOMAIN, lang="ca")
        self.create(email="ord2" + DOMAIN)
        email = "ord1" + DOMAIN
        self.assertEqual(client_lang.resolve_client_lang(booking_lang="es", email=email), "es")      # the booking's language wins
        self.assertEqual(client_lang.resolve_client_lang(booking_lang=None, email=email), "ca")      # then the profile
        self.assertEqual(client_lang.resolve_client_lang(booking_lang="xx", email=email), "ca")      # an invalid one counts as none
        self.assertEqual(client_lang.resolve_client_lang(email="ord2" + DOMAIN), "en")               # profile without language
        self.assertEqual(client_lang.resolve_client_lang(email="nobody" + DOMAIN), "en")             # unknown client
        self.assertEqual(client_lang.resolve_client_lang(), "en")

    def test_password_changed_only_touches_the_caller(self):
        first = self.create(email="a1" + DOMAIN)
        second = self.create(email="a2" + DOMAIN)
        endpoint("/me/password-changed", "POST")({"sub": "fake-uid-1", "email": "a1" + DOMAIN})
        self.assertFalse(self.db_user("a1" + DOMAIN)[3])
        self.assertTrue(self.db_user("a2" + DOMAIN)[3])
        self.assertTrue(first["id"] != second["id"])

    def test_the_user_lookup_reports_the_flag(self):
        self.create()
        found = endpoint("/users/email/{email}", "GET")("ana" + DOMAIN, {"email": "ana" + DOMAIN})
        self.assertTrue(found["must_change_password"])

    def test_routes_are_protected(self):
        def deps(path, method):
            for route in main.app.routes:
                if getattr(route, "path", None) == path and method in getattr(route, "methods", ()):
                    return [d.call for d in route.dependant.dependencies]
            raise LookupError(path)

        self.assertIn(main.require_admin, deps("/admin/clients", "POST"))
        self.assertIn(main.require_admin, deps("/admin/clients/{client_id}/resend-credentials", "POST"))
        self.assertIn(main.require_client, deps("/me/password-changed", "POST"))
        for header in (None, "", "Bearer", "Bearer not-a-token", "Basic abc"):
            with self.assertRaises(HTTPException) as caught:
                main.require_admin(header)
            self.assertEqual(caught.exception.status_code, 401)

    def test_account_creation_unavailable_is_a_clear_503(self):
        def broken(*args):
            raise accounts.AccountsUnavailable("FIREBASE_CREDENTIALS_PATH is not set")
        accounts.create_login = broken
        with self.assertRaises(HTTPException) as caught:
            self.create()
        self.assertEqual(caught.exception.status_code, 503)
        self.assertIsNone(self.db_user("ana" + DOMAIN))


if __name__ == "__main__":
    unittest.main()

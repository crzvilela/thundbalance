"""Invoicing data of clients (document + billing address):

    python -m unittest test_billing -v

Firebase and the Google Calendar are faked, Google Mail is a local fake. The
local database is used and cleaned up. The key promise tested here: the
document is validated, masked in lists, and never appears in emails, logs or
error answers.
"""
import asyncio
import io
import json
import logging
import threading
import unittest
from contextlib import redirect_stdout
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer

from fastapi import HTTPException
from fastapi.exceptions import RequestValidationError

import admin_api
import client_accounts
import firebase_accounts as accounts
import main
import packs
import tax_id
from database import get_connection

DOMAIN = "@test-billing.example"
DNI = "12345678Z"
NIE = "X1234567L"
SECRET_STREET = "Calle Secretisima 99 3B"
RECEIVED = []


class FakeScript(BaseHTTPRequestHandler):
    def do_POST(self):
        import os
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        RECEIVED.append(body)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps({"ok": body.get("secret") == "right-secret"}).encode())

    def log_message(self, *args):
        pass


def route(path, method):
    for r in main.app.routes:
        if getattr(r, "path", None) == path and method in getattr(r, "methods", ()):
            return r.endpoint
    raise LookupError(path)


class LogCatcher(logging.Handler):
    def __init__(self):
        super().__init__()
        self.lines = []

    def emit(self, record):
        self.lines.append(record.getMessage())


class Algorithm(unittest.TestCase):
    def test_valid_documents_and_normalisation(self):
        cases = [
            ("DNI", "12345678Z", "12345678Z"), ("DNI", " 12.345.678-z ", "12345678Z"), ("DNI", "00000000T", "00000000T"),
            ("NIE", "X1234567L", "X1234567L"), ("NIE", "y-1234567-x", "Y1234567X"), ("NIE", "Z1234567R", "Z1234567R"),
            ("PASSPORT", "ab 123 456", "AB123456"), ("OTHER", "XK-998877", "XK998877"),
        ]
        for kind, typed, expected in cases:
            self.assertEqual(tax_id.validate(kind, typed), (kind, expected), (kind, typed))

    def test_invalid_documents_have_a_precise_code(self):
        cases = [
            ("DNI", "12345678A", "dni_letter"), ("DNI", "1234567Z", "dni_format"), ("DNI", "X1234567L", "dni_format"),
            ("NIE", "X1234567A", "nie_letter"), ("NIE", "A1234567L", "nie_format"), ("NIE", "12345678Z", "nie_format"),
            ("PASSPORT", "abc", "other_format"), ("OTHER", "x" * 21, "other_format"), ("OTHER", "ab#123", "other_format"),
            ("FOO", "12345678Z", "type"),
        ]
        for kind, typed, code in cases:
            with self.assertRaises(tax_id.TaxIdError) as caught:
                tax_id.validate(kind, typed)
            self.assertEqual(caught.exception.code, code, (kind, typed))
            self.assertNotIn(typed.strip(), caught.exception.message)   # never echoes the value

    def test_mask(self):
        self.assertEqual(tax_id.mask(DNI), "••••678Z")
        self.assertEqual(tax_id.mask("AB1"), "••••")
        self.assertIsNone(tax_id.mask(None))
        self.assertIsNone(tax_id.mask(""))

    def test_empty_means_no_document(self):
        self.assertEqual(tax_id.clean("DNI", ""), (None, None))
        self.assertEqual(tax_id.clean("DNI", "  . - "), (None, None))


class Endpoints(unittest.TestCase):
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
        os.environ["TRIAL_EMAIL_WEBHOOK_SECRET"] = "right-secret"
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active AND nome IN ('Guille','Matilda') ORDER BY id LIMIT 1")
        row = cur.fetchone()
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 1")
        cls.trainer_id = (row or cur.fetchone())[0]
        cur.execute("INSERT INTO plans (nome, preco, duracao_meses, duration_weeks) VALUES ('TEST billing 2 weeks', 0, 1, 2) RETURNING id")
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
        ids = [r[0] for r in cur.fetchall()]
        if ids:
            cur.execute("DELETE FROM sessions WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM user_plans WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM users WHERE id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM email_log WHERE destinatario LIKE %s", (f"%{DOMAIN}",))
        conn.commit()
        conn.close()

    def setUp(self):
        RECEIVED.clear()
        self.cleanup()
        self.firebase = {}
        self._orig = (accounts.create_login, accounts.set_password, accounts.delete_login,
                      packs.create_calendar_event, packs.delete_calendar_event)
        accounts.create_login = lambda email, password, name: self.firebase.setdefault(email, f"uid-{len(self.firebase) + 1}")
        accounts.set_password = lambda uid, password: None
        accounts.delete_login = lambda uid: True
        packs.create_calendar_event = lambda *a, **k: k.get("event_id") or "evt"
        packs.delete_calendar_event = lambda event_id: None
        self.logs = LogCatcher()
        logging.getLogger().addHandler(self.logs)
        logging.getLogger().setLevel(logging.INFO)

    def tearDown(self):
        (accounts.create_login, accounts.set_password, accounts.delete_login,
         packs.create_calendar_event, packs.delete_calendar_event) = self._orig
        logging.getLogger().removeHandler(self.logs)
        self.cleanup()

    # ----- helpers
    def create(self, email="ana" + DOMAIN, pack=False, **fields):
        pack_data = None
        if pack:
            start = date.today() + timedelta(days=30)
            while start.weekday() != 0:
                start += timedelta(days=1)
            pack_data = client_accounts.ClientPack(
                plan_id=self.plan_id, sessions_per_week=1, preferred_days="Monday", preferred_time="09:00",
                trainer_id=self.trainer_id, start_date=start.isoformat())
        out = io.StringIO()
        with redirect_stdout(out):
            result = route("/admin/clients", "POST")(client_accounts.CreateClient(
                name="Ana García", email=email, pack=pack_data, **fields))
        self.stdout = out.getvalue()
        return result

    def drain_mail(self):
        """Waits until every email queued so far has been delivered to the fake."""
        import time
        from emails.transport import _pool
        for _ in range(3):
            _pool.submit(lambda: None).result(timeout=10)
        time.sleep(0.4)

    def user(self, email):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id, tax_id_type, tax_id, country, morada, cep, cidade FROM users WHERE email = %s", (email,))
        row = cur.fetchone()
        conn.close()
        return row

    def listed(self, user_id):
        return next(c for c in route("/admin/clients", "GET")() if c["id"] == user_id)

    # ----- creating
    def test_create_with_a_valid_dni_stores_it_normalised(self):
        result = self.create(tax_id_type="DNI", tax_id="12.345.678-z", country="España", address=SECRET_STREET,
                             city="Barcelona", postal_code="08005")
        user = self.user("ana" + DOMAIN)
        self.assertEqual(user[1:4], ("DNI", DNI, "España"))
        self.assertEqual(user[4], SECRET_STREET)
        self.assertNotIn(DNI, json.dumps(result))                     # the answer does not carry it

    def test_a_nie_is_accepted_and_a_wrong_letter_is_refused_clearly(self):
        self.create(email="nie" + DOMAIN, tax_id_type="NIE", tax_id=NIE)
        self.assertEqual(self.user("nie" + DOMAIN)[1:3], ("NIE", NIE))
        with self.assertRaises(HTTPException) as caught:
            self.create(email="bad" + DOMAIN, tax_id_type="DNI", tax_id="12345678A")
        self.assertEqual(caught.exception.status_code, 422)
        self.assertIn("La letra del DNI no es correcta", caught.exception.detail)
        self.assertIn("The DNI letter is not correct", caught.exception.detail)
        self.assertNotIn("12345678A", caught.exception.detail)
        self.assertIsNone(self.user("bad" + DOMAIN))                   # nothing was created
        self.assertEqual(self.firebase.get("bad" + DOMAIN), None)

    def test_the_document_is_optional(self):
        self.create(email="none" + DOMAIN)
        user = self.user("none" + DOMAIN)
        self.assertEqual(user[1:3], (None, None))
        card = self.listed(user[0])
        self.assertTrue(card["billing_missing"])
        self.assertIsNone(card["tax_id_masked"])

    # ----- lists mask, the record shows everything to the admin
    def test_lists_are_masked_and_the_record_is_complete(self):
        self.create(tax_id_type="DNI", tax_id=DNI, address=SECRET_STREET, country="España")
        user_id = self.user("ana" + DOMAIN)[0]

        card = self.listed(user_id)
        self.assertEqual(card["tax_id_masked"], "••••678Z")
        self.assertFalse(card["billing_missing"])
        self.assertNotIn("tax_id", card)
        self.assertNotIn(DNI, json.dumps(route("/admin/clients", "GET")()))

        legacy = route("/users", "GET")()
        self.assertNotIn(DNI, json.dumps(legacy, default=str))        # GET /users no longer returns the document
        self.assertIn("••••678Z", json.dumps(legacy, default=str, ensure_ascii=False))

        detail = route("/admin/clients/{client_id}", "GET")(user_id)
        self.assertEqual((detail["tax_id_type"], detail["tax_id"], detail["country"]), ("DNI", DNI, "España"))
        self.assertFalse(detail["billing_missing"])

    def test_billing_is_missing_without_document_or_address(self):
        self.create(tax_id_type="DNI", tax_id=DNI)                    # document, no address
        self.assertTrue(self.listed(self.user("ana" + DOMAIN)[0])["billing_missing"])
        self.create(email="addr" + DOMAIN, address="Calle 1")         # address, no document
        self.assertTrue(self.listed(self.user("addr" + DOMAIN)[0])["billing_missing"])

    # ----- editing from the panel
    def test_the_admin_edits_and_clears_billing_data(self):
        self.create()
        user_id = self.user("ana" + DOMAIN)[0]
        save = route("/admin/clients/{client_id}/billing", "PUT")
        save(user_id, admin_api.BillingPayload(tax_id_type="NIE", tax_id="x-1234567-l", address=SECRET_STREET,
                                                                     postal_code="08005", city="Barcelona", country="España"))
        user = self.user("ana" + DOMAIN)
        self.assertEqual(user[1:7], ("NIE", NIE, "España", SECRET_STREET, "08005", "Barcelona"))

        with self.assertRaises(HTTPException) as caught:
            save(user_id, admin_api.BillingPayload(tax_id_type="NIE", tax_id="X1234567A"))
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(self.user("ana" + DOMAIN)[2], NIE)           # the invalid edit changed nothing

        with self.assertRaises(HTTPException):                         # the type alone must still fit the saved document
            save(user_id, admin_api.BillingPayload(tax_id_type="DNI"))
        save(user_id, admin_api.BillingPayload(tax_id="", address=""))   # empty text clears
        user = self.user("ana" + DOMAIN)
        self.assertEqual((user[1], user[2], user[4]), (None, None, None))
        with self.assertRaises(HTTPException) as missing:
            save(999999999, admin_api.BillingPayload(address="x"))
        self.assertEqual(missing.exception.status_code, 404)

    def test_billing_routes_need_the_admin(self):
        for path, method in (("/admin/clients/{client_id}/billing", "PUT"), ("/admin/clients", "POST"), ("/admin/clients", "GET")):
            for r in main.app.routes:
                if getattr(r, "path", None) == path and method in r.methods:
                    self.assertIn(main.require_admin, [d.call for d in r.dependant.dependencies], (path, method))

    # ----- the client's own profile
    def test_the_client_sees_and_edits_their_own_document(self):
        self.create(tax_id_type="DNI", tax_id=DNI, address=SECRET_STREET, country="España")
        user_id = self.user("ana" + DOMAIN)[0]
        claims = {"sub": "uid-1", "email": "ana" + DOMAIN}
        profile = route("/profile/{user_id}", "GET")(user_id, claims)
        self.assertEqual((profile["tax_id_type"], profile["tax_id"], profile["country"]), ("DNI", DNI, "España"))

        update = route("/profile/{user_id}", "PUT")
        body = dict(telefone="600", codigo_pais="+34", cidade="Barcelona", morada="Calle Nueva 5", cep="08001")
        self.assertEqual(update(user_id, main.UpdateProfile(**body, tax_id_type="NIE", tax_id=NIE, country="Francia"), claims),
                         {"message": "Profile updated successfully"})
        self.assertEqual(self.user("ana" + DOMAIN)[1:5], ("NIE", NIE, "Francia", "Calle Nueva 5"))

        with self.assertRaises(HTTPException) as caught:               # a code the site translates, no value
            update(user_id, main.UpdateProfile(**body, tax_id_type="DNI", tax_id="12345678A"), claims)
        self.assertEqual((caught.exception.status_code, caught.exception.detail), (422, "tax_id_dni_letter"))
        self.assertEqual(self.user("ana" + DOMAIN)[2], NIE)

        # an old client of the site that only sends the five classic fields still works
        self.assertEqual(update(user_id, main.UpdateProfile(**body), claims), {"message": "Profile updated successfully"})
        self.assertEqual(self.user("ana" + DOMAIN)[2], NIE)

        stranger = {"sub": "other", "email": "someone-else@example.com"}
        with self.assertRaises(HTTPException) as denied:
            route("/profile/{user_id}", "GET")(user_id, stranger)
        self.assertEqual(denied.exception.status_code, 403)

    def test_a_database_error_does_not_echo_personal_data(self):
        self.create(tax_id_type="DNI", tax_id=DNI)
        user_id = self.user("ana" + DOMAIN)[0]
        claims = {"sub": "uid-1", "email": "ana" + DOMAIN}
        too_long = "9" * 5000                                          # makes Postgres complain only if a column has a limit
        out = io.StringIO()
        with redirect_stdout(out):
            result = route("/profile/{user_id}", "PUT")(user_id, main.UpdateProfile(
                telefone="1", codigo_pais="+34", cidade="x", morada=SECRET_STREET, cep="1", country=too_long), claims)
        self.assertNotIn(SECRET_STREET, json.dumps(result))
        self.assertNotIn(SECRET_STREET, out.getvalue())

    # ----- nothing sensitive leaves through emails, logs or validation errors
    def test_emails_logs_and_errors_never_carry_the_document_or_the_address(self):
        result = self.create(tax_id_type="DNI", tax_id=DNI, address=SECRET_STREET, country="España",
                             city="Barcelona", postal_code="99887", pack=True)
        self.assertTrue(result["email"]["sent"])
        self.drain_mail()                                              # the studio copy is sent in the background
        self.assertGreaterEqual(len(RECEIVED), 2)                      # welcome (+pack summary) and the studio copy
        everything = json.dumps(RECEIVED, ensure_ascii=False)
        for secret in (DNI, "12.345.678", SECRET_STREET, "99887", "España"):
            self.assertNotIn(secret, everything, f"{secret!r} leaked into an email")

        logged = "\n".join(self.logs.lines) + self.stdout
        for secret in (DNI, SECRET_STREET):
            self.assertNotIn(secret, logged)

        # a refused document: the error text does not repeat what was typed
        out = io.StringIO()
        with redirect_stdout(out):
            with self.assertRaises(HTTPException) as caught:
                self.create(email="again" + DOMAIN, tax_id_type="DNI", tax_id="87654321A")
        self.assertNotIn("87654321A", caught.exception.detail)
        self.assertNotIn("87654321A", out.getvalue() + "\n".join(self.logs.lines))

    def test_a_malformed_request_is_not_echoed_back(self):
        error = RequestValidationError([{
            "type": "string_type", "loc": ("body", "tax_id"), "msg": "Input should be a valid string",
            "input": 12345678, "ctx": {"secret": "12345678"},
        }])
        response = asyncio.run(main.validation_error_without_input(None, error))
        body = response.body.decode()
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("12345678", body)
        self.assertIn("Input should be a valid string", body)


if __name__ == "__main__":
    unittest.main()

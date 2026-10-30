"""Individual | Dual sessions and the single source of prices:

    python -m unittest test_pricing -v

Pack Individual 1/3/6 months = 65/60/55, Dual = 80/75/70, trial 40 individual / 50 dual (EUR per session). The server
works the price out itself, a dual session needs the second person, old packs are left alone, the Google event says
"Tipo: Dual (Nombre)" and nothing is sent to the second person. Mail is a local fake server and Google is faked; the
local database is used and cleaned up.
"""
import json
import re
import threading
import unittest
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from types import SimpleNamespace
from unittest import mock

import os

import testsafety
from fastapi import HTTPException
from fastapi.testclient import TestClient

import google_fakes
import main
import plans_schema
import pricing
from database import get_connection

DOMAIN = "@test-pricing.example"
SECOND = f"beatriz{DOMAIN}"
RECEIVED = []


class FakeScript(BaseHTTPRequestHandler):
    def do_POST(self):
        RECEIVED.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"ok": true}')

    def log_message(self, *args):
        pass


def endpoint(path, method):
    for item in main.app.routes:
        if getattr(item, "path", None) == path and method in getattr(item, "methods", ()):
            return item.endpoint
    raise LookupError(path)


def weekday_after(offset):
    day = date.today() + timedelta(days=offset)
    while day.weekday() > 4:
        day += timedelta(days=1)
    return day


def code(error):
    return error.exception.detail["code"], error.exception.detail["field"]


class Pricing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        testsafety.require_local_database()
        for name in ("ensure_trial_session_fields", "ensure_session_pack_column", "ensure_calendar_sync_columns",
                     "ensure_client_lifecycle_columns", "ensure_client_workflow_fields"):
            getattr(main, name)()
        cls.server = HTTPServer(("127.0.0.1", 0), FakeScript)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        os.environ["TRIAL_EMAIL_WEBHOOK_URL"] = f"http://127.0.0.1:{cls.server.server_port}/exec"
        os.environ["TRIAL_EMAIL_WEBHOOK_SECRET"] = "right-secret"
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 1")
        cls.trainer_id = cur.fetchone()[0]
        price = plans_schema.price_column(cur)
        cls.plans = {}
        for months, weeks in ((1, 2), (3, 12), (7, 4)):         # 7 months has no price
            cur.execute(f"INSERT INTO plans (nome, {price}, duracao_meses, duration_weeks) VALUES (%s, 0, %s, %s) RETURNING id",
                        (f"TEST pricing {months}m", months, weeks))
            cls.plans[months] = cur.fetchone()[0]
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.cleanup()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM plans WHERE id = ANY(%s)", (list(cls.plans.values()),))
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
            cur.execute("DELETE FROM client_requests WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM users WHERE id = ANY(%s)", (ids,))
        cur.execute("SELECT id FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        trials = [str(r[0]) for r in cur.fetchall()]
        if trials:
            cur.execute("DELETE FROM email_log WHERE referencia = ANY(%s)", (trials,))
        cur.execute("DELETE FROM email_log WHERE destinatario LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        conn.commit()
        conn.close()

    def setUp(self):
        RECEIVED.clear()
        self.cleanup()
        main._trial_hits.clear()
        self.google = google_fakes.FakeGoogle().install()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO users (nome, email, firebase_uid) VALUES ('Henrique Preco', %s, 'uid-pricing') RETURNING id", (f"hp{DOMAIN}",))
        self.user_id = cur.fetchone()[0]
        conn.commit()
        conn.close()

    def tearDown(self):
        self.google.uninstall()
        main.app.dependency_overrides.clear()
        self.cleanup()

    # ----- helpers
    def new_pack(self, months=3, per_week=2, session_type=None, name=None, email=None, **extra):
        start = weekday_after(10).isoformat()
        return endpoint("/admin/clients/{client_id}/renew-pack", "POST")(self.user_id, main.NewPack(
            plan_id=self.plans[months], sessions_per_week=per_week, preferred_days="Monday,Wednesday", preferred_time="09:00",
            trainer_id=self.trainer_id, start_date=start, email_extra=[], allow_conflicts=True, confirm_replace=True,
            session_type=session_type, second_person_name=name, second_person_email=email, **extra))

    def pack_row(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT session_type, second_person_name, second_person_email, price_per_session, total_price "
                    "FROM user_plans WHERE user_id = %s ORDER BY id DESC LIMIT 1", (self.user_id,))
        row = cur.fetchone()
        conn.close()
        return row

    def wait_for_mail(self):
        from emails.transport import _pool
        _pool.submit(lambda: None).result(timeout=120)
        _pool.submit(lambda: None).result(timeout=120)
        import time
        time.sleep(0.4)

    def book_trial(self, session_type=None, name=None, email=None, address=None, hour="10:00", offset=12):
        request = SimpleNamespace(headers={}, client=SimpleNamespace(host="127.0.0.1"))
        payload = main.TrialSessionCreate(
            full_name="Ana Garcia", email=address or f"ana{DOMAIN}", phone="600123456", goals=["Lose weight"],
            experience="Beginner", session_date=weekday_after(offset).isoformat(), session_time=hour, lang="es",
            session_type=session_type, second_person_name=name, second_person_email=email)
        result = endpoint("/trial-sessions", "POST")(payload, request)
        self.wait_for_mail()
        return result

    def trial_row(self, trial_id):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT session_type, second_person_name, second_person_email, price_per_session FROM trial_sessions WHERE id = %s", (trial_id,))
        row = cur.fetchone()
        conn.close()
        return row

    # ----- the table
    def test_the_prices_are_the_ones_of_the_brief_and_the_seed_is_idempotent(self):
        conn = get_connection()
        cur = conn.cursor()
        pricing.ensure_schema(cur)
        pricing.ensure_schema(cur)
        cur.execute("SELECT kind, session_type, months, price FROM pricing ORDER BY kind, session_type, months")
        rows = {(a, b, c): float(d) for a, b, c, d in cur.fetchall()}
        self.assertEqual(rows, {
            ("pack", "individual", 1): 65, ("pack", "individual", 3): 60, ("pack", "individual", 6): 55,
            ("pack", "dual", 1): 80, ("pack", "dual", 3): 75, ("pack", "dual", 6): 70,
            ("trial", "individual", 0): 40, ("trial", "dual", 0): 50,
        })
        # a price edited in the database survives the next start
        cur.execute("UPDATE pricing SET price = 61 WHERE kind = 'pack' AND session_type = 'individual' AND months = 3")
        pricing.ensure_schema(cur)
        self.assertEqual(float(pricing.price_per_session(cur, "pack", "individual", 3)), 61)
        cur.execute("UPDATE pricing SET price = 60 WHERE kind = 'pack' AND session_type = 'individual' AND months = 3")
        conn.commit()
        conn.close()

    def test_the_site_reads_the_prices_from_a_public_endpoint(self):
        body = TestClient(main.app).get("/pricing").json()                   # no token: they are the public prices
        self.assertEqual(body["packs"]["individual"], {"1": 65, "3": 60, "6": 55})
        self.assertEqual(body["packs"]["dual"], {"1": 80, "3": 75, "6": 70})
        self.assertEqual(body["trial"], {"individual": 40, "dual": 50})
        self.assertEqual(body["months"], [1, 3, 6])

    def test_plans_list_shows_the_individual_price_of_the_table(self):
        rows = {row[2]: row for row in endpoint("/plans", "GET")() if row[1].startswith("TEST pricing")}
        self.assertEqual(float(rows[3][3]), 60)
        self.assertIsNone(rows[7][3])                                         # no price for 7 months: none is invented

    def test_durations_without_a_price_are_found(self):
        conn = get_connection()
        cur = conn.cursor()
        self.assertIn(7, pricing.unpriced_plan_months(cur))
        self.assertNotIn(3, pricing.unpriced_plan_months(cur))
        conn.close()

    # ----- packs
    def test_an_individual_pack_of_3_months_is_60_per_session_and_the_total_is_right(self):
        result = self.new_pack(months=3, per_week=2)                          # 12 weeks x 2 = 24 sessions
        self.assertEqual((result["session_type"], result["price_per_session"], result["total_sessions"], result["total_price"]),
                         ("individual", 60, 24, 1440))
        self.assertEqual(self.pack_row(), ("individual", None, None, 60, 1440))

    def test_a_dual_pack_of_3_months_is_75_per_session(self):
        result = self.new_pack(months=3, per_week=2, session_type="dual", name="Beatriz Prueba", email=SECOND)
        self.assertEqual((result["session_type"], result["price_per_session"], result["total_price"]), ("dual", 75, 75 * 24))
        self.assertEqual(self.pack_row(), ("dual", "Beatriz Prueba", SECOND, 75, 1800))

    def test_every_duration_and_type_costs_what_the_brief_says(self):
        for months, individual, dual in ((1, 65, 80), (3, 60, 75)):
            for session_type, expected in (("individual", individual), ("dual", dual)):
                self.cleanup_packs()
                result = self.new_pack(months=months, per_week=1, session_type=session_type, name="Bea Test", email=SECOND)
                self.assertEqual(result["price_per_session"], expected, (months, session_type))
                self.assertEqual(result["total_price"], expected * result["total_sessions"], (months, session_type))

    def cleanup_packs(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM sessions WHERE user_id = %s", (self.user_id,))
        cur.execute("DELETE FROM user_plans WHERE user_id = %s", (self.user_id,))
        conn.commit()
        conn.close()

    def test_a_price_sent_by_the_browser_is_ignored(self):
        main.app.dependency_overrides[main.require_admin] = lambda: {"email": main.ADMIN_EMAIL, "sub": "uid-admin"}
        body = {
            "plan_id": self.plans[3], "sessions_per_week": 1, "preferred_days": "Monday", "preferred_time": "09:00",
            "trainer_id": self.trainer_id, "start_date": weekday_after(10).isoformat(), "email_extra": [],
            "allow_conflicts": True, "confirm_replace": True,
            "price_per_session": 1, "total_price": 1, "price": 1, "preco": 1,
        }
        response = TestClient(main.app).post(f"/admin/clients/{self.user_id}/renew-pack", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["price_per_session"], 60)
        self.assertEqual(self.pack_row()[3:], (60, 720))

    def test_a_duration_without_a_price_is_refused_not_invented(self):
        with self.assertRaises(HTTPException) as error:
            self.new_pack(months=7)
        self.assertEqual(code(error), ("price_missing", "plan_id"))
        self.assertIsNone(self.pack_row())

    def test_a_dual_pack_needs_the_second_person_and_a_valid_email(self):
        for name, email, expected in (
            (None, SECOND, ("invalid_name", "second_person_name")),
            ("B", SECOND, ("invalid_name", "second_person_name")),
            ("Beatriz", None, ("invalid_email", "second_person_email")),
            ("Beatriz", "no-es-un-email", ("invalid_email", "second_person_email")),
        ):
            with self.assertRaises(HTTPException, msg=(name, email)) as error:
                self.new_pack(session_type="dual", name=name, email=email)
            self.assertEqual(code(error), expected)
            self.assertIsNone(self.pack_row())                                 # nothing was created

    def test_an_invalid_type_is_refused_and_an_individual_pack_keeps_no_second_person(self):
        with self.assertRaises(HTTPException) as error:
            self.new_pack(session_type="trio")
        self.assertEqual(code(error), ("invalid_session_type", "session_type"))
        self.new_pack(session_type="individual", name="Intrusa Sobrante", email=SECOND)
        self.assertEqual(self.pack_row()[:3], ("individual", None, None))

    def test_a_pack_that_already_existed_keeps_what_it_has(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO user_plans (user_id, plan_id, active, start_date, end_date) VALUES (%s, %s, TRUE, %s, %s) RETURNING id",
                    (self.user_id, self.plans[3], date.today() - timedelta(days=5), date.today() + timedelta(days=60)))
        old_id = cur.fetchone()[0]
        conn.commit()
        pricing.ensure_schema(cur)                                            # the next start of the server
        conn.commit()
        cur.execute("SELECT session_type, second_person_name, price_per_session, total_price FROM user_plans WHERE id = %s", (old_id,))
        self.assertEqual(cur.fetchone(), ("individual", None, None, None))     # nothing was recalculated or filled in
        conn.close()
        self.new_pack(months=3, session_type="dual", name="Beatriz Prueba", email=SECOND)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT session_type, price_per_session, total_price FROM user_plans WHERE id = %s", (old_id,))
        self.assertEqual(cur.fetchone(), ("individual", None, None))
        conn.close()

    # ----- the Google event
    def test_the_google_event_of_a_dual_session_says_tipo_dual_with_the_second_name(self):
        self.new_pack(months=1, per_week=1, session_type="dual", name="Beatriz Prueba", email=SECOND)
        events = list(self.google.events.values())
        self.assertGreater(len(events), 0)
        for event in events:
            self.assertIn("Tipo: Dual (Beatriz Prueba)", event["description"])
            self.assertRegex(event["summary"], r"^Henrique Preco \d+/\d+$")        # the title keeps its format
        self.assertNotIn("beatriz", json.dumps(events).lower().replace("beatriz prueba", ""))   # the email is not in the event

    def test_the_event_of_an_individual_session_is_unchanged(self):
        self.new_pack(months=1, per_week=1)
        for event in self.google.events.values():
            self.assertNotIn("Tipo", event["description"])

    # ----- trial sessions
    def test_a_trial_is_40_individual_and_50_dual(self):
        individual = self.book_trial()
        self.assertEqual(self.trial_row(individual["trial_id"]), ("individual", None, None, 40))
        dual = self.book_trial("dual", "Beatriz Prueba", SECOND, address=f"dual{DOMAIN}", hour="11:00")
        self.assertEqual(self.trial_row(dual["trial_id"]), ("dual", "Beatriz Prueba", SECOND, 50))

    def test_a_dual_trial_needs_the_second_person(self):
        for name, email, expected in (
            (None, SECOND, ("invalid_name", "second_person_name")),
            ("Beatriz", "", ("invalid_email", "second_person_email")),
            ("Beatriz", "malo@", ("invalid_email", "second_person_email")),
        ):
            with self.assertRaises(HTTPException, msg=(name, email)) as error:
                self.book_trial("dual", name, email)
            self.assertEqual(code(error), expected)

    def test_the_emails_say_the_type_and_the_price_and_nothing_goes_to_the_second_person(self):
        self.book_trial("dual", "Beatriz Prueba", SECOND)
        client = [m for m in RECEIVED if f"ana{DOMAIN}" in m["to"]]
        team = [m for m in RECEIVED if "pt@thundbalance.com" in m["to"].split(",")]
        self.assertEqual((len(client), len(team)), (1, 1))
        for message in client + team:
            self.assertIn("Dual", message["html"])
            self.assertIn("€50", message["html"])
            self.assertNotIn(SECOND, message["to"])                            # never written to
        self.assertIn(SECOND, team[0]["html"])                                 # the team does see the second person's email
        self.assertNotIn(SECOND, client[0]["html"])                            # the client's email only names them
        self.assertIn("Beatriz Prueba", client[0]["html"])
        self.assertFalse([m for m in RECEIVED if SECOND in m["to"] or SECOND in m.get("cc", "") or SECOND in m.get("bcc", "")])

    def test_the_pack_email_says_the_type_and_the_price_and_goes_only_to_the_client(self):
        main.app.dependency_overrides[main.require_admin] = lambda: {"email": main.ADMIN_EMAIL, "sub": "uid-admin"}
        self.new_pack_with_email(months=3, per_week=2)
        self.wait_for_mail()
        sent = [m for m in RECEIVED if f"hp{DOMAIN}" in m["to"]]
        self.assertEqual(len(sent), 1)
        html = re.sub(r"\s+", " ", sent[0]["html"])
        for expected in ("Dual", "Beatriz Prueba", "€75", "€1800"):
            self.assertIn(expected, html)
        self.assertFalse([m for m in RECEIVED if SECOND in m["to"]])

    def new_pack_with_email(self, months, per_week):
        return endpoint("/admin/clients/{client_id}/renew-pack", "POST")(self.user_id, main.NewPack(
            plan_id=self.plans[months], sessions_per_week=per_week, preferred_days="Monday,Wednesday", preferred_time="09:00",
            trainer_id=self.trainer_id, start_date=weekday_after(10).isoformat(), email_extra=[], allow_conflicts=True,
            confirm_replace=True, session_type="dual", second_person_name="Beatriz Prueba", second_person_email=SECOND))

    # ----- requests
    def test_a_client_request_keeps_its_type_and_approving_it_builds_the_dual_pack(self):
        with mock.patch.object(main, "require_client", lambda authorization=None: {"sub": "uid-pricing", "email": f"hp{DOMAIN}"}):
            create = endpoint("/client-requests", "POST")
            with self.assertRaises(HTTPException) as error:
                create(main.ClientRequestCreate(plan_id=self.plans[3], sessions_per_week=2, preferred_days="Monday,Wednesday",
                                                preferred_time="09:00", session_type="dual"), "Bearer x")
            self.assertEqual(code(error), ("invalid_name", "second_person_name"))
            create(main.ClientRequestCreate(plan_id=self.plans[3], sessions_per_week=2, preferred_days="Monday,Wednesday",
                                            preferred_time="09:00", session_type="dual", second_person_name="Beatriz Prueba",
                                            second_person_email=SECOND), "Bearer x")
        rows = [row for row in endpoint("/admin/client-requests", "GET")() if row[1] == "Henrique Preco"]
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual((row[9], row[10], row[11], row[12]), ("dual", "Beatriz Prueba", SECOND, 3))      # type, second person, plan months
        result = endpoint("/admin/approve-request", "POST")(main.ApproveRequest(
            request_id=row[0], trainer_id=self.trainer_id, start_date=weekday_after(10).isoformat(), email_extra=[],
            email_client=False, allow_conflicts=True, confirm_replace=True))
        self.assertEqual(result["total_sessions"], 24)
        self.assertEqual(self.pack_row(), ("dual", "Beatriz Prueba", SECOND, 75, 1800))

    def test_the_preview_shows_the_price_and_the_lists_show_the_label(self):
        preview = endpoint("/admin/packs/preview", "POST")(main.PackPreview(
            client_id=self.user_id, plan_id=self.plans[3], sessions_per_week=2, preferred_days="Monday,Wednesday",
            preferred_time="09:00", trainer_id=self.trainer_id, start_date=weekday_after(10).isoformat(), session_type="dual"))
        self.assertEqual((preview["price_per_session"], preview["total_price"]), (75, 1800))
        unpriced = endpoint("/admin/packs/preview", "POST")(main.PackPreview(
            client_id=self.user_id, plan_id=self.plans[7], sessions_per_week=1, preferred_days="Monday",
            preferred_time="09:00", trainer_id=self.trainer_id, start_date=weekday_after(10).isoformat()))
        self.assertIsNone(unpriced["price_per_session"])
        self.new_pack(months=1, per_week=1, session_type="dual", name="Beatriz Prueba", email=SECOND)
        main.app.dependency_overrides[main.require_admin] = lambda: {"email": main.ADMIN_EMAIL, "sub": "uid-admin"}
        http = TestClient(main.app)
        client = next(item for item in http.get("/admin/clients").json() if item["id"] == self.user_id)
        self.assertEqual(client["session_type"], "dual")
        detail = http.get(f"/admin/clients/{self.user_id}").json()
        pack = detail["packs"][-1]
        self.assertEqual((pack["session_type"], pack["second_person_name"], pack["price_per_session"], pack["total_price"]),
                         ("dual", "Beatriz Prueba", 80, 80 * pack["total"]))


if __name__ == "__main__":
    unittest.main()

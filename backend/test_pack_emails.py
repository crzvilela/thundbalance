"""Tests for the pack email and the unified pack creation:

    python -m unittest test_pack_emails -v

A fake Apps Script server stands in for Google Mail; the Google Calendar is
replaced by a counter. The database part uses the LOCAL database and removes
what it creates.
"""
import json
import os
import threading
import unittest
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer

from fastapi import HTTPException

import main
import packs
from database import get_connection
from emails import (
    build_pack_ics, clean_recipients, render_pack_summary_block, send_pack_summary_email, team_emails,
)

RECEIVED = []


class FakeScript(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        RECEIVED.append(body)
        ok = body.get("secret") == "right-secret"
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps({"ok": ok}).encode())

    def log_message(self, *args):
        pass


def sample_summary():
    return {
        "client_name": "Ana <García>", "client_email": "ana@example.com", "plan_name": "Pack 10",
        "sessions_per_week": 2, "days": ["Wednesday", "Monday"], "trainer": "Carles",
        "sessions": [  # deliberately out of order
            {"id": 3, "start": datetime(2026, 10, 19, 9), "trainer": "Carles", "number": "3/4"},
            {"id": 1, "start": datetime(2026, 10, 12, 9), "trainer": "Carles", "number": "1/4"},
            {"id": 4, "start": datetime(2026, 10, 21, 9), "trainer": "Carles", "number": "4/4"},
            {"id": 2, "start": datetime(2026, 10, 14, 9), "trainer": "Carles", "number": "2/4"},
        ],
    }


class EmailPart(unittest.TestCase):
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

    def test_block_lists_sessions_by_date_in_both_languages(self):
        es = render_pack_summary_block(sample_summary(), "es")
        en = render_pack_summary_block(sample_summary(), "en")
        self.assertLess(es.html.index("12 de octubre"), es.html.index("14 de octubre"))
        self.assertLess(es.html.index("14 de octubre"), es.html.index("19 de octubre"))
        self.assertIn("Lunes, Miércoles", es.html)           # days in week order, translated
        self.assertIn("Monday, Wednesday", en.html)
        self.assertIn("Empieza", es.html)
        self.assertIn("lunes, 12 de octubre de 2026", es.text.lower())

    def test_ics_has_every_session_with_stable_uids(self):
        ics = build_pack_ics(sample_summary())
        self.assertEqual(ics.count("BEGIN:VEVENT"), 4)
        for n in (1, 2, 3, 4):
            self.assertIn(f"UID:session-{n}@thundbalance.com", ics)
        self.assertIn("DTSTART:20261012T070000Z", ics)       # 09:00 Madrid (summer) = 07:00Z
        self.assertIn("DTEND:20261012T080000Z", ics)         # 60 minutes
        self.assertIn("Carrer de Pallars 286\\, Barcelona", ics.replace("\r\n ", ""))
        self.assertLess(ics.index("session-1@"), ics.index("session-2@"))

    def test_sends_client_and_team_messages(self):
        result = send_pack_summary_email(sample_summary(), True, ["info@thundbalance.com", "pt@thundbalance.com", "ANA@example.com", "info@thundbalance.com"])
        self.assertTrue(result.ok)
        self.assertEqual(result.sent_to, ["ana@example.com", "info@thundbalance.com", "pt@thundbalance.com"])
        self.assertEqual(len(RECEIVED), 2)
        client = next(m for m in RECEIVED if m["to"] == "ana@example.com")
        team = next(m for m in RECEIVED if m["to"] != "ana@example.com")
        self.assertEqual(team["to"], "info@thundbalance.com,pt@thundbalance.com")
        self.assertNotIn("Ana", client["subject"])
        self.assertIn("Ana <García>", team["subject"])
        self.assertIn(" / ", client["subject"])
        for message in (client, team):
            self.assertEqual(len(message["attachments"]), 1)
            self.assertEqual(message["attachments"][0]["name"], "thundbalance-sesiones.ics")
            self.assertIn("&lt;García&gt;", message["html"])
        self.assertEqual(client["attachments"][0]["data"], team["attachments"][0]["data"])

    def test_client_switch_off_and_no_recipients(self):
        result = send_pack_summary_email(sample_summary(), False, ["info@thundbalance.com"])
        self.assertEqual((result.sent_to, len(RECEIVED)), (["info@thundbalance.com"], 1))
        RECEIVED.clear()
        result = send_pack_summary_email(sample_summary(), False, [])
        self.assertFalse(result.ok)
        self.assertEqual((result.problem, RECEIVED), ("no_recipients", []))

    def test_failure_is_reported_not_raised(self):
        os.environ["TRIAL_EMAIL_WEBHOOK_SECRET"] = "wrong"
        result = send_pack_summary_email(sample_summary(), True, ["info@thundbalance.com"])
        self.assertFalse(result.ok)
        self.assertEqual(result.sent_to, [])
        self.assertEqual(result.failed, ["ana@example.com", "info@thundbalance.com"])
        del os.environ["TRIAL_EMAIL_WEBHOOK_URL"]
        self.assertFalse(send_pack_summary_email(sample_summary(), True, []).ok)

    def test_recipient_rules(self):
        self.assertEqual(clean_recipients([" A@x.com", "a@x.com", "", "b@x.com"]), ["a@x.com", "b@x.com"])
        with self.assertRaises(ValueError):
            clean_recipients(["not-an-email"])
        with self.assertRaises(ValueError):
            clean_recipients(["a@x.com\nbcc:b@x.com"])
        with self.assertRaises(ValueError):
            clean_recipients([f"u{n}@x.com" for n in range(11)])
        os.environ["TEAM_EMAILS"] = "one@x.com, two@x.com,one@x.com"
        try:
            self.assertEqual(team_emails(), ["one@x.com", "two@x.com"])
            os.environ["TEAM_EMAILS"] = "broken"
            self.assertEqual(team_emails(), ["info@thundbalance.com", "pt@thundbalance.com"])
        finally:
            del os.environ["TEAM_EMAILS"]
        self.assertEqual(team_emails(), ["info@thundbalance.com", "pt@thundbalance.com"])


def endpoint(path, method):
    for route in main.app.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", ()):
            return route.endpoint
    raise LookupError(path)


class PackFlow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.ensure_trial_session_fields()
        main.ensure_client_workflow_fields()
        cls.server = HTTPServer(("127.0.0.1", 0), FakeScript)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active AND nome='Guille'")
        row = cur.fetchone()
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 1")
        cls.trainer_id = (row or cur.fetchone())[0]
        cur.execute("INSERT INTO plans (nome, preco, duracao_meses, duration_weeks) VALUES ('TEST pack 2 weeks', 0, 1, 2) RETURNING id")
        cls.plan_id = cur.fetchone()[0]
        cur.execute("INSERT INTO users (nome, email) VALUES ('Ana Test Pack', 'ana.pack.test@example.com') RETURNING id")
        cls.user_id = cur.fetchone()[0]
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM client_requests WHERE user_id = %s", (cls.user_id,))
        cur.execute("DELETE FROM sessions WHERE user_id = %s", (cls.user_id,))
        cur.execute("DELETE FROM user_plans WHERE user_id = %s", (cls.user_id,))
        cur.execute("DELETE FROM users WHERE id = %s", (cls.user_id,))
        cur.execute("DELETE FROM plans WHERE id = %s", (cls.plan_id,))
        conn.commit()
        conn.close()

    def setUp(self):
        RECEIVED.clear()
        os.environ["TRIAL_EMAIL_WEBHOOK_URL"] = f"http://127.0.0.1:{self.server.server_port}/exec"
        os.environ["TRIAL_EMAIL_WEBHOOK_SECRET"] = "right-secret"
        self.events, self.deleted = [], []
        self._orig = (packs.create_calendar_event, packs.delete_calendar_event)
        packs.create_calendar_event = lambda *a, **k: (self.events.append(a), f"evt-{len(self.events)}")[1]
        packs.delete_calendar_event = lambda event_id: self.deleted.append(event_id)

    def tearDown(self):
        packs.create_calendar_event, packs.delete_calendar_event = self._orig
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM sessions WHERE user_id = %s", (self.user_id,))
        cur.execute("DELETE FROM user_plans WHERE user_id = %s", (self.user_id,))
        conn.commit()
        conn.close()

    def payload(self, **changes):
        start = date.today() + timedelta(days=30)
        while start.weekday() != 0:
            start += timedelta(days=1)
        base = dict(plan_id=self.plan_id, sessions_per_week=2, preferred_days="Monday,Wednesday",
                    preferred_time="09:00", trainer_id=self.trainer_id, start_date=start.isoformat())
        base.update(changes)
        return main.RenewPack(**base)

    def count_sessions(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM sessions WHERE user_id = %s", (self.user_id,))
        n = cur.fetchone()[0]
        conn.close()
        return n

    def test_renew_creates_sessions_events_and_emails(self):
        if not self.plan_id:
            self.skipTest("no 2-week plan in the local database")
        result = endpoint("/admin/clients/{client_id}/renew-pack", "POST")(
            self.user_id, self.payload(email_extra=["info@thundbalance.com", "pt@thundbalance.com"]))
        self.assertEqual(result["total_sessions"], 4)
        self.assertEqual(self.count_sessions(), 4)
        self.assertEqual(len(self.events), 4)
        self.assertEqual(sorted(result["email"]["sent_to"]), ["ana.pack.test@example.com", "info@thundbalance.com", "pt@thundbalance.com"])
        self.assertEqual(result["email"]["failed"], [])
        self.assertEqual(len(RECEIVED), 2)
        ics = RECEIVED[0]["attachments"][0]["data"]
        import base64
        self.assertEqual(base64.b64decode(ics).decode().count("BEGIN:VEVENT"), 4)

    def test_email_failure_keeps_the_sessions(self):
        if not self.plan_id:
            self.skipTest("no 2-week plan in the local database")
        os.environ["TRIAL_EMAIL_WEBHOOK_SECRET"] = "wrong"
        result = endpoint("/admin/clients/{client_id}/renew-pack", "POST")(self.user_id, self.payload())
        self.assertEqual(self.count_sessions(), 4)
        self.assertEqual(self.deleted, [])
        self.assertTrue(result["email"]["failed"])
        self.assertEqual(result["email"]["sent_to"], [])

    def test_bad_recipient_is_refused_before_anything_is_created(self):
        if not self.plan_id:
            self.skipTest("no 2-week plan in the local database")
        with self.assertRaises(HTTPException) as caught:
            endpoint("/admin/clients/{client_id}/renew-pack", "POST")(self.user_id, self.payload(email_extra=["nope"]))
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual((self.count_sessions(), self.events), (0, []))

    def test_calendar_failure_rolls_everything_back(self):
        if not self.plan_id:
            self.skipTest("no 2-week plan in the local database")
        calls = []

        def flaky(*args, **kwargs):
            calls.append(args)
            if len(calls) == 3:
                raise RuntimeError("calendar down")
            return f"evt-{len(calls)}"

        packs.create_calendar_event = flaky
        with self.assertRaises(HTTPException):
            endpoint("/admin/clients/{client_id}/renew-pack", "POST")(self.user_id, self.payload())
        self.assertEqual(self.count_sessions(), 0)
        self.assertEqual(self.deleted, ["evt-1", "evt-2"])
        self.assertEqual(RECEIVED, [])                       # nothing is emailed for a failed pack

    def test_client_switch_off_sends_only_to_extras(self):
        if not self.plan_id:
            self.skipTest("no 2-week plan in the local database")
        result = endpoint("/admin/clients/{client_id}/renew-pack", "POST")(
            self.user_id, self.payload(email_client=False, email_extra=["info@thundbalance.com"]))
        self.assertEqual(result["email"]["sent_to"], ["info@thundbalance.com"])
        self.assertIn("Ana Test Pack", RECEIVED[0]["subject"])

    def test_approving_a_request_uses_the_same_creation_and_email(self):
        if not self.plan_id:
            self.skipTest("no 2-week plan in the local database")
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO client_requests (user_id, plan_id, sessions_per_week, preferred_days, preferred_time, status) "
            "VALUES (%s, %s, 2, 'Monday,Wednesday', '09:00', 'Pending') RETURNING id", (self.user_id, self.plan_id))
        request_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        start = self.payload().start_date
        result = endpoint("/admin/approve-request", "POST")(main.ApproveRequest(
            request_id=request_id, trainer_id=self.trainer_id, start_date=start, email_extra=[]))
        self.assertEqual(result["total_sessions"], 4)
        self.assertEqual(self.count_sessions(), 4)
        self.assertEqual(len(self.events), 4)
        self.assertEqual(result["email"]["sent_to"], ["ana.pack.test@example.com"])
        self.assertEqual(len(RECEIVED), 1)


if __name__ == "__main__":
    unittest.main()

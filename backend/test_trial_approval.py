"""Approving a trial session: email in the saved language, a provisional
calendar event, a log of every email and a resend button.

    python -m unittest test_trial_approval -v

Google Mail is a local fake server; the Google Calendar is faked. The local
database is used and cleaned.
"""
import json
import os
import re
import threading
import unittest
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from types import SimpleNamespace

from fastapi import HTTPException

import admin_api
import main
import trial_confirmation as tc
from database import get_connection

RECEIVED = []
DOMAIN = "@test-approval.example"


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


class Gone(Exception):
    """What Google raises for an event that was deleted by hand."""
    resp = SimpleNamespace(status=404)


class Approval(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.ensure_trial_session_fields()
        main.ensure_email_log_table()
        cls.server = HTTPServer(("127.0.0.1", 0), FakeScript)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}/exec"
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
        cur.execute("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        conn.commit()
        conn.close()

    def setUp(self):
        RECEIVED.clear()
        self.cleanup()
        os.environ["TRIAL_EMAIL_WEBHOOK_URL"] = self.url
        os.environ["TRIAL_EMAIL_WEBHOOK_SECRET"] = "right-secret"
        self.events, self.updates, self.deleted = [], [], []
        self.calendar_down = False
        self.event_gone = False

        def fake_create(*args, **kwargs):
            if self.calendar_down:
                raise RuntimeError("calendar down")
            self.events.append(kwargs.get("provisional"))
            return f"evt-{len(self.events)}"

        def fake_update(event_id, *args, **kwargs):
            if self.calendar_down:
                raise RuntimeError("calendar down")
            if self.event_gone:
                raise Gone()
            self.updates.append((event_id, kwargs.get("provisional")))

        self._orig = (tc.create_trial_session_event, tc.update_trial_session_event, tc.delete_calendar_event,
                      admin_api.delete_calendar_event)
        tc.create_trial_session_event = fake_create
        tc.update_trial_session_event = fake_update
        tc.delete_calendar_event = lambda event_id: self.deleted.append(event_id)
        admin_api.delete_calendar_event = lambda event_id: self.deleted.append(event_id)

    def tearDown(self):
        (tc.create_trial_session_event, tc.update_trial_session_event, tc.delete_calendar_event,
         admin_api.delete_calendar_event) = self._orig
        os.environ["TRIAL_EMAIL_WEBHOOK_URL"] = self.url
        os.environ["TRIAL_EMAIL_WEBHOOK_SECRET"] = "right-secret"
        self.cleanup()

    # ----- helpers
    def new_trial(self, tag="a", lang="ca", status="Pending", hour="10:00", offset=14, token=None):
        day = date.today() + timedelta(days=offset)
        while day.weekday() > 4:
            day += timedelta(days=1)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status, lang, confirmation_token) "
            "VALUES ('Ana García', %s, '600123456', 'Lose weight', 'Beginner', %s, %s, %s, %s, %s) RETURNING id",
            (f"{tag}{DOMAIN}", day, hour, status, lang, token))
        trial_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        return trial_id

    def approve(self, trial_id):
        return endpoint("/admin/trial-sessions/{trial_id}/approve", "POST")(
            trial_id, admin_api.TrialApprovePayload(trainer_id=self.trainer_id))

    def card(self, trial_id):
        return {row["id"]: row for row in endpoint("/admin/trial-sessions", "GET")()}[trial_id]

    def row(self, trial_id):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT status, google_event_id, confirmation_token, calendar_error FROM trial_sessions WHERE id = %s", (trial_id,))
        data = cur.fetchone()
        conn.close()
        return data

    def log_rows(self, trial_id, kind="trial_approved"):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT estado, erro, destinatario FROM email_log WHERE tipo = %s AND referencia = %s ORDER BY id", (kind, str(trial_id)))
        rows = cur.fetchall()
        conn.close()
        return rows

    def age_the_log(self, trial_id, seconds):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("UPDATE email_log SET criado_em = criado_em - (%s || ' seconds')::interval WHERE referencia = %s", (str(seconds), str(trial_id)))
        conn.commit()
        conn.close()

    # ----- tests
    def test_approving_sends_the_email_logs_it_and_creates_the_provisional_event(self):
        trial_id = self.new_trial(lang="ca")
        result = self.approve(trial_id)

        self.assertEqual(result["email"], {"sent": True, "problem": ""})
        self.assertTrue(result["calendar"]["ok"])
        status, event_id, token, _ = self.row(trial_id)
        self.assertEqual((status, event_id), ("Approved", "evt-1"))
        self.assertEqual(self.events, [True])                          # provisional=True

        approved = [m for m in RECEIVED if m["to"] == f"a{DOMAIN}"]
        self.assertEqual(len(approved), 1)
        self.assertEqual(approved[0]["language"], "ca")
        self.assertIn(f"/trial-session/confirm/{token}?lang=ca", approved[0]["html"])

        self.assertEqual(self.log_rows(trial_id), [("enviado", None, f"a{DOMAIN}")])
        card = self.card(trial_id)
        self.assertEqual(card["status"], "approved")
        self.assertEqual(card["approval_email"]["status"], "sent")
        self.assertRegex(card["approval_email"]["at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d$")
        self.assertFalse(card["calendar_missing"])

    def test_the_email_failure_is_visible_and_resend_works_with_the_same_link(self):
        os.environ["TRIAL_EMAIL_WEBHOOK_SECRET"] = "wrong"           # credentials "turned off"
        trial_id = self.new_trial(lang="es")
        result = self.approve(trial_id)
        self.assertEqual(self.row(trial_id)[0], "Approved")            # approval is NOT undone
        self.assertEqual(result["email"]["sent"], False)
        self.assertEqual(result["email"]["problem"], "rejected")
        self.assertEqual(self.log_rows(trial_id), [("falhou", "rejected", f"a{DOMAIN}")])
        card = self.card(trial_id)
        self.assertEqual((card["approval_email"]["status"], card["approval_email"]["error"]), ("failed", "rejected"))

        token = self.row(trial_id)[2]
        os.environ["TRIAL_EMAIL_WEBHOOK_SECRET"] = "right-secret"     # credentials put back
        RECEIVED.clear()
        self.age_the_log(trial_id, 120)                                # past the one-minute limit
        again = endpoint("/admin/trial-sessions/{trial_id}/resend-approval", "POST")(trial_id)
        self.assertEqual(again["email"]["sent"], True)
        self.assertEqual(self.row(trial_id)[2], token)                 # same token, still valid
        message = [m for m in RECEIVED if m["to"] == f"a{DOMAIN}"][0]
        self.assertIn(f"/trial-session/confirm/{token}", message["html"])
        self.assertEqual([r[0] for r in self.log_rows(trial_id)], ["falhou", "enviado"])
        self.assertEqual(self.card(trial_id)["approval_email"]["status"], "sent")   # the card shows the newest

    def test_resend_is_limited_to_once_a_minute(self):
        trial_id = self.new_trial()
        self.approve(trial_id)                                         # this email counts as the last one
        with self.assertRaises(HTTPException) as caught:
            endpoint("/admin/trial-sessions/{trial_id}/resend-approval", "POST")(trial_id)
        self.assertEqual(caught.exception.status_code, 429)
        self.assertEqual(len(self.log_rows(trial_id)), 1)
        self.age_the_log(trial_id, 61)
        endpoint("/admin/trial-sessions/{trial_id}/resend-approval", "POST")(trial_id)
        self.assertEqual(len(self.log_rows(trial_id)), 2)
        with self.assertRaises(HTTPException) as again:                # and not twice in a row
            endpoint("/admin/trial-sessions/{trial_id}/resend-approval", "POST")(trial_id)
        self.assertEqual(again.exception.status_code, 429)

    def test_resend_only_for_sessions_waiting_for_the_client(self):
        pending = self.new_trial(tag="p")
        with self.assertRaises(HTTPException) as caught:
            endpoint("/admin/trial-sessions/{trial_id}/resend-approval", "POST")(pending)
        self.assertEqual(caught.exception.status_code, 409)
        approved = self.new_trial(tag="q", hour="11:00")
        self.approve(approved)
        token = self.row(approved)[2]
        endpoint("/trial-sessions/confirmation/{token}/confirm", "POST")(token)
        self.age_the_log(approved, 300)
        with self.assertRaises(HTTPException) as confirmed:
            endpoint("/admin/trial-sessions/{trial_id}/resend-approval", "POST")(approved)
        self.assertEqual(confirmed.exception.status_code, 409)

    def test_unconfigured_email_is_reported_not_silent(self):
        del os.environ["TRIAL_EMAIL_WEBHOOK_URL"]
        trial_id = self.new_trial()
        result = self.approve(trial_id)
        self.assertEqual(result["email"], {"sent": False, "problem": "not_configured"})
        self.assertEqual(self.log_rows(trial_id), [("falhou", "not_configured", f"a{DOMAIN}")])
        self.assertEqual(self.row(trial_id)[0], "Approved")

    def test_calendar_failure_is_flagged_and_the_button_never_duplicates(self):
        self.calendar_down = True
        trial_id = self.new_trial()
        result = self.approve(trial_id)
        self.assertEqual(self.row(trial_id)[0], "Approved")            # approval kept
        self.assertEqual(result["calendar"]["ok"], False)
        self.assertEqual(result["email"]["sent"], True)                # the email still went out
        card = self.card(trial_id)
        self.assertTrue(card["calendar_missing"])
        self.assertTrue(card["calendar_failed"])

        self.calendar_down = False
        button = endpoint("/admin/trial-sessions/{trial_id}/calendar-event", "POST")
        self.assertTrue(button(trial_id)["calendar"]["ok"])
        self.assertEqual(self.events, [True])                          # created once, provisional
        self.assertFalse(self.card(trial_id)["calendar_missing"])
        self.assertTrue(button(trial_id)["calendar"]["ok"])            # pressed again
        self.assertTrue(button(trial_id)["calendar"]["ok"])
        self.assertEqual(self.events, [True])                          # still ONE event
        self.assertEqual(self.updates[-1], ("evt-1", True))            # refreshed, not duplicated

    def test_an_event_deleted_by_hand_is_recreated_by_the_button(self):
        trial_id = self.new_trial()
        self.approve(trial_id)
        self.event_gone = True
        self.assertTrue(endpoint("/admin/trial-sessions/{trial_id}/calendar-event", "POST")(trial_id)["calendar"]["ok"])
        self.assertEqual(len(self.events), 2)
        self.assertEqual(self.row(trial_id)[1], "evt-2")

    def test_a_row_approved_before_this_change_is_not_fixed_on_its_own(self):
        token = "legacy-token-" + "x" * 30
        trial_id = self.new_trial(status="Approved", token=token, lang=None)
        card = self.card(trial_id)                                     # listing it does nothing
        self.assertTrue(card["calendar_missing"])
        self.assertFalse(card["calendar_failed"])
        self.assertEqual((self.events, self.updates), ([], []))
        self.assertIsNone(self.row(trial_id)[1])
        endpoint("/admin/trial-sessions/{trial_id}/calendar-event", "POST")(trial_id)   # only the button does
        self.assertEqual(self.events, [True])
        self.assertEqual(self.row(trial_id)[1], "evt-1")

    def test_confirm_updates_the_same_event_and_decline_deletes_it(self):
        confirmed = self.new_trial(tag="c", hour="11:00")
        self.approve(confirmed)
        endpoint("/trial-sessions/confirmation/{token}/confirm", "POST")(self.row(confirmed)[2])
        self.assertEqual(self.events, [True])                          # no second event
        self.assertEqual(self.updates, [("evt-1", False)])             # same event, no "[Pendiente]"
        declined = self.new_trial(tag="d", hour="12:00")
        self.approve(declined)
        endpoint("/trial-sessions/confirmation/{token}/decline", "POST")(self.row(declined)[2])
        self.assertEqual(self.deleted, ["evt-2"])
        self.assertIsNone(self.row(declined)[1])

    def test_one_log_row_per_email_and_nothing_sensitive(self):
        trial_id = self.new_trial()
        self.approve(trial_id)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT * FROM email_log WHERE referencia = %s", (str(trial_id),))
        rows = cur.fetchall()
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'email_log' ORDER BY ordinal_position")
        columns = [c[0] for c in cur.fetchall()]
        conn.close()
        self.assertEqual(columns, ["id", "tipo", "referencia", "destinatario", "estado", "erro", "criado_em"])
        self.assertEqual(len(rows), 1)
        joined = " ".join(str(v) for v in rows[0])
        self.assertNotIn("right-secret", joined)
        self.assertNotIn("trial-session/confirm", joined)             # no content, no links


if __name__ == "__main__":
    unittest.main()

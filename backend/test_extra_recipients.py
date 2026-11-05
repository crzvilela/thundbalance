"""Extra recipients of the admin's emails: the CLIENT always gets the email (To) and the extra ones get it in BCC.

    python -m unittest test_extra_recipients -v

The rules (format, lower case, no duplicates, at most 5), the BCC of the central sender (and its fallback when the extra ones
make the message fail), and the actions that carry them: approve a trial (stored as extra_emails), resend, cancel, a new pack
and a reschedule answer. Mail goes to a local fake server; Google is faked; the local database is used and cleaned up.
"""
import json
import os
import threading
import unittest
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer

import testsafety
from fastapi import HTTPException

import admin_api
import catalog_testing
import google_fakes
import main
import plans_schema
import trial_confirmation as tc
from database import get_connection
from emails import transport
from emails.recipients import MAX_EXTRA, client_extra, extra_scope, parse_extra

DOMAIN = "@test-extra.example"
RECEIVED = []
REFUSE_BCC = {"on": False}


class FakeScript(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        RECEIVED.append(body)
        ok = not (REFUSE_BCC["on"] and body.get("bcc"))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps({"ok": ok, "error": "" if ok else "bad bcc"}).encode())

    def log_message(self, *args):
        pass


def endpoint(path, method):
    for route in main.app.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", ()):
            return route.endpoint
    raise LookupError(path)


def weekday_after(offset):
    day = date.today() + timedelta(days=offset)
    while day.weekday() > 4:
        day += timedelta(days=1)
    return day


def flush():
    import time
    from emails.transport import _pool
    for _ in range(3):
        _pool.submit(lambda: None).result(timeout=60)
    time.sleep(0.3)


class Rules(unittest.TestCase):
    def test_valid_lower_case_no_duplicates_and_never_the_client(self):
        got = parse_extra(["PT@Thundbalance.com", "pt@thundbalance.com", " ", "otro@x.co", "Client@X.co"], "client@x.co")
        self.assertEqual(got, ["pt@thundbalance.com", "otro@x.co"])

    def test_a_bad_address_and_more_than_five_are_refused(self):
        for bad in (["no-es-un-email"], ["a@b"], ["a@b.co\nBcc: x@y.z"], ["ok@x.co", "x@@y.co"]):
            with self.assertRaises(HTTPException) as caught:
                parse_extra(bad)
            self.assertEqual((caught.exception.status_code, caught.exception.detail["code"]), (422, "invalid_extra_recipients"))
        self.assertEqual(len(parse_extra([f"p{i}@x.co" for i in range(MAX_EXTRA)])), MAX_EXTRA)
        with self.assertRaises(HTTPException) as caught:
            parse_extra([f"p{i}@x.co" for i in range(MAX_EXTRA + 1)])
        self.assertEqual(caught.exception.detail["code"], "too_many_extra_recipients")

    def test_the_scope_is_only_for_the_action_being_run(self):
        self.assertEqual(client_extra(), [])
        with extra_scope(["a@x.co"]):
            self.assertEqual(client_extra(), ["a@x.co"])
        self.assertEqual(client_extra(), [])


class Flows(unittest.TestCase):
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
        cur.execute(f"INSERT INTO plans (nome, {plans_schema.price_column(cur)}, duracao_meses, duration_weeks) VALUES ('TEST extra 2 weeks', 0, 1, 2) RETURNING id")
        cls.plan_id = cur.fetchone()[0]
        cls.pack_ids = catalog_testing.make_pair(cur, cls.plan_id)
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.cleanup()
        conn = get_connection()
        cur = conn.cursor()
        catalog_testing.drop(cur)
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
            cur.execute("DELETE FROM client_requests WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM users WHERE id = ANY(%s)", (ids,))
        cur.execute("SELECT id FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        trials = [str(r[0]) for r in cur.fetchall()]
        if trials:
            cur.execute("DELETE FROM email_log WHERE referencia = ANY(%s)", (trials,))
        cur.execute("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        conn.commit()
        conn.close()

    def setUp(self):
        RECEIVED.clear()
        REFUSE_BCC["on"] = False
        self.cleanup()
        self.google = google_fakes.FakeGoogle().install()

    def tearDown(self):
        self.google.uninstall()
        self.cleanup()

    def new_trial(self, days=14, hour="10:00"):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status, lang) "
            "VALUES ('Ana Prueba', %s, '600', 'x', 'y', %s, %s, 'Pending', 'es') RETURNING id",
            (f"ana{days}{DOMAIN}", weekday_after(days), hour))
        trial_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        return trial_id

    def mails_to(self, address):
        flush()
        return [m for m in RECEIVED if m["to"] == address]

    # ----- the central sender
    def test_the_sender_puts_the_extra_recipients_in_bcc_and_the_client_alone_in_to(self):
        result = transport.send_email("client@x.co", "Hola", "<p>x</p>", "x", bcc=["pt@thundbalance.com", "otro@x.co"], kind="t", lang="es")
        self.assertTrue(result.ok)
        sent = RECEIVED[-1]
        self.assertEqual((sent["to"], sent["bcc"]), ("client@x.co", "pt@thundbalance.com,otro@x.co"))
        self.assertEqual(sent["cc"], "")

    def test_a_problem_with_the_extra_recipients_never_stops_the_client_email(self):
        REFUSE_BCC["on"] = True
        result = transport.send_email("client@x.co", "Hola", "<p>x</p>", "x", bcc=["pt@thundbalance.com"], kind="t", lang="es")
        self.assertTrue(result.ok)
        self.assertTrue(result.bcc_dropped)
        self.assertEqual([bool(m.get("bcc")) for m in RECEIVED], [True, False])         # tried with them, then without
        self.assertEqual(RECEIVED[-1]["to"], "client@x.co")

    # ----- the trial
    def test_approving_a_trial_sends_it_to_the_client_with_the_extra_in_bcc_and_keeps_them(self):
        trial_id = self.new_trial()
        result = endpoint("/admin/trial-sessions/{trial_id}/approve", "POST")(
            trial_id, admin_api.TrialApprovePayload(trainer_id=self.trainer_id, extra_recipients=["PT@thundbalance.com", "pt@thundbalance.com"]))
        self.assertEqual(result["extra_recipients"], ["pt@thundbalance.com"])
        mails = self.mails_to(f"ana14{DOMAIN}")
        self.assertEqual(len(mails), 1)
        self.assertEqual(mails[0]["bcc"], "pt@thundbalance.com")
        self.assertEqual(mails[0]["to"], f"ana14{DOMAIN}")                                       # the client is the only To
        self.assertEqual(mails[0]["cc"], "")
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT extra_emails FROM trial_sessions WHERE id = %s", (trial_id,))
        self.assertEqual(cur.fetchone()[0], ["pt@thundbalance.com"])                  # kept for the calendar invitations
        conn.close()

    def test_a_bad_or_too_many_extra_recipients_refuse_the_approval_and_change_nothing(self):
        trial_id = self.new_trial()
        approve = endpoint("/admin/trial-sessions/{trial_id}/approve", "POST")
        for bad in (["nope"], [f"p{i}@x.co" for i in range(MAX_EXTRA + 1)]):
            with self.assertRaises(HTTPException) as caught:
                approve(trial_id, admin_api.TrialApprovePayload(trainer_id=self.trainer_id, extra_recipients=bad))
            self.assertEqual(caught.exception.status_code, 422)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT status, extra_emails FROM trial_sessions WHERE id = %s", (trial_id,))
        self.assertEqual(cur.fetchone(), ("Pending", None))
        conn.close()
        self.assertEqual(RECEIVED, [])

    def test_resending_and_cancelling_carry_the_extra_recipients_too(self):
        trial_id = self.new_trial(days=15)
        endpoint("/admin/trial-sessions/{trial_id}/approve", "POST")(trial_id, admin_api.TrialApprovePayload(trainer_id=self.trainer_id))
        flush()
        RECEIVED.clear()
        tc_resend = endpoint("/admin/trial-sessions/{trial_id}/resend-received", "POST")
        answer = tc_resend(trial_id, admin_api.ExtraRecipients(extra_recipients=["pt@thundbalance.com"]))
        self.assertEqual(answer["extra_recipients"], ["pt@thundbalance.com"])
        self.assertEqual([m["bcc"] for m in self.mails_to(f"ana15{DOMAIN}")], ["pt@thundbalance.com"])
        RECEIVED.clear()
        endpoint("/admin/trial-sessions/{trial_id}/cancel", "POST")(trial_id, admin_api.ExtraRecipients(extra_recipients=["otro@x.co"]))
        cancelled = [m for m in self.mails_to(f"ana15{DOMAIN}")]
        self.assertEqual([m["bcc"] for m in cancelled], ["otro@x.co"])

    # ----- the pack
    def test_a_new_pack_goes_to_the_client_with_the_extra_in_bcc_and_keeps_them(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO users (nome, email) VALUES ('Henrique Extra', %s) RETURNING id", (f"he{DOMAIN}",))
        user_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        result = endpoint("/admin/clients/{client_id}/renew-pack", "POST")(user_id, main.NewPack(
            pack_id=self.pack_ids["individual"], sessions_per_week=2, preferred_days="Monday,Wednesday", preferred_time="09:00",
            trainer_id=self.trainer_id, start_date=weekday_after(10).isoformat(), extra_recipients=["PT@thundbalance.com", f"he{DOMAIN}"],
            allow_conflicts=True, allow_overlaps=True))
        self.assertEqual(result["extra_recipients"], ["pt@thundbalance.com"])               # the client's own address is dropped
        mails = self.mails_to(f"he{DOMAIN}")
        self.assertEqual(len(mails), 1)                                                     # ONE message: no separate team copy
        self.assertEqual(mails[0]["bcc"], "pt@thundbalance.com")
        self.assertEqual(result["email"]["sent_to"], [f"he{DOMAIN}", "pt@thundbalance.com"])
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT extra_emails FROM user_plans WHERE user_id = %s", (user_id,))
        self.assertEqual(cur.fetchone()[0], ["pt@thundbalance.com"])
        conn.close()
        with self.assertRaises(HTTPException) as caught:
            endpoint("/admin/clients/{client_id}/renew-pack", "POST")(user_id, main.NewPack(
                pack_id=self.pack_ids["individual"], sessions_per_week=2, preferred_days="Monday,Wednesday", preferred_time="09:00",
                trainer_id=self.trainer_id, start_date=weekday_after(40).isoformat(), extra_recipients=["mal"]))
        self.assertEqual(caught.exception.status_code, 422)

    # ----- the reschedule answers
    def test_the_reschedule_emails_to_the_client_carry_the_scope_and_the_studio_ones_do_not(self):
        import reschedule_notifications as notify
        sent = []

        def fake(to, subject, html, text, **kwargs):
            sent.append((to, kwargs.get("bcc")))
            return None
        original = notify.send_email_async
        notify.send_email_async = fake
        os.environ.setdefault("TRIAL_EMAIL_WEBHOOK_URL", "http://x")
        try:
            ctx = {"id": 1, "client_email": f"c{DOMAIN}", "client_name": "Ana", "lang": "es", "number": "1/4",
                   "original_date": "2026-11-09", "original_time": "09:00", "requested_date": "2026-11-10", "requested_time": "10:00",
                   "session_date": "2026-11-09", "session_time": "09:00", "status": "approved"}
            with extra_scope(["pt@thundbalance.com", f"c{DOMAIN}"]):
                notify._client(lambda: ("s", "<p>h</p>", "t"), dict(ctx), "reschedule_approved")
                notify._staff(lambda: ("s", "<p>h</p>", "t"), dict(ctx), "reschedule_requested")
        finally:
            notify.send_email_async = original
        self.assertEqual(sent[0], (f"c{DOMAIN}", ["pt@thundbalance.com"]))                  # the client's own address is dropped
        self.assertEqual(sent[1][1], None)                                                  # the studio's notice has no BCC

    def test_the_reschedule_routes_validate_before_deciding(self):
        for method, path in (("approve", "/admin/reschedule-requests/{request_id}/approve"),
                             ("resend", "/admin/reschedule-requests/{request_id}/resend-email")):
            handler = endpoint(path, "POST")
            with self.assertRaises(HTTPException) as caught:
                if method == "approve":
                    handler(987654, __import__("reschedule_requests").ExtraPayload(extra_recipients=["mal"]), claims={"email": "x"})
                else:
                    handler(987654, __import__("reschedule_requests").ExtraPayload(extra_recipients=["mal"]))
            self.assertEqual(caught.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()

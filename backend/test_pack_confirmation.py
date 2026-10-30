"""The pack confirmation email reaches the client on EVERY path that creates or changes a pack:

    python -m unittest test_pack_confirmation -v

  approve a request (/admin/approve-request) · new pack / renew (/admin/clients/{id}/renew-pack)
  assign a plan (/admin/assign-plan, which sent nothing before) · and the welcome email of "Nuevo cliente" has the same facts.

send_email is replaced by a recorder (nothing leaves the machine) and Google Calendar by a fake.
"""
import unittest
from datetime import date, timedelta
from unittest import mock

import google_fakes
import main
import packs
from database import get_connection
from emails.transport import EmailResult

DOMAIN = "@test-confirm.example"
TEAM = "pt@thundbalance.com"


def next_monday(offset=10):
    day = date.today() + timedelta(days=offset)
    return day + timedelta(days=(7 - day.weekday()) % 7)


class Recorder:
    def __init__(self):
        self.sent = []

    def __call__(self, to, subject, html, text, reply_to=None, attachments=None, cc=None, extra=None, kind="", lang="", reference=None):
        self.sent.append({"to": to, "subject": subject, "html": html, "text": text, "kind": kind, "lang": lang})
        return EmailResult(True)

    def to(self, address):
        return [m for m in self.sent if address == m["to"] or (not isinstance(m["to"], str) and address in m["to"])]


class Confirmation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.ensure_session_pack_column()           # also adds plans.tipo
        main.ensure_calendar_sync_columns()
        main.ensure_client_workflow_fields()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 1")
        cls.trainer_id = cur.fetchone()[0]
        conn.commit()
        conn.close()

    def setUp(self):
        self.cleanup()
        self.google = google_fakes.FakeGoogle().install()
        self.recorder = Recorder()
        patcher = mock.patch("emails.transport.send_email", self.recorder)
        patcher.start()
        self.addCleanup(patcher.stop)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO plans (nome, preco, duracao_meses, duration_weeks, tipo) VALUES ('TEST confirm dual', 62.5, 1, 3, 'dual') RETURNING id")
        self.dual = cur.fetchone()[0]
        cur.execute("INSERT INTO plans (nome, preco, duracao_meses, duration_weeks) VALUES ('TEST confirm single', 70, 1, 2) RETURNING id")
        self.single = cur.fetchone()[0]
        cur.execute("INSERT INTO users (nome, email, firebase_uid, lang) VALUES ('Ana Confirm', %s, 'uid-confirm', 'ca') RETURNING id", (f"ana{DOMAIN}",))
        self.user_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        self.monday = next_monday()

    def tearDown(self):
        self.google.uninstall()
        self.cleanup()

    @classmethod
    def tearDownClass(cls):
        cls.cleanup()

    @staticmethod
    def cleanup():
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        ids = [row[0] for row in cur.fetchall()]
        if ids:
            cur.execute("DELETE FROM sessions WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM user_plans WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM client_requests WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM users WHERE id = ANY(%s)", (ids,))
        cur.execute("DELETE FROM plans WHERE nome LIKE 'TEST confirm%'")
        conn.commit()
        conn.close()

    def route(self, path):
        return next(r for r in main.app.routes if getattr(r, "path", None) == path and "POST" in getattr(r, "methods", ())).endpoint

    def renew(self, plan, email_client=True, **extra):
        return self.route("/admin/clients/{client_id}/renew-pack")(self.user_id, main.RenewPack(
            plan_id=plan, sessions_per_week=2, preferred_days="Monday,Wednesday", preferred_time="10:00",
            trainer_id=self.trainer_id, start_date=self.monday.isoformat(), email_client=email_client,
            allow_conflicts=True, confirm_replace=True, **extra))

    def check_email(self, message, plan_name, type_text, price_text, total_text):
        html = message["html"]
        self.assertIn('<html lang="ca"', html)                     # the client's language, one language
        self.assertEqual(message["subject"], "El teu pack d'entrenament")
        for word in (plan_name, type_text, price_text, total_text, "3 setmanes", "Comença"):
            self.assertIn(word, html, word)
        self.assertNotIn(" / ", message["subject"])

    # ----- the three paths
    def test_a_new_pack_sends_the_confirmation_to_the_client_with_all_the_facts(self):
        answer = self.renew(self.dual)
        self.assertEqual(answer["email"]["sent_to"], [f"ana{DOMAIN}", TEAM])
        self.assertEqual(answer["email"]["failed"], [])
        message = self.recorder.to(f"ana{DOMAIN}")[0]
        # 3 weeks x 2 a week = 6 sessions at 62,50 each = 375
        self.check_email(message, "TEST confirm dual", "Dual (en parella)", "62,50", "375")
        self.assertEqual(message["kind"], "pack_summary")
        self.assertEqual(message["lang"], "ca")
        self.assertEqual(self.recorder.to(TEAM)[0]["lang"], "es")  # the team's copy stays Spanish

    def test_approving_a_request_sends_it(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO client_requests (user_id, plan_id, sessions_per_week, preferred_days, preferred_time, status) "
                    "VALUES (%s, %s, 2, 'Monday,Wednesday', '10:00', 'Pending') RETURNING id", (self.user_id, self.dual))
        request_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        answer = main.approve_request(main.ApproveRequest(
            request_id=request_id, trainer_id=self.trainer_id, start_date=self.monday.isoformat(), allow_conflicts=True, confirm_replace=True))
        self.assertIn(f"ana{DOMAIN}", answer["email"]["sent_to"])
        self.check_email(self.recorder.to(f"ana{DOMAIN}")[0], "TEST confirm dual", "Dual (en parella)", "62,50", "375")

    def test_assigning_a_plan_now_sends_the_confirmation_too(self):
        self.renew(self.single, email_client=False)                 # a pack with its sessions, without the first email
        self.recorder.sent.clear()
        answer = self.route("/admin/assign-plan")(main.AssignPlan(user_id=self.user_id, plan_id=self.dual))
        self.assertEqual(answer["message"], "Plan assigned successfully")
        self.assertIn(f"ana{DOMAIN}", answer["email"]["sent_to"])
        message = self.recorder.to(f"ana{DOMAIN}")[0]
        self.assertIn("TEST confirm dual", message["html"])         # the plan the client has NOW
        self.assertIn("Dual (en parella)", message["html"])
        self.assertIn('<html lang="ca"', message["html"])

    def test_assigning_a_plan_to_a_client_without_sessions_sends_nothing_and_still_assigns(self):
        answer = self.route("/admin/assign-plan")(main.AssignPlan(user_id=self.user_id, plan_id=self.single))
        self.assertEqual(answer["message"], "Plan assigned successfully")
        self.assertIsNone(answer["email"])
        self.assertEqual(self.recorder.sent, [])

    # ----- never in the way of the pack
    def test_a_failing_send_never_undoes_or_blocks_the_pack(self):
        with mock.patch("emails.transport.send_email", lambda *a, **k: EmailResult(False, "unreachable")):
            answer = self.renew(self.dual)
        self.assertEqual(answer["message"], "Pack renewed successfully")
        self.assertEqual(answer["email"]["sent_to"], [])
        self.assertTrue(answer["email"]["failed"])
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM sessions WHERE user_id = %s AND status = 'Booked'", (self.user_id,))
        self.assertEqual(cur.fetchone()[0], 6)
        conn.close()

    def test_an_error_while_preparing_the_email_is_reported_without_personal_data(self):
        records = []
        handler = mock.Mock()
        handler.level = 0
        import logging
        capture = logging.Handler()
        capture.emit = lambda record: records.append(record.getMessage())
        logging.getLogger("thundbalance.packs").addHandler(capture)
        try:
            with mock.patch("packs.send_pack_summary_email", side_effect=RuntimeError("boom ana@x.co")):
                answer = self.renew(self.single)
        finally:
            logging.getLogger("thundbalance.packs").removeHandler(capture)
        self.assertEqual(answer["message"], "Pack renewed successfully")
        self.assertEqual(answer["email"], {"sent_to": [], "failed": [], "problem": "error"})
        text = " ".join(records)
        self.assertIn("RuntimeError", text)
        self.assertNotIn("ana@x.co", text)
        self.assertNotIn("Ana", text)

    def test_a_replaced_event_that_cannot_be_removed_does_not_stop_the_email(self):
        with mock.patch("main.remove_replaced_events", side_effect=RuntimeError("calendar down")):
            answer = self.renew(self.single)
        self.assertEqual(answer["message"], "Pack renewed successfully")
        self.assertIn(f"ana{DOMAIN}", answer["email"]["sent_to"])

    # ----- plans keep working
    def test_old_plans_are_individual_and_the_type_is_validated(self):
        answer = self.renew(self.single)
        self.assertIn("Individual (1 a 1)", self.recorder.to(f"ana{DOMAIN}")[0]["html"])
        self.assertTrue(answer["email"]["sent_to"])
        facts = packs.plan_facts(self._cursor(), self.single)
        self.assertEqual((facts["type"], facts["weeks"], facts["price"]), ("individual", 2, 70.0))

    def _cursor(self):
        conn = get_connection()
        self.addCleanup(conn.close)
        return conn.cursor()


if __name__ == "__main__":
    unittest.main()

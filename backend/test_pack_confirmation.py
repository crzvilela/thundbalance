"""The pack confirmation email reaches the client on EVERY path that creates a pack, and a problem sending it never stops the pack:

    python -m unittest test_pack_confirmation -v

  approve a request (/admin/approve-request) · new pack (/admin/clients/{id}/renew-pack) · and the failure cases.
  (The old "Asignar plan" path no longer exists: a new pack replaces it, and it sends the same email.)

The email says the type (individual / dual), the duration, the price per session and the total, the start date and every
session. send_email is replaced by a recorder (nothing leaves the machine) and Google Calendar by a fake.
"""
import logging
import unittest
from datetime import date, timedelta
from unittest import mock

import google_fakes
import main
import packs
import pricing
from database import get_connection
from emails.transport import EmailResult

DOMAIN = "@test-confirm.example"
TEAM = "pt@thundbalance.com"
SECOND = f"beatriz{DOMAIN}"


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
        main.ensure_session_pack_column()
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
        # a 1-month plan of 3 weeks (the price comes from the pricing table, never from the plan)
        cur.execute("INSERT INTO plans (nome, duracao_meses, duration_weeks) VALUES ('TEST confirm 3 weeks', 1, 3) RETURNING id")
        self.plan_id = cur.fetchone()[0]
        cur.execute("INSERT INTO users (nome, email, firebase_uid, lang) VALUES ('Ana Confirm', %s, 'uid-confirm', 'ca') RETURNING id", (f"ana{DOMAIN}",))
        self.user_id = cur.fetchone()[0]
        self.individual = pricing.pack_quote(cur, "individual", 1, 6)       # 3 weeks x 2 a week = 6 sessions
        self.dual = pricing.pack_quote(cur, "dual", 1, 6)
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

    def new_pack(self, session_type=None, email_client=True):
        extra = {"session_type": "dual", "second_person_name": "Beatriz Prueba", "second_person_email": SECOND} if session_type == "dual" else {}
        return self.route("/admin/clients/{client_id}/renew-pack")(self.user_id, main.NewPack(
            plan_id=self.plan_id, sessions_per_week=2, preferred_days="Monday,Wednesday", preferred_time="10:00",
            trainer_id=self.trainer_id, start_date=self.monday.isoformat(), email_client=email_client,
            allow_conflicts=True, confirm_replace=True, **extra))

    def check_email(self, message, type_word, quote):
        html = message["html"]
        self.assertIn('<html lang="ca"', html)                      # the client's language, one language
        self.assertEqual(message["subject"], "El teu pack d'entrenament")
        self.assertNotIn(" / ", message["subject"])
        for word in ("TEST confirm 3 weeks", type_word, pricing.money(quote["price_per_session"]), pricing.money(quote["total_price"]),
                     "3 setmanes", "Comença"):
            self.assertIn(word, html, word)
        self.assertEqual(html.count(">10:00<"), 6)                     # the summary lists every session (6 rows)

    # ----- the paths
    def test_a_new_pack_sends_the_confirmation_to_the_client_with_all_the_facts(self):
        answer = self.new_pack()
        self.assertEqual(answer["email"]["sent_to"], [f"ana{DOMAIN}", TEAM])
        self.assertEqual(answer["email"]["failed"], [])
        message = self.recorder.to(f"ana{DOMAIN}")[0]
        self.check_email(message, "Individual", self.individual)
        self.assertEqual((message["kind"], message["lang"]), ("pack_summary", "ca"))
        self.assertEqual(self.recorder.to(TEAM)[0]["lang"], "es")  # the team's copy stays Spanish

    def test_a_dual_pack_says_dual_and_the_dual_price(self):
        self.new_pack("dual")
        message = self.recorder.to(f"ana{DOMAIN}")[0]
        self.check_email(message, "Dual", self.dual)
        self.assertNotIn(SECOND, message["html"])                    # the client's email only names the second person
        self.assertNotIn(SECOND, str(message["to"]))                 # and nothing is ever sent to them

    def test_approving_a_request_sends_it(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO client_requests (user_id, plan_id, sessions_per_week, preferred_days, preferred_time, status) "
                    "VALUES (%s, %s, 2, 'Monday,Wednesday', '10:00', 'Pending') RETURNING id", (self.user_id, self.plan_id))
        request_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        answer = main.approve_request(main.ApproveRequest(
            request_id=request_id, trainer_id=self.trainer_id, start_date=self.monday.isoformat(), allow_conflicts=True, confirm_replace=True))
        self.assertIn(f"ana{DOMAIN}", answer["email"]["sent_to"])
        self.check_email(self.recorder.to(f"ana{DOMAIN}")[0], "Individual", self.individual)

    # ----- never in the way of the pack
    def test_a_failing_send_never_undoes_or_blocks_the_pack(self):
        with mock.patch("emails.transport.send_email", lambda *a, **k: EmailResult(False, "unreachable")):
            answer = self.new_pack()
        self.assertEqual(answer["message"], "Pack created successfully")
        self.assertEqual(answer["email"]["sent_to"], [])
        self.assertTrue(answer["email"]["failed"])
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM sessions WHERE user_id = %s AND status = 'Booked'", (self.user_id,))
        self.assertEqual(cur.fetchone()[0], 6)
        conn.close()

    def test_an_error_while_preparing_the_email_is_reported_without_personal_data(self):
        records = []
        capture = logging.Handler()
        capture.emit = lambda record: records.append(record.getMessage())
        logging.getLogger("thundbalance.packs").addHandler(capture)
        try:
            with mock.patch("packs.send_pack_summary_email", side_effect=RuntimeError("boom ana@x.co")):
                answer = self.new_pack()
        finally:
            logging.getLogger("thundbalance.packs").removeHandler(capture)
        self.assertEqual(answer["message"], "Pack created successfully")
        self.assertEqual(answer["email"], {"sent_to": [], "failed": [], "problem": "error"})
        text = " ".join(records)
        self.assertIn("RuntimeError", text)
        self.assertNotIn("ana@x.co", text)
        self.assertNotIn("Ana", text)

    def test_a_replaced_event_that_cannot_be_removed_does_not_stop_the_email(self):
        with mock.patch("main.remove_replaced_events", side_effect=RuntimeError("calendar down")):
            answer = self.new_pack()
        self.assertEqual(answer["message"], "Pack created successfully")
        self.assertIn(f"ana{DOMAIN}", answer["email"]["sent_to"])

    def test_email_pack_alone_never_raises(self):
        self.assertEqual(
            packs.email_pack({}, client_name="x", client_email="a@b.co", days=[], sessions_per_week=1, trainer_name="t", to_client=True, extra=[]),
            {"sent_to": [], "failed": [], "problem": "error"})


if __name__ == "__main__":
    unittest.main()

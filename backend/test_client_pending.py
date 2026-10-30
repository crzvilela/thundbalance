"""What the client's "pending requests" card needs: the sending date of the pack request and of the trial session.

    python -m unittest test_client_pending -v
"""
import unittest
from datetime import date, timedelta

import main
from database import get_connection

DOMAIN = "@test-pending.example"


class Pending(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.ensure_client_workflow_fields()
        main.ensure_trial_session_fields()

    def setUp(self):
        self.cleanup()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO users (nome, email, firebase_uid) VALUES ('Pending Client', %s, 'uid-pending') RETURNING id", (f"p{DOMAIN}",))
        self.user_id = cur.fetchone()[0]
        cur.execute("SELECT id FROM plans ORDER BY id LIMIT 1")
        self.plan_id = cur.fetchone()[0]
        conn.commit()
        conn.close()

    def tearDown(self):
        self.cleanup()

    @staticmethod
    def cleanup():
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM client_requests WHERE user_id IN (SELECT id FROM users WHERE email LIKE %s)", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        conn.commit()
        conn.close()

    def as_client(self, call):
        real = main.require_client
        main.require_client = lambda authorization: {"sub": "uid-pending", "email": f"p{DOMAIN}"}
        try:
            return call()
        finally:
            main.require_client = real

    def test_the_pack_request_carries_the_day_it_was_sent(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO client_requests (user_id, plan_id, sessions_per_week, preferred_days, preferred_time, status) "
                    "VALUES (%s, %s, 2, 'Monday', '09:00', 'Pending')", (self.user_id, self.plan_id))
        conn.commit()
        conn.close()
        workflow = self.as_client(lambda: main.client_workflow(authorization="Bearer x"))
        self.assertEqual(workflow["state"], "pending")
        sent = workflow["request"]["created_at"]
        self.assertTrue(sent and sent[:10] in (date.today().isoformat(), (date.today() - timedelta(days=1)).isoformat(), (date.today() + timedelta(days=1)).isoformat()))

    def test_a_request_from_before_the_column_has_no_date_and_still_works(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO client_requests (user_id, plan_id, sessions_per_week, preferred_days, preferred_time, status, created_at) "
                    "VALUES (%s, %s, 1, 'Monday', '09:00', 'Pending', NULL)", (self.user_id, self.plan_id))
        conn.commit()
        conn.close()
        workflow = self.as_client(lambda: main.client_workflow(authorization="Bearer x"))
        self.assertIsNone(workflow["request"]["created_at"])

    def test_the_open_trial_session_carries_the_day_it_was_sent(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status) "
            "VALUES ('Pending Client', %s, '600111222', 'Lose weight', 'Beginner', %s, '10:00', 'Pending')",
            (f"p{DOMAIN}", date.today() + timedelta(days=10)))
        conn.commit()
        conn.close()
        answer = self.as_client(lambda: main.client_trial(authorization="Bearer x"))
        self.assertEqual(answer["trial"]["status"], "pending")
        self.assertTrue(answer["trial"]["created_at"])


if __name__ == "__main__":
    unittest.main()

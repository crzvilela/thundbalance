"""A second trial request from the same email shows where the first one stands:

    python -m unittest test_trial_duplicates -v

Uses the local database; the rows it creates are removed.
"""
import unittest
from datetime import date, timedelta
from types import SimpleNamespace

from fastapi import HTTPException

import main
from database import get_connection

DOMAIN = "@test-dup.example"
EMAIL = f"ana{DOMAIN}"


class TrialDuplicates(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.ensure_trial_session_fields()

    def setUp(self):
        self.cleanup()
        main._trial_hits.clear()
        self._claims = main.require_client
        main.require_client = lambda authorization=None: {"email": EMAIL.upper()}

    def tearDown(self):
        main.require_client = self._claims
        self.cleanup()

    def cleanup(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        conn.commit()
        conn.close()

    def weekday(self, offset=12):
        day = date.today() + timedelta(days=offset)
        while day.weekday() > 4:
            day += timedelta(days=1)
        return day

    def insert(self, status, day=None, email=EMAIL):
        day = day or self.weekday()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status, lang)
               VALUES ('Ana García', %s, '600123456', 'Lose weight, Build muscle', 'Beginner', %s, '10:00', %s, 'es')""",
            (email, day, status),
        )
        conn.commit()
        conn.close()

    def submit(self, email=EMAIL, day=None):
        day = day or self.weekday(14)
        request = SimpleNamespace(headers={}, client=SimpleNamespace(host="127.0.0.1"))
        payload = main.TrialSessionCreate(
            full_name="Ana García", email=email, phone="600123456", goals=["Lose weight"],
            experience="Beginner", session_date=day.isoformat(), session_time="10:00", lang="es",
        )
        return main.create_trial_session(payload, request)

    def test_each_open_status_is_reported_with_date_and_time(self):
        for status in ("Pending", "Approved", "Confirmed"):
            self.cleanup()
            main._trial_hits.clear()
            day = self.weekday()
            self.insert(status, day)
            with self.assertRaises(HTTPException) as caught:
                self.submit(email=EMAIL.upper())  # case does not matter
            self.assertEqual(caught.exception.status_code, 409)
            detail = caught.exception.detail
            self.assertEqual(detail["code"], "trial_exists")
            self.assertEqual(detail["status"], status.lower())
            self.assertEqual(detail["session_date"], day.isoformat())
            self.assertEqual(detail["session_time"], "10:00")

    def test_the_public_answer_has_no_personal_data(self):
        self.insert("Confirmed")
        with self.assertRaises(HTTPException) as caught:
            self.submit()
        self.assertEqual(set(caught.exception.detail), {"code", "status", "session_date", "session_time"})

    def test_declined_cancelled_and_past_requests_do_not_block(self):
        self.insert("Declined")
        self.insert("Cancelled")
        self.insert("Confirmed", date.today() - timedelta(days=3))
        try:
            self.submit()
        except HTTPException as error:
            # not a duplicate (it may be refused for another reason, e.g. no trainer)
            self.assertNotEqual(error.status_code, 409)

    def test_logged_in_client_gets_the_full_trial(self):
        self.insert("Approved")
        self.insert("Pending", email=f"other{DOMAIN}")
        trial = main.client_trial("Bearer x")["trial"]
        self.assertEqual(trial["status"], "approved")
        self.assertEqual(trial["session_time"], "10:00")
        self.assertEqual(trial["goal"], "Lose weight, Build muscle")
        self.assertEqual(trial["experience"], "Beginner")

    def test_client_without_a_trial_gets_null(self):
        self.assertIsNone(main.client_trial("Bearer x")["trial"])


if __name__ == "__main__":
    unittest.main()

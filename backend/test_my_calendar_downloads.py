"""The .ics downloads of My Sessions (own sessions only, well-formed files):

    python -m unittest test_my_calendar_downloads -v

Uses the local database; the rows it creates are removed.
"""
import unittest
from datetime import date, timedelta

from fastapi import HTTPException

import main
from database import get_connection

DOMAIN = "@test-ics.example"


def endpoint(path):
    for route in main.app.routes:
        if getattr(route, "path", None) == path and "GET" in getattr(route, "methods", ()):
            return route.endpoint
    raise LookupError(path)


def body(response):
    return response.body.decode("utf-8")


def unfold(text):
    return text.replace("\r\n ", "")


class Downloads(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.ensure_trial_session_fields()
        main.ensure_calendar_sync_columns()
        cls.cleanup()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id, nome FROM trainers WHERE active ORDER BY id LIMIT 1")
        cls.trainer_id, cls.trainer = cur.fetchone()
        cls.users = {}
        for key, name in (("ana", "Ana Ics"), ("bia", "Bia Ics")):
            cur.execute("INSERT INTO users (firebase_uid, nome, email) VALUES (%s, %s, %s) RETURNING id",
                        (f"uid-{key}-ics", name, f"{key}{DOMAIN}"))
            cls.users[key] = cur.fetchone()[0]
        today = date.today()
        cls.ids = {}
        rows = [("ana", 5, "1/3", "Booked"), ("ana", 7, "2/3", "Booked"), ("ana", 9, "3/3", "Cancelled"),
                ("ana", -4, "0/3", "Booked"), ("bia", 6, "1/1", "Booked")]
        for key, offset, number, status in rows:
            cur.execute(
                "INSERT INTO sessions (user_id, trainer_id, session_date, session_time, session_number, status, feed_sequence) "
                "VALUES (%s, %s, %s, '10:00', %s, %s, 0) RETURNING id",
                (cls.users[key], cls.trainer_id, today + timedelta(days=offset), number, status),
            )
            cls.ids[(key, number)] = cur.fetchone()[0]
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        cls.cleanup()

    @classmethod
    def cleanup(cls):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE %s)", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        conn.commit()
        conn.close()

    def claims(self, key):
        return {"sub": f"uid-{key}-ics", "email": f"{key}{DOMAIN}"}

    def test_one_session_file_is_well_formed(self):
        session_id = self.ids[("ana", "1/3")]
        response = endpoint("/me/sessions/{session_id}/ics")(session_id, self.claims("ana"))
        self.assertTrue(response.media_type.startswith("text/calendar"))
        self.assertIn("attachment", response.headers["content-disposition"])
        text = body(response)
        self.assertTrue(text.startswith("BEGIN:VCALENDAR\r\n"))
        self.assertTrue(text.endswith("END:VCALENDAR\r\n"))
        self.assertNotIn("\n", text.replace("\r\n", ""))                    # CRLF only
        for line in text.split("\r\n"):
            self.assertLessEqual(len(line.encode("utf-8")), 75)             # folded
        text = unfold(text)
        for expected in ("VERSION:2.0", "PRODID:", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
                         f"UID:session-{session_id}@thundbalance.com", "STATUS:CONFIRMED", "SEQUENCE:1",
                         f"SUMMARY:ThundBalance · Sesión con {self.trainer.split()[0]} 1/3",
                         r"LOCATION:ThundBalance\, Carrer de Pallars 286\, Barcelona"):
            self.assertIn(expected, text)
        self.assertNotIn("@", text.replace("@thundbalance.com", ""))        # no e-mail address anywhere

    def test_a_session_of_another_client_is_not_found(self):
        other = self.ids[("bia", "1/1")]
        with self.assertRaises(HTTPException) as caught:
            endpoint("/me/sessions/{session_id}/ics")(other, self.claims("ana"))
        self.assertEqual(caught.exception.status_code, 404)
        with self.assertRaises(HTTPException) as unknown:
            endpoint("/me/sessions/{session_id}/ics")(99999999, self.claims("ana"))
        self.assertEqual(unknown.exception.status_code, 404)                # the same answer: no hints

    def test_all_sessions_file_has_only_own_upcoming_not_cancelled_ones(self):
        text = unfold(body(endpoint("/me/sessions.ics")(self.claims("ana"))))
        self.assertIn(f"UID:session-{self.ids[('ana', '1/3')]}@thundbalance.com", text)
        self.assertIn(f"UID:session-{self.ids[('ana', '2/3')]}@thundbalance.com", text)
        self.assertNotIn(f"UID:session-{self.ids[('ana', '3/3')]}@", text)    # cancelled
        self.assertNotIn(f"UID:session-{self.ids[('ana', '0/3')]}@", text)    # in the past
        self.assertNotIn(f"UID:session-{self.ids[('bia', '1/1')]}@", text)    # somebody else's
        self.assertEqual(text.count("BEGIN:VEVENT"), 2)

    def test_the_account_without_a_profile_gets_404(self):
        with self.assertRaises(HTTPException) as caught:
            endpoint("/me/sessions.ics")({"sub": "nobody", "email": f"nobody{DOMAIN}"})
        self.assertEqual(caught.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()

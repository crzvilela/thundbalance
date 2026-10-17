"""The times offered on a date: fast, cached for a minute, never wrong at booking.

    python -m unittest test_schedule_speed -v

Covers: /health needs no database, the single-query result equals the per-trainer
calculation, the short-lived cache (hit, invalidated by a successful write, not
by a failed one), a clear 503 when the database fails, and the rule that the
booking itself validates the slot again whatever the cache says.
The local database is used and cleaned.
"""
import unittest
from datetime import date, timedelta
from unittest import mock

from fastapi.testclient import TestClient

import availability
import database
import main
import schedule_cache
from database import get_connection

DOMAIN = "@test-speed.example"


def weekday(offset):
    day = date.today() + timedelta(days=offset)
    while day.weekday() > 4:
        day += timedelta(days=1)
    return day


class ScheduleSpeed(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.ensure_trial_session_fields()
        cls.client = TestClient(main.app)
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)
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
        self.cleanup()
        schedule_cache.invalidate()
        main._trial_hits.clear()

    def tearDown(self):
        self.cleanup()

    def busy_trial(self, trainer_id, day, hour):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status, trainer_id, lang)
               VALUES ('Busy', %s, '600000000', 'x', 'x', %s, %s, 'Confirmed', %s, 'en')""",
            (f"busy{trainer_id}{hour.replace(':', '')}{DOMAIN}", day.isoformat(), hour, trainer_id),
        )
        conn.commit()
        conn.close()

    def trainer_ids(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id")
        ids = [r[0] for r in cur.fetchall()]
        conn.close()
        return ids

    # ----- /health
    def test_health_answers_without_touching_the_database(self):
        with mock.patch.object(database, "_connect", side_effect=AssertionError("database used")), \
             mock.patch.object(main, "get_connection", side_effect=AssertionError("database used")):
            for method in (self.client.get, self.client.head):
                response = method("/health")
                self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get("/health").json(), {"status": "ok"})

    # ----- one query, same answer
    def test_single_query_matches_the_per_trainer_calculation(self):
        day = weekday(15)
        trainers = self.trainer_ids()
        self.busy_trial(trainers[0], day, "09:00")
        self.busy_trial(trainers[1], day, "10:00")
        conn = get_connection()
        cur = conn.cursor()
        expected = set()
        for trainer_id in trainers:
            expected |= set(availability.free_start_times(cur, trainer_id, day))
        got = availability.free_start_times_any_trainer(cur, day)
        conn.close()
        self.assertEqual(got, sorted(expected))

    def test_an_hour_disappears_only_when_every_trainer_is_busy(self):
        day = weekday(16)
        trainers = self.trainer_ids()
        for trainer_id in trainers:
            self.busy_trial(trainer_id, day, "11:00")
        times = self.client.get(f"/schedule/{day.isoformat()}").json()
        self.assertNotIn("11:00", times)
        self.assertIn("12:00", times)

    # ----- the cache
    def test_second_request_comes_from_the_cache(self):
        day = weekday(17).isoformat()
        with mock.patch.object(main, "run_read", wraps=main.run_read) as spy:
            first = self.client.get(f"/schedule/{day}").json()
            second = self.client.get(f"/schedule/{day}").json()
        self.assertEqual(first, second)
        self.assertEqual(spy.call_count, 1, "the database was asked once")

    def test_a_successful_write_empties_the_cache_and_a_failed_one_does_not(self):
        day = weekday(18).isoformat()
        self.client.get(f"/schedule/{day}")
        self.assertTrue(schedule_cache._store)
        self.client.post("/contact-messages", json={"name": "x", "email": "bad", "message": "hola hola"})  # 422
        self.assertTrue(schedule_cache._store, "a refused request changes nothing")
        ok = self.client.post("/contact-messages", json={
            "name": "Cache Test", "email": f"cache{DOMAIN}", "message": "hola, esto es una prueba"})
        self.assertEqual(ok.status_code, 200)
        self.assertFalse(schedule_cache._store, "a successful write starts the cache again")
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM contact_messages WHERE email LIKE %s", (f"%{DOMAIN}",))
        conn.commit()
        conn.close()

    def test_the_booking_validates_again_even_if_the_cache_is_stale(self):
        day = weekday(19)
        self.assertIn("10:00", self.client.get(f"/schedule/{day.isoformat()}").json())   # cached: free
        for trainer_id in self.trainer_ids():                                            # taken behind the cache's back
            self.busy_trial(trainer_id, day, "10:00")
        self.assertIn("10:00", self.client.get(f"/schedule/{day.isoformat()}").json(), "stale on purpose")
        response = self.client.post("/trial-sessions", json={
            "full_name": "Ana García", "email": f"late{DOMAIN}", "phone": "600123456", "goals": ["Lose weight"],
            "experience": "Beginner", "session_date": day.isoformat(), "session_time": "10:00", "lang": "en"})
        self.assertEqual(response.status_code, 422)
        self.assertIn("No trainer is available", response.json()["detail"])

    # ----- failure is clear, not a hang
    def test_database_failure_gives_a_clear_503(self):
        day = weekday(20).isoformat()
        with mock.patch.object(database, "_connect", side_effect=database.psycopg2.OperationalError("down")):
            database._drop_idle()
            response = self.client.get(f"/schedule/{day}")
        self.assertEqual(response.status_code, 503)
        self.assertIn("could not be loaded", response.json()["detail"])
        self.assertEqual(self.client.get(f"/schedule/{day}").status_code, 200, "recovers by itself")

    def test_a_connection_the_server_closed_is_replaced(self):
        day = weekday(21).isoformat()
        self.client.get(f"/schedule/{day}")                         # leaves one idle connection
        for connection, _ in list(database._idle):
            connection.close()                                       # as if the server had dropped it
        schedule_cache.invalidate()
        self.assertEqual(self.client.get(f"/schedule/{day}").status_code, 200)


if __name__ == "__main__":
    unittest.main()

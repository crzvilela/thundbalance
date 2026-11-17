"""GET /admin/overview/today (backend/admin_overview.py): who can read it, the counts, Europe/Madrid, the cache and a part that fails.

    python -m unittest test_admin_overview -v

The local database is used; the test rows are removed afterwards. The counts are compared with what was there before (the local
database may hold other data). require_admin is replaced where an administrator is needed.
"""
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

from fastapi.testclient import TestClient

import admin_overview as overview
import main
from database import get_connection

URL = "/admin/overview/today"
DOMAIN = "@overview-test.invalid"
OK = {"email_ready": True, "reason": "", "quota": 90}


class Today(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)
        cls.cleanup()

    def setUp(self):
        overview.clear_cache()
        main.app.dependency_overrides[main.require_admin] = lambda: {"email": main.ADMIN_EMAIL}
        self._email = mock.patch.object(overview.email_health, "check_ready", return_value=OK)
        self._email.start()

    def tearDown(self):
        self._email.stop()
        main.app.dependency_overrides.pop(main.require_admin, None)
        self.cleanup()
        overview.clear_cache()

    @classmethod
    def cleanup(cls):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE %s)", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM client_requests WHERE user_id IN (SELECT id FROM users WHERE email LIKE %s)", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM contact_messages WHERE email LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        conn.commit()
        conn.close()

    def get(self):
        overview.clear_cache()
        answer = self.client.get(URL)
        self.assertEqual(answer.status_code, 200, answer.text)
        return answer.json()

    # ----- who can read it
    def test_only_the_admin_can_read_it(self):
        main.app.dependency_overrides.pop(main.require_admin, None)
        self.assertEqual(self.client.get(URL).status_code, 401)                                              # no login
        self.assertEqual(self.client.get(URL, headers={"Authorization": "Bearer not-a-token"}).status_code, 401)
        self.assertEqual(self.client.post(URL).status_code, 405)                                              # it only reads

    def test_a_client_is_not_an_admin(self):
        def client_only():
            from fastapi import HTTPException
            raise HTTPException(status_code=403, detail="Admin only")
        main.app.dependency_overrides[main.require_admin] = client_only
        self.assertEqual(self.client.get(URL).status_code, 403)

    # ----- the answer
    def test_the_answer_has_every_part_and_no_secrets(self):
        body = self.get()
        self.assertEqual(set(body), {"date", "sessions_today", "pending_requests", "pending_trials", "unread_messages", "pending_deletions",
                                     "expiring_packs", "email", "new_errors", "legal_needs_attention"})
        self.assertEqual(body["email"], {"ready": True, "reason": ""})
        self.assertNotIn("quota", body["email"])
        self.assertEqual(body["date"], overview.madrid_today().isoformat())

    def test_the_counts_follow_the_data(self):
        before = self.get()
        today = overview.madrid_today()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers ORDER BY id LIMIT 1")
        trainer = cur.fetchone()[0]
        cur.execute("INSERT INTO users (firebase_uid, nome, email) VALUES ('uid-ov-a', 'Ana Hoy', %s) RETURNING id", (f"ana{DOMAIN}",))
        ana = cur.fetchone()[0]
        for hour, status, user in (("18:00", "Booked", ana), ("09:30", "Booked", ana), ("10:00", "Cancelled", ana)):
            cur.execute("INSERT INTO sessions (user_id, trainer_id, session_date, session_time, session_number, status) VALUES (%s, %s, %s, %s, '1/4', %s)",
                        (ana, trainer, today, hour, status))
        cur.execute("INSERT INTO sessions (user_id, trainer_id, session_date, session_time, session_number, status) VALUES (%s, %s, %s, '08:00', '1/4', 'Booked')",
                    (ana, trainer, today + timedelta(days=1)))                          # tomorrow: not today
        for hour, status, token in (("12:00", "Pending", None), ("11:00", "Approved", "tok-" + "x" * 30), ("13:00", "Rejected", None)):
            cur.execute(
                "INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status, trainer_id, confirmation_token) "
                "VALUES ('Prueba Hoy', %s, '600', 'Goal', 'Beginner', %s, %s, %s, %s, %s)", (f"t{hour[:2]}{DOMAIN}", today, hour, status, trainer, token))
        cur.execute("SELECT id FROM plans ORDER BY id LIMIT 1")
        plan = cur.fetchone()[0]
        for status, archived in (("Pending", None), ("Pending", datetime.now(timezone.utc)), ("Approved", None)):
            cur.execute("INSERT INTO client_requests (user_id, plan_id, sessions_per_week, preferred_days, preferred_time, status, archived_at) VALUES (%s, %s, 2, 'Mon', '10:00', %s, %s)",
                        (ana, plan, status, archived))
        cur.execute("INSERT INTO contact_messages (name, email, message) VALUES ('Someone', %s, 'Hola'), ('Other', %s, 'Hello')", (f"m1{DOMAIN}", f"m2{DOMAIN}"))
        conn.commit()
        conn.close()

        after = self.get()
        self.assertEqual(after["pending_requests"], before["pending_requests"] + 1)           # the archived and the approved ones do not count
        self.assertEqual(after["pending_trials"], before["pending_trials"] + 1)
        self.assertEqual(after["unread_messages"], before["unread_messages"] + 2)
        sessions = after["sessions_today"]
        self.assertEqual(sessions["total"], before["sessions_today"]["total"] + 4)           # 2 booked + pending trial + approved (not confirmed yet) trial; cancelled and rejected are out
        mine = [item for item in sessions["items"] if item["client"] in ("Ana Hoy", "Prueba Hoy")]
        self.assertEqual([item["time"] for item in mine], ["09:30", "11:00", "12:00", "18:00"])     # by hour, sessions and trials together
        self.assertEqual([item["kind"] for item in mine], ["session", "trial", "trial", "session"])
        self.assertEqual({item["status"] for item in mine if item["kind"] == "trial"}, {"pending", "approved"})
        self.assertTrue(all(item["trainer"] for item in mine))

    def test_a_trial_approved_before_the_confirmation_flow_counts_as_confirmed(self):
        today = overview.madrid_today()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status) VALUES ('Vieja Hoy', %s, '600', 'Goal', 'Beginner', %s, '15:00', 'Approved')",
            (f"old{DOMAIN}", today))
        conn.commit()
        conn.close()
        item = next(item for item in self.get()["sessions_today"]["items"] if item["client"] == "Vieja Hoy")
        self.assertEqual(item["status"], "confirmed")

    def test_the_list_is_cut_at_thirty_but_the_total_is_not(self):
        fake = [{"id": f"s{n}", "kind": "session", "time": "09:00", "client": "x", "trainer": "y", "status": "booked"} for n in range(45)]
        with mock.patch.object(overview, "_today_sessions", return_value=fake):
            body = self.get()
        self.assertEqual(body["sessions_today"]["total"], 45)
        self.assertEqual(len(body["sessions_today"]["items"]), overview.MAX_SESSIONS)

    # ----- Europe/Madrid
    def test_today_is_the_day_in_madrid_not_in_utc(self):
        class Fixed(datetime):
            moment = None

            @classmethod
            def now(cls, tz=None):
                return cls.moment

        with mock.patch.object(overview, "datetime", Fixed):
            Fixed.moment = datetime(2026, 7, 1, 22, 30, tzinfo=timezone.utc)        # summer: 00:30 of the 2nd in Madrid
            self.assertEqual(overview.madrid_today().isoformat(), "2026-07-02")
            Fixed.moment = datetime(2026, 12, 1, 22, 30, tzinfo=timezone.utc)       # winter: 23:30 of the 1st
            self.assertEqual(overview.madrid_today().isoformat(), "2026-12-01")
            Fixed.moment = datetime(2026, 12, 1, 23, 30, tzinfo=timezone.utc)       # winter: 00:30 of the 2nd
            self.assertEqual(overview.madrid_today().isoformat(), "2026-12-02")

    # ----- the warnings
    def test_the_email_problem_comes_with_its_reason_and_is_cached_for_a_minute(self):
        self._email.stop()
        with mock.patch.object(overview.email_health, "check_ready", return_value={"email_ready": False, "reason": "unauthorized", "quota": None}) as check:
            self.assertEqual(self.get()["email"], {"ready": False, "reason": "unauthorized"})
            overview._cache.update(at=0.0, value=None)                                           # the whole answer is asked again ...
            self.assertEqual(self.client.get(URL).json()["email"]["reason"], "unauthorized")
            self.assertEqual(check.call_count, 1)                                                # ... but Google is not
        self._email.start()

    def test_new_errors_and_legal_status(self):
        with mock.patch.object(overview, "_new_errors", return_value=3), mock.patch.object(overview.legal, "get_admin", return_value={"needs_attention": True}):
            body = self.get()
        self.assertEqual(body["new_errors"], 3)
        self.assertIs(body["legal_needs_attention"], True)
        with mock.patch.object(overview.legal, "get_admin", return_value={"needs_attention": False}):
            self.assertIs(self.get()["legal_needs_attention"], False)

    def test_one_part_failing_does_not_take_the_page_down_and_logs_no_data(self):
        with mock.patch.object(overview, "_new_errors", side_effect=RuntimeError("secret client name Ana")), self.assertLogs("thundbalance.overview", "WARNING") as logged:
            body = self.get()
        self.assertIsNone(body["new_errors"])
        self.assertIsNotNone(body["pending_requests"])
        self.assertIn("RuntimeError", logged.output[0])
        self.assertNotIn("Ana", logged.output[0])                                              # only the name of the part and the kind of error

    # ----- the cache
    def test_the_answer_is_cached_for_a_few_seconds(self):
        overview.clear_cache()
        with mock.patch.object(overview, "build_today", wraps=overview.build_today) as build:
            self.assertEqual(self.client.get(URL).status_code, 200)
            self.assertEqual(self.client.get(URL).status_code, 200)
            self.assertEqual(build.call_count, 1)
            with mock.patch.object(overview.time, "monotonic", return_value=overview._cache["at"] + overview.CACHE_SECONDS + 1):
                self.assertEqual(self.client.get(URL).status_code, 200)
            self.assertEqual(build.call_count, 2)
        self.assertTrue(10 <= overview.CACHE_SECONDS <= 15)

    def test_the_expiring_packs_are_the_clients_whose_pack_ends_within_a_week(self):
        before = self.get()["expiring_packs"]
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM plans ORDER BY id LIMIT 1")
        plan = cur.fetchone()[0]
        today = overview.madrid_today()
        ids = []
        for name, offset in (("Pack Soon", 3), ("Pack Far", 40), ("Pack Over", -2)):
            cur.execute("INSERT INTO users (firebase_uid, nome, email) VALUES (%s, %s, %s) RETURNING id", (f"uid-{name}", name, f"{name.replace(' ', '').lower()}{DOMAIN}"))
            user = cur.fetchone()[0]
            ids.append(user)
            cur.execute("INSERT INTO user_plans (user_id, plan_id, active, start_date, end_date) VALUES (%s, %s, TRUE, %s, %s)", (user, plan, today - timedelta(days=30), today + timedelta(days=offset)))
        conn.commit()
        try:
            self.assertEqual(self.get()["expiring_packs"], before + 1)                         # only the one that ends in 3 days
        finally:
            cur = conn.cursor()
            cur.execute("DELETE FROM user_plans WHERE user_id = ANY(%s)", (ids,))
            conn.commit()
            conn.close()


if __name__ == "__main__":
    unittest.main()

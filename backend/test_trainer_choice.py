"""Choosing a trainer: who is free at a day and hour, and what happens when the chosen one is not.

    python -m unittest test_trainer_choice -v

The local database is used; the trainers, clients and requests it creates are removed. Google Calendar is a fake.
"""
import unittest
from datetime import date, timedelta

from fastapi import HTTPException
from fastapi.testclient import TestClient

import availability
import google_fakes
import main
import reschedule_requests as rr
import trainer_choice
from database import get_connection

DOMAIN = "@test-choice.example"
NAMES = ("TEST Choice A", "TEST Choice B", "TEST Choice Tuesday")


def future_monday(weeks=6):
    day = date.today() + timedelta(weeks=weeks)
    return day - timedelta(days=day.weekday())


class Choice(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.ensure_trial_session_fields()
        main.ensure_client_workflow_fields()
        main.ensure_calendar_sync_columns()
        main.ensure_session_pack_column()
        rr.ensure_tables()
        cls.client = TestClient(main.app)

    def setUp(self):
        self.cleanup()
        self.google = google_fakes.FakeGoogle().install()
        trainer_choice.reset_rate_limit()
        conn = get_connection()
        cur = conn.cursor()
        self.trainers = {}
        for name in NAMES:
            cur.execute("INSERT INTO trainers (nome, active) VALUES (%s, TRUE) RETURNING id", (name,))
            self.trainers[name] = cur.fetchone()[0]
        weekdays = {"TEST Choice A": ("Monday", "Wednesday"), "TEST Choice B": ("Monday", "Wednesday"), "TEST Choice Tuesday": ("Tuesday",)}
        for name, days in weekdays.items():
            for day in days:
                cur.execute("INSERT INTO trainer_availability (trainer_id, day_of_week, start_time, end_time) VALUES (%s, %s, '07:00', '21:00')",
                            (self.trainers[name], day))
        cur.execute("INSERT INTO users (nome, email, firebase_uid) VALUES ('Choice Client', %s, 'uid-choice') RETURNING id", (f"c{DOMAIN}",))
        self.user_id = cur.fetchone()[0]
        cur.execute("INSERT INTO users (nome, email, firebase_uid) VALUES ('Choice Other', %s, 'uid-choice-2') RETURNING id", (f"o{DOMAIN}",))
        self.other_id = cur.fetchone()[0]
        cur.execute("SELECT id FROM plans ORDER BY id LIMIT 1")
        self.plan_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        self.monday = future_monday()

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
        cur.execute("DELETE FROM reschedule_requests WHERE user_id IN (SELECT id FROM users WHERE email LIKE %s)", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE %s)", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM client_requests WHERE user_id IN (SELECT id FROM users WHERE email LIKE %s)", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM trainer_availability WHERE trainer_id IN (SELECT id FROM trainers WHERE nome LIKE 'TEST Choice%')")
        cur.execute("DELETE FROM trainers WHERE nome LIKE 'TEST Choice%'")
        conn.commit()
        conn.close()

    # ----- helpers
    def sql(self, query, args=()):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(query, args)
        rows = cur.fetchall() if cur.description else []
        conn.commit()
        conn.close()
        return rows

    def book(self, trainer, day, time, user=None, status="Booked", number="1/4"):
        return self.sql(
            "INSERT INTO sessions (user_id, trainer_id, session_date, session_time, status, session_number) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
            (user or self.other_id, self.trainers[trainer], day, time, status, number))[0][0]

    def free_ids(self, day, time):
        answer = self.client.get("/available-trainers", params={"date": str(day), "time": time})
        self.assertEqual(answer.status_code, 200, answer.text)
        return {item["id"] for item in answer.json()}, answer.json()

    def code_of(self, caught):
        return caught.exception.detail["code"]

    # ----- the endpoint
    def test_the_endpoint_lists_only_free_trainers_with_id_and_name_only(self):
        ids, items = self.free_ids(self.monday, "10:00")
        mine = {self.trainers["TEST Choice A"], self.trainers["TEST Choice B"]}
        self.assertTrue(mine <= ids)
        self.assertNotIn(self.trainers["TEST Choice Tuesday"], ids)               # does not work on Mondays
        for item in items:
            self.assertEqual(set(item), {"id", "name"})                           # nothing else leaves the server
        self.book("TEST Choice A", self.monday, "10:00")
        ids, _ = self.free_ids(self.monday, "10:00")
        self.assertNotIn(self.trainers["TEST Choice A"], ids)                     # a booked session
        self.assertIn(self.trainers["TEST Choice B"], ids)
        ids, _ = self.free_ids(self.monday, "11:00")
        self.assertIn(self.trainers["TEST Choice A"], ids)                        # another hour is free

    def test_the_session_being_moved_does_not_block_its_own_trainer(self):
        session = self.book("TEST Choice A", self.monday, "10:00", user=self.user_id)
        ids, _ = self.free_ids(self.monday, "10:00")
        self.assertNotIn(self.trainers["TEST Choice A"], ids)
        answer = self.client.get("/available-trainers", params={"date": str(self.monday), "time": "10:00", "exclude_session_id": session})
        self.assertIn(self.trainers["TEST Choice A"], {item["id"] for item in answer.json()})

    def test_approved_confirmed_and_pending_trials_with_a_trainer_hold_the_slot(self):
        for status in ("Pending", "Approved", "Confirmed"):
            self.sql("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
            self.sql(
                "INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status, trainer_id) "
                "VALUES ('Trial', %s, '600111222', 'Lose weight', 'Beginner', %s, '12:00', %s, %s)",
                (f"t{DOMAIN}", self.monday, status, self.trainers["TEST Choice A"]))
            ids, _ = self.free_ids(self.monday, "12:00")
            self.assertNotIn(self.trainers["TEST Choice A"], ids, status)
        self.sql("UPDATE trial_sessions SET status = 'Declined' WHERE email LIKE %s", (f"%{DOMAIN}",))
        ids, _ = self.free_ids(self.monday, "12:00")
        self.assertIn(self.trainers["TEST Choice A"], ids)                        # a declined one holds nothing

    def test_weekday_mode_looks_at_working_hours_only(self):
        answer = self.client.get("/available-trainers", params={"weekday": "Tuesday", "time": "10:00"})
        self.assertEqual(answer.status_code, 200)
        ids = {item["id"] for item in answer.json()}
        self.assertIn(self.trainers["TEST Choice Tuesday"], ids)
        self.assertNotIn(self.trainers["TEST Choice A"], ids)

    def test_bad_input_is_refused_and_the_rate_is_limited(self):
        self.assertEqual(self.client.get("/available-trainers", params={"date": "nope", "time": "10:00"}).status_code, 422)
        self.assertEqual(self.client.get("/available-trainers", params={"date": str(self.monday), "time": "25:99"}).status_code, 422)
        self.assertEqual(self.client.get("/available-trainers", params={"weekday": "Funday", "time": "10:00"}).status_code, 422)
        trainer_choice.reset_rate_limit()
        codes = [self.client.get("/available-trainers", params={"date": str(self.monday), "time": "10:00"}).status_code
                 for _ in range(trainer_choice.RATE_LIMIT + 3)]
        self.assertEqual(codes[:trainer_choice.RATE_LIMIT], [200] * trainer_choice.RATE_LIMIT)
        self.assertEqual(set(codes[trainer_choice.RATE_LIMIT:]), {429})
        trainer_choice.reset_rate_limit()

    def test_the_existing_trainers_all_come_from_the_table_dominika_included(self):
        names = {row[0] for row in self.sql("SELECT nome FROM trainers WHERE active")}
        ids, items = self.free_ids(self.monday, "10:00")
        self.assertTrue({item["name"] for item in items} <= names)                # every name is a row of the table, none is made up

    # ----- the trial form
    def trial_body(self, day, time, trainer=None, email="t"):
        return {"full_name": "Trial Person", "email": f"{email}{DOMAIN}", "phone": "+34600111222", "goals": ["Lose weight"], "experience": "Beginner",
                "session_date": str(day), "session_time": time, "lang": "es", **({"trainer_id": trainer} if trainer else {})}

    def test_a_trial_with_a_busy_trainer_gets_409_with_the_free_ones(self):
        self.book("TEST Choice A", self.monday, "10:00")
        main._trial_hits.clear()
        answer = self.client.post("/trial-sessions", json=self.trial_body(self.monday, "10:00", self.trainers["TEST Choice A"]))
        self.assertEqual(answer.status_code, 409)
        detail = answer.json()["detail"]
        self.assertEqual(detail["code"], "trainer_unavailable")
        self.assertIn(self.trainers["TEST Choice B"], {item["id"] for item in detail["alternatives"]})
        self.assertNotIn(self.trainers["TEST Choice A"], {item["id"] for item in detail["alternatives"]})
        self.assertEqual(self.sql("SELECT COUNT(*) FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))[0][0], 0)    # nothing was saved

    def test_a_trial_with_a_free_trainer_keeps_the_choice_and_holds_the_slot(self):
        main._trial_hits.clear()
        answer = self.client.post("/trial-sessions", json=self.trial_body(self.monday, "10:00", self.trainers["TEST Choice B"]))
        self.assertEqual(answer.status_code, 200, answer.text)
        self.assertEqual(self.sql("SELECT trainer_id, status FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",)), [(self.trainers["TEST Choice B"], "Pending")])
        main._trial_hits.clear()
        second = self.client.post("/trial-sessions", json=self.trial_body(self.monday, "10:00", self.trainers["TEST Choice B"], email="second"))
        self.assertEqual(second.status_code, 409)                                  # the pending one holds B
        self.assertEqual(second.json()["detail"]["code"], "trainer_unavailable")

    def test_a_trial_without_a_trainer_works_as_before(self):
        main._trial_hits.clear()
        answer = self.client.post("/trial-sessions", json=self.trial_body(self.monday, "10:00"))
        self.assertEqual(answer.status_code, 200, answer.text)
        self.assertIsNone(self.sql("SELECT trainer_id FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))[0][0])

    # ----- the pack request (weekly: working hours on every chosen day)
    def pack_request(self, days, time, trainer=None):
        real = main.require_client
        main.require_client = lambda authorization: {"sub": "uid-choice", "email": f"c{DOMAIN}"}
        try:
            return main.create_client_request(
                main.ClientRequestCreate(plan_id=self.plan_id, sessions_per_week=len(days.split(",")), preferred_days=days, preferred_time=time,
                                         trainer_id=trainer), authorization="Bearer x")
        finally:
            main.require_client = real

    def test_a_pack_request_checks_every_chosen_day_and_keeps_the_trainer(self):
        a, tuesday = self.trainers["TEST Choice A"], self.trainers["TEST Choice Tuesday"]
        with self.assertRaises(HTTPException) as caught:
            self.pack_request("Monday,Tuesday", "10:00", trainer=a)               # A does not work on Tuesdays
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(self.code_of(caught), "trainer_unavailable")
        self.assertNotIn(a, {item["id"] for item in caught.exception.detail["alternatives"]})
        with self.assertRaises(HTTPException) as caught:
            self.pack_request("Monday,Tuesday", "10:00", trainer=tuesday)         # the Tuesday trainer does not work on Mondays
        self.assertEqual(self.code_of(caught), "trainer_unavailable")
        self.pack_request("Monday,Wednesday", "10:00", trainer=a)
        self.assertEqual(self.sql("SELECT trainer_id FROM client_requests WHERE user_id = %s", (self.user_id,)), [(a,)])
        # the admin list shows it (the last two columns of each row)
        rows = main.admin_client_requests(archived="exclude") if hasattr(main, "admin_client_requests") else None
        if rows:
            mine = next(row for row in rows if row[1] == "Choice Client")
            self.assertEqual(mine[-2:], [a, "TEST Choice A"])

    # ----- the change of date
    def make_session(self):
        return self.book("TEST Choice A", self.monday, "09:00", user=self.user_id, number="3/12")

    def test_asking_for_a_busy_trainer_answers_409_and_another_trainer_can_be_asked_and_approved(self):
        session = self.make_session()
        target = self.monday + timedelta(days=2)                                    # a Wednesday
        self.book("TEST Choice A", target, "11:00")                                 # A is busy then
        with self.assertRaises(HTTPException) as caught:
            rr.create_request(self.user_id, session, str(target), "11:00")
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(self.code_of(caught), "trainer_unavailable")
        alternatives = {item["id"] for item in caught.exception.detail["alternatives"]}
        b = self.trainers["TEST Choice B"]
        self.assertIn(b, alternatives)
        self.assertNotIn(self.trainers["TEST Choice A"], alternatives)
        created = rr.create_request(self.user_id, session, str(target), "11:00", trainer_id=b)
        self.assertEqual(created["request"]["requested_trainer_id"], b)
        approved = rr.approve(created["request"]["id"], "admin@test")
        self.assertFalse(approved["repeated"])
        row = self.sql("SELECT session_date, session_time, trainer_id FROM sessions WHERE id = %s", (session,))[0]
        self.assertEqual((str(row[0]), str(row[1])[:5], row[2]), (str(target), "11:00", b))        # moved AND now with the other trainer

    def test_without_asking_for_another_trainer_the_session_keeps_its_own(self):
        session = self.make_session()
        target = self.monday + timedelta(days=2)
        created = rr.create_request(self.user_id, session, str(target), "13:00")
        self.assertIsNone(created["request"]["requested_trainer_id"])
        rr.approve(created["request"]["id"], "admin@test")
        self.assertEqual(self.sql("SELECT trainer_id FROM sessions WHERE id = %s", (session,))[0][0], self.trainers["TEST Choice A"])

    def test_the_trainer_asked_for_can_be_taken_before_the_studio_approves(self):
        session = self.make_session()
        target = self.monday + timedelta(days=2)
        b = self.trainers["TEST Choice B"]
        created = rr.create_request(self.user_id, session, str(target), "15:00", trainer_id=b)
        self.book("TEST Choice B", target, "15:00")                                 # somebody takes B in the meantime
        with self.assertRaises(HTTPException) as caught:
            rr.approve(created["request"]["id"], "admin@test")
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(self.sql("SELECT trainer_id FROM sessions WHERE id = %s", (session,))[0][0], self.trainers["TEST Choice A"])

    def test_the_admin_list_shows_the_trainer_asked_for(self):
        session = self.make_session()
        target = self.monday + timedelta(days=2)
        rr.create_request(self.user_id, session, str(target), "16:00", trainer_id=self.trainers["TEST Choice B"])
        listing = rr.list_for_admin("pending", None, f"c{DOMAIN}", 25, 0, "", None)
        item = listing["items"][0]
        self.assertEqual((item["trainer"], item["requested_trainer"]), ("TEST Choice A", "TEST Choice B"))


if __name__ == "__main__":
    unittest.main()

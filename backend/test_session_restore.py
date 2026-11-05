"""Cancelled sessions: they show in the admin calendar on demand, and an admin can restore them.

    python -m unittest test_session_restore -v

Google Calendar is a fake. The local database is used and cleaned.
"""
import unittest
from datetime import date, timedelta

from fastapi import HTTPException

import pack_schedule
import admin_calendar
import google_fakes
import catalog_testing
import main
import plans_schema
import session_restore
from database import get_connection

DOMAIN = "@test-restore.example"


def next_monday(offset=14):
    day = date.today() + timedelta(days=offset)
    return day + timedelta(days=(7 - day.weekday()) % 7)


def call(path, *args, **kwargs):
    route = next(r for r in main.app.routes if getattr(r, "path", None) == path and "POST" in getattr(r, "methods", ()))
    return route.endpoint(*args, **kwargs)


class Restore(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.ensure_session_pack_column()
        main.ensure_calendar_sync_columns()
        main.ensure_client_workflow_fields()
        main.ensure_trial_session_fields()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 2")
        ids = [row[0] for row in cur.fetchall()]
        cls.trainer_id, cls.other_trainer = ids[0], ids[1]
        conn.close()

    def setUp(self):
        self.cleanup()
        self.google = google_fakes.FakeGoogle().install()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(f"INSERT INTO plans (nome, {plans_schema.price_column(cur)}, duracao_meses, duration_weeks) VALUES ('TEST restore 2 weeks', 0, 1, 2) RETURNING id")
        self.plan_id = cur.fetchone()[0]
        self.pack_id = catalog_testing.make_pair(cur, self.plan_id)['individual']
        cur.execute("INSERT INTO users (nome, email, firebase_uid, lang) VALUES ('Ana María Ruiz', %s, 'uid-restore', 'ca') RETURNING id", (f"ana{DOMAIN}",))
        self.user_id = cur.fetchone()[0]
        cur.execute("INSERT INTO users (nome, email, firebase_uid) VALUES ('Otra Persona', %s, 'uid-restore-2') RETURNING id", (f"otra{DOMAIN}",))
        self.other_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        self.monday = next_monday()
        call("/admin/clients/{client_id}/renew-pack", self.user_id, main.NewPack(
            pack_id=self.pack_id, sessions_per_week=2, schedule=pack_schedule.uniform("Monday,Wednesday", "10:00", self.trainer_id), start_date=self.monday.isoformat(), email_client=False, email_extra=[],
            allow_conflicts=True))
        self.sessions = self.rows()

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
            cur.execute("DELETE FROM inbox_recipients WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM sessions WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM user_plans WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM client_requests WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM users WHERE id = ANY(%s)", (ids,))
        cur.execute("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        catalog_testing.drop(cur)
        cur.execute("DELETE FROM plans WHERE nome LIKE 'TEST restore%'")
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

    def rows(self):
        return self.sql("SELECT id, session_date, session_time, status, google_event_id, session_number, trainer_id FROM sessions "
                        "WHERE user_id = %s ORDER BY session_date, session_time, id", (self.user_id,))

    def row(self, session_id):
        return self.sql("SELECT status, session_date, session_time, google_event_id, session_number, trainer_id, cancelled_by, restored_by, "
                        "cancelled_at IS NOT NULL, restored_at IS NOT NULL FROM sessions WHERE id = %s", (session_id,))[0]

    def cancel(self, session_id):
        main.cancel_session(session_id, {"sub": "admin-uid", "email": main.ADMIN_EMAIL})

    def restore(self, session_id, **body):
        return call("/admin/sessions/{session_id}/restore", session_id, session_restore.RestorePayload(**body), {"sub": "a", "email": main.ADMIN_EMAIL})

    def calendar(self, day, show_cancelled):
        conn = get_connection()
        cur = conn.cursor()
        try:
            return admin_calendar.calendar_events(cur, day - timedelta(days=1), day + timedelta(days=1), show_cancelled=show_cancelled)
        finally:
            conn.close()

    def inbox_messages(self):
        return self.sql("SELECT COUNT(*) FROM inbox_messages m JOIN inbox_recipients r ON r.message_id = m.id "
                        "WHERE m.type = 'session_restored' AND r.user_id = %s", (self.user_id,))[0][0]

    # ----- the calendar
    def test_a_cancelled_session_shows_only_when_asked_with_who_and_when(self):
        session_id, day = self.sessions[1][0], self.sessions[1][1]
        self.cancel(session_id)
        self.assertEqual([e for e in self.calendar(day, False) if e["id"] == f"s{session_id}"], [])
        shown = [e for e in self.calendar(day, True) if e["id"] == f"s{session_id}"]
        self.assertEqual(len(shown), 1)
        props = shown[0]["extendedProps"]
        self.assertEqual((props["status"], props["number"], props["cancelledBy"]), ("cancelled", "2/4", main.ADMIN_EMAIL))
        self.assertTrue(props["cancelledAt"])
        self.assertNotIn(self.row(session_id)[3], self.google.events)                  # not in Google

    def test_cancelled_trial_sessions_come_with_the_switch_too(self):
        self.sql("INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status) "
                 "VALUES ('Trial Person', %s, '600111222', 'Lose weight', 'Beginner', %s, '12:00', 'Cancelled')", (f"trial{DOMAIN}", self.monday))
        self.assertEqual([e for e in self.calendar(self.monday, False) if e["extendedProps"]["kind"] == "trial"], [])
        shown = [e for e in self.calendar(self.monday, True) if e["extendedProps"]["kind"] == "trial"]
        self.assertEqual([e["extendedProps"]["status"] for e in shown], ["cancelled"])

    # ----- restoring
    def test_restoring_puts_it_back_in_the_same_place_with_the_same_number_and_one_event(self):
        session_id, day, moment, _, event_id, number, _ = self.sessions[1]
        self.cancel(session_id)
        self.assertNotIn(event_id, self.google.events)
        answer = self.restore(session_id)
        self.assertTrue(answer["restored"])
        status, new_day, new_time, new_event, new_number, trainer, cancelled_by, restored_by, was_cancelled, was_restored = self.row(session_id)
        self.assertEqual((status, new_day, str(new_time)[:5], new_number, trainer), ("Booked", day, "10:00", number, self.trainer_id))
        self.assertTrue(was_cancelled and was_restored)
        self.assertEqual((cancelled_by, restored_by), (main.ADMIN_EMAIL, main.ADMIN_EMAIL))
        self.assertIn(new_event, self.google.events)                                   # back in Google
        self.assertEqual(self.google.events[new_event]["summary"], f"Ana Ruiz {number}")  # "Name Surname x/y"
        self.assertEqual(len(self.google.events), 4)                                   # no duplicates: the 4 sessions of the pack
        shown = [e for e in self.calendar(day, False) if e["id"] == f"s{session_id}"]
        self.assertEqual(shown[0]["extendedProps"]["status"], "booked")                # and in the admin calendar, in its place
        self.assertEqual(self.inbox_messages(), 1)                                     # the client's message (no e-mail is involved)

    def test_restoring_twice_in_a_row_changes_nothing_the_second_time(self):
        session_id = self.sessions[1][0]
        self.cancel(session_id)
        self.restore(session_id)
        creates = self.google.count("create") + self.google.count("patch")
        again = self.restore(session_id)
        self.assertEqual((again["restored"], again["already"]), (False, True))
        self.assertEqual(self.google.count("create") + self.google.count("patch"), creates)
        self.assertEqual(len(self.google.events), 4)
        self.assertEqual(self.inbox_messages(), 1)

    def test_an_active_session_is_not_touched(self):
        answer = self.restore(self.sessions[0][0])
        self.assertEqual((answer["restored"], answer["already"]), (False, True))
        with self.assertRaises(HTTPException) as caught:
            self.restore(987654321)
        self.assertEqual(caught.exception.status_code, 404)

    def test_a_busy_trainer_refuses_with_the_free_ones_and_another_slot_can_be_chosen(self):
        session_id, day = self.sessions[1][0], self.sessions[1][1]
        self.cancel(session_id)
        self.sql("INSERT INTO sessions (user_id, trainer_id, session_date, session_time, status, session_number) VALUES (%s, %s, %s, '10:00', 'Booked', '1/8')",
                 (self.other_id, self.trainer_id, day))                                # somebody took the hour
        with self.assertRaises(HTTPException) as caught:
            self.restore(session_id)
        self.assertEqual((caught.exception.status_code, caught.exception.detail["code"]), (409, "trainer_unavailable"))
        alternatives = {item["id"] for item in caught.exception.detail["alternatives"]}
        self.assertNotIn(self.trainer_id, alternatives)                               # the busy one is not offered
        self.assertEqual(self.row(session_id)[0], "Cancelled")                         # nothing changed
        new_day = day + timedelta(days=1)
        answer = self.restore(session_id, date=new_day.isoformat(), time="12:00", trainer_id=self.trainer_id)
        self.assertTrue(answer["restored"])
        status, got_day, got_time, event_id, number, *_ = self.row(session_id)
        self.assertEqual((status, got_day, str(got_time)[:5], number), ("Booked", new_day, "12:00", "2/4"))   # same x/y, new slot
        self.assertIn(event_id, self.google.events)

    def test_a_pending_trial_with_that_trainer_blocks_it_too(self):
        session_id, day = self.sessions[1][0], self.sessions[1][1]
        self.cancel(session_id)
        self.sql("INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status, trainer_id) "
                 "VALUES ('Trial Person', %s, '600111222', 'Lose weight', 'Beginner', %s, '10:00', 'Pending', %s)", (f"trial{DOMAIN}", day, self.trainer_id))
        with self.assertRaises(HTTPException) as caught:
            self.restore(session_id)
        self.assertEqual(caught.exception.detail["code"], "trainer_unavailable")

    def test_a_date_in_the_past_is_refused_and_a_new_date_works(self):
        session_id = self.sessions[1][0]
        self.sql("UPDATE sessions SET session_date = %s WHERE id = %s", (date.today() - timedelta(days=5), session_id))
        self.cancel(session_id)
        with self.assertRaises(HTTPException) as caught:
            self.restore(session_id)
        self.assertEqual((caught.exception.status_code, caught.exception.detail["code"]), (409, "past"))
        future = next_monday(30)
        self.assertTrue(self.restore(session_id, date=future.isoformat(), time="09:00")["restored"])
        self.assertEqual(self.row(session_id)[4], "2/4")

    def test_another_session_of_the_client_at_the_same_hour_needs_a_confirmation(self):
        session_id, day = self.sessions[1][0], self.sessions[1][1]
        self.cancel(session_id)
        self.sql("INSERT INTO sessions (user_id, trainer_id, session_date, session_time, status, session_number) VALUES (%s, %s, %s, '10:00', 'Booked', '1/8')",
                 (self.user_id, self.other_trainer, day))                              # the client has ANOTHER one then (another pack, another trainer)
        with self.assertRaises(HTTPException) as caught:
            self.restore(session_id)
        self.assertEqual((caught.exception.status_code, caught.exception.detail["code"]), (409, "client_busy"))
        self.assertTrue(self.restore(session_id, confirm_client_overlap=True)["restored"])

    def test_a_google_failure_does_not_stop_the_restoration_and_is_flagged(self):
        session_id = self.sessions[1][0]
        self.cancel(session_id)
        self.google.fail = True
        answer = self.restore(session_id)
        self.assertTrue(answer["restored"])
        self.assertFalse(answer["calendar"]["ok"])
        self.assertEqual(self.sql("SELECT status, calendar_sync_status FROM sessions WHERE id = %s", (session_id,))[0], ("Booked", "failed"))

    def test_only_an_admin_can_restore_and_the_client_detail_carries_the_cancellation(self):
        route = next(r for r in main.app.routes if getattr(r, "path", None) == "/admin/sessions/{session_id}/restore")
        self.assertIn(main.require_admin, [d.call for d in route.dependant.dependencies])
        session_id = self.sessions[1][0]
        self.cancel(session_id)
        detail = next(r for r in main.app.routes if getattr(r, "path", None) == "/admin/clients/{client_id}" and "GET" in r.methods).endpoint(self.user_id)
        mine = next(item for item in detail["sessions"] if item["id"] == session_id)
        self.assertEqual((mine["status"], mine["number"], mine["cancelled_by"]), ("Cancelled", "2/4", main.ADMIN_EMAIL))
        self.assertTrue(mine["cancelled_at"])


if __name__ == "__main__":
    unittest.main()

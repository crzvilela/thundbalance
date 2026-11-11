"""A session deleted in Google Calendar is cancelled in the web, and nothing else ever is (docs/GOOGLE_DELETE_SYNC.md):

    python -m unittest test_google_delete_sync -v

Google Calendar is a fake (no network). The local database is used and cleaned up.
"""
import os
import unittest
from datetime import date, timedelta
from unittest import mock

import pack_schedule
import calendar_reconcile as reconcile
import catalog_testing
import google_calendar as gc
import google_fakes
import inbox
import main
import mailer
import plans_schema
import session_restore
from database import get_connection

DOMAIN = "@test-deletesync.example"


def next_monday(offset=14):
    day = date.today() + timedelta(days=offset)
    return day + timedelta(days=(7 - day.weekday()) % 7)


def post(path, *args, **kwargs):
    route = next(r for r in main.app.routes if getattr(r, "path", None) == path and "POST" in getattr(r, "methods", ()))
    return route.endpoint(*args, **kwargs)


def get(path, *args, **kwargs):
    route = next(r for r in main.app.routes if getattr(r, "path", None) == path and "GET" in getattr(r, "methods", ()))
    return route.endpoint(*args, **kwargs)


class DeleteSync(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.ensure_session_pack_column()
        main.ensure_calendar_sync_columns()
        main.ensure_client_workflow_fields()
        main.ensure_trial_session_fields()
        reconcile.ensure_columns_once()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 2")
        cls.trainer_id = cur.fetchall()[0][0]
        conn.close()

    def setUp(self):
        self.cleanup()
        self.env = mock.patch.dict(os.environ, {"GOOGLE_DELETE_SYNC": "on"})
        self.env.start()
        self.google = google_fakes.FakeGoogle().install()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(f"INSERT INTO plans (nome, {plans_schema.price_column(cur)}, duracao_meses, duration_weeks) VALUES ('TEST delsync 2 weeks', 0, 1, 2) RETURNING id")
        plan_id = cur.fetchone()[0]
        self.pack_id = catalog_testing.make_pair(cur, plan_id)["individual"]
        cur.execute("INSERT INTO users (nome, email, firebase_uid, lang) VALUES ('Ana María Ruiz', %s, 'uid-delsync', 'es') RETURNING id", (f"ana{DOMAIN}",))
        self.user_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        self.monday = next_monday()
        self.renew("10:00")
        self.sessions = self.rows()

    def tearDown(self):
        self.google.uninstall()
        self.env.stop()
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
        cur.execute("DELETE FROM app_settings WHERE key = %s", (reconcile.PENDING_KEY,))
        catalog_testing.drop(cur)
        cur.execute("DELETE FROM plans WHERE nome LIKE 'TEST delsync%'")
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

    def renew(self, hour):
        post("/admin/clients/{client_id}/renew-pack", self.user_id, main.NewPack(
            pack_id=self.pack_id, sessions_per_week=2, schedule=pack_schedule.uniform("Monday,Wednesday", hour, self.trainer_id),
            start_date=self.monday.isoformat(), email_client=False, email_extra=[], allow_conflicts=True))

    def rows(self):
        return self.sql("SELECT id, status, google_event_id, session_number FROM sessions WHERE user_id = %s ORDER BY session_date, session_time, id", (self.user_id,))

    def session(self, session_id):
        return self.sql("SELECT status, google_event_id, session_number, cancel_source, cancelled_by, feed_sequence FROM sessions WHERE id = %s", (session_id,))[0]

    def new_trial(self, event_id="tbdelsynctrial1", hour="12:00", status="Confirmed", in_google=True):
        day = date.today() + timedelta(days=21)
        while day.weekday() > 4:
            day += timedelta(days=1)
        trial_id = self.sql(
            "INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status, trainer_id, google_event_id) "
            "VALUES ('Ana Prueba', %s, '600', 'Lose weight', 'Beginner', %s, %s, %s, %s, %s) RETURNING id",
            (f"trial{DOMAIN}", day, hour, status, self.trainer_id, event_id))[0][0]
        if in_google:
            self.google.events[event_id] = {"summary": "Trial"}
        return trial_id

    def trial(self, trial_id):
        return self.sql("SELECT status, google_event_id, cancel_source, cancel_prev_status, feed_sequence FROM trial_sessions WHERE id = %s", (trial_id,))[0]

    def run_pass(self, **kwargs):
        return reconcile.reconcile_deleted_events(**kwargs)

    def delete_in_google(self, event_id):
        del self.google.events[event_id]                       # somebody deleted it by hand in Google Calendar

    # ----- (a) a 404 cancels, without any e-mail
    def test_an_event_deleted_in_google_cancels_the_session_and_sends_nothing(self):
        session_id, event_id, number = self.sessions[1][0], self.sessions[1][2], self.sessions[1][3]
        before = self.session(session_id)[5]
        self.delete_in_google(event_id)
        with mock.patch.object(mailer, "send_email_async") as mail, mock.patch.object(inbox, "create_system_message") as message:
            summary = self.run_pass()
        mail.assert_not_called()
        message.assert_not_called()                             # only recorded: nobody is told
        self.assertEqual((summary["gone"], summary["cancelled"], summary["pending"]), (1, 1, 0))
        status, kept_event, kept_number, source, by, sequence = self.session(session_id)
        self.assertEqual((status, kept_event, kept_number, source), ("Cancelled", None, number, "google"))   # event id cleared, x/y unchanged
        self.assertEqual((by, sequence), (reconcile.CANCELLED_BY, before + 1))
        self.assertEqual([row[1] for row in self.rows() if row[0] != session_id], ["Booked"] * 3)              # the others are untouched

    def test_a_trial_session_deleted_in_google_is_cancelled_too(self):
        trial_id = self.new_trial(in_google=False)
        summary = self.run_pass()
        self.assertEqual(summary["cancelled"], 1)
        self.assertEqual(self.trial(trial_id), ("Cancelled", None, "google", "Confirmed", 1))

    def test_an_event_google_returns_as_cancelled_counts_as_deleted(self):
        trial_id = self.new_trial()
        self.google.events["tbdelsynctrial1"] = {"summary": "Trial", "status": "cancelled"}
        self.assertEqual(self.run_pass()["cancelled"], 1)
        self.assertEqual(self.trial(trial_id)[0], "Cancelled")

    # ----- (b) a Google error never cancels anything
    def assert_nothing_cancelled(self, trial_id=None):
        self.assertEqual({row[1] for row in self.rows()}, {"Booked"})
        if trial_id:
            self.assertEqual(self.trial(trial_id)[0], "Confirmed")

    def test_a_listing_error_cancels_nothing(self):
        trial_id = self.new_trial(in_google=False)
        self.google.fail = True                                 # timeout / 500 / 403 on the listing
        summary = self.run_pass()
        self.assertTrue(summary["unreadable"])
        self.assertEqual(summary["cancelled"], 0)
        self.assert_nothing_cancelled(trial_id)

    def test_an_error_looking_up_a_missing_event_cancels_nothing(self):
        for status in (500, 403, 429, 503):
            self.delete_in_google(self.sessions[0][2])

            def failing(event_id, status=status):
                raise google_fakes.FakeHttpError(status)

            with mock.patch.object(gc, "get_calendar_event", failing):
                summary = self.run_pass()
            self.assertEqual(summary["cancelled"], 0, status)
            self.assert_nothing_cancelled()
            self.google.events[self.sessions[0][2]] = {"summary": "back"}

    def test_an_empty_answer_cancels_nothing_while_google_still_has_the_events(self):
        with mock.patch.object(gc, "list_calendar_events", lambda *args, **kwargs: []):         # an empty listing proves nothing: each event is asked for
            summary = self.run_pass()
        self.assertEqual((summary["cancelled"], summary["pending"]), (0, 0))
        self.assert_nothing_cancelled()

    def test_an_empty_listing_and_failing_lookups_cancel_nothing(self):
        def failing(event_id):
            raise RuntimeError("timeout")

        with mock.patch.object(gc, "list_calendar_events", lambda *args, **kwargs: []), mock.patch.object(gc, "get_calendar_event", failing):
            summary = self.run_pass()
        self.assertEqual(summary["cancelled"], 0)
        self.assert_nothing_cancelled()

    # ----- (c) many at once: nothing is cancelled until the admin confirms
    def test_more_than_five_deleted_cancels_nothing_warns_and_waits_for_the_admin(self):
        self.renew("11:00")                                     # a second pack: 8 sessions in all
        sessions = self.rows()
        self.assertEqual(len(sessions), 8)
        for row in sessions[:6]:
            self.delete_in_google(row[2])
        summary = self.run_pass()
        self.assertEqual((summary["gone"], summary["cancelled"], summary["pending"]), (6, 0, 6))
        self.assertEqual({row[1] for row in self.rows()}, {"Booked"})
        status = get("/admin/google-sync/status")
        self.assertEqual((status["enabled"], status["pending"]["count"]), (True, 6))
        self.assertEqual(self.run_pass()["cancelled"], 0)       # a second pass does not cancel them either

        confirmed = post("/admin/google-sync/confirm")          # the admin reviewed it and confirms
        self.assertEqual(confirmed["cancelled"], 6)
        self.assertEqual(sorted(row[1] for row in self.rows()), ["Booked", "Booked"] + ["Cancelled"] * 6)
        self.assertIsNone(get("/admin/google-sync/status")["pending"])

    def test_up_to_five_deleted_are_cancelled_without_asking(self):
        self.renew("11:00")
        for row in self.rows()[:5]:
            self.delete_in_google(row[2])
        summary = self.run_pass()
        self.assertEqual((summary["cancelled"], summary["pending"]), (5, 0))

    # ----- (d) what the web cancelled itself is ignored: no loop
    def test_a_session_cancelled_from_the_web_is_ignored(self):
        session_id = self.sessions[0][0]
        main.cancel_session(session_id, {"sub": "admin-uid", "email": main.ADMIN_EMAIL})       # the web deletes its event
        before = self.session(session_id)
        summary = self.run_pass()
        self.assertEqual((summary["checked"], summary["gone"], summary["cancelled"]), (3, 0, 0))
        self.assertEqual(self.session(session_id), before)      # still cancelled by the admin, not "from Google"
        self.assertEqual(before[3], None)
        self.assertEqual(before[4], main.ADMIN_EMAIL)

    def test_a_past_session_and_one_without_an_event_are_not_looked_at(self):
        self.sql("UPDATE sessions SET session_date = %s WHERE id = %s", (date.today() - timedelta(days=3), self.sessions[0][0]))
        self.sql("UPDATE sessions SET google_event_id = NULL WHERE id = %s", (self.sessions[1][0],))
        self.assertEqual(self.run_pass()["checked"], 2)

    # ----- (e) the switch
    def test_off_switches_everything_off(self):
        self.delete_in_google(self.sessions[0][2])
        with mock.patch.dict(os.environ, {"GOOGLE_DELETE_SYNC": "off"}):
            asked = []
            with mock.patch.object(gc, "list_calendar_events", lambda *args, **kwargs: asked.append(1) or []):
                summary = self.run_pass()
                self.assertFalse(reconcile.maybe_reconcile())
            self.assertEqual(summary, {"enabled": False, "checked": 0, "gone": 0, "cancelled": 0, "pending": 0, "unreadable": False})
            self.assertEqual(asked, [])                         # Google was not even asked
            self.assertEqual(get("/admin/google-sync/status"), {"enabled": False, "pending": None})
        self.assert_nothing_cancelled()

    def test_on_is_the_default_and_the_pass_starts_in_the_background_at_most_once_a_minute(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("GOOGLE_DELETE_SYNC", None)
            self.assertTrue(reconcile.enabled())
        started = []
        with mock.patch.object(reconcile.threading, "Thread", lambda **kwargs: type("T", (), {"start": lambda self: started.append(1)})()):
            reconcile._last_started = 0.0
            self.assertTrue(reconcile.maybe_reconcile())
            self.assertFalse(reconcile.maybe_reconcile())       # the second one within the minute does nothing
        self.assertEqual(started, [1])

    # ----- (f) restoring creates the event again
    def test_restoring_a_pack_session_cancelled_from_google_creates_the_event_again(self):
        session_id, event_id = self.sessions[1][0], self.sessions[1][2]
        self.delete_in_google(event_id)
        self.run_pass()
        self.assertEqual(self.session(session_id)[3], "google")
        post("/admin/sessions/{session_id}/restore", session_id, session_restore.RestorePayload(), {"sub": "a", "email": main.ADMIN_EMAIL})
        status, new_event, number, source, _, _ = self.session(session_id)
        self.assertEqual((status, number, source), ("Booked", self.sessions[1][3], None))
        self.assertIn(new_event, self.google.events)           # the event exists in Google again
        self.assertEqual(self.run_pass()["cancelled"], 0)       # and the next pass leaves it alone

    def test_restoring_a_trial_cancelled_from_google_brings_back_its_state_and_event(self):
        trial_id = self.new_trial(in_google=False)
        self.run_pass()
        self.assertEqual(self.trial(trial_id)[:3], ("Cancelled", None, "google"))
        result = post("/admin/trial-sessions/{trial_id}/restore", trial_id)
        self.assertEqual((result["restored"], result["calendar_ok"]), (True, True))
        status, event_id, source, previous, _ = self.trial(trial_id)
        self.assertEqual((status, source, previous), ("Confirmed", None, None))
        self.assertIn(event_id, self.google.events)
        again = post("/admin/trial-sessions/{trial_id}/restore", trial_id)
        self.assertEqual((again["restored"], again["already"]), (False, True))

    def test_a_trial_cancelled_by_the_web_is_not_restored_here(self):
        trial_id = self.new_trial()
        self.sql("UPDATE trial_sessions SET status = 'Cancelled' WHERE id = %s", (trial_id,))
        with self.assertRaises(Exception) as caught:
            post("/admin/trial-sessions/{trial_id}/restore", trial_id)
        self.assertEqual(caught.exception.status_code, 409)

    def test_the_admin_calendar_and_the_trial_list_say_where_the_cancellation_came_from(self):
        import admin_calendar
        session_id = self.sessions[0][0]
        self.delete_in_google(self.sessions[0][2])
        self.run_pass()
        conn = get_connection()
        cur = conn.cursor()
        events = admin_calendar.calendar_events(cur, self.monday - timedelta(days=1), self.monday + timedelta(days=20), show_cancelled=True)
        conn.close()
        shown = next(e for e in events if e["id"] == f"s{session_id}")
        self.assertEqual((shown["extendedProps"]["status"], shown["extendedProps"]["cancelSource"]), ("cancelled", "google"))


if __name__ == "__main__":
    unittest.main()

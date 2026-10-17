"""Flow test for trial-session confirmation against the LOCAL database
(Google Calendar and emails are replaced by fakes):

    python -m unittest test_trial_confirmation -v

It creates its own rows and removes them at the end.
"""
import unittest
from datetime import date, timedelta

from fastapi import HTTPException

import main
import admin_api
import trial_confirmation as tc
import trial_notifications
import mailer
from database import get_connection


def endpoint(path, method):
    for route in main.app.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", ()):
            return route.endpoint
    raise LookupError(path)


class Sent:
    """What mailer.send_* returns: something with .result(timeout)."""
    def result(self, timeout=None):
        from emails.transport import EmailResult
        return EmailResult(True)


class Flow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.ensure_trial_session_fields()   # the real startup migration (includes ensure_confirmation_fields)
        main.ensure_email_log_table()
        main.ensure_trial_session_fields()   # twice: must be idempotent
        cls.rows = []
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 1")
        cls.trainer_id = cur.fetchone()[0]
        conn.close()

    @classmethod
    def tearDownClass(cls):
        conn = get_connection()
        cur = conn.cursor()
        if cls.rows:
            cur.execute("DELETE FROM trial_sessions WHERE id = ANY(%s)", (cls.rows,))
        conn.commit()
        conn.close()

    def setUp(self):
        self.events, self.updates, self.deleted, self.mails = [], [], [], []
        self.fail_calendar = False

        def fake_create(*args, **kwargs):
            if self.fail_calendar:
                raise RuntimeError("calendar down")
            self.events.append((args, kwargs))
            return f"evt-{len(self.events)}"

        def fake_update(event_id, *args, **kwargs):
            if self.fail_calendar:
                raise RuntimeError("calendar down")
            self.updates.append(event_id)

        self._orig = (tc.create_trial_session_event, tc.delete_calendar_event, mailer.send_trial_approved,
                      mailer.send_trial_confirmed, trial_notifications.notify_trial_confirmed,
                      trial_notifications.notify_trial_declined, tc.update_trial_session_event)
        tc.create_trial_session_event = fake_create
        tc.update_trial_session_event = fake_update
        tc.delete_calendar_event = lambda event_id: self.deleted.append(event_id)
        self._admin_delete = admin_api.delete_calendar_event
        admin_api.delete_calendar_event = lambda event_id: self.deleted.append(event_id)
        mailer.send_trial_approved = lambda *a, **k: (self.mails.append(("approved", a)), Sent())[1]
        mailer.send_trial_confirmed = lambda *a, **k: (self.mails.append(("client_confirmed", a)), Sent())[1]
        trial_notifications.notify_trial_confirmed = lambda trial, ok=True: self.mails.append(("staff_confirmed", ok))
        trial_notifications.notify_trial_declined = lambda trial: self.mails.append(("staff_declined", None))
        # trial_confirmation imported the notification module itself, so patching the module attributes is enough

    def tearDown(self):
        admin_api.delete_calendar_event = self._admin_delete
        (tc.create_trial_session_event, tc.delete_calendar_event, mailer.send_trial_approved,
         mailer.send_trial_confirmed, trial_notifications.notify_trial_confirmed,
         trial_notifications.notify_trial_declined, tc.update_trial_session_event) = self._orig

    # ----- helpers
    def new_trial(self, days=14, status="Pending", hour="10:00"):
        day = date.today() + timedelta(days=days)
        while day.weekday() > 4:
            day += timedelta(days=1)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status) "
            "VALUES ('Ana Prueba', 'ana.prueba@example.com', '600', 'Lose weight', 'Beginner', %s, %s, %s) RETURNING id",
            (day, hour, status),
        )
        trial_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        self.rows.append(trial_id)
        return trial_id

    def approve(self, trial_id):
        import admin_api
        endpoint("/admin/trial-sessions/{trial_id}/approve", "POST")(
            trial_id, admin_api.TrialApprovePayload(trainer_id=self.trainer_id))
        return [m for m in self.mails if m[0] == "approved"][-1][1][5]  # the token

    def row(self, trial_id):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT status, google_event_id, confirmation_token, calendar_error, confirmed_at, declined_at FROM trial_sessions WHERE id=%s", (trial_id,))
        data = cur.fetchone()
        conn.close()
        return data

    info = staticmethod(lambda token: endpoint("/trial-sessions/confirmation/{token}", "GET")(token))
    confirm = staticmethod(lambda token: endpoint("/trial-sessions/confirmation/{token}/confirm", "POST")(token))
    decline = staticmethod(lambda token: endpoint("/trial-sessions/confirmation/{token}/decline", "POST")(token))

    # ----- tests
    def test_full_flow_confirm_is_idempotent_and_get_changes_nothing(self):
        trial_id = self.new_trial()
        token = self.approve(trial_id)
        self.assertGreaterEqual(len(token), 40)
        self.assertEqual(self.row(trial_id)[0], "Approved")
        self.assertEqual(len(self.events), 0)                  # approving puts NOTHING on the calendar
        self.assertIsNone(self.row(trial_id)[1])

        view = self.info(token)                                # opening the link
        self.info(token)
        self.assertEqual(view["state"], "pending_confirmation")
        self.assertEqual(view["first_name"], "Ana")
        self.assertEqual(set(view), {"state", "first_name", "date", "time"})   # minimum data only
        self.assertEqual(self.row(trial_id)[0], "Approved")    # ... confirms nothing
        self.assertEqual((self.events, self.updates), ([], []))

        self.assertEqual(self.confirm(token)["outcome"], "confirmed")
        self.assertEqual(self.confirm(token)["outcome"], "already_confirmed")   # double press
        self.assertEqual(len(self.events), 1)                  # the event exists only now, once
        kwargs = self.events[0][1]
        self.assertNotIn("provisional", kwargs)
        self.assertTrue(kwargs["event_id"].startswith("tb"))   # deterministic id: a repeat can not duplicate
        self.assertEqual(kwargs["trial_id"], trial_id)
        self.assertEqual(self.updates, [])
        self.assertEqual([m[0] for m in self.mails if m[0] != "approved"], ["staff_confirmed", "client_confirmed"])
        status, event_id, _, calendar_error, confirmed_at, _ = self.row(trial_id)
        self.assertEqual((status, event_id, calendar_error), ("Confirmed", "evt-1", None))
        self.assertIsNotNone(confirmed_at)

    def test_declining_after_confirming_deletes_the_event(self):
        trial_id = self.new_trial(days=13, hour="08:00")
        token = self.approve(trial_id)
        self.confirm(token)
        self.assertEqual(self.row(trial_id)[1], "evt-1")
        self.assertEqual(self.decline(token)["outcome"], "declined")
        self.assertEqual(self.deleted, ["evt-1"])
        status, event_id, _, calendar_error, _, declined_at = self.row(trial_id)
        self.assertEqual((status, event_id, calendar_error), ("Declined", None, None))
        self.assertIsNotNone(declined_at)
        self.assertEqual(self.decline(token)["outcome"], "already_declined")
        self.assertEqual(self.confirm(token)["outcome"], "already_declined")   # not from the same link
        self.assertEqual(len(self.events), 1)

    def test_a_failed_delete_is_recorded_and_kept_for_a_retry(self):
        trial_id = self.new_trial(days=12, hour="07:00")
        token = self.approve(trial_id)
        self.confirm(token)

        def broken(event_id):
            raise RuntimeError("calendar down")
        tc.delete_calendar_event = broken
        self.assertEqual(self.decline(token)["outcome"], "declined")
        status, event_id, _, calendar_error, _, _ = self.row(trial_id)
        self.assertEqual((status, event_id), ("Declined", "evt-1"))    # the id is kept
        self.assertTrue(calendar_error)

    def test_decline_before_confirming_never_touches_the_calendar(self):
        trial_id = self.new_trial(days=15)
        token = self.approve(trial_id)
        self.assertEqual(self.decline(token)["outcome"], "declined")
        self.assertEqual(self.decline(token)["outcome"], "already_declined")
        self.assertEqual(self.confirm(token)["outcome"], "already_declined")
        self.assertEqual(self.row(trial_id)[0], "Declined")
        self.assertEqual((self.events, self.deleted), ([], []))   # there was never an event
        self.assertIsNone(self.row(trial_id)[1])
        self.assertEqual([m[0] for m in self.mails if m[0] != "approved"], ["staff_declined"])
        # the slot is free again
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT session_date FROM trial_sessions WHERE id=%s", (trial_id,))
        day = cur.fetchone()[0]
        self.assertEqual(main.slot_problem(cur, self.trainer_id, str(day), "10:00"), None)
        conn.close()

    def test_an_approved_session_keeps_its_hour_blocked_without_an_event(self):
        trial_id = self.new_trial(days=20, hour="08:00")
        self.approve(trial_id)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT session_date FROM trial_sessions WHERE id=%s", (trial_id,))
        day = str(cur.fetchone()[0])
        self.assertNotIn("08:00", main.free_start_times(cur, self.trainer_id, day))   # blocked from the database
        self.assertIsNotNone(main.slot_problem(cur, self.trainer_id, day, "08:00"))
        conn.close()
        self.assertEqual(self.events, [])
        with self.assertRaises(HTTPException) as caught:           # the panel button is for confirmed ones only
            endpoint("/admin/trial-sessions/{trial_id}/calendar-event", "POST")(trial_id)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(self.events, [])

    def test_calendar_failure_keeps_session_confirmed_and_flags_it(self):
        trial_id = self.new_trial(days=16, hour="11:00")
        token = self.approve(trial_id)
        self.fail_calendar = True                              # creating the event at confirmation fails
        self.assertEqual(self.confirm(token)["outcome"], "confirmed")
        status, event_id, _, calendar_error, _, _ = self.row(trial_id)
        self.assertEqual((status, event_id), ("Confirmed", None))      # confirmed, no event yet
        self.assertTrue(calendar_error)
        self.assertIn(("staff_confirmed", False), self.mails)
        listed = {r["id"]: r for r in endpoint("/admin/trial-sessions", "GET")()}
        self.assertEqual(listed[trial_id]["status"], "confirmed")
        self.assertTrue(listed[trial_id]["calendar_missing"])          # the panel warning + button
        self.assertTrue(listed[trial_id]["calendar_failed"])
        # the panel button creates the event once the calendar is back
        self.fail_calendar = False
        result = endpoint("/admin/trial-sessions/{trial_id}/calendar-event", "POST")(trial_id)
        self.assertTrue(result["calendar"]["ok"])
        self.assertEqual(self.row(trial_id)[3], None)
        self.assertEqual(len(self.events), 1)
        again = endpoint("/admin/trial-sessions/{trial_id}/calendar-event", "POST")(trial_id)   # pressed twice
        self.assertTrue(again["calendar"]["ok"])
        self.assertEqual(len(self.events), 1)                          # updated, never a second event
        self.assertEqual(self.updates, ["evt-1"])

    def test_expired_and_unknown_tokens(self):
        trial_id = self.new_trial(days=17, hour="12:00")
        token = self.approve(trial_id)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("UPDATE trial_sessions SET session_date = CURRENT_DATE - 1 WHERE id=%s", (trial_id,))
        conn.commit()
        conn.close()
        self.assertEqual(self.info(token)["state"], "expired")
        self.assertEqual(self.confirm(token)["outcome"], "expired")
        self.assertEqual(self.row(trial_id)[0], "Approved")
        self.assertEqual((self.events, self.updates), ([], []))
        with self.assertRaises(HTTPException) as caught:
            self.info("x" * 43)
        self.assertEqual(caught.exception.status_code, 404)
        with self.assertRaises(HTTPException):
            self.confirm("short")

    def test_old_approved_rows_are_untouched_and_shown_as_confirmed(self):
        trial_id = self.new_trial(days=18, status="Approved", hour="13:00")
        self.assertIsNone(self.row(trial_id)[2])               # no token
        listed = {r["id"]: r for r in endpoint("/admin/trial-sessions", "GET")()}
        self.assertEqual(listed[trial_id]["status"], "confirmed")
        self.assertEqual(self.row(trial_id)[0], "Approved")    # data not rewritten

    def test_cancel_works_on_waiting_and_confirmed(self):
        cancel = endpoint("/admin/trial-sessions/{trial_id}/cancel", "POST")
        sent = []
        orig = mailer.send_trial_cancelled
        mailer.send_trial_cancelled = lambda *a, **k: sent.append(a)
        try:
            waiting = self.new_trial(days=19, hour="09:00")
            self.approve(waiting)
            cancel(waiting)
            self.assertEqual(self.row(waiting)[0], "Cancelled")
            self.assertEqual(self.deleted, [])                 # waiting for the client: no event to remove

            confirmed = self.new_trial(days=21, hour="09:00")
            self.confirm(self.approve(confirmed))
            cancel(confirmed)
            self.assertEqual(self.row(confirmed)[0], "Cancelled")
            self.assertEqual(self.deleted, ["evt-1"])          # the confirmed one had its event removed
        finally:
            mailer.send_trial_cancelled = orig
        self.assertEqual(len(sent), 2)


if __name__ == "__main__":
    unittest.main()

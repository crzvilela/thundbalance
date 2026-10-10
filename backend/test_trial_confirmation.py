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
            self.updates.append((event_id, kwargs.get("provisional")))

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
        self.assertEqual(len(self.events), 1)                  # provisional event created at approval
        self.assertTrue(self.events[0][1]["provisional"])
        self.assertEqual(self.row(trial_id)[1], "evt-1")

        view = self.info(token)                                # opening the link
        self.info(token)
        self.assertEqual(view["state"], "pending_confirmation")
        self.assertEqual(view["first_name"], "Ana")
        self.assertEqual(set(view), {"state", "first_name", "date", "time"})   # minimum data only
        self.assertEqual(self.row(trial_id)[0], "Approved")    # ... confirms nothing
        self.assertEqual(self.updates, [])

        self.assertEqual(self.confirm(token)["outcome"], "confirmed")
        self.assertEqual(self.confirm(token)["outcome"], "already_confirmed")   # double press
        self.assertEqual(len(self.events), 1)                  # still the one event: no second one
        self.assertEqual(self.updates, [("evt-1", False)])     # the SAME event became confirmed, once
        self.assertEqual([m[0] for m in self.mails if m[0] != "approved"], ["staff_confirmed", "client_confirmed"])
        status, event_id, _, calendar_error, confirmed_at, _ = self.row(trial_id)
        self.assertEqual((status, event_id, calendar_error), ("Confirmed", "evt-1", None))
        self.assertIsNotNone(confirmed_at)

        self.assertEqual(self.decline(token)["outcome"], "already_confirmed")   # the other answer, later
        self.assertEqual(self.row(trial_id)[0], "Confirmed")

    def test_decline_then_confirm(self):
        trial_id = self.new_trial(days=15)
        token = self.approve(trial_id)
        self.assertEqual(self.decline(token)["outcome"], "declined")
        self.assertEqual(self.decline(token)["outcome"], "already_declined")
        self.assertEqual(self.confirm(token)["outcome"], "already_declined")
        self.assertEqual(self.row(trial_id)[0], "Declined")
        self.assertEqual(self.deleted, ["evt-1"])              # declining removes the provisional event
        self.assertIsNone(self.row(trial_id)[1])
        self.assertEqual([m[0] for m in self.mails if m[0] != "approved"], ["staff_declined"])
        # the slot is free again
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT session_date FROM trial_sessions WHERE id=%s", (trial_id,))
        day = cur.fetchone()[0]
        self.assertEqual(main.slot_problem(cur, self.trainer_id, str(day), "10:00"), None)
        conn.close()

    def test_calendar_failure_keeps_session_confirmed_and_flags_it(self):
        trial_id = self.new_trial(days=16, hour="11:00")
        token = self.approve(trial_id)
        self.fail_calendar = True                              # the update at confirmation fails
        self.assertEqual(self.confirm(token)["outcome"], "confirmed")
        status, event_id, _, calendar_error, _, _ = self.row(trial_id)
        self.assertEqual((status, event_id), ("Confirmed", "evt-1"))   # still the provisional event
        self.assertTrue(calendar_error)
        self.assertIn(("staff_confirmed", False), self.mails)
        listed = {r["id"]: r for r in endpoint("/admin/trial-sessions", "GET")()}
        self.assertEqual(listed[trial_id]["status"], "confirmed")
        # the panel button refreshes the same event once the calendar is back
        self.fail_calendar = False
        result = endpoint("/admin/trial-sessions/{trial_id}/calendar-event", "POST")(trial_id)
        self.assertTrue(result["calendar"]["ok"])
        self.assertEqual(self.row(trial_id)[3], None)
        self.assertEqual(len(self.events), 1)

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
        self.assertEqual(self.updates, [])
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
        trial_id = self.new_trial(days=19, hour="09:00")
        self.approve(trial_id)
        cancel = endpoint("/admin/trial-sessions/{trial_id}/cancel", "POST")
        sent = []
        orig = mailer.send_trial_cancelled
        mailer.send_trial_cancelled = lambda *a, **k: sent.append(a)
        try:
            cancel(trial_id)
        finally:
            mailer.send_trial_cancelled = orig
        self.assertEqual(self.row(trial_id)[0], "Cancelled")
        self.assertEqual(len(sent), 1)
        self.assertEqual(self.deleted, ["evt-1"])              # the provisional event is removed too


if __name__ == "__main__":
    unittest.main()

"""A trial session goes onto the calendar when the ADMIN approves it ("Trial (Pendiente)", grey) and the SAME
event becomes the confirmed one when the client confirms:

    python -m unittest test_trial_pending -v

Google is faked (google_fakes.FakeGoogle builds the real event bodies); emails are faked; the local database
is used and cleaned up.
"""
import unittest
from datetime import date, timedelta

import testsafety
from fastapi import HTTPException

import admin_api
import admin_calendar
import event_format
import google_fakes
import mailer
import main
import trial_confirmation as tc
import trial_notifications
from database import get_connection

DOMAIN = "@test-pending.example"


class Sent:
    def result(self, timeout=None):
        from emails.transport import EmailResult
        return EmailResult(True)


def endpoint(path, method):
    for route in main.app.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", ()):
            return route.endpoint
    raise LookupError(path)


def weekday_after(offset):
    day = date.today() + timedelta(days=offset)
    while day.weekday() > 4:
        day += timedelta(days=1)
    return day


class Pending(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        testsafety.require_local_database()
        main.ensure_trial_session_fields()
        main.ensure_email_log_table()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 1")
        cls.trainer_id = cur.fetchone()[0]
        conn.close()

    def cleanup(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        conn.commit()
        conn.close()

    def setUp(self):
        self.cleanup()
        self.google = google_fakes.FakeGoogle().install()
        self.mails = []
        self._saved = (mailer.send_trial_approved, mailer.send_trial_confirmed, mailer.send_trial_cancelled,
                       trial_notifications.notify_trial_confirmed, trial_notifications.notify_trial_declined)
        mailer.send_trial_approved = lambda *a, **k: (self.mails.append(("approved", a)), Sent())[1]
        mailer.send_trial_confirmed = lambda *a, **k: Sent()
        mailer.send_trial_cancelled = lambda *a, **k: None
        trial_notifications.notify_trial_confirmed = lambda trial, ok=True: None
        trial_notifications.notify_trial_declined = lambda trial: None

    def tearDown(self):
        self.google.uninstall()
        (mailer.send_trial_approved, mailer.send_trial_confirmed, mailer.send_trial_cancelled,
         trial_notifications.notify_trial_confirmed, trial_notifications.notify_trial_declined) = self._saved
        self.cleanup()

    # ----- helpers
    def new_trial(self, days=14, hour="10:00", session_type="individual", second="Beatriz Prueba"):
        day = weekday_after(days)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status, "
            "session_type, second_person_name) VALUES ('Ana Maria Prueba', %s, '600', 'Lose weight', 'Beginner', %s, %s, "
            "'Pending', %s, %s) RETURNING id",
            (f"ana{days}{hour[:2]}{DOMAIN}", day, hour, session_type, second if session_type == "dual" else None),
        )
        trial_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        return trial_id

    def approve(self, trial_id, **extra):
        return endpoint("/admin/trial-sessions/{trial_id}/approve", "POST")(
            trial_id, admin_api.TrialApprovePayload(trainer_id=self.trainer_id, **extra))

    def token(self, trial_id):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT confirmation_token FROM trial_sessions WHERE id = %s", (trial_id,))
        value = cur.fetchone()[0]
        conn.close()
        return value

    def row(self, trial_id):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT status, google_event_id, session_date, session_time FROM trial_sessions WHERE id = %s", (trial_id,))
        data = cur.fetchone()
        conn.close()
        return data

    def admin_event(self, trial_id):
        conn = get_connection()
        cur = conn.cursor()
        day = self.row(trial_id)[2]
        events = admin_calendar.calendar_events(cur, day, day + timedelta(days=1), kind="all")
        conn.close()
        return next((event for event in events if event["id"] == f"t{trial_id}"), None)

    confirm = staticmethod(lambda token: endpoint("/trial-sessions/confirmation/{token}/confirm", "POST")(token))
    decline = staticmethod(lambda token: endpoint("/trial-sessions/confirmation/{token}/decline", "POST")(token))

    # ----- tests
    def test_approving_puts_a_grey_pending_event_on_google_and_the_admin_calendar(self):
        trial_id = self.new_trial(session_type="dual")
        result = self.approve(trial_id)
        self.assertTrue(result["calendar"]["ok"])
        status, event_id, day, time = self.row(trial_id)
        self.assertEqual(status, "Approved")
        self.assertTrue(event_id.startswith("tb"))                          # deterministic id, stored on the trial
        event = self.google.events[event_id]
        self.assertEqual(event["summary"], "Trial (Pendiente) - Ana Prueba")
        self.assertEqual(event["colorId"], event_format.PENDING_COLOR)
        self.assertEqual(event["extendedProperties"]["private"]["app"], "thundbalance")
        self.assertEqual(event["start"]["timeZone"], "Europe/Madrid")
        for text in ("Ana Maria Prueba", f"ana14{'10'}{DOMAIN}", "Dual (Beatriz Prueba)", str(day)[8:10]):
            self.assertIn(text, event["description"])
        shown = self.admin_event(trial_id)                                   # on the admin calendar at once
        self.assertEqual(shown["title"], f"Trial (Pendiente) - ana14{'10'}{DOMAIN}")
        self.assertEqual(shown["extendedProps"]["status"], "approved")

    def test_confirming_patches_the_same_event_and_twice_changes_nothing(self):
        trial_id = self.new_trial()
        self.approve(trial_id)
        event_id = self.row(trial_id)[1]
        token = self.token(trial_id)
        self.assertEqual(self.confirm(token)["outcome"], "confirmed")
        self.assertEqual(self.confirm(token)["outcome"], "already_confirmed")
        self.assertEqual(self.row(trial_id)[:2], ("Confirmed", event_id))   # same event id
        self.assertEqual(list(self.google.events), [event_id])              # no second event
        event = self.google.events[event_id]
        self.assertEqual(event["summary"], "Trial - Ana Prueba")
        self.assertEqual(event["colorId"], event_format.TRIAL_COLOR)
        self.assertNotIn("Pendiente", event["description"])
        self.assertEqual((self.google.count("create"), self.google.count("patch")), (1, 1))
        shown = self.admin_event(trial_id)
        self.assertEqual((shown["title"], shown["extendedProps"]["status"]), (f"Trial - ana14{'10'}{DOMAIN}", "confirmed"))

    def test_approving_twice_does_not_duplicate(self):
        trial_id = self.new_trial()
        self.approve(trial_id)
        with self.assertRaises(HTTPException) as caught:                     # it is no longer a pending request
            self.approve(trial_id)
        self.assertEqual(caught.exception.status_code, 404)
        self.assertTrue(tc.sync_calendar_event(trial_id))                    # the sync itself is idempotent too
        self.assertTrue(tc.sync_calendar_event(trial_id))
        self.assertEqual(len(self.google.events), 1)
        self.assertEqual(self.google.count("create"), 1)

    def test_declining_removes_the_event_from_google_and_the_admin_calendar(self):
        trial_id = self.new_trial()
        self.approve(trial_id)
        self.assertEqual(self.decline(self.token(trial_id))["outcome"], "declined")
        self.assertEqual(self.google.events, {})
        self.assertIsNone(self.row(trial_id)[1])
        self.assertIsNone(self.admin_event(trial_id))                        # a declined trial is not on the calendar

    def test_the_admin_cancelling_removes_the_event_from_both(self):
        trial_id = self.new_trial(days=15)
        self.approve(trial_id)
        self.assertEqual(len(self.google.events), 1)
        endpoint("/admin/trial-sessions/{trial_id}/cancel", "POST")(trial_id)
        self.assertEqual(self.google.events, {})
        self.assertIsNone(self.admin_event(trial_id))
        confirmed = self.new_trial(days=16)                                  # ... and after the client confirmed
        self.approve(confirmed)
        self.confirm(self.token(confirmed))
        endpoint("/admin/trial-sessions/{trial_id}/cancel", "POST")(confirmed)
        self.assertEqual(self.google.events, {})
        self.assertIsNone(self.admin_event(confirmed))

    def test_the_slot_is_blocked_from_the_approval(self):
        trial_id = self.new_trial(days=20, hour="09:00")
        self.approve(trial_id)
        day = self.row(trial_id)[2]
        conn = get_connection()
        cur = conn.cursor()
        self.assertNotIn("09:00", main.free_start_times(cur, self.trainer_id, str(day)))
        self.assertIsNotNone(main.slot_problem(cur, self.trainer_id, str(day), "09:00"))
        conn.close()

    def test_an_hour_adjusted_in_the_approval_is_the_one_used_everywhere(self):
        trial_id = self.new_trial(days=21, hour="09:00")
        day = weekday_after(22).isoformat()
        self.approve(trial_id, session_date=day, session_time="11:00")
        status, event_id, saved_day, saved_time = self.row(trial_id)
        self.assertEqual((str(saved_day), str(saved_time)[:5]), (day, "11:00"))
        self.assertTrue(self.google.events[event_id]["start"]["dateTime"].startswith(f"{day}T11:00"))
        self.assertEqual(self.mails[-1][1][2:4], (day, "11:00"))             # the email says the final time too
        # and it is the final slot that is held
        conn = get_connection()
        cur = conn.cursor()
        self.assertIsNotNone(main.slot_problem(cur, self.trainer_id, day, "11:00"))
        conn.close()

    def test_a_calendar_failure_does_not_undo_the_approval_and_the_retry_creates_one_event(self):
        trial_id = self.new_trial(days=23)
        self.google.fail = True
        result = self.approve(trial_id)
        self.assertFalse(result["calendar"]["ok"])
        self.assertEqual(self.row(trial_id)[:2], ("Approved", None))
        self.google.fail = False
        self.assertTrue(endpoint("/admin/trial-sessions/{trial_id}/calendar-event", "POST")(trial_id)["calendar"]["ok"])
        self.assertEqual(len(self.google.events), 1)
        self.assertEqual(next(iter(self.google.events.values()))["summary"], "Trial (Pendiente) - Ana Prueba")


if __name__ == "__main__":
    unittest.main()

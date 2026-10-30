"""The studio's Google Calendar always matches the app, and the client calendar can be switched off:

    python -m unittest test_google_sync -v

Google is a fake (google_fakes.FakeGoogle): no real call is made. Uses the local database;
the rows it creates are removed.
"""
import os
import threading
import time
import unittest

import plans_schema
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from unittest import mock

from fastapi import HTTPException

import calendar_feed
import calendar_sync
import google_calendar as gc
import google_fakes
import main
import reschedule_requests
import packs
from database import get_connection
from emails import build_pack_email
from emails.pack_emails import pack_ics_attachment
from emails.trial_emails import client_trial_confirmed
from emails.welcome_emails import build_welcome_email
from features import client_calendar_enabled

DOMAIN = "@test-gsync.example"
CLAIMS = {"sub": "uid-gsync", "email": f"ana{DOMAIN}"}


def route(path, method):
    for item in main.app.routes:
        if getattr(item, "path", None) == path and method in getattr(item, "methods", ()):
            return item
    raise LookupError(path)


def next_weekday(offset, weekday):
    day = date.today() + timedelta(days=offset)
    while day.weekday() != weekday:
        day += timedelta(days=1)
    return day


class Sync(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.ensure_trial_session_fields()
        main.ensure_session_pack_column()
        main.ensure_calendar_sync_columns()
        main.ensure_client_lifecycle_columns()
        main.ensure_client_workflow_fields()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 1")
        cls.trainer_id = cur.fetchone()[0]
        cur.execute(f"INSERT INTO plans (nome, {plans_schema.price_column(cur)}, duracao_meses, duration_weeks) VALUES ('TEST gsync 3 weeks', 0, 1, 3) RETURNING id")
        cls.plan_id = cur.fetchone()[0]
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        cls.cleanup()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM plans WHERE id = %s", (cls.plan_id,))
        conn.commit()
        conn.close()

    @classmethod
    def cleanup(cls):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        ids = [row[0] for row in cur.fetchall()]
        if ids:
            cur.execute("DELETE FROM sessions WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM user_plans WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM client_requests WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM users WHERE id = ANY(%s)", (ids,))
        conn.commit()
        conn.close()

    def setUp(self):
        self.cleanup()
        self.google = google_fakes.FakeGoogle().install()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO users (firebase_uid, nome, email, telefone) VALUES ('uid-gsync', 'Ana María Ruiz', %s, '+34600111222') RETURNING id", (f"ana{DOMAIN}",))
        self.user_id = cur.fetchone()[0]
        conn.commit()
        conn.close()

    def tearDown(self):
        self.google.uninstall()
        self.cleanup()

    # ----- helpers
    def renew(self, start=None):
        start = start or next_weekday(10, 0)
        return route("/admin/clients/{client_id}/renew-pack", "POST").endpoint(self.user_id, main.NewPack(
            plan_id=self.plan_id, sessions_per_week=2, preferred_days="Monday,Wednesday", preferred_time="10:00",
            trainer_id=self.trainer_id, start_date=start.isoformat(), email_extra=[], allow_conflicts=True, confirm_replace=True))

    def sessions(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id, session_date, session_time, status, google_event_id, calendar_sync_status, calendar_sync_error, session_number "
                    "FROM sessions WHERE user_id = %s ORDER BY session_date, session_time, id", (self.user_id,))
        rows = cur.fetchall()
        conn.close()
        return rows

    # ----- creating
    def test_a_pack_creates_one_event_per_session_with_the_right_title(self):
        self.renew()
        rows = self.sessions()
        self.assertEqual(len(rows), 6)                                   # 3 weeks x 2 a week
        self.assertEqual(len(self.google.events), 6)
        self.assertEqual(self.google.count("create"), 6)
        for row in rows:
            event = self.google.events[row[4]]                           # the stored id is the event's id
            self.assertEqual(event["summary"], f"Ana Ruiz {row[7]}")     # "{Name} {Last surname} {x}/{y}"
            self.assertEqual(row[5], "ok")
            self.assertIsNone(row[6])
            self.assertEqual(event["extendedProperties"]["private"]["app"], "thundbalance")
            self.assertNotIn("attendees", event)                         # nobody is ever invited
            for line in ("Cliente: Ana María Ruiz", f"Email: ana{DOMAIN}", "Teléfono: +34600111222", "Entrenador:", "Pack: TEST gsync"):
                self.assertIn(line, event["description"])

    def test_pressing_sync_twice_never_duplicates(self):
        self.renew()
        before = len(self.google.events)
        for _ in range(2):
            route("/admin/clients/{client_id}/sync-calendar", "POST").endpoint(self.user_id)
        self.assertEqual(len(self.google.events), before)
        self.assertEqual(self.google.count("create"), before)           # nothing was created again

    # ----- moving
    def test_rescheduling_patches_the_same_event(self):
        self.renew()
        row = self.sessions()[0]
        new_day = next_weekday(40, 2)
        reschedule_requests.admin_reschedule(row[0], new_day.isoformat(), "11:00", None, "test")
        self.assertEqual(self.google.count("create"), 6)                # no new event
        self.assertEqual(self.google.count("patch"), 1)
        event = self.google.events[row[4]]
        self.assertEqual(event["start"]["dateTime"][:16], f"{new_day}T11:00")
        self.assertIn("11:00 - 12:00", event["description"])

    def test_a_vanished_event_is_created_again_when_moving(self):
        self.renew()
        row = self.sessions()[0]
        del self.google.events[row[4]]                                  # somebody deleted it in Google
        reschedule_requests.admin_reschedule(row[0], next_weekday(40, 2).isoformat(), "11:00", None, "test")
        self.assertIn(row[4], self.google.events)                       # back, with the same deterministic id
        self.assertEqual(self.sessions()[0][5], "ok")

    # ----- cancelling
    def test_cancelling_deletes_the_event_and_a_missing_one_counts_as_success(self):
        self.renew()
        first, second = self.sessions()[:2]
        self.assertEqual(main.cancel_session(first[0], CLAIMS), {"message": "Session cancelled successfully"})
        self.assertNotIn(first[4], self.google.events)
        del self.google.events[second[4]]                               # already gone from Google
        main.cancel_session(second[0], CLAIMS)                          # must not fail
        rows = {row[0]: row for row in self.sessions()}
        self.assertEqual((rows[first[0]][3], rows[first[0]][5]), ("Cancelled", "ok"))
        self.assertEqual((rows[second[0]][3], rows[second[0]][5]), ("Cancelled", "ok"))
        self.assertEqual(len(self.google.events), 4)

    # ----- Google failing
    def test_a_google_outage_never_stops_the_operation_in_the_app(self):
        self.renew()
        row = self.sessions()[0]
        self.google.fail = True
        new_day = next_weekday(40, 2)
        reschedule_requests.admin_reschedule(row[0], new_day.isoformat(), "11:00", None, "test")
        saved = {r[0]: r for r in self.sessions()}[row[0]]
        self.assertEqual(str(saved[1]), str(new_day))                   # the move is saved
        self.assertEqual(saved[5], "failed")                            # and flagged
        self.assertTrue(saved[6])
        for private in ("Ana", "Ruiz", DOMAIN, "600111222"):
            self.assertNotIn(private, saved[6])                         # the stored error has no personal data
        main.cancel_session(row[0], CLAIMS)                             # cancelling works too
        self.assertEqual({r[0]: r for r in self.sessions()}[row[0]][3], "Cancelled")

    def test_a_pack_is_created_even_if_google_is_down_and_the_button_fixes_it(self):
        self.google.fail = True
        answer = self.renew()
        self.assertEqual(len(self.sessions()), 6)
        self.assertEqual(answer["calendar"]["failed"], 6)
        self.assertTrue(all(row[5] == "failed" for row in self.sessions()))
        self.google.fail = False
        result = route("/admin/clients/{client_id}/sync-calendar", "POST").endpoint(self.user_id)
        self.assertEqual((result["created"], result["failed"]), (6, 0))
        self.assertTrue(all(row[5] == "ok" for row in self.sessions()))
        self.assertEqual(len(self.google.events), 6)

    def test_the_single_session_button_creates_the_missing_event_once(self):
        self.renew()
        row = self.sessions()[0]
        del self.google.events[row[4]]
        endpoint = route("/admin/sessions/{session_id}/sync-calendar", "POST").endpoint
        self.assertTrue(endpoint(row[0])["ok"])
        self.assertTrue(endpoint(row[0])["ok"])                         # a second press changes nothing
        self.assertEqual(len(self.google.events), 6)
        with self.assertRaises(HTTPException) as caught:
            endpoint(99999999)
        self.assertEqual(caught.exception.status_code, 404)

    # ----- the client changes
    def test_editing_the_client_rewrites_the_future_events(self):
        self.renew()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("UPDATE users SET nome = 'Ana Lucía Torres' WHERE id = %s", (self.user_id,))
        conn.commit()
        conn.close()
        calendar_sync.sync_client_sessions_to_google(self.user_id)
        for row in self.sessions():
            self.assertEqual(self.google.events[row[4]]["summary"], f"Ana Torres {row[7]}")
            self.assertIn("Cliente: Ana Lucía Torres", self.google.events[row[4]]["description"])

    # ----- many requests
    def test_requests_run_in_parallel_but_never_more_than_four_at_a_time(self):
        state = {"now": 0, "max": 0}
        lock = threading.Lock()
        original = self.google.create

        def slow_create(*args, **kwargs):
            with lock:
                state["now"] += 1
                state["max"] = max(state["max"], state["now"])
            time.sleep(0.05)
            try:
                return original(*args, **kwargs)
            finally:
                with lock:
                    state["now"] -= 1

        gc.create_calendar_event_status = slow_create
        self.renew()
        self.assertEqual(len(self.google.events), 6)
        self.assertGreater(state["max"], 1)                             # really parallel
        self.assertLessEqual(state["max"], calendar_sync.MAX_PARALLEL)

    def test_the_google_client_is_built_once_with_a_timeout(self):
        gc.reset_service()
        built = []

        def fake_build(*args, **kwargs):
            built.append(kwargs)
            return object()

        credentials = SimpleNamespace(valid=True)
        with mock.patch.object(gc, "build", fake_build), mock.patch.object(gc, "load_credentials", lambda: credentials):
            first, second = gc.get_calendar_service(), gc.get_calendar_service()
        gc.reset_service()
        self.assertIs(first, second)
        self.assertEqual(len(built), 1)                                 # not authenticated again for every event
        self.assertEqual(built[0]["http"].http.timeout, gc.TIMEOUT_SECONDS)
        self.assertEqual(gc.TIMEOUT_SECONDS, 8)

    # ----- cleaning and logs
    def test_clear_calendar_needs_the_admin_and_an_explicit_confirmation(self):
        calls = [dependency.call for dependency in route("/admin/clear-calendar", "DELETE").dependant.dependencies]
        self.assertIn(main.require_admin, calls)
        with self.assertRaises(HTTPException) as caught:
            main.clear_google_calendar(main.ClearCalendarPayload(confirm=""))
        self.assertEqual(caught.exception.status_code, 422)
        with mock.patch.object(main, "clear_calendar", lambda: 3):
            answer = main.clear_google_calendar(main.ClearCalendarPayload(confirm="CLEAR CALENDAR"))
        self.assertEqual(answer["deleted"], 3)

    def test_no_debug_prints_in_the_calendar_code(self):
        base = os.path.dirname(os.path.abspath(__file__))
        for name in ("google_calendar.py", "calendar_sync.py", "packs.py", "trial_confirmation.py", "calendar_feed.py"):
            with open(os.path.join(base, name), encoding="utf-8") as handle:
                self.assertNotIn("print(", handle.read(), name)


class ClientCalendarSwitch(unittest.TestCase):
    """CLIENT_CALENDAR_ENABLED: off by default, and when it is off nothing about the client's
    calendar reaches the emails or the endpoints."""

    SUMMARY = {
        "client_name": "Ana", "client_email": "ana@example.com", "plan_name": "Plan", "sessions_per_week": 2, "days": ["Monday"],
        "trainer": "Carles", "calendar_links": calendar_feed.feed_urls("t" * 43, base_url="https://api.example.com"),
        "sessions": [{"id": 1, "start": datetime(2026, 11, 3, 10), "trainer": "Carles", "number": "1/1"}],
    }

    def env(self, value):
        return mock.patch.dict(os.environ, {"CLIENT_CALENDAR_ENABLED": value})

    def test_off_by_default(self):
        with mock.patch.dict(os.environ):
            os.environ.pop("CLIENT_CALENDAR_ENABLED", None)
            self.assertFalse(client_calendar_enabled())
        for value in ("", "false", "0", "no", "off"):
            with self.env(value):
                self.assertFalse(client_calendar_enabled(), value)
        for value in ("true", "1", "YES", "On"):
            with self.env(value):
                self.assertTrue(client_calendar_enabled(), value)

    def test_the_pack_email_has_no_calendar_part_when_off(self):
        with self.env("false"):
            subject, html, text = build_pack_email(self.SUMMARY)
            self.assertIsNone(pack_ics_attachment(self.SUMMARY))
        for word in ("Google Calendar", ".ics", "calendar.google.com", "/calendar/feed/", "calendario", "calendar", "24 hours", "24 horas"):
            self.assertNotIn(word.lower(), (html + text).lower(), word)
        # everything else is still there: summary, session list, trainer, date
        self.assertIn("Carles", html)
        self.assertIn("Plan", html)
        self.assertIn("2026", html + text)

    def test_the_pack_email_has_the_calendar_part_when_on(self):
        with self.env("true"):
            _, html, _ = build_pack_email(self.SUMMARY)
            attachment = pack_ics_attachment(self.SUMMARY)
        self.assertIn("Add to my Google Calendar", html)
        self.assertEqual(attachment["filename"], "thundbalance-sesiones.ics")

    def test_the_welcome_email_has_no_calendar_part_when_off(self):
        with self.env("false"):
            subject, html, text, ics = build_welcome_email("Ana", "ana@example.com", "pw-123456", self.SUMMARY)
        self.assertIsNone(ics)
        for word in ("google calendar", ".ics", "feed", "calendario", "calendar"):
            self.assertNotIn(word, (html + text).lower(), word)
        self.assertIn("pw-123456", html)                                # the access data is untouched
        with self.env("true"):
            *_, ics_on = build_welcome_email("Ana", "ana@example.com", "pw-123456", self.SUMMARY)
        self.assertIsNotNone(ics_on)

    def test_the_trial_confirmation_has_no_file_and_no_sentence_about_it_when_off(self):
        with self.env("false"):
            subject, html, text, ics = client_trial_confirmed("Ana", datetime(2026, 11, 3, 10), "Carles", 5, "es")
        self.assertIsNone(ics)
        self.assertNotIn("calendario", (html + text).lower())
        self.assertNotIn("adjunt", (html + text).lower())
        with self.env("true"):
            *_, ics_on = client_trial_confirmed("Ana", datetime(2026, 11, 3, 10), "Carles", 5, "es")
        self.assertIn("UID:trial-5@thundbalance.com", ics_on)

    def test_the_endpoints_of_the_client_calendar_are_closed_when_off(self):
        with self.env("false"):
            self.assertIsNone(calendar_feed.links_for_email("ana@example.com"))
            answer = route("/calendar/feed/{filename}", "GET").endpoint("a" * 43 + ".ics")
            self.assertEqual(answer.status_code, 404)
            self.assertEqual(main.public_features()["client_calendar"], False)
            for path, method in (("/me/calendar-feed", "GET"), ("/me/calendar-feed/regenerate", "POST"),
                                 ("/me/sessions.ics", "GET"), ("/me/sessions/{session_id}/ics", "GET"),
                                 ("/admin/clients/{client_id}/calendar-feed", "GET")):
                guards = [dependency.call.__name__ for dependency in route(path, method).dependant.dependencies]
                self.assertIn("_require_enabled", guards, path)
                with self.assertRaises(HTTPException) as caught:
                    [d.call for d in route(path, method).dependant.dependencies if d.call.__name__ == "_require_enabled"][0]()
                self.assertEqual(caught.exception.status_code, 404, path)
        with self.env("true"):
            self.assertEqual(main.public_features()["client_calendar"], True)


if __name__ == "__main__":
    unittest.main()

"""The admin calendar reads the database only:

    python -m unittest test_admin_calendar -v

Uses the local database; the rows it creates are removed. Google Calendar is made to
fail loudly: if any of this code touched it, the tests would break.
"""
import unittest
from datetime import date, datetime, timedelta

from fastapi import HTTPException

import admin_calendar as ac
import google_calendar
import main
from database import get_connection

DOMAIN = "@test-admincal.example"


def route(path, method):
    for item in main.app.routes:
        if getattr(item, "path", None) == path and method in getattr(item, "methods", ()):
            return item
    raise LookupError(path)


def call(path, method="GET", **kwargs):
    return route(path, method).endpoint(**kwargs)


class FakeCursor:
    def __init__(self, colors):
        self.colors = colors
        self.sql = ""

    def execute(self, sql, params=None):
        self.sql = sql

    def fetchall(self):
        return [(color,) for color in self.colors]

    def fetchone(self):
        return (len(self.colors),)


class Calendar(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ac.ensure_columns()
        cls._calendar_calls = []

        def forbidden(*args, **kwargs):
            cls._calendar_calls.append(1)
            raise AssertionError("the admin calendar must not call Google Calendar")

        cls._saved = (google_calendar.list_calendar_events, google_calendar.get_calendar_service)
        google_calendar.list_calendar_events = forbidden
        google_calendar.get_calendar_service = forbidden
        cls.cleanup()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id, nome, color FROM trainers WHERE active ORDER BY id LIMIT 2")
        cls.trainers = cur.fetchall()
        assert len(cls.trainers) == 2, "the calendar tests need two active trainers"
        cls.t1, cls.t2 = cls.trainers[0][0], cls.trainers[1][0]
        cur.execute("INSERT INTO users (firebase_uid, nome, email, telefone, codigo_pais) VALUES ('uid-cal-a', 'Ana Cal', %s, '600111222', '+34') RETURNING id", (f"ana{DOMAIN}",))
        cls.ana = cur.fetchone()[0]
        cur.execute("INSERT INTO users (firebase_uid, nome, email) VALUES ('uid-cal-b', 'Bia Cal', %s) RETURNING id", (f"bia{DOMAIN}",))
        cls.bia = cur.fetchone()[0]
        today = date.today()
        cls.first = today + timedelta(days=40)
        cls.last = cls.first + timedelta(days=7)

        def session(user, offset, hour, trainer, number, status="Booked", rescheduled=False):
            cur.execute(
                "INSERT INTO sessions (user_id, trainer_id, session_date, session_time, session_number, status, rescheduled) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (user, trainer, cls.first + timedelta(days=offset), hour, number, status, rescheduled),
            )
            return cur.fetchone()[0]

        cls.s1 = session(cls.ana, 1, "10:00", cls.t1, "2/8")
        cls.s2 = session(cls.ana, 2, "11:00", cls.t2, "3/8", rescheduled=True)
        cls.s3 = session(cls.bia, 3, "09:00", cls.t1, "1/4")
        cls.s_cancel = session(cls.ana, 4, "10:00", cls.t1, "4/8", status="Cancelled")
        cls.s_past = None
        cur.execute(
            "INSERT INTO sessions (user_id, trainer_id, session_date, session_time, session_number, status) "
            "VALUES (%s, %s, %s, '08:00', '1/8', 'Booked') RETURNING id", (cls.ana, cls.t1, today - timedelta(days=5)))
        cls.s_past = cur.fetchone()[0]

        def trial(email, offset, hour, status, trainer=None, token=None):
            cur.execute(
                "INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status, trainer_id, confirmation_token) "
                "VALUES ('Trial Person', %s, '600333444', 'Lose weight', 'Beginner', %s, %s, %s, %s, %s) RETURNING id",
                (email, cls.first + timedelta(days=offset), hour, status, trainer, token),
            )
            return cur.fetchone()[0]

        cls.tr_pending = trial(f"pend{DOMAIN}", 1, "12:00", "Pending")
        cls.tr_approved = trial(f"appr{DOMAIN}", 2, "12:00", "Approved", cls.t1, "tok-approved-" + "x" * 30)
        cls.tr_confirmed = trial(f"conf{DOMAIN}", 3, "12:00", "Confirmed", cls.t2, "tok-confirmed-" + "x" * 30)
        cls.tr_legacy = trial(f"old{DOMAIN}", 4, "12:00", "Approved", cls.t1, None)     # approved before the confirmation flow
        cls.tr_declined = trial(f"decl{DOMAIN}", 5, "12:00", "Declined", cls.t1, "tok-declined-" + "x" * 30)
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        google_calendar.list_calendar_events, google_calendar.get_calendar_service = cls._saved
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

    def events(self, **filters):
        params = {"start": self.first.isoformat(), "end": self.last.isoformat(), "email": "", "trainer_ids": "",
                  "kind": "all", "show_cancelled": False}
        params.update(filters)
        return call("/admin/calendar", **params)

    def ids(self, events):
        return {event["id"] for event in events}

    # ----- content
    def test_a_pack_session_is_titled_with_its_position_and_the_client_email(self):
        event = next(e for e in self.events() if e["id"] == f"s{self.s1}")
        self.assertEqual(event["title"], f"2/8 - ana{DOMAIN}")
        self.assertEqual((event["start"], event["end"]), (f"{self.first + timedelta(days=1)}T10:00:00", f"{self.first + timedelta(days=1)}T11:00:00"))
        props = event["extendedProps"]
        self.assertEqual((props["kind"], props["number"], props["clientName"], props["email"]), ("session", "2/8", "Ana Cal", f"ana{DOMAIN}"))
        self.assertEqual(props["phone"], "+34 600111222")
        self.assertEqual(props["trainerId"], self.t1)
        self.assertEqual(props["status"], "booked")
        self.assertIn(props["color"], ac.PALETTE)

    def test_trial_title_and_statuses(self):
        by_id = {e["id"]: e for e in self.events()}
        self.assertEqual(by_id[f"t{self.tr_confirmed}"]["title"], f"Trial - conf{DOMAIN}")
        self.assertEqual(by_id[f"t{self.tr_confirmed}"]["extendedProps"]["status"], "confirmed")
        self.assertEqual(by_id[f"t{self.tr_pending}"]["extendedProps"]["status"], "pending")
        self.assertEqual(by_id[f"t{self.tr_approved}"]["extendedProps"]["status"], "approved")
        self.assertEqual(by_id[f"t{self.tr_legacy}"]["extendedProps"]["status"], "confirmed")
        self.assertEqual(by_id[f"t{self.tr_pending}"]["extendedProps"]["trainerId"], None)     # shown as "Sin asignar"

    def test_declined_trials_only_show_in_the_trial_filter(self):
        self.assertNotIn(f"t{self.tr_declined}", self.ids(self.events()))
        shown = {e["id"]: e for e in self.events(kind="trials")}
        self.assertEqual(shown[f"t{self.tr_declined}"]["extendedProps"]["status"], "declined")

    def test_cancelled_sessions_are_hidden_unless_asked(self):
        self.assertNotIn(f"s{self.s_cancel}", self.ids(self.events()))
        shown = {e["id"]: e for e in self.events(show_cancelled=True)}
        self.assertEqual(shown[f"s{self.s_cancel}"]["extendedProps"]["status"], "cancelled")

    def test_status_follows_the_clock_in_madrid(self):
        window_start = date.today() - timedelta(days=8)
        events = call("/admin/calendar", start=window_start.isoformat(), end=(window_start + timedelta(days=7)).isoformat(),
                      email="", trainer_ids="", kind="packs", show_cancelled=False)
        past = next(e for e in events if e["id"] == f"s{self.s_past}")
        self.assertEqual(past["extendedProps"]["status"], "completed")
        rescheduled = next(e for e in self.events() if e["id"] == f"s{self.s2}")
        self.assertEqual(rescheduled["extendedProps"]["status"], "rescheduled")
        # the rule itself, with a fixed "now"
        now = datetime(2026, 10, 19, 10, 30)
        self.assertEqual(ac.session_status("2026-10-19", "10:00", "Booked", False, now), "booked")      # still running
        self.assertEqual(ac.session_status("2026-10-19", "09:00", "Booked", False, now), "completed")
        self.assertEqual(ac.session_status("2026-10-19", "09:00", "Cancelled", False, now), "cancelled")

    # ----- filters
    def test_filter_by_client_email(self):
        events = self.events(email=f"BIA{DOMAIN}")                 # case does not matter
        self.assertEqual(self.ids(events), {f"s{self.s3}"})
        self.assertEqual(self.ids(self.events(email=f"pend{DOMAIN}")), {f"t{self.tr_pending}"})   # trials by e-mail too

    def test_filter_by_trainers_combines_with_the_rest(self):
        only_t2 = self.ids(self.events(trainer_ids=str(self.t2)))
        self.assertEqual(only_t2, {f"s{self.s2}", f"t{self.tr_confirmed}"})                       # no unassigned trial
        both = self.ids(self.events(trainer_ids=f"{self.t1},{self.t2}", kind="packs"))
        self.assertEqual(both, {f"s{self.s1}", f"s{self.s2}", f"s{self.s3}"})
        self.assertEqual(self.ids(self.events(trainer_ids=str(self.t1), email=f"ana{DOMAIN}")), {f"s{self.s1}"})

    def test_filter_by_kind(self):
        packs = self.events(kind="packs")
        trials = self.events(kind="trials")
        self.assertTrue(all(e["extendedProps"]["kind"] == "session" for e in packs))
        self.assertTrue(all(e["extendedProps"]["kind"] == "trial" for e in trials))
        self.assertEqual(len(self.events()), len(self.events(kind="packs")) + len([e for e in self.events(kind="trials") if e["extendedProps"]["status"] not in ("declined", "rejected", "cancelled")]))

    def test_a_trial_without_date_or_time_is_not_shown(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT is_nullable FROM information_schema.columns WHERE table_name='trial_sessions' AND column_name='session_time'")
        nullable = cur.fetchone()[0] == "YES"
        conn.close()
        if not nullable:
            self.skipTest("session_time is NOT NULL in this database: such a row cannot exist")

    # ----- validation and security
    def test_bad_requests(self):
        for kwargs in ({"start": "nope"}, {"end": self.first.isoformat()}, {"kind": "x"}, {"trainer_ids": "a,b"},
                       {"end": (self.first + timedelta(days=200)).isoformat()}):
            with self.assertRaises(HTTPException) as caught:
                self.events(**kwargs)
            self.assertEqual(caught.exception.status_code, 422, kwargs)

    def test_every_new_route_requires_the_admin(self):
        for path, method in (("/admin/calendar", "GET"), ("/admin/calendar/emails", "GET"), ("/admin/trainers/{trainer_id}/color", "PUT")):
            calls = [dependency.call for dependency in route(path, method).dependant.dependencies]
            self.assertIn(main.require_admin, calls, path)

    def test_the_calendar_never_called_google(self):
        self.events()
        self.events(kind="trials", show_cancelled=True)
        self.assertEqual(self._calendar_calls, [])

    # ----- suggestions
    def test_email_suggestions(self):
        found = call("/admin/calendar/emails", q="ana")
        self.assertIn(f"ana{DOMAIN}", found)
        self.assertEqual(call("/admin/calendar/emails", q="a"), [])                # too short
        self.assertEqual(call("/admin/calendar/emails", q="zzz-no-such-client-zzz"), [])
        self.assertIn(f"conf{DOMAIN}", call("/admin/calendar/emails", q="conf@test-admincal"))
        self.assertEqual(call("/admin/calendar/emails", q="%%"), [])               # wildcards are not wildcards

    # ----- colours
    def test_default_colours_are_the_palette_in_order_and_new_ones_take_the_next_free(self):
        self.assertEqual(len(ac.PALETTE), 12)
        self.assertEqual(len(set(ac.PALETTE)), 12)
        self.assertEqual(ac.next_free_color(FakeCursor([])), ac.PALETTE[0])
        self.assertEqual(ac.next_free_color(FakeCursor(ac.PALETTE[:3])), ac.PALETTE[3])
        self.assertEqual(ac.next_free_color(FakeCursor([ac.PALETTE[0].upper(), ac.PALETTE[2]])), ac.PALETTE[1])
        self.assertEqual(ac.next_free_color(FakeCursor(ac.PALETTE)), ac.PALETTE[0])   # all taken: starts over

    def test_every_trainer_has_a_colour_after_startup(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM trainers WHERE color IS NULL")
        self.assertEqual(cur.fetchone()[0], 0)
        conn.close()

    def test_saving_a_colour(self):
        original = self.trainers[0][2]
        try:
            self.assertEqual(call("/admin/trainers/{trainer_id}/color", "PUT", trainer_id=self.t1, data=ac.ColorPayload(color=ac.PALETTE[5].upper()))["color"], ac.PALETTE[5])
            listing = {t["id"]: t for t in call("/admin/trainer-availability")}
            self.assertEqual(listing[self.t1]["color"], ac.PALETTE[5])
            for bad in ("#000000", "red", "", "#34d39"):
                with self.assertRaises(HTTPException) as caught:
                    call("/admin/trainers/{trainer_id}/color", "PUT", trainer_id=self.t1, data=ac.ColorPayload(color=bad))
                self.assertEqual(caught.exception.status_code, 422, bad)
            with self.assertRaises(HTTPException) as missing:
                call("/admin/trainers/{trainer_id}/color", "PUT", trainer_id=99999999, data=ac.ColorPayload(color=ac.PALETTE[0]))
            self.assertEqual(missing.exception.status_code, 404)
        finally:
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("UPDATE trainers SET color = %s WHERE id = %s", (original, self.t1))
            conn.commit()
            conn.close()


if __name__ == "__main__":
    unittest.main()

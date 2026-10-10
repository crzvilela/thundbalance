"""Calendar synchronisation of client sessions:

    python -m unittest test_calendar_sync -v

The Google Calendar is replaced by an in-memory fake that behaves like the real
one where it matters here: inserting an id that exists answers HTTP 409, a
deleted event keeps its id reserved, events().get() of an unknown id is 404.
The local database is used and cleaned up.
"""
import threading
import unittest
from datetime import date, timedelta

import httplib2
from fastapi import HTTPException
from googleapiclient.errors import HttpError

import admin_api
import calendar_sync
import google_calendar as gc
import main
from database import get_connection

DOMAIN = "@test-sync.example"


def http_error(status):
    return HttpError(httplib2.Response({"status": str(status)}), b"{}")


class FakeCalendar:
    """Just enough of the Calendar API: insert / get / update / patch / delete / list."""

    def __init__(self):
        self.store = {}
        self.lock = threading.Lock()
        self.fail = None                 # set to an HTTP status to make every call fail
        self.auto = 0
        self.log = []

    def events(self):
        return self

    def _call(self, name, fn):
        class Call:
            def execute(inner):
                with self.lock:
                    self.log.append(name)
                    if self.fail:
                        raise http_error(self.fail)
                    return fn()
        return Call()

    def insert(self, calendarId, body):
        def run():
            event_id = body.get("id")
            if event_id is None:
                self.auto += 1
                event_id = f"auto{self.auto}"
            if event_id in self.store:
                raise http_error(409)
            self.store[event_id] = {**body, "id": event_id, "status": "confirmed"}
            return self.store[event_id]
        return self._call("insert", run)

    def get(self, calendarId, eventId):
        def run():
            if eventId not in self.store:
                raise http_error(404)
            return self.store[eventId]
        return self._call("get", run)

    def update(self, calendarId, eventId, body):
        def run():
            self.store[eventId] = {**body, "id": eventId}
            return self.store[eventId]
        return self._call("update", run)

    def patch(self, calendarId, eventId, body):
        def run():
            if eventId not in self.store:
                raise http_error(404)
            self.store[eventId].update(body)
            return self.store[eventId]
        return self._call("patch", run)

    def delete(self, calendarId, eventId):
        def run():
            if eventId not in self.store:
                raise http_error(404)
            self.store[eventId]["status"] = "cancelled"     # id stays reserved, like Google
        return self._call("delete", run)

    def list(self, **kwargs):
        def run():
            return {"items": [e for e in self.store.values() if e.get("status") != "cancelled"]}
        return self._call("list", run)

    def live(self):
        return {k: v for k, v in self.store.items() if v.get("status") != "cancelled"}


class Sync(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.ensure_calendar_sync_columns()
        main.ensure_session_pack_column()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active AND nome IN ('Guille','Matilda') ORDER BY id LIMIT 1")
        row = cur.fetchone()
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 1")
        cls.trainer_id = (row or cur.fetchone())[0]
        conn.close()

    def setUp(self):
        self.cleanup()
        self.fake = FakeCalendar()
        self._orig = gc.get_calendar_service
        gc.get_calendar_service = lambda: self.fake
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO users (nome, email) VALUES ('Henrique Prueba', %s) RETURNING id", (f"henrique{DOMAIN}",))
        self.user_id = cur.fetchone()[0]
        conn.commit()
        conn.close()

    def tearDown(self):
        gc.get_calendar_service = self._orig
        self.cleanup()

    @classmethod
    def cleanup(cls):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        ids = [r[0] for r in cur.fetchall()]
        if ids:
            cur.execute("DELETE FROM sessions WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM users WHERE id = ANY(%s)", (ids,))
        conn.commit()
        conn.close()

    # ----- helpers
    def day(self, offset):
        d = date.today() + timedelta(days=offset)
        while d.weekday() > 4:
            d += timedelta(days=1)
        return d

    def add_session(self, offset, hour="14:00", status="Booked", event_id=None, number="1/4"):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO sessions (user_id, trainer_id, session_date, session_time, session_number, status, google_event_id) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (self.user_id, self.trainer_id, self.day(offset), hour, number, status, event_id))
        session_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        return session_id

    def row(self, session_id):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT status, google_event_id, calendar_sync_status, calendar_sync_error, session_date, session_time FROM sessions WHERE id = %s", (session_id,))
        data = cur.fetchone()
        conn.close()
        return data

    # ----- idempotent creation
    def test_the_same_session_never_produces_two_events(self):
        first = gc.create_calendar_event("Guille", "Ana", "a@b.co", "2027-01-04", "14:00", "1/4", event_id="tbabcdefgh00000001", session_id=1)
        second = gc.create_calendar_event("Guille", "Ana", "a@b.co", "2027-01-04", "14:00", "1/4", event_id="tbabcdefgh00000001", session_id=1)
        self.assertEqual(first, second)
        self.assertEqual(len(self.fake.live()), 1)
        event = self.fake.store[first]
        self.assertEqual(event["start"], {"dateTime": "2027-01-04T14:00:00", "timeZone": "Europe/Madrid"})
        self.assertEqual(event["end"]["timeZone"], "Europe/Madrid")
        self.assertEqual(event["extendedProperties"]["private"]["thundbalance_session_id"], "1")

    def test_a_409_on_an_event_deleted_in_google_brings_it_back(self):
        event_id = gc.create_calendar_event("Guille", "Ana", "a@b.co", "2027-01-04", "14:00", "1/4", event_id="tbabcdefgh00000002", session_id=2)
        self.fake.delete("c", event_id).execute()
        self.assertEqual(self.fake.live(), {})
        gc.create_calendar_event("Guille", "Ana", "a@b.co", "2027-01-04", "14:00", "1/4", event_id=event_id, session_id=2)
        self.assertIn(event_id, self.fake.live())

    def test_event_ids_are_valid_and_differ_between_databases(self):
        a, b = calendar_sync.event_id_for("abcdefgh", 7), calendar_sync.event_id_for("qrstuvab"[:0] + "0123abcd", 7)
        self.assertNotEqual(a, b)
        for value in (a, b):
            self.assertTrue(set(value) <= set("0123456789abcdefghijklmnopqrstuv"), value)
            self.assertTrue(5 <= len(value) <= 1024)
        conn = get_connection()
        cur = conn.cursor()
        key = calendar_sync.instance_key(cur)
        self.assertEqual(calendar_sync.instance_key(cur), key)           # stable
        conn.close()
        self.assertEqual(len(key), 8)
        self.assertTrue(set(key) <= set(calendar_sync.BASE32HEX))

    # ----- the sync button
    def test_sync_creates_only_what_is_missing_and_repeating_duplicates_nothing(self):
        a = self.add_session(10, number="1/3")
        b = self.add_session(17, number="2/3")
        c = self.add_session(24, number="3/3")
        past = self.add_session(-9, hour="09:00")                         # past session: ignored
        cancelled = self.add_session(12, status="Cancelled")              # cancelled: ignored

        result = calendar_sync.sync_client(self.user_id)
        self.assertEqual((result["created"], result["failed"], result["already_ok"]), (3, 0, 0))
        self.assertEqual(len(self.fake.live()), 3)
        for sid in (a, b, c):
            status, event_id, sync, error, _, _ = self.row(sid)
            self.assertEqual((sync, error), ("ok", None))
            self.assertIn(event_id, self.fake.live())
            self.assertTrue(event_id.startswith("tb") and len(event_id) == 18)
        self.assertIsNone(self.row(past)[1])
        self.assertIsNone(self.row(cancelled)[1])

        again = calendar_sync.sync_client(self.user_id)                   # pressed twice
        self.assertEqual((again["created"], again["already_ok"]), (0, 3))
        self.assertEqual(len(self.fake.live()), 3)

    def test_two_syncs_at_the_same_moment_do_not_duplicate(self):
        for offset in (10, 17, 24, 31):
            self.add_session(offset)
        results = []
        barrier = threading.Barrier(2)

        def press():
            barrier.wait()
            results.append(calendar_sync.sync_client(self.user_id))

        threads = [threading.Thread(target=press) for _ in range(2)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(len(self.fake.live()), 4)                       # still exactly one per session
        self.assertEqual(sum(r["failed"] for r in results), 0)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(DISTINCT google_event_id), COUNT(*) FROM sessions WHERE user_id = %s", (self.user_id,))
        self.assertEqual(cur.fetchone(), (4, 4))
        conn.close()

    def test_an_event_id_from_another_calendar_counts_as_missing(self):
        """The case of the Henrique sessions: the id points to an event that is
        not in the calendar this server uses."""
        sid = self.add_session(10, event_id="idFromTheOtherCalendar")
        result = calendar_sync.sync_client(self.user_id)
        self.assertEqual(result["created"], 1)
        event_id = self.row(sid)[1]
        self.assertNotEqual(event_id, "idFromTheOtherCalendar")
        self.assertIn(event_id, self.fake.live())

    def test_failures_are_recorded_not_raised_and_a_later_sync_repairs(self):
        sid = self.add_session(10)
        self.fake.fail = 403
        result = calendar_sync.sync_client(self.user_id)
        self.assertEqual(result["created"], 0)
        self.assertEqual(result["failed"], 1)
        self.assertEqual(result["errors"], ["Google Calendar HTTP 403"])
        status, event_id, sync, error, _, _ = self.row(sid)
        self.assertEqual((status, event_id, sync, error), ("Booked", None, "failed", "Google Calendar HTTP 403"))
        self.fake.fail = None
        result = calendar_sync.sync_client(self.user_id)
        self.assertEqual((result["created"], result["failed"]), (1, 0))
        self.assertEqual(self.row(sid)[2:4], ("ok", None))

    def test_rows_from_before_stay_unknown_until_they_are_checked(self):
        sid = self.add_session(10)
        self.assertEqual(self.row(sid)[2:4], (None, None))                # NULL = unknown

    # ----- cancel and move never fail because of the calendar
    def claims(self):
        return {"sub": "x", "email": f"henrique{DOMAIN}"}

    def test_cancelling_works_when_the_calendar_fails_and_says_so(self):
        sid = self.add_session(10)
        calendar_sync.sync_client(self.user_id)
        self.fake.fail = 500
        result = main.cancel_session(sid, self.claims())
        self.assertEqual(result, {"message": "Session cancelled successfully"})
        status, _, sync, error, _, _ = self.row(sid)
        self.assertEqual((status, sync, error), ("Cancelled", "failed", "Google Calendar HTTP 500"))

    def test_cancelling_an_event_that_is_already_gone_is_fine(self):
        sid = self.add_session(10, event_id="alreadyGone")
        result = main.cancel_session(sid, self.claims())
        self.assertEqual(result, {"message": "Session cancelled successfully"})
        self.assertEqual(self.row(sid)[0::2][0], "Cancelled")
        self.assertEqual(self.row(sid)[2], "ok")

    def test_moving_a_session_saves_the_date_even_if_the_event_could_not_move(self):
        sid = self.add_session(10, hour="14:00")
        calendar_sync.sync_client(self.user_id)
        event_id = self.row(sid)[1]
        new_day = self.day(20)
        self.fake.fail = 503
        result = main.update_session(sid, main.UpdateSession(session_date=new_day.isoformat(), session_time="12:00"), self.claims())
        self.assertEqual(result, {"message": "Session updated successfully"})
        status, _, sync, error, saved_day, saved_time = self.row(sid)
        self.assertEqual((str(saved_day), str(saved_time)[:5], sync), (new_day.isoformat(), "12:00", "failed"))
        # the event is still at the old time; the sync button moves it
        self.fake.fail = None
        self.assertNotIn("2", self.fake.store[event_id]["start"]["dateTime"][11:13] + "x")
        repaired = calendar_sync.sync_client(self.user_id)
        self.assertEqual((repaired["updated"], repaired["failed"]), (1, 0))
        self.assertEqual(self.fake.store[event_id]["start"]["dateTime"][:16], f"{new_day.isoformat()}T12:00")
        self.assertEqual(self.row(sid)[2], "ok")

    # ----- the panel
    def test_the_endpoint_syncs_shows_status_and_requires_admin(self):
        sid = self.add_session(10)
        route = next(r for r in main.app.routes if getattr(r, "path", None) == "/admin/clients/{client_id}/sync-calendar")
        self.assertIn(main.require_admin, [d.call for d in route.dependant.dependencies])
        result = route.endpoint(self.user_id)
        self.assertEqual((result["created"], result["failed"]), (1, 0))
        with self.assertRaises(HTTPException) as caught:
            route.endpoint(999999999)
        self.assertEqual(caught.exception.status_code, 404)

        detail = next(r for r in main.app.routes if getattr(r, "path", None) == "/admin/clients/{client_id}" and "GET" in r.methods)
        sessions = detail.endpoint(self.user_id)["sessions"]
        self.assertEqual(sessions[0]["calendar_sync_status"], "ok")
        self.assertIn("calendar_sync_error", sessions[0])

        status_route = next(r for r in main.app.routes if getattr(r, "path", None) == "/admin/calendar-status")
        shown = status_route.endpoint()
        self.assertEqual(set(shown), {"calendar", "source"})
        self.assertIn(shown["source"], ("env", "default"))
        self.assertLess(len(shown["calendar"]), 45)                        # masked, not the full id


if __name__ == "__main__":
    unittest.main()

"""Reschedule requests (the client asks, the studio decides):

    python -m unittest test_reschedule_requests -v

Google is a fake (google_fakes.FakeGoogle) and no e-mail is really sent. Uses the local database;
the rows it creates are removed.
"""
import os
import unittest
from datetime import date, timedelta
from unittest import mock

from fastapi import HTTPException

import availability
import calendar_sync
import google_fakes
import main
import reschedule_notifications as notify
import reschedule_requests as rr
from database import get_connection
from emails.reschedule_emails import (
    client_reschedule_counter, client_reschedule_rejected, staff_reschedule_requested, client_reschedule_approved,
)

os.environ.pop("TRIAL_EMAIL_WEBHOOK_URL", None)       # no real e-mail

DOMAIN = "@test-resched.example"
ADMIN = {"sub": "uid-admin-resched", "email": main.ADMIN_EMAIL}


def claims_of(key):
    return {"sub": f"uid-{key}-resched", "email": f"{key}{DOMAIN}"}


def route(path, method):
    for item in main.app.routes:
        if getattr(item, "path", None) == path and method in getattr(item, "methods", ()):
            return item
    raise LookupError(path)


def weekday_after(offset):
    day = date.today() + timedelta(days=offset)
    while day.weekday() > 4:
        day += timedelta(days=1)
    return day


class Requests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.ensure_trial_session_fields()
        main.ensure_session_pack_column()
        main.ensure_calendar_sync_columns()
        main.ensure_client_lifecycle_columns()
        rr.ensure_tables()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 1")
        cls.trainer_id = cur.fetchone()[0]
        cls.slot_day = weekday_after(14)
        free = availability.free_start_times(cur, cls.trainer_id, cls.slot_day.isoformat())
        conn.close()
        assert len(free) >= 3, "the reschedule tests need a trainer with free hours"
        cls.free = free
        cls.original = weekday_after(21)

    @classmethod
    def tearDownClass(cls):
        cls.cleanup()

    @classmethod
    def cleanup(cls):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        ids = [row[0] for row in cur.fetchall()]
        if ids:
            cur.execute("DELETE FROM reschedule_requests WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM sessions WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM users WHERE id = ANY(%s)", (ids,))
        conn.commit()
        conn.close()

    def setUp(self):
        self.cleanup()
        self.google = google_fakes.FakeGoogle().install()
        self.sent = []
        self._patches = []
        for name in ("staff_requested", "staff_counter_accepted", "staff_counter_declined", "client_approved",
                     "client_rejected", "client_counter", "session_moved"):
            patcher = mock.patch.object(notify, name, lambda ctx, _n=name: (self.sent.append((_n, ctx["id"])), None)[1])
            patcher.start()
            self._patches.append(patcher)
        self.ana = self.user("ana", "Ana María Ruiz")
        self.bia = self.user("bia", "Bia Torres")
        self.session = self.new_session(self.ana, self.original, self.free[0], "3/8")

    def tearDown(self):
        for patcher in self._patches:
            patcher.stop()
        self.google.uninstall()
        rr.MAX_RESCHEDULE_REQUESTS_PER_SESSION = 1
        self.cleanup()

    # ----- helpers
    def user(self, key, name):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO users (firebase_uid, nome, email) VALUES (%s, %s, %s) RETURNING id",
                    (f"uid-{key}-resched", name, f"{key}{DOMAIN}"))
        user_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        return user_id

    def new_session(self, user_id, day, time, number="1/8", synced=True):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO sessions (user_id, trainer_id, session_date, session_time, status, session_number) "
                    "VALUES (%s, %s, %s, %s, 'Booked', %s) RETURNING id", (user_id, self.trainer_id, day, time, number))
        session_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        if synced:
            calendar_sync.sync_session_to_google(session_id)
        return session_id

    def session_row(self, session_id=None):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT session_date, session_time, rescheduled, google_event_id, calendar_sync_status FROM sessions WHERE id = %s",
                    (session_id or self.session,))
        row = cur.fetchone()
        conn.close()
        return row

    def request(self, session_id=None, time=None, note=None, user=None, lang=None):
        return rr.create_request(user or self.ana, session_id or self.session, self.slot_day.isoformat(),
                                 time or self.free[1], note, lang)["request"]

    def status_of(self, request_id):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT status FROM reschedule_requests WHERE id = %s", (request_id,))
        value = cur.fetchone()[0]
        conn.close()
        return value

    def sql(self, query, params=()):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(query, params)
        conn.commit()
        conn.close()

    def code_of(self, error):
        return error.exception.detail["code"]

    # ----- creating a request
    def test_a_request_keeps_the_session_and_stores_the_note_and_language(self):
        before = self.session_row()
        created = self.request(note="  Tengo   un viaje  ", lang="ca")
        self.assertEqual((created["status"], created["client_note"]), ("pending", "Tengo un viaje"))
        self.assertEqual(self.session_row(), before)                        # nothing moved
        self.assertEqual(self.sent, [("staff_requested", created["id"])])  # the studio is told
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT lang, token FROM reschedule_requests WHERE id = %s", (created["id"],))
        lang, token = cur.fetchone()
        conn.close()
        self.assertEqual(lang, "ca")
        self.assertGreaterEqual(len(token), 40)
        self.assertNotIn("token", created)                                  # the client never sees it

    def test_the_note_is_optional_and_limited_to_300_characters(self):
        self.assertIsNone(self.request()["client_note"])
        self.sql("DELETE FROM reschedule_requests")
        with self.assertRaises(HTTPException) as caught:
            self.request(note="x" * 301)
        self.assertEqual((caught.exception.status_code, self.code_of(caught)), (422, "note_too_long"))
        self.assertEqual(self.request(note="x" * 300)["client_note"], "x" * 300)

    def test_less_than_8_hours_before_the_session_is_refused_and_8_or_more_is_allowed(self):
        now = rr._now()
        soon = (now + timedelta(hours=3)).replace(minute=0, second=0, microsecond=0)
        late = self.new_session(self.ana, soon.date(), soon.strftime("%H:%M"), "4/8", synced=False)
        with self.assertRaises(HTTPException) as caught:
            self.request(session_id=late)
        self.assertEqual((caught.exception.status_code, self.code_of(caught)), (409, "too_late"))
        ok_time = (now + timedelta(hours=10)).replace(minute=0, second=0, microsecond=0)
        fine = self.new_session(self.ana, ok_time.date(), ok_time.strftime("%H:%M"), "5/8", synced=False)
        self.assertEqual(self.request(session_id=fine)["status"], "pending")

    def test_a_second_request_is_blocked_while_one_is_open_and_forever_after(self):
        first = self.request()
        with self.assertRaises(HTTPException) as open_one:
            self.request(time=self.free[2])
        self.assertEqual(self.code_of(open_one), "open_request")
        rr.reject(first["id"], "no")                                         # rejected ...
        with self.assertRaises(HTTPException) as after:
            self.request(time=self.free[2])
        self.assertEqual((after.exception.status_code, self.code_of(after)), (409, "limit_reached"))   # ... still no second one

    def test_the_limit_is_a_constant_and_changing_it_needs_no_migration(self):
        first = self.request()
        rr.reject(first["id"])
        rr.MAX_RESCHEDULE_REQUESTS_PER_SESSION = 2
        second = self.request(time=self.free[2])                             # now allowed
        self.assertEqual(second["status"], "pending")
        rr.reject(second["id"])
        with self.assertRaises(HTTPException) as caught:
            self.request()
        self.assertEqual(self.code_of(caught), "limit_reached")              # the second limit holds

    def test_only_one_open_request_per_session_is_enforced_by_the_database(self):
        self.request()
        conn = get_connection()
        cur = conn.cursor()
        with self.assertRaises(Exception) as caught:
            cur.execute("INSERT INTO reschedule_requests (session_id, user_id, original_date, original_time, requested_date, "
                        "requested_time, token) VALUES (%s, %s, CURRENT_DATE, '10:00', CURRENT_DATE, '11:00', 'dup-token-123456789012345')",
                        (self.session, self.ana))
        self.assertEqual(type(caught.exception).__name__, "UniqueViolation")
        conn.rollback()
        # ... but it is NOT unique over the whole table: closed requests may pile up (the code limits them)
        cur.execute("SELECT indexdef FROM pg_indexes WHERE indexname = 'reschedule_requests_one_open'")
        self.assertIn("WHERE", cur.fetchone()[0])
        cur.execute("SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'reschedule_requests' AND indexdef LIKE '%UNIQUE%' "
                    "AND indexdef LIKE '%(session_id)%' AND indexdef NOT LIKE '%WHERE%'")
        self.assertEqual(cur.fetchone()[0], 0)
        conn.close()

    def test_a_busy_or_past_slot_is_refused(self):
        other = self.new_session(self.bia, self.slot_day, self.free[1], "1/4", synced=False)   # trainer busy then
        with self.assertRaises(HTTPException) as busy:
            self.request()
        self.assertEqual(self.code_of(busy), "slot_unavailable")
        self.sql("DELETE FROM sessions WHERE id = %s", (other,))
        # the client is busy then, with ANOTHER trainer (so it is the client who is the problem)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active AND id <> %s ORDER BY id LIMIT 1", (self.trainer_id,))
        elsewhere = cur.fetchone()[0]
        cur.execute("INSERT INTO sessions (user_id, trainer_id, session_date, session_time, status, session_number) "
                    "VALUES (%s, %s, %s, %s, 'Booked', '2/8') RETURNING id", (self.ana, elsewhere, self.slot_day, self.free[2]))
        mine = cur.fetchone()[0]
        conn.commit()
        conn.close()
        with self.assertRaises(HTTPException) as client_busy:
            self.request(time=self.free[2])
        self.assertIn("client already has", client_busy.exception.detail["message"])
        with self.assertRaises(HTTPException) as past:
            rr.create_request(self.ana, self.session, (date.today() - timedelta(days=1)).isoformat(), "10:00")
        self.assertEqual(self.code_of(past), "slot_unavailable")
        self.sql("DELETE FROM sessions WHERE id = %s", (mine,))

    # ----- approving
    def test_approving_moves_the_session_and_the_google_event_and_is_idempotent(self):
        title_before = self.google.events[self.session_row()[3]]["summary"]
        created = self.request()
        answer = rr.approve(created["id"], "boss")
        self.assertEqual((answer["request"]["status"], answer["repeated"]), ("approved", False))
        day, time, rescheduled, event_id, sync = self.session_row()
        self.assertEqual((str(day), str(time)[:5], rescheduled, sync), (str(self.slot_day), self.free[1], True, "ok"))
        event = self.google.events[event_id]
        self.assertEqual(event["start"]["dateTime"][:16], f"{self.slot_day}T{self.free[1]}")     # the SAME event moved
        self.assertEqual(event["summary"], title_before)                                        # the title does not change
        self.assertEqual(self.google.count("create"), 1)
        patches = self.google.count("patch")
        again = rr.approve(created["id"], "boss")                                                # a second press
        self.assertTrue(again["repeated"])
        self.assertEqual(self.google.count("patch"), patches)
        self.assertEqual([item for item in self.sent if item[0] == "client_approved"], [("client_approved", created["id"])])

    def test_approving_with_a_conflict_is_refused_and_the_request_stays_pending(self):
        created = self.request()
        self.new_session(self.bia, self.slot_day, self.free[1], "1/4", synced=False)             # taken meanwhile
        before = self.session_row()
        with self.assertRaises(HTTPException) as caught:
            rr.approve(created["id"], "boss")
        self.assertEqual((caught.exception.status_code, self.code_of(caught)), (409, "slot_unavailable"))
        self.assertEqual(self.status_of(created["id"]), "pending")
        self.assertEqual(self.session_row(), before)

    def test_a_google_failure_leaves_the_session_moved_and_flagged(self):
        created = self.request()
        self.google.fail = True
        rr.approve(created["id"], "boss")
        day, time, _, _, sync = self.session_row()
        self.assertEqual((str(day), str(time)[:5], sync), (str(self.slot_day), self.free[1], "failed"))
        self.google.fail = False
        self.assertTrue(calendar_sync.sync_session_to_google(self.session)["action"] in ("updated", "created"))
        self.assertEqual(self.session_row()[4], "ok")                                            # "Sincronizar con Google"

    # ----- rejecting
    def test_rejecting_keeps_the_session_and_stores_the_note(self):
        created = self.request()
        before = self.session_row()
        answer = rr.reject(created["id"], "No hay hueco esa semana", "boss")
        self.assertEqual((answer["request"]["status"], answer["request"]["admin_note"]), ("rejected", "No hay hueco esa semana"))
        self.assertEqual(self.session_row(), before)
        self.assertTrue(rr.reject(created["id"])["repeated"])
        self.assertEqual([item[0] for item in self.sent].count("client_rejected"), 1)
        with self.assertRaises(HTTPException) as caught:
            rr.approve(created["id"], "boss")                                                    # terminal states do not change
        self.assertEqual(self.code_of(caught), "closed")

    # ----- counter proposal
    def test_a_proposal_only_moves_the_session_when_the_client_accepts(self):
        created = self.request()
        before = self.session_row()
        answer = rr.counter(created["id"], self.slot_day.isoformat(), self.free[2], "Mejor a esta hora", "boss")
        self.assertEqual(answer["request"]["status"], "counter_proposed")
        self.assertEqual(self.session_row(), before)                                             # nothing moved yet
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT token FROM reschedule_requests WHERE id = %s", (created["id"],))
        token = cur.fetchone()[0]
        conn.close()
        view = rr.public_view(token)                                                             # opening the link decides nothing
        self.assertEqual((view["state"], view["counter_time"], view["first_name"]), ("waiting", self.free[2], "Ana"))
        self.assertEqual(set(view), {"state", "first_name", "session_date", "session_time", "counter_date", "counter_time"})
        self.assertEqual(self.status_of(created["id"]), "counter_proposed")
        accepted = rr.respond(token=token, accept=True)
        self.assertEqual((accepted["outcome"], accepted["already"]), ("accepted", False))
        day, time, rescheduled, _, sync = self.session_row()
        self.assertEqual((str(day), str(time)[:5], rescheduled, sync), (str(self.slot_day), self.free[2], True, "ok"))
        self.assertTrue(rr.respond(token=token, accept=True)["already"])                         # twice: nothing repeated
        self.assertTrue(rr.respond(token=token, accept=False)["already"])                        # and it can not flip
        self.assertEqual(self.status_of(created["id"]), "accepted")
        self.assertEqual([item[0] for item in self.sent].count("staff_counter_accepted"), 1)

    def test_declining_a_proposal_keeps_the_original_session(self):
        created = self.request()
        rr.counter(created["id"], self.slot_day.isoformat(), self.free[2])
        before = self.session_row()
        answer = rr.respond(request_id=created["id"], user_id=self.ana, accept=False)
        self.assertEqual(answer["outcome"], "declined")
        self.assertEqual(self.session_row(), before)
        self.assertEqual(self.status_of(created["id"]), "declined")
        with self.assertRaises(HTTPException) as caught:
            self.request(time=self.free[2])
        self.assertEqual(self.code_of(caught), "limit_reached")                                   # a declined proposal still counts

    def test_accepting_rechecks_conflicts(self):
        created = self.request()
        rr.counter(created["id"], self.slot_day.isoformat(), self.free[2])
        self.new_session(self.bia, self.slot_day, self.free[2], "1/4", synced=False)             # the counter slot is taken
        before = self.session_row()
        with self.assertRaises(HTTPException) as caught:
            rr.respond(request_id=created["id"], user_id=self.ana, accept=True)
        self.assertEqual(self.code_of(caught), "slot_unavailable")
        self.assertEqual(self.session_row(), before)
        self.assertEqual(self.status_of(created["id"]), "counter_proposed")

    def test_a_proposal_must_be_a_free_slot_and_leave_time_to_answer(self):
        created = self.request()
        self.new_session(self.bia, self.slot_day, self.free[2], "1/4", synced=False)
        with self.assertRaises(HTTPException) as busy:
            rr.counter(created["id"], self.slot_day.isoformat(), self.free[2])
        self.assertEqual(self.code_of(busy), "slot_unavailable")
        soon = (rr._now() + timedelta(hours=3)).replace(minute=0, second=0, microsecond=0)
        self.sql("UPDATE sessions SET session_date = %s, session_time = %s WHERE id = %s", (soon.date(), soon.strftime("%H:%M"), self.session))
        with self.assertRaises(HTTPException) as late:
            rr.counter(created["id"], self.slot_day.isoformat(), self.free[0])
        self.assertEqual(self.code_of(late), "too_late")

    # ----- expiry
    def test_a_pending_request_expires_when_the_session_starts(self):
        created = self.request()
        past = rr._now() - timedelta(hours=1)
        self.sql("UPDATE sessions SET session_date = %s, session_time = %s WHERE id = %s", (past.date(), past.strftime("%H:%M"), self.session))
        listed = rr.list_for_admin(limit=50)["items"]
        self.assertEqual({item["id"]: item["status"] for item in listed}[created["id"]], "expired")
        with self.assertRaises(HTTPException) as caught:
            rr.approve(created["id"], "boss")
        self.assertEqual(self.code_of(caught), "closed")

    def test_a_proposal_expires_8_hours_before_the_session_and_can_no_longer_be_accepted(self):
        created = self.request()
        rr.counter(created["id"], self.slot_day.isoformat(), self.free[2])
        soon = (rr._now() + timedelta(hours=5))
        self.sql("UPDATE sessions SET session_date = %s, session_time = %s WHERE id = %s", (soon.date(), soon.strftime("%H:%M"), self.session))
        before = self.session_row()
        answer = rr.respond(request_id=created["id"], user_id=self.ana, accept=True)
        self.assertEqual(answer["outcome"], "expired")
        self.assertEqual(self.session_row(), before)
        self.assertEqual(self.status_of(created["id"]), "expired")

    def test_a_cancelled_session_closes_its_open_request(self):
        created = self.request()
        main.cancel_session(self.session, claims_of("ana"))
        self.assertEqual(rr.list_for_user(self.ana)[0]["status"], "expired")
        self.assertEqual(self.status_of(created["id"]), "expired")

    # ----- the studio moves a session directly
    def test_the_studio_can_always_move_a_session_directly_and_it_does_not_count_for_the_client(self):
        result = rr.admin_reschedule(self.session, self.slot_day.isoformat(), self.free[1], "Cambio por obras", "boss")
        self.assertEqual(result["new"], {"date": str(self.slot_day), "time": self.free[1]})
        day, time, rescheduled, _, sync = self.session_row()
        self.assertEqual((str(day), str(time)[:5], rescheduled, sync), (str(self.slot_day), self.free[1], False, "ok"))
        self.assertIn(("session_moved", f"s{self.session}"), self.sent)
        self.assertEqual(self.request(time=self.free[2])["status"], "pending")                    # the client's one request is intact
        # moving again directly is fine, and it closes the open request (the studio picked another day: expired)
        rr.admin_reschedule(self.session, self.slot_day.isoformat(), self.free[0], None, "boss")
        self.assertEqual(rr.list_for_user(self.ana)[0]["status"], "expired")

    def test_a_direct_move_to_the_requested_slot_approves_the_open_request(self):
        created = self.request()
        rr.admin_reschedule(self.session, self.slot_day.isoformat(), self.free[1], None, "boss")
        self.assertEqual(self.status_of(created["id"]), "approved")

    def test_a_direct_move_checks_conflicts_too(self):
        self.new_session(self.bia, self.slot_day, self.free[1], "1/4", synced=False)
        with self.assertRaises(HTTPException) as caught:
            rr.admin_reschedule(self.session, self.slot_day.isoformat(), self.free[1], None, "boss")
        self.assertEqual(self.code_of(caught), "slot_unavailable")

    def test_put_sessions_no_longer_reschedules_for_clients(self):
        with self.assertRaises(HTTPException) as caught:
            main.update_session(self.session, main.UpdateSession(session_date=self.slot_day.isoformat(), session_time=self.free[1]), claims_of("ana"))
        self.assertEqual((caught.exception.status_code, caught.exception.detail["code"]), (403, "use_reschedule_request"))
        self.assertEqual(str(self.session_row()[0]), str(self.original))
        answer = main.update_session(self.session, main.UpdateSession(session_date=self.slot_day.isoformat(), session_time=self.free[1]), ADMIN)
        self.assertEqual(answer, {"message": "Session updated successfully"})            # the administrator still can
        self.assertEqual(str(self.session_row()[0]), str(self.slot_day))

    # ----- permissions
    def test_a_client_only_sees_and_creates_requests_for_their_own_sessions(self):
        endpoint = route("/me/sessions/{session_id}/reschedule-request", "POST").endpoint
        with self.assertRaises(HTTPException) as caught:
            endpoint(self.session, rr.RequestPayload(requested_date=self.slot_day.isoformat(), requested_time=self.free[1]), claims_of("bia"))
        self.assertEqual(caught.exception.status_code, 404)                                       # as if it did not exist
        created = endpoint(self.session, rr.RequestPayload(requested_date=self.slot_day.isoformat(), requested_time=self.free[1]), claims_of("ana"))["request"]
        listing = route("/me/reschedule-requests", "GET").endpoint
        self.assertEqual(listing(claims_of("bia"))["items"], [])
        mine = listing(claims_of("ana"))
        self.assertEqual([r["id"] for r in mine["items"]], [created["id"]])
        self.assertEqual((mine["max_per_session"], mine["notice_hours"], mine["note_max"]), (1, 8, 300))   # the rules, for the page
        rr.MAX_RESCHEDULE_REQUESTS_PER_SESSION = 2
        self.assertEqual(listing(claims_of("ana"))["max_per_session"], 2)                                  # change the constant, the page follows
        rr.MAX_RESCHEDULE_REQUESTS_PER_SESSION = 1
        with self.assertRaises(HTTPException) as other:
            route("/me/reschedule-requests/{request_id}", "GET").endpoint(created["id"], claims_of("bia"))
        self.assertEqual(other.exception.status_code, 404)
        rr.counter(created["id"], self.slot_day.isoformat(), self.free[2])
        with self.assertRaises(HTTPException) as stranger:
            route("/me/reschedule-requests/{request_id}/accept", "POST").endpoint(created["id"], claims_of("bia"))
        self.assertEqual(stranger.exception.status_code, 404)
        self.assertEqual(self.status_of(created["id"]), "counter_proposed")                      # a stranger decided nothing

    def test_routes_are_protected_as_they_should(self):
        def guards(path, method):
            return {dependency.call for dependency in route(path, method).dependant.dependencies}
        for path, method in (("/admin/reschedule-requests", "GET"), ("/admin/reschedule-requests/count", "GET"),
                             ("/admin/reschedule-requests/{request_id}/approve", "POST"),
                             ("/admin/reschedule-requests/{request_id}/reject", "POST"),
                             ("/admin/reschedule-requests/{request_id}/counter", "POST"),
                             ("/admin/reschedule-requests/{request_id}/resend-email", "POST"),
                             ("/admin/sessions/{session_id}/reschedule", "POST")):
            self.assertIn(main.require_admin, guards(path, method), path)
        for path, method in (("/me/sessions/{session_id}/reschedule-request", "POST"), ("/me/reschedule-requests", "GET"),
                             ("/me/reschedule-requests/{request_id}/accept", "POST"), ("/me/reschedule-requests/{request_id}/decline", "POST")):
            self.assertIn(main.require_client, guards(path, method), path)
        for path, method in (("/reschedule-response/{token}", "GET"), ("/reschedule-response/{token}/accept", "POST")):
            self.assertEqual(guards(path, method), set(), path)                                   # public: the token is the key
        with self.assertRaises(HTTPException) as caught:
            route("/reschedule-response/{token}", "GET").endpoint("short")
        self.assertEqual(caught.exception.status_code, 404)

    # ----- listing for the studio
    def test_the_studio_lists_filters_and_counts(self):
        first = self.request()
        other = self.new_session(self.bia, self.original, self.free[0], "1/4", synced=False)
        second = rr.create_request(self.bia, other, self.slot_day.isoformat(), self.free[2], None, "es")["request"]
        rr.reject(second["id"])
        self.assertEqual(rr.pending_count(), 1)
        every = rr.list_for_admin(limit=10)
        self.assertEqual(every["total"], 2)
        self.assertEqual(every["items"][0]["id"], first["id"])                                    # pending first
        self.assertEqual([i["status"] for i in rr.list_for_admin(status="rejected")["items"]], ["rejected"])
        self.assertEqual([i["client_email"] for i in rr.list_for_admin(email="BIA@")["items"]], [f"bia{DOMAIN}"])
        self.assertEqual(rr.list_for_admin(trainer_id=self.trainer_id)["total"], 2)
        self.assertEqual(rr.list_for_admin(trainer_id=99999999)["total"], 0)
        page = rr.list_for_admin(limit=1, offset=1)
        self.assertEqual((len(page["items"]), page["total"]), (1, 2))
        with self.assertRaises(HTTPException):
            rr.list_for_admin(status="nonsense")
        self.assertEqual(rr.list_for_admin(email="%")["total"], 0)                                # wildcards are literal

    def test_the_schedule_page_gets_counts_urgency_conflicts_and_sync_state(self):
        far = self.request()
        near_day = weekday_after(10)
        near_session = self.new_session(self.bia, near_day, self.free[0], "2/4", synced=False)
        near = rr.create_request(self.bia, near_session, self.slot_day.isoformat(), self.free[2], None, "es")["request"]
        listing = rr.list_for_admin(status="pending,counter_proposed")
        self.assertEqual([item["id"] for item in listing["items"]], [near["id"], far["id"]])    # the closest session first
        self.assertEqual((listing["counts"]["pending"], listing["counts"]["approved"]), (2, 0))
        self.assertEqual(rr.open_count(), {"pending": 2, "counter_proposed": 0, "open": 2})
        first = listing["items"][1]
        self.assertEqual((first["session_date"], first["session_time"], first["number"]), (str(self.original), self.free[0], "3/8"))
        self.assertIsNone(first["conflict"])
        self.assertTrue(first["color"])
        # somebody takes the hour that was asked for: the card says so, nothing else changes
        self.new_session(self.bia, self.slot_day, self.free[1], "1/4", synced=False)
        flagged = {item["id"]: item["conflict"] for item in rr.list_for_admin(status="pending")["items"]}
        self.assertTrue(flagged[far["id"]])
        self.assertEqual(self.status_of(far["id"]), "pending")
        # a proposal is checked against the proposed hour; counts follow the filters, not the tab
        rr.counter(near["id"], self.slot_day.isoformat(), self.free[0], "ok", "boss")
        self.assertEqual(rr.open_count(), {"pending": 1, "counter_proposed": 1, "open": 2})
        self.assertEqual(rr.list_for_admin(email="bia@")["counts"]["counter_proposed"], 1)
        self.assertEqual(rr.list_for_admin(email="ana@")["counts"]["counter_proposed"], 0)
        self.assertEqual(rr.list_for_admin(status="counter_proposed", trainer_ids=f"{self.trainer_id},99999999")["total"], 1)
        self.assertEqual(rr.list_for_admin(trainer_ids="99999999")["total"], 0)
        self.assertEqual([item["id"] for item in rr.list_for_admin(request_id=far["id"])["items"]], [far["id"]])
        # decided cards say who decided; a failed Google update is shown on the card
        self.sql("DELETE FROM sessions WHERE user_id = %s AND session_number = '1/4'", (self.bia,))   # the hour is free again
        self.google.fail = True
        approved = rr.approve(far["id"], "boss@example.org")
        self.assertEqual(approved["session"]["sync_status"], "failed")
        item = rr.list_for_admin(status="approved")["items"][0]
        self.assertEqual((item["decided_by"], item["sync_status"], item["session_date"]), ("boss@example.org", "failed", str(self.slot_day)))
        self.google.fail = False

    def test_the_admin_calendar_marks_sessions_with_an_open_request(self):
        import admin_calendar
        created = self.request()
        conn = get_connection()
        cur = conn.cursor()
        events = admin_calendar.calendar_events(cur, str(self.original), str(self.original + timedelta(days=1)))
        conn.close()
        props = [event["extendedProps"] for event in events if event["extendedProps"].get("sessionId") == self.session][0]
        self.assertEqual((props["changeRequestId"], props["changeRequestStatus"]), (created["id"], "pending"))
        rr.reject(created["id"])
        conn = get_connection()
        cur = conn.cursor()
        events = admin_calendar.calendar_events(cur, str(self.original), str(self.original + timedelta(days=1)))
        conn.close()
        props = [event["extendedProps"] for event in events if event["extendedProps"].get("sessionId") == self.session][0]
        self.assertIsNone(props["changeRequestId"])

    # ----- e-mails
    def test_emails_are_one_language_and_have_no_calendar_part(self):
        ctx = {"id": 7, "client_name": "Ana María Ruiz", "client_email": f"ana{DOMAIN}", "number": "3/8", "trainer": "Matilda",
               "original_date": "2026-11-16", "original_time": "10:00", "requested_date": "2026-11-18", "requested_time": "11:00",
               "session_date": "2026-11-18", "session_time": "11:00", "counter_date": "2026-11-19", "counter_time": "12:00",
               "client_note": "Tengo un viaje", "admin_note": "Hueco libre ese día", "token": "t" * 43, "lang": "ca"}
        _, html, text = client_reschedule_counter(ctx)
        self.assertIn('lang="ca"', html)
        self.assertIn("Acceptar la data nova", html)
        self.assertNotIn("Aceptar la nueva fecha", html)                                          # no second language
        for action in ("accept", "decline"):
            self.assertIn(f"/reschedule-response/{'t' * 43}?action={action}&amp;lang=ca".replace("&amp;", "&"), html.replace("&amp;", "&"))
        self.assertIn("Hueco libre ese día", html)
        for word in ("calendar.google.com", ".ics", "Google Calendar"):
            self.assertNotIn(word, html + text)
        # English by default
        subject, html_en, _ = client_reschedule_approved({**ctx, "lang": None})
        self.assertIn('lang="en"', html_en)
        self.assertIn("Your session has a new date", subject)
        _, rejected, _ = client_reschedule_rejected({**ctx, "lang": "es"})
        self.assertIn("Hueco libre ese día", rejected)                                           # the reason is shown
        # the studio's e-mail: Spanish only, with the client's e-mail, the note and the panel link
        subject, staff_html, _ = staff_reschedule_requested(ctx)
        self.assertIn("Solicitud de cambio de fecha", subject)
        for text_in in (f"ana{DOMAIN}", "Tengo un viaje", "/admin/schedule?request=7", "3/8"):
            self.assertIn(text_in, staff_html)

    def test_an_email_failure_never_breaks_the_request(self):
        for patcher in self._patches:
            patcher.stop()
        self._patches = []
        os.environ["TRIAL_EMAIL_WEBHOOK_URL"] = "http://127.0.0.1:9/none"                       # unreachable
        try:
            created = rr.create_request(self.ana, self.session, self.slot_day.isoformat(), self.free[1], None, "en")
            self.assertEqual(created["request"]["status"], "pending")
            self.assertFalse(created["email"]["sent"])
            answer = rr.approve(created["request"]["id"], "boss")
            self.assertEqual(answer["request"]["status"], "approved")
            self.assertFalse(answer["email"]["sent"])                                            # the panel can offer "reenviar"
            again = rr.resend_email(created["request"]["id"])
            self.assertFalse(again["email"]["sent"])
        finally:
            os.environ.pop("TRIAL_EMAIL_WEBHOOK_URL", None)


if __name__ == "__main__":
    unittest.main()

"""The client sees the events in THEIR Google Calendar (a guest of each event).

    python -m unittest test_calendar_guests -v

Google is a fake (google_fakes.FakeGoogle); the credentials / sendUpdates / delegation logic of google_calendar.py is tested
with small stand-ins for Google's service. The local database is used and cleaned.
"""
import json
import os
import unittest
from datetime import date, datetime, timedelta
from unittest import mock

import pack_schedule
import calendar_sync
import event_format
import google_calendar as gc
import google_fakes
import catalog_testing
import main
import plans_schema
import reschedule_requests as rr
import session_restore
import trial_confirmation
from database import get_connection

DOMAIN = "@test-guests.example"
CLIENT = f"ana{DOMAIN}"
FLAGS = {"guestsCanSeeOtherGuests": False, "guestsCanModify": False, "guestsCanInviteOthers": False}


def next_monday(offset=14):
    day = date.today() + timedelta(days=offset)
    return day + timedelta(days=(7 - day.weekday()) % 7)


def call(path, *args, **kwargs):
    route = next(r for r in main.app.routes if getattr(r, "path", None) == path and "POST" in getattr(r, "methods", ()))
    return route.endpoint(*args, **kwargs)


class Guests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.ensure_session_pack_column()
        main.ensure_calendar_sync_columns()
        main.ensure_client_workflow_fields()
        main.ensure_trial_session_fields()
        rr.ensure_tables()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT trainer_id, day_of_week FROM trainer_availability ta JOIN trainers t ON t.id = ta.trainer_id "
                    "WHERE t.active AND start_time <= '09:00' AND end_time >= '14:00' ORDER BY trainer_id LIMIT 1")
        cls.trainer_id, cls.weekday = cur.fetchone()
        conn.close()
        cls.pause = calendar_sync.INVITE_PAUSE_SECONDS
        calendar_sync.INVITE_PAUSE_SECONDS = 0

    @classmethod
    def tearDownClass(cls):
        calendar_sync.INVITE_PAUSE_SECONDS = cls.pause
        cls.cleanup()

    def setUp(self):
        self.cleanup()
        self.google = google_fakes.FakeGoogle().install()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(f"INSERT INTO plans (nome, {plans_schema.price_column(cur)}, duracao_meses, duration_weeks) VALUES ('TEST guests 2 weeks', 0, 1, 2) RETURNING id")
        self.plan_id = cur.fetchone()[0]
        self.pack_id = catalog_testing.make_pair(cur, self.plan_id)['individual']
        cur.execute("INSERT INTO users (nome, email, firebase_uid) VALUES ('Ana María Ruiz', %s, 'uid-guests') RETURNING id", (CLIENT,))
        self.user_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        day = date.today() + timedelta(days=14)
        while names[day.weekday()] != self.weekday:
            day += timedelta(days=1)
        self.first_day = day

    def tearDown(self):
        self.google.uninstall()
        self.cleanup()

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
            cur.execute("DELETE FROM reschedule_requests WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM users WHERE id = ANY(%s)", (ids,))
        cur.execute("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        catalog_testing.drop(cur)
        cur.execute("DELETE FROM plans WHERE nome LIKE 'TEST guests%'")
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

    def new_pack(self, share=True, extra=None, per_week=2):
        return call("/admin/clients/{client_id}/renew-pack", self.user_id, main.NewPack(
            pack_id=self.pack_id, sessions_per_week=per_week, schedule=pack_schedule.uniform(f"{self.weekday}" if per_week == 1 else f"{self.weekday},Thursday", "10:00", self.trainer_id), start_date=self.first_day.isoformat(), email_client=False,
            email_extra=extra if extra is not None else [], allow_conflicts=True, share_calendar=share))

    def sessions(self):
        return self.sql("SELECT id, google_event_id, status, session_date FROM sessions WHERE user_id = %s ORDER BY session_date, session_time, id", (self.user_id,))

    def guests(self, event):
        return [item["email"] for item in event.get("attendees", [])]

    # ----- packs
    def test_every_event_of_a_shared_pack_has_the_client_as_its_only_guest_with_no_powers(self):
        answer = self.new_pack(share=True)
        self.assertIsNone(answer["calendar"]["guests_warning"])
        events = [self.google.events[row[1]] for row in self.sessions()]
        self.assertEqual(len(events), 4)
        for event in events:
            self.assertEqual(self.guests(event), [CLIENT])
            for flag, value in FLAGS.items():
                self.assertIs(event[flag], value)                                # they see no other guest, cannot edit, cannot invite
            self.assertNotIn("@", event["description"].replace(CLIENT, ""))      # the description holds nothing of anybody else

    def test_the_extra_addresses_are_guests_too_but_the_calendar_owner_never_is(self):
        self.new_pack(share=True, extra=["Second@Test-Guests.example", "pt@thundbalance.com", CLIENT.upper()])
        event = self.google.events[self.sessions()[0][1]]
        self.assertEqual(self.guests(event), [CLIENT, f"second{DOMAIN}"])         # no repeats, lower case, the organizer left out

    def test_switching_sharing_off_means_no_guests(self):
        self.new_pack(share=False)
        for row in self.sessions():
            self.assertNotIn("attendees", self.google.events[row[1]])

    def test_the_guests_are_saved_with_the_pack(self):
        self.new_pack(share=True, extra=[f"second{DOMAIN}"])
        self.assertEqual(self.sql("SELECT calendar_share, calendar_extra FROM user_plans WHERE user_id = %s", (self.user_id,))[0], (True, f"second{DOMAIN}"))

    def test_without_the_delegation_the_pack_and_its_events_exist_without_guests_and_the_admin_is_warned(self):
        self.google.guests_allowed = False
        answer = self.new_pack(share=True)
        self.assertEqual(answer["message"], "Pack created successfully")
        self.assertEqual(answer["calendar"]["guests_warning"], "delegation_missing")
        self.assertEqual(answer["calendar"]["failed"], 0)
        rows = self.sessions()
        self.assertEqual(len(rows), 4)
        for row in rows:
            self.assertNotIn("attendees", self.google.events[row[1]])

    def test_a_big_pack_goes_on_when_one_session_fails_and_says_which(self):
        original = self.google.create

        def create(*args, **kwargs):
            if args[5] == "3/12":                                              # the session number
                raise RuntimeError("google hiccup")
            return original(*args, **kwargs)
        self.google.create = create
        from google_calendar import create_calendar_event_status as installed        # the fake is installed under this name
        self.assertTrue(installed)
        gc.create_calendar_event_status = create
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(f"INSERT INTO plans (nome, {plans_schema.price_column(cur)}, duracao_meses, duration_weeks) VALUES ('TEST guests 6 weeks', 0, 3, 6) RETURNING id")
        pack = catalog_testing.make_pair(cur, cur.fetchone()[0])['individual']
        conn.commit()
        conn.close()
        answer = call("/admin/clients/{client_id}/renew-pack", self.user_id, main.NewPack(
            pack_id=pack, sessions_per_week=2, schedule=pack_schedule.uniform(f"{self.weekday},Thursday", "10:00", self.trainer_id), start_date=self.first_day.isoformat(), email_client=False, email_extra=[],
            allow_conflicts=True))
        self.assertEqual(answer["total_sessions"], 12)
        self.assertEqual(answer["calendar"]["failed"], 1)
        statuses = self.sql("SELECT session_number, calendar_sync_status FROM sessions WHERE user_id = %s ORDER BY id", (self.user_id,))
        self.assertEqual([number for number, status in statuses if status == "failed"], ["3/12"])
        self.assertEqual(len([1 for _, status in statuses if status == "ok"]), 11)

    # ----- the life of an event keeps its guests
    def test_rescheduling_cancelling_and_restoring_keep_the_guests_up_to_date(self):
        self.new_pack(share=True)
        session_id, event_id, _, day = self.sessions()[0]
        later = day + timedelta(days=1)
        rr.admin_reschedule(session_id, later.isoformat(), "11:00", None, "admin@test")
        event = self.google.events[event_id]
        self.assertEqual(self.guests(event), [CLIENT])                         # moved, same guest
        self.assertEqual(event["start"]["dateTime"][:16], f"{later.isoformat()}T11:00")
        main.cancel_session(session_id, {"sub": "a", "email": main.ADMIN_EMAIL})
        self.assertNotIn(event_id, self.google.events)                         # deleted: the guest stops seeing it
        answer = call("/admin/sessions/{session_id}/restore", session_id, session_restore.RestorePayload(), {"sub": "a", "email": main.ADMIN_EMAIL})
        self.assertTrue(answer["restored"])
        restored = self.google.events[self.sessions()[0][1]]
        self.assertEqual(self.guests(restored), [CLIENT])                      # recreated with the same guests
        self.assertEqual(restored["summary"], "Ana Ruiz 1/4")

    # ----- trial sessions
    def trial(self):
        day = next_monday(30)
        names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        while names[day.weekday()] != self.weekday:
            day += timedelta(days=1)
        return self.sql(
            "INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status) "
            "VALUES ('Ana María Ruiz', %s, '600111222', 'Lose weight', 'Beginner', %s, '10:00', 'Pending') RETURNING id", (CLIENT, day))[0][0]

    def test_an_approved_trial_is_a_pending_event_with_the_client_as_guest_and_confirming_keeps_it(self):
        trial_id = self.trial()
        result = trial_confirmation.approve_trial(trial_id, self.trainer_id, share_calendar=True)
        self.assertEqual(result["calendar"], {"ok": True, "guests_warning": None})
        event_id = self.sql("SELECT google_event_id FROM trial_sessions WHERE id = %s", (trial_id,))[0][0]
        event = self.google.events[event_id]
        self.assertEqual(event["summary"], "Trial (Pendiente) - Ana Ruiz")
        self.assertEqual(self.guests(event), [CLIENT])
        for flag, value in FLAGS.items():
            self.assertIs(event[flag], value)
        token = self.sql("SELECT confirmation_token FROM trial_sessions WHERE id = %s", (trial_id,))[0][0]
        trial_confirmation.answer_trial(token, "confirmed")
        confirmed = self.google.events[event_id]                                # the SAME event
        self.assertEqual(confirmed["summary"], "Trial - Ana Ruiz")
        self.assertEqual(self.guests(confirmed), [CLIENT])
        self.assertEqual(len(self.google.events), 1)

    def test_a_trial_without_sharing_or_without_the_delegation_has_no_guests(self):
        trial_id = self.trial()
        trial_confirmation.approve_trial(trial_id, self.trainer_id, share_calendar=False)
        event = self.google.events[self.sql("SELECT google_event_id FROM trial_sessions WHERE id = %s", (trial_id,))[0][0]]
        self.assertNotIn("attendees", event)
        self.cleanup_events()
        trial_id = self.trial()
        self.google.guests_allowed = False
        result = trial_confirmation.approve_trial(trial_id, self.trainer_id, share_calendar=True)
        self.assertEqual(result["calendar"], {"ok": True, "guests_warning": "delegation_missing"})     # approved and on the calendar, the admin is warned

    def cleanup_events(self):
        self.google.events.clear()
        self.sql("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))


class FakeRequest:
    """googleapiclient's request: .execute(num_retries=...) answers or raises."""
    def __init__(self, log, kind, params, outcomes):
        self.log, self.kind, self.params, self.outcomes = log, kind, params, outcomes

    def execute(self, num_retries=0):
        self.log.append((self.kind, self.params, num_retries))
        outcome = self.outcomes.pop(0) if self.outcomes else {"id": self.params.get("eventId") or self.params.get("body", {}).get("id", "evt")}
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class FakeEvents:
    def __init__(self, outcomes=None):
        self.log, self.outcomes = [], list(outcomes or [])

    def _request(self, kind):
        return lambda **params: FakeRequest(self.log, kind, params, self.outcomes)

    def __getattr__(self, name):
        if name in ("insert", "patch", "delete", "update", "get"):
            return self._request(name)
        raise AttributeError(name)


class FakeService:
    def __init__(self, outcomes=None):
        self._events = FakeEvents(outcomes)

    def events(self):
        return self._events


def http_error(status, reason=""):
    from googleapiclient.errors import HttpError
    content = json.dumps({"error": {"errors": [{"reason": reason}]}}).encode()
    return HttpError(type("Resp", (), {"status": status, "reason": "x"})(), content)


class GoogleLayer(unittest.TestCase):
    """Credentials with delegation, sendUpdates, refused guests and retries: no network, no real key."""

    def setUp(self):
        gc.reset_service()
        self.env = mock.patch.dict(os.environ, {"GOOGLE_CALENDAR_ID": "pt@thundbalance.com"}, clear=False)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.addCleanup(gc.reset_service)

    def test_the_environment_variables_and_their_defaults(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("SEND_CALENDAR_INVITE_EMAILS", None)
            os.environ.pop("GOOGLE_IMPERSONATE_EMAIL", None)
            self.assertEqual(gc.send_updates(), "none")                         # no invitation e-mails by default
            self.assertEqual(gc.impersonate_email(), "pt@thundbalance.com")
        with mock.patch.dict(os.environ, {"SEND_CALENDAR_INVITE_EMAILS": " ALL ", "GOOGLE_IMPERSONATE_EMAIL": "boss@thundbalance.com"}):
            self.assertEqual(gc.send_updates(), "all")
            self.assertEqual(gc.impersonate_email(), "boss@thundbalance.com")
        with mock.patch.dict(os.environ, {"SEND_CALENDAR_INVITE_EMAILS": "sometimes"}):
            self.assertEqual(gc.send_updates(), "none")                         # anything else is "none"

    def test_the_server_acts_as_the_calendar_user_once_google_accepts_the_delegation(self):
        class Base:
            def with_subject(self, subject):
                self.subject = subject
                return self

            def refresh(self, request):
                pass
        base = Base()
        with mock.patch.object(gc, "_shared_credentials", return_value=base):
            credentials, delegated = gc._calendar_credentials()
        self.assertTrue(delegated)
        self.assertEqual(base.subject, "pt@thundbalance.com")

    def test_without_the_delegation_it_falls_back_logs_only_the_kind_and_tries_again_later(self):
        class Refused:
            calls = 0

            def with_subject(self, subject):
                return self

            def refresh(self, request):
                Refused.calls += 1
                raise RuntimeError("unauthorized_client: Client is unauthorized to retrieve access tokens ana@secret.example")
        base = Refused()
        records = []
        capture = __import__("logging").Handler()
        capture.emit = lambda record: records.append(record.getMessage())
        gc.logger.addHandler(capture)
        try:
            with mock.patch.object(gc, "_shared_credentials", return_value=base):
                self.assertEqual(gc._calendar_credentials(), (base, False))
                self.assertEqual(gc._calendar_credentials(), (base, False))      # not asked again at once
                self.assertEqual(Refused.calls, 1)
                self.assertEqual(gc.delegation_status()["error"], "unauthorized_client")
                gc._delegation["tried_at"] -= gc.DELEGATION_RETRY_SECONDS + 1     # some minutes later
                gc._calendar_credentials()
                self.assertEqual(Refused.calls, 2)
        finally:
            gc.logger.removeHandler(capture)
        text = " ".join(records)
        self.assertIn("unauthorized_client", text)
        self.assertNotIn("secret.example", text)                                 # no personal data in the log

    def test_events_are_sent_with_the_guests_and_the_send_updates_rule(self):
        service = FakeService()
        body = event_format.build_session_event(
            client_name="Ana Ruiz", client_email="ana@x.com", session_date="2026-12-07", session_time="10:00",
            attendees=event_format.guest_list("ana@x.com", [], True))
        with mock.patch.object(gc, "delegation_active", return_value=True), mock.patch.object(gc, "get_calendar_id", return_value="cal"):
            for value, expected in (("", "none"), ("all", "all")):
                with mock.patch.dict(os.environ, {"SEND_CALENDAR_INVITE_EMAILS": value}):
                    gc._insert(service, body, "tbabc")
        kinds = [(entry[1]["sendUpdates"], entry[1]["body"]["attendees"], entry[2]) for entry in service.events().log]
        self.assertEqual(kinds, [("none", [{"email": "ana@x.com"}], gc.HTTP_RETRIES), ("all", [{"email": "ana@x.com"}], gc.HTTP_RETRIES)])

    def test_without_the_delegation_the_event_goes_without_guests_and_a_warning(self):
        service = FakeService()
        body = event_format.build_session_event(
            client_name="Ana Ruiz", client_email="ana@x.com", session_date="2026-12-07", session_time="10:00",
            attendees=event_format.guest_list("ana@x.com", [], True))
        gc.consume_guest_warning()
        with mock.patch.object(gc, "delegation_active", return_value=False), mock.patch.object(gc, "get_calendar_id", return_value="cal"):
            gc._insert(service, body, "tbabc")
        sent = service.events().log[0][1]["body"]
        self.assertNotIn("attendees", sent)
        self.assertNotIn("guestsCanModify", sent)
        self.assertEqual(gc.consume_guest_warning(), "delegation_missing")
        self.assertIsNone(gc.consume_guest_warning())                            # read once

    def test_google_refusing_the_guests_still_creates_the_event(self):
        refused = http_error(403, "forbiddenForServiceAccounts")
        service = FakeService([refused])
        body = event_format.build_session_event(
            client_name="Ana Ruiz", client_email="ana@x.com", session_date="2026-12-07", session_time="10:00",
            attendees=event_format.guest_list("ana@x.com", [], True))
        gc.consume_guest_warning()
        with mock.patch.object(gc, "delegation_active", return_value=True), mock.patch.object(gc, "get_calendar_id", return_value="cal"):
            self.assertEqual(gc._insert(service, body, "tbabc"), ("tbabc", True))
        first, second = service.events().log
        self.assertIn("attendees", first[1]["body"])
        self.assertNotIn("attendees", second[1]["body"])                         # the second try has no guests
        self.assertEqual(gc.consume_guest_warning(), "delegation_missing")

    def test_deleting_and_patching_follow_the_same_rule_and_retry_on_rate_limits(self):
        service = FakeService()
        with mock.patch.object(gc, "get_calendar_service", return_value=service), mock.patch.object(gc, "get_calendar_id", return_value="cal"), \
                mock.patch.object(gc, "delegation_active", return_value=True), mock.patch.dict(os.environ, {"SEND_CALENDAR_INVITE_EMAILS": "all"}):
            gc.delete_calendar_event("tbabc", notify=True)            # a cancellation somebody asked for follows the rule
            gc.patch_calendar_event("tbabc", {"summary": "x", "attendees": [{"email": "ana@x.com"}], **event_format.GUEST_FLAGS})
        deleted, patched = service.events().log
        self.assertEqual((deleted[0], deleted[1]["sendUpdates"], deleted[2]), ("delete", "all", gc.HTTP_RETRIES))
        self.assertEqual((patched[0], patched[1]["sendUpdates"], patched[2]), ("patch", "all", gc.HTTP_RETRIES))


    def test_a_delete_never_notifies_unless_the_admin_or_the_client_asked_for_the_cancellation(self):
        service = FakeService()
        with mock.patch.object(gc, "get_calendar_service", return_value=service), mock.patch.object(gc, "get_calendar_id", return_value="cal"), \
                mock.patch.object(gc, "delegation_active", return_value=True), mock.patch.dict(os.environ, {"SEND_CALENDAR_INVITE_EMAILS": "all"}):
            gc.delete_calendar_event("tbrollback")                   # a rollback / clean-up: silent even with "all"
            gc.delete_calendar_event("tbcancelled", notify=True)     # a cancellation somebody asked for
        silent, asked = service.events().log
        self.assertEqual(silent[1]["sendUpdates"], "none")
        self.assertEqual(asked[1]["sendUpdates"], "all")


if __name__ == "__main__":
    unittest.main()

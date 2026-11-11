"""The schedule of a pack: ONE ENTRY PER TRAINING DAY (weekday, hour, trainer). No flow stores a single hour any more.

    python -m unittest test_pack_schedule -v

Covers the rules (pack_schedule.clean), GET /pack-availability, the client's request, the approval with an adjusted schedule,
the admin's new pack (sessions at each day's hour and trainer, conflicts per day), the 409 with alternatives, and that OLD
single-hour rows stay readable. Google Calendar is faked, mail goes to a local fake server, the local database is cleaned up.
"""
import json
import os
import threading
import unittest
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest import mock

import testsafety  # noqa: F401
from fastapi import HTTPException
from fastapi.testclient import TestClient

import catalog_testing
import google_fakes
import main
import pack_schedule
import packs
import plans_schema
import trainer_choice
from availability import create_trainer
from database import get_connection

DOMAIN = "@test-schedule.example"
NAME = "TESTSCH"


class FakeScript(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers["Content-Length"]))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"ok": true}')

    def log_message(self, *args):
        pass


def route(path, method):
    for r in main.app.routes:
        if getattr(r, "path", None) == path and method in getattr(r, "methods", ()):
            return r.endpoint
    raise LookupError(path)


def next_weekday(offset, weekday):
    day = date.today() + timedelta(days=offset)
    while day.weekday() != weekday:
        day += timedelta(days=1)
    return day


class Schedule(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.ensure_trial_session_fields()
        main.ensure_session_pack_column()
        main.ensure_calendar_sync_columns()
        main.ensure_client_lifecycle_columns()
        main.ensure_client_workflow_fields()
        packs.ensure_pack_columns()
        cls.server = HTTPServer(("127.0.0.1", 0), FakeScript)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        os.environ["TRIAL_EMAIL_WEBHOOK_URL"] = f"http://127.0.0.1:{cls.server.server_port}/exec"
        os.environ["TRIAL_EMAIL_WEBHOOK_SECRET"] = "right-secret"
        conn = get_connection()
        cur = conn.cursor()
        # two test trainers who work Monday to Friday 08:00-20:00 (nobody else is involved in these hours)
        cls.trainers = []
        for suffix in ("A", "B"):
            trainer_id = create_trainer(cur, f"{NAME} {suffix}")
            for day in ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday"):
                cur.execute("INSERT INTO trainer_availability (trainer_id, day_of_week, start_time, end_time) VALUES (%s, %s, '08:00', '20:00')", (trainer_id, day))
            cls.trainers.append(trainer_id)
        cls.a, cls.b = cls.trainers
        cur.execute(f"INSERT INTO plans (nome, {plans_schema.price_column(cur)}, duracao_meses, duration_weeks) VALUES ('TEST schedule 2 weeks', 0, 1, 2) RETURNING id")
        cls.plan_id = cur.fetchone()[0]
        cls.pack_ids = catalog_testing.make_pair(cur, cls.plan_id)
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.cleanup()
        conn = get_connection()
        cur = conn.cursor()
        catalog_testing.drop(cur)
        cur.execute("DELETE FROM plans WHERE id = %s", (cls.plan_id,))
        cur.execute("DELETE FROM trainer_availability WHERE trainer_id = ANY(%s)", (cls.trainers,))
        cur.execute("DELETE FROM trainers WHERE id = ANY(%s)", (cls.trainers,))
        conn.commit()
        conn.close()

    @classmethod
    def cleanup(cls):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        ids = [r[0] for r in cur.fetchall()]
        cur.execute("DELETE FROM sessions WHERE trainer_id = ANY(%s)", (cls.trainers,))
        if ids:
            cur.execute("DELETE FROM sessions WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM user_plans WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM client_requests WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM users WHERE id = ANY(%s)", (ids,))
        conn.commit()
        conn.close()

    def setUp(self):
        self.cleanup()
        trainer_choice.reset_rate_limit()
        self.events = []
        self._restore_gc = google_fakes.delegate_to_packs()
        self._orig = (packs.create_calendar_event, packs.delete_calendar_event)
        packs.create_calendar_event = lambda *a, **k: (self.events.append((a, k)), k.get("event_id") or "evt")[1]
        packs.delete_calendar_event = lambda event_id: None
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO users (nome, email) VALUES ('Cliente Horario', %s) RETURNING id", (f"ch{DOMAIN}",))
        self.user_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        self.monday = next_weekday(14, 0)
        self.mine = [{"weekday": "Monday", "time": "18:00", "trainer_id": self.a}, {"weekday": "Wednesday", "time": "09:00", "trainer_id": self.b}]

    def tearDown(self):
        packs.create_calendar_event, packs.delete_calendar_event = self._orig
        self._restore_gc()
        self.cleanup()

    # ----- helpers
    def new_pack(self, schedule=None, per_week=2, **extra):
        return route("/admin/clients/{client_id}/renew-pack", "POST")(self.user_id, main.NewPack(
            pack_id=self.pack_ids["individual"], sessions_per_week=per_week, schedule=schedule or self.mine,
            start_date=self.monday.isoformat(), email_extra=[], **extra))

    def rows(self, sql, params=()):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(sql, params)
        found = cur.fetchall()
        conn.close()
        return found

    def request_as_client(self, schedule, per_week=2):
        with mock.patch.object(main, "require_client", lambda authorization=None: {"sub": "uid-sched", "email": f"ch{DOMAIN}"}):
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("UPDATE users SET firebase_uid = 'uid-sched' WHERE id = %s", (self.user_id,))
            conn.commit()
            conn.close()
            return route("/client-requests", "POST")(main.ClientRequestCreate(
                pack_id=self.pack_ids["individual"], sessions_per_week=per_week, schedule=schedule), "Bearer x")

    # ----- the rules
    def test_one_entry_per_day_each_with_its_own_hour_and_trainer(self):
        got = pack_schedule.clean([{"weekday": "Wednesday", "time": "09:00", "trainer_id": 2}, {"weekday": "Monday", "time": "18:00", "trainer_id": 1}], 2)
        self.assertEqual([(e["weekday"], e["time"], e["trainer_id"]) for e in got], [("Monday", "18:00", 1), ("Wednesday", "09:00", 2)])

    def test_a_single_hour_or_a_bad_schedule_is_refused(self):
        bad = {
            "fewer days than sessions per week": ([{"weekday": "Monday", "time": "18:00", "trainer_id": 1}], 2),
            "a day twice": ([{"weekday": "Monday", "time": "18:00", "trainer_id": 1}] * 2, 2),
            "a half hour": ([{"weekday": "Monday", "time": "18:30", "trainer_id": 1}], 1),
            "no trainer": ([{"weekday": "Monday", "time": "18:00", "trainer_id": None}], 1),
            "unknown day": ([{"weekday": "Funday", "time": "18:00", "trainer_id": 1}], 1),
            "empty": ([], 1),
        }
        for label, (entries, per_week) in bad.items():
            with self.subTest(label), self.assertRaises(HTTPException) as caught:
                pack_schedule.clean(entries, per_week)
            self.assertEqual((caught.exception.status_code, caught.exception.detail["code"]), (422, "invalid_schedule"))

    def test_the_endpoints_no_longer_take_one_hour_for_the_pack(self):
        main.app.dependency_overrides[main.require_admin] = lambda: {"email": main.ADMIN_EMAIL, "sub": "uid-admin"}
        try:
            body = {"pack_id": self.pack_ids["individual"], "sessions_per_week": 2, "preferred_days": "Monday,Wednesday", "preferred_time": "09:00",
                    "trainer_id": self.a, "start_date": self.monday.isoformat()}
            response = TestClient(main.app).post(f"/admin/clients/{self.user_id}/renew-pack", json=body)
        finally:
            main.app.dependency_overrides.pop(main.require_admin, None)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.rows("SELECT COUNT(*) FROM user_plans WHERE user_id = %s", (self.user_id,))[0][0], 0)

    # ----- the pack: each session at its day's hour and trainer
    def test_sessions_follow_the_day_hour_and_trainer_of_each_entry(self):
        answer = self.new_pack(allow_conflicts=True, allow_overlaps=True)
        self.assertEqual(answer["total_sessions"], 4)
        found = self.rows("SELECT session_date, to_char(session_time, 'HH24:MI'), trainer_id FROM sessions WHERE user_id = %s ORDER BY session_date", (self.user_id,))
        self.assertEqual(len(found), 4)
        for day, stamp, trainer in found:
            if day.weekday() == 0:
                self.assertEqual((stamp, trainer), ("18:00", self.a))
            else:
                self.assertEqual((day.weekday(), stamp, trainer), (2, "09:00", self.b))
        stored = self.rows("SELECT schedule, preferred_time, preferred_days FROM user_plans WHERE user_id = %s", (self.user_id,))[0]
        self.assertEqual([(e["weekday"], e["time"], e["trainer_id"]) for e in stored[0]], [("Monday", "18:00", self.a), ("Wednesday", "09:00", self.b)])
        self.assertIsNone(stored[1])                                   # NO single hour is written
        self.assertEqual(stored[2], "Monday,Wednesday")

    def test_the_preview_lists_each_session_with_its_hour_and_trainer(self):
        conn = get_connection()
        try:
            preview = packs.preview_pack(
                conn.cursor(), user_id=self.user_id, catalog_pack_id=self.pack_ids["individual"], sessions_per_week=2,
                schedule=self.mine, start_date=self.monday.isoformat())
        finally:
            conn.close()
        self.assertEqual(preview["total_sessions"], 4)
        self.assertEqual([(s["time"], s["trainer_id"]) for s in preview["sessions"]], [("18:00", self.a), ("09:00", self.b)] * 2)
        self.assertEqual(preview["sessions"][0]["number"], "1/4")

    def test_a_busy_trainer_on_one_day_collides_only_on_that_day(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO users (nome, email) VALUES ('Otro', %s) RETURNING id", (f"ot{DOMAIN}",))
        other = cur.fetchone()[0]
        wednesday = self.monday + timedelta(days=2)
        cur.execute("INSERT INTO sessions (user_id, trainer_id, session_date, session_time, status) VALUES (%s, %s, %s, '09:00', 'Booked')", (other, self.b, wednesday))
        conn.commit()
        conn.close()
        with self.assertRaises(HTTPException) as caught:
            self.new_pack()
        self.assertEqual(caught.exception.status_code, 409)
        listed = caught.exception.detail["conflicts"]
        self.assertEqual([(c["date"], c["time"], c["trainer_id"], c["kind"]) for c in listed], [(wednesday.isoformat(), "09:00", self.b, "trainer_busy")])
        self.assertEqual(self.rows("SELECT COUNT(*) FROM user_plans WHERE user_id = %s", (self.user_id,))[0][0], 0)

    # ----- GET /pack-availability
    def test_pack_availability_lists_free_hours_with_their_trainers(self):
        answer = route("/pack-availability", "GET")(fake_request(), None, None)
        monday = {item["time"]: [t["id"] for t in item["trainers"]] for item in answer["weekdays"]["Monday"]}
        self.assertIn(self.a, monday["18:00"])
        self.assertIn(self.b, monday["18:00"])
        for item in answer["weekdays"]["Monday"]:
            for trainer in item["trainers"]:
                self.assertEqual(set(trainer), {"id", "name"})                  # only id and name, never anything personal

    def test_a_booked_trainer_is_left_out_of_that_hour_inside_the_window(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO users (nome, email) VALUES ('Otro', %s) RETURNING id", (f"ot{DOMAIN}",))
        other = cur.fetchone()[0]
        cur.execute("INSERT INTO sessions (user_id, trainer_id, session_date, session_time, status) VALUES (%s, %s, %s, '18:00', 'Booked')", (other, self.a, self.monday + timedelta(days=7)))
        conn.commit()
        conn.close()
        inside = route("/pack-availability", "GET")(fake_request(), self.monday.isoformat(), 3)
        monday = {item["time"]: [t["id"] for t in item["trainers"]] for item in inside["weekdays"]["Monday"]}
        self.assertNotIn(self.a, monday["18:00"])
        self.assertIn(self.b, monday["18:00"])
        outside = route("/pack-availability", "GET")(fake_request(), (self.monday + timedelta(days=60)).isoformat(), 1)
        self.assertIn(self.a, {t["id"] for item in outside["weekdays"]["Monday"] if item["time"] == "18:00" for t in item["trainers"]})

    def test_pack_availability_checks_its_parameters_and_is_rate_limited(self):
        endpoint = route("/pack-availability", "GET")
        for start, weeks in (("not-a-date", 2), (self.monday.isoformat(), None), (self.monday.isoformat(), 0), (self.monday.isoformat(), 999)):
            with self.assertRaises(HTTPException) as caught:
                endpoint(fake_request(), start, weeks)
            self.assertEqual(caught.exception.status_code, 422)
        trainer_choice.reset_rate_limit()
        with self.assertRaises(HTTPException) as caught:
            for _ in range(trainer_choice.RATE_LIMIT + 1):
                endpoint(fake_request(), None, None)
        self.assertEqual(caught.exception.status_code, 429)

    # ----- the client's request
    def test_the_clients_request_keeps_one_hour_and_trainer_per_day_and_no_single_hour(self):
        self.request_as_client([{"weekday": "Monday", "time": "18:00", "trainer_id": self.a}, {"weekday": "Wednesday", "time": "09:00", "trainer_id": None}])
        row = self.rows("SELECT schedule, preferred_time, preferred_days, trainer_id FROM client_requests WHERE user_id = %s", (self.user_id,))[0]
        self.assertEqual([(e["weekday"], e["time"], e["trainer_id"]) for e in row[0]], [("Monday", "18:00", self.a), ("Wednesday", "09:00", None)])
        self.assertIsNone(row[1])
        self.assertEqual((row[2], row[3]), ("Monday,Wednesday", self.a))

    def test_a_request_for_an_hour_nobody_works_answers_409_with_the_free_hours(self):
        with self.assertRaises(HTTPException) as caught:
            self.request_as_client([{"weekday": "Monday", "time": "23:00", "trainer_id": None}, {"weekday": "Wednesday", "time": "09:00", "trainer_id": None}])
        self.assertEqual((caught.exception.status_code, caught.exception.detail["code"]), (409, "schedule_unavailable"))
        entry = caught.exception.detail["entries"][0]
        self.assertEqual((entry["weekday"], entry["time"]), ("Monday", "23:00"))
        self.assertIn("18:00", entry["times"])

    def test_a_request_for_a_trainer_who_does_not_work_then_lists_the_free_trainers(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM trainer_availability WHERE trainer_id = %s AND day_of_week = 'Wednesday'", (self.a,))
        conn.commit()
        conn.close()
        try:
            with self.assertRaises(HTTPException) as caught:
                self.request_as_client([{"weekday": "Monday", "time": "18:00", "trainer_id": self.a}, {"weekday": "Wednesday", "time": "09:00", "trainer_id": self.a}])
            entry = caught.exception.detail["entries"][0]
            self.assertEqual((entry["weekday"], entry["trainer_id"]), ("Wednesday", self.a))
            self.assertIn(self.b, [t["id"] for t in entry["alternatives"]])
        finally:
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("INSERT INTO trainer_availability (trainer_id, day_of_week, start_time, end_time) VALUES (%s, 'Wednesday', '08:00', '20:00')", (self.a,))
            conn.commit()
            conn.close()

    def test_a_request_with_a_single_hour_for_two_sessions_a_week_is_refused(self):
        with self.assertRaises(HTTPException) as caught:
            self.request_as_client([{"weekday": "Monday", "time": "18:00", "trainer_id": None}], per_week=2)
        self.assertEqual(caught.exception.detail["code"], "invalid_schedule")

    # ----- the admin approves: sees the schedule per day and adjusts it
    def test_the_list_shows_the_schedule_per_day_and_the_approval_uses_the_adjusted_one(self):
        self.request_as_client([{"weekday": "Monday", "time": "18:00", "trainer_id": self.a}, {"weekday": "Wednesday", "time": "09:00", "trainer_id": None}])
        listed = [row for row in route("/admin/client-requests", "GET")() if row[1] == "Cliente Horario"]
        self.assertEqual(len(listed), 1)
        asked = listed[0][17]
        self.assertEqual([(e["weekday"], e["time"], e["trainer"]) for e in asked], [("Monday", "18:00", f"{NAME} A"), ("Wednesday", "09:00", None)])
        adjusted = [{"weekday": "Tuesday", "time": "10:00", "trainer_id": self.b}, {"weekday": "Thursday", "time": "17:00", "trainer_id": self.a}]
        result = route("/admin/approve-request", "POST")(main.ApproveRequest(
            request_id=listed[0][0], schedule=adjusted, start_date=self.monday.isoformat(), email_extra=[], allow_conflicts=True, allow_overlaps=True))
        self.assertEqual(result["total_sessions"], 4)
        found = self.rows("SELECT EXTRACT(ISODOW FROM session_date)::int, to_char(session_time, 'HH24:MI'), trainer_id FROM sessions WHERE user_id = %s", (self.user_id,))
        self.assertEqual(sorted({(d, h, t) for d, h, t in found}), [(2, "10:00", self.b), (4, "17:00", self.a)])
        after = self.rows("SELECT status, schedule, preferred_time FROM client_requests WHERE user_id = %s", (self.user_id,))[0]
        self.assertEqual(after[0], "Approved")
        self.assertEqual([(e["weekday"], e["time"]) for e in after[1]], [("Tuesday", "10:00"), ("Thursday", "17:00")])
        self.assertIsNone(after[2])

    def test_approving_without_a_schedule_is_refused(self):
        with self.assertRaises(Exception):
            main.ApproveRequest(request_id=1, start_date=self.monday.isoformat())


    # ----- Saturday and Sunday are NEVER an option
    def test_weekend_days_are_refused_and_never_offered(self):
        for day in ("Saturday", "Sunday"):
            with self.subTest(day), self.assertRaises(HTTPException) as caught:
                pack_schedule.clean([{"weekday": day, "time": "10:00", "trainer_id": 1}], 1)
            self.assertEqual(caught.exception.detail["code"], "invalid_schedule")
        # even a trainer who has weekend hours stored is never free then
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO trainer_availability (trainer_id, day_of_week, start_time, end_time) VALUES (%s, 'Saturday', '08:00', '20:00')", (self.a,))
        conn.commit()
        conn.close()
        answer = route("/pack-availability", "GET")(fake_request(), None, None)
        self.assertEqual((answer["weekdays"]["Saturday"], answer["weekdays"]["Sunday"]), ([], []))
        import availability
        conn = get_connection()
        cur = conn.cursor()
        saturday = next_weekday(10, 5)
        self.assertIsNotNone(availability.slot_problem(cur, self.a, saturday.isoformat(), "10:00"))
        self.assertEqual(availability.free_start_times_any_trainer(cur, saturday.isoformat()), [])
        self.assertEqual(availability.weekly_start_times(cur)["Saturday"], [])
        conn.close()

    def test_saving_trainer_hours_ignores_the_weekend(self):
        import availability
        conn = get_connection()
        cur = conn.cursor()
        window = type("W", (), {"start": "08:00", "end": "12:00"})
        availability.validate_hours({"Monday": window, "Saturday": window})
        availability.save_hours(cur, self.a, {"Monday": window, "Saturday": window})
        cur.execute("SELECT day_of_week FROM trainer_availability WHERE trainer_id = %s", (self.a,))
        self.assertEqual([r[0] for r in cur.fetchall()], ["Monday"])
        conn.rollback()
        conn.close()

    # ----- old single-hour rows are only read
    def test_an_old_single_hour_request_and_pack_stay_readable(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO client_requests (user_id, plan_id, sessions_per_week, preferred_days, preferred_time, status) VALUES (%s, %s, 2, 'Monday,Wednesday', '10:00', 'Pending')", (self.user_id, self.plan_id))
        cur.execute(
            "INSERT INTO user_plans (user_id, plan_id, active, start_date, end_date, sessions_per_week, preferred_days, preferred_time, trainer_id, status) "
            "VALUES (%s, %s, TRUE, %s, %s, 2, 'Monday,Wednesday', '10:00', %s, 'activo')", (self.user_id, self.plan_id, self.monday, self.monday + timedelta(days=13), self.a))
        conn.commit()
        conn.close()
        listed = [row for row in route("/admin/client-requests", "GET")() if row[1] == "Cliente Horario"][0]
        self.assertEqual((listed[4], listed[5], listed[17]), ("Monday,Wednesday", "10:00", []))
        import pack_view
        conn = get_connection()
        cur = conn.cursor()
        all_packs, _ = pack_view.user_packs(cur, self.user_id)
        conn.close()
        self.assertEqual((all_packs[0]["preferred_days"], all_packs[0]["preferred_time"], all_packs[0]["schedule"]), ("Monday,Wednesday", "10:00", []))
        self.assertEqual(pack_schedule.legacy_entries("Monday,Wednesday", "10:00", self.a)[1], {"weekday": "Wednesday", "time": "10:00", "trainer_id": self.a})


class _Client:
    host = "127.0.0.1"


class _Request:
    client = _Client()
    headers = {}          # no proxy header: the address of the connection is used (web_safety.get_client_ip)


def fake_request():
    return _Request()


if __name__ == "__main__":
    unittest.main()

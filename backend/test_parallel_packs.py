"""Several active packs per client: buying a new pack never touches the packs the client already has; each one runs and
counts on its own (x/y of that pack). Also any start date, trainer conflicts (they block) and the client's own sessions at
the same time (allowed after a warning):

    python -m unittest test_parallel_packs -v

Google Mail is a local fake server, the Google Calendar is faked. The local database is used and cleaned up.
"""
import pack_schedule
import base64
import os
import json
import threading
import unittest

import catalog_testing

import plans_schema
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer

from fastapi import HTTPException

import admin_api
import main
import google_fakes
import packs
from database import get_connection

os.environ["CLIENT_CALENDAR_ENABLED"] = "true"      # these tests look at the calendar parts of the emails

DOMAIN = "@test-packs.example"
RECEIVED = []


class FakeScript(BaseHTTPRequestHandler):
    def do_POST(self):
        RECEIVED.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
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


class Parallel(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import os
        main.ensure_trial_session_fields()
        main.ensure_session_pack_column()
        main.ensure_calendar_sync_columns()
        main.ensure_client_lifecycle_columns()
        main.ensure_client_workflow_fields()
        cls.server = HTTPServer(("127.0.0.1", 0), FakeScript)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        os.environ["TRIAL_EMAIL_WEBHOOK_URL"] = f"http://127.0.0.1:{cls.server.server_port}/exec"
        os.environ["TRIAL_EMAIL_WEBHOOK_SECRET"] = "right-secret"
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active AND nome IN ('Guille','Matilda') ORDER BY id")
        rows = cur.fetchall()
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 1")
        cls.trainer_id = (rows[0] if rows else cur.fetchone())[0]
        cls.other_trainer_id = rows[1][0] if len(rows) > 1 else cls.trainer_id
        cur.execute(f"INSERT INTO plans (nome, {plans_schema.price_column(cur)}, duracao_meses, duration_weeks) VALUES ('TEST parallel 2 weeks', 0, 1, 2) RETURNING id")
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
        conn.commit()
        conn.close()

    @classmethod
    def cleanup(cls):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        ids = [r[0] for r in cur.fetchall()]
        if ids:
            cur.execute("DELETE FROM sessions WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM user_plans WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM client_requests WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM users WHERE id = ANY(%s)", (ids,))
        conn.commit()
        conn.close()

    def setUp(self):
        RECEIVED.clear()
        self.cleanup()
        self.events = []
        self.deleted = []
        self._restore_gc = google_fakes.delegate_to_packs()
        self._orig = (packs.create_calendar_event, packs.delete_calendar_event)
        packs.create_calendar_event = lambda *a, **k: (self.events.append((a, k)), k.get("event_id") or "evt")[1]
        packs.delete_calendar_event = lambda event_id: self.deleted.append(event_id)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO users (nome, email) VALUES ('Henrique Paralelo', %s) RETURNING id", (f"hp{DOMAIN}",))
        self.user_id = cur.fetchone()[0]
        conn.commit()
        conn.close()

    def tearDown(self):
        packs.create_calendar_event, packs.delete_calendar_event = self._orig
        self._restore_gc()
        self.cleanup()

    # ----- helpers
    def renew(self, *, per_week, days, start, time="09:00", allow=False, trainer=None, extra=None, overlaps=False):
        return route("/admin/clients/{client_id}/renew-pack", "POST")(self.user_id, main.NewPack(
            pack_id=self.pack_ids["individual"], sessions_per_week=per_week, schedule=pack_schedule.uniform(days, time, trainer or self.trainer_id), start_date=start.isoformat(),
            email_extra=extra if extra is not None else [], allow_conflicts=allow, allow_overlaps=overlaps))

    def add_session(self, day, time="09:00", status="Booked"):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO sessions (user_id, trainer_id, session_date, session_time, status, session_number) "
            "VALUES (%s, %s, %s, %s, %s, '1/1') RETURNING id", (self.user_id, self.trainer_id, day, time, status))
        session_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        return session_id

    def plans_rows(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id, active, start_date, end_date, sessions_per_week FROM user_plans WHERE user_id = %s ORDER BY id", (self.user_id,))
        rows = cur.fetchall()
        conn.close()
        return rows

    def sessions_rows(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id, session_date, session_time, status, user_plan_id, session_number FROM sessions WHERE user_id = %s ORDER BY session_date, session_time, id", (self.user_id,))
        rows = cur.fetchall()
        conn.close()
        return rows

    def detail(self):
        return route("/admin/clients/{client_id}", "GET")(self.user_id)

    # ----- several active packs: the new one does not touch the previous ones
    def test_a_second_pack_leaves_the_first_one_alone_and_both_stay_active(self):
        monday = next_weekday(14, 0)
        first = self.renew(per_week=1, days="Monday", start=monday)
        self.assertEqual(first["total_sessions"], 2)
        sessions_before = self.sessions_rows()

        second = self.renew(per_week=2, days="Tuesday,Thursday", start=monday, time="10:00")      # starts the same day
        self.assertEqual(second["total_sessions"], 4)
        self.assertEqual(second["calendar"], {"failed": 0, "errors": [], "guests_warning": None})

        plans_after = self.plans_rows()
        self.assertEqual([row[1] for row in plans_after], [True, True])        # BOTH active
        first_pack = plans_after[0][0]
        old = [r for r in self.sessions_rows() if r[4] == first_pack]
        self.assertEqual([(r[3], r[5]) for r in old], [("Booked", "1/2"), ("Booked", "2/2")])      # untouched
        self.assertEqual(old, [r for r in sessions_before if r[4] == first_pack])
        self.assertEqual(self.deleted, [])                                     # no calendar event was deleted
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT status, replaced_at FROM user_plans WHERE user_id = %s ORDER BY id", (self.user_id,))
        self.assertEqual(cur.fetchall(), [("activo", None), ("activo", None)])  # nothing is "replaced" any more
        conn.close()

    def test_each_pack_counts_its_own_x_of_y_and_the_record_shows_both(self):
        monday = next_weekday(14, 0)
        self.renew(per_week=1, days="Monday", start=monday)
        self.renew(per_week=2, days="Tuesday,Thursday", start=monday + timedelta(days=7), time="10:00")

        detail = self.detail()
        cards = [p for p in detail["packs"] if p["shown"]]
        self.assertEqual(len(cards), 2)
        old, new = cards
        self.assertEqual((old["active"], new["active"]), (True, True))
        self.assertEqual([(p["total"], p["done"], p["remaining"]) for p in cards], [(2, 0, 2), (4, 0, 4)])
        self.assertEqual(sum(p["total"] for p in cards), len([s for s in detail["sessions"] if s["status"] != "Cancelled"]))
        self.assertEqual(detail["pack"]["id"], new["id"])                   # the newest card is the default of "Nuevo pack"
        numbers = {}
        for session in detail["sessions"]:
            numbers.setdefault(session["pack_id"], []).append(session["number"])
        self.assertEqual(sorted(numbers[old["id"]]), ["1/2", "2/2"])         # y is the total of THAT pack
        self.assertEqual(sorted(numbers[new["id"]]), ["1/4", "2/4", "3/4", "4/4"])

        listed = next(c for c in route("/admin/clients", "GET")() if c["id"] == self.user_id)
        self.assertEqual(listed["packs_active"], 2)
        self.assertEqual(listed["next_session"], monday.isoformat())

    def test_a_pack_that_ran_its_course_is_not_active_and_a_client_with_any_active_pack_is(self):
        import pack_view
        monday = next_weekday(14, 0)
        self.renew(per_week=1, days="Monday", start=monday)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("UPDATE sessions SET session_date = session_date - 60 WHERE user_id = %s", (self.user_id,))
        cur.execute("UPDATE user_plans SET start_date = start_date - 60, end_date = end_date - 60 WHERE user_id = %s", (self.user_id,))
        conn.commit()
        self.assertFalse(pack_view.has_active_pack(cur, self.user_id))          # all its sessions are in the past
        conn.close()
        self.renew(per_week=1, days="Wednesday", start=monday, time="10:00")
        conn = get_connection()
        cur = conn.cursor()
        self.assertTrue(pack_view.has_active_pack(cur, self.user_id))           # ANY active pack makes the client active
        self.assertEqual(sum(1 for p in pack_view.user_packs(cur, self.user_id)[0] if p["is_active"]), 1)
        conn.close()
        self.assertEqual(next(c for c in route("/admin/clients", "GET")() if c["id"] == self.user_id)["packs_active"], 1)

    def test_new_events_use_the_name_format_and_the_pack_name(self):
        monday = next_weekday(14, 0)
        self.renew(per_week=1, days="Monday", start=monday)
        args, kwargs = self.events[0]
        self.assertEqual(args[1], "Henrique Paralelo")                        # the client's profile name
        self.assertEqual(args[5], "1/2")                                      # x/n, fixed at creation
        self.assertEqual(kwargs["pack_name"], "TEST parallel 2 weeks")
        self.assertIn("client_phone", kwargs)
        import event_format
        self.assertEqual(event_format.session_title("Henrique Paralelo", args[5]), "Henrique Paralelo 1/2")

    def test_the_client_dashboard_counts_the_sessions_of_every_active_pack(self):
        monday = next_weekday(14, 0)
        self.renew(per_week=1, days="Monday", start=monday)
        self.renew(per_week=2, days="Tuesday,Thursday", start=monday + timedelta(days=7), time="10:00")
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("UPDATE users SET firebase_uid = 'uid-hp' WHERE id = %s", (self.user_id,))
        conn.commit()
        conn.close()

        real = main.require_client
        main.require_client = lambda authorization: {"sub": "uid-hp", "email": f"hp{DOMAIN}"}
        try:
            workflow = main.client_workflow(authorization="Bearer test")
        finally:
            main.require_client = real

        self.assertEqual(workflow["state"], "active")
        self.assertEqual(len(workflow["plans"]), 2)                          # one card per active pack
        self.assertEqual(sorted((p["done"], p["remaining"], p["total"]) for p in workflow["plans"]), [(0, 2, 2), (0, 4, 4)])
        self.assertEqual(workflow["sessions_remaining"], 6)                  # 2 of the first pack + 4 of the second
        self.assertEqual(len([x for x in workflow["sessions"] if x["status"] != "Cancelled"]), 6)
        pack_ids = {p["id"] for p in workflow["plans"]}
        self.assertEqual({x["pack_id"] for x in workflow["sessions"]}, pack_ids)       # every session says which pack it is
        self.assertEqual(workflow["sessions"][0]["date"], monday.isoformat())

    def test_the_clients_session_list_says_which_pack_each_session_belongs_to(self):
        monday = next_weekday(14, 0)
        self.renew(per_week=1, days="Monday", start=monday)
        self.renew(per_week=2, days="Tuesday,Thursday", start=monday, time="10:00")
        # the admin may read any client's list (the same call the client's own page makes with their token)
        rows = main.get_user_sessions(self.user_id, claims={"email": main.ADMIN_EMAIL, "sub": "uid-admin"})
        self.assertEqual(len(rows), 6)
        by_pack = {}
        for row in rows:
            by_pack.setdefault((row[7], row[8]), []).append(row[6])                  # (pack id, pack name) -> numbers
        self.assertEqual(len(by_pack), 2)
        self.assertEqual({name for _, name in by_pack}, {"TEST parallel 2 weeks"})
        self.assertEqual(sorted(sorted(numbers) for numbers in by_pack.values()),
                         [["1/2", "2/2"], ["1/4", "2/4", "3/4", "4/4"]])                # each pack counts its own x/y

    # ----- any start date
    def test_the_start_date_can_be_today_or_in_the_past(self):
        today = date.today()
        # the Monday of last week (past), no refusal: the panel asks the human first
        past = today - timedelta(days=today.weekday() + 7)
        result = self.renew(per_week=1, days="Monday", start=past)
        self.assertEqual(result["start_date"], past.isoformat())
        today_result = self.renew(per_week=1, days=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][today.weekday()],
                                  start=today, time="11:00", trainer=self.other_trainer_id,
                                  allow=True)             # the point is the date; today may be a weekend
        self.assertEqual(today_result["start_date"], today.isoformat())

    def test_a_start_inside_the_current_pack_is_not_refused(self):
        monday = next_weekday(14, 0)
        self.renew(per_week=1, days="Monday", start=monday)
        inside = monday + timedelta(days=2)                              # a Wednesday, inside the period
        result = self.renew(per_week=1, days="Wednesday", start=inside, time="12:00")
        self.assertEqual(result["start_date"], inside.isoformat())
        self.assertEqual(len(self.plans_rows()), 2)

    def test_approving_a_request_adds_a_pack_and_leaves_the_current_one(self):
        monday = next_weekday(14, 0)
        self.renew(per_week=1, days="Monday", start=monday)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO client_requests (user_id, plan_id, catalog_pack_id, sessions_per_week, preferred_days, preferred_time, status) "
            "VALUES (%s, %s, %s, 1, 'Wednesday', '15:00', 'Pending') RETURNING id", (self.user_id, self.plan_id, self.pack_ids["individual"]))
        request_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        route("/admin/approve-request", "POST")(main.ApproveRequest(
            request_id=request_id, schedule=pack_schedule.uniform("Wednesday", "15:00", self.trainer_id), start_date=(monday + timedelta(days=2)).isoformat(), email_extra=[]))
        self.assertEqual([r[1] for r in self.plans_rows()], [True, True])
        self.assertEqual(sum(1 for r in self.sessions_rows() if r[3] == "Booked"), 4)       # 2 + 2, none cancelled

    def test_a_client_with_an_active_pack_can_ask_for_another_one(self):
        monday = next_weekday(14, 0)
        self.renew(per_week=1, days="Monday", start=monday)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("UPDATE users SET firebase_uid = 'uid-hp' WHERE id = %s", (self.user_id,))
        conn.commit()
        conn.close()
        from unittest import mock
        with mock.patch.object(main, "require_client", lambda authorization=None: {"sub": "uid-hp", "email": f"hp{DOMAIN}"}):
            main.create_client_request(main.ClientRequestCreate(
                pack_id=self.pack_ids["individual"], sessions_per_week=1, schedule=pack_schedule.uniform("Wednesday", "09:00", None)), "Bearer x")
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM client_requests WHERE user_id = %s AND LOWER(status) = 'pending'", (self.user_id,))
        self.assertEqual(cur.fetchone()[0], 1)
        conn.close()

    # ----- conflicts
    def free_the_trainer(self):
        """The existing sessions of the client stay, but no trainer holds them: only the CLIENT is then busy at that hour."""
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("UPDATE sessions SET trainer_id = NULL WHERE user_id = %s", (self.user_id,))
        conn.commit()
        conn.close()

    def test_two_sessions_of_the_client_at_the_same_time_are_allowed_after_a_warning(self):
        monday = next_weekday(14, 0)
        self.renew(per_week=1, days="Monday", start=monday)             # Mondays 09:00 (pack A)
        self.free_the_trainer()
        plans_before, sessions_before = self.plans_rows(), self.sessions_rows()

        with self.assertRaises(HTTPException) as caught:                # pack B at the same day and hour
            self.renew(per_week=1, days="Monday", start=monday)
        self.assertEqual(caught.exception.status_code, 409)
        detail = caught.exception.detail
        self.assertEqual(detail["code"], "client_overlap")
        self.assertEqual([(o["date"], o["time"], o["kind"], o["pack"]) for o in detail["overlaps"]],
                         [(monday.isoformat(), "09:00", "client_busy", "TEST parallel 2 weeks"),
                          ((monday + timedelta(days=7)).isoformat(), "09:00", "client_busy", "TEST parallel 2 weeks")])
        self.assertEqual((self.plans_rows(), self.sessions_rows()), (plans_before, sessions_before))   # nothing silently created

        result = self.renew(per_week=1, days="Monday", start=monday, overlaps=True)       # "Continuar igualmente"
        self.assertEqual(result["total_sessions"], 2)
        same_slot = [r for r in self.sessions_rows() if r[1] == monday]
        self.assertEqual(len(same_slot), 2)                             # two sessions the same day and hour, on purpose
        self.assertEqual({r[3] for r in same_slot}, {"Booked"})

    def test_a_session_without_a_pack_also_warns_and_names_no_pack(self):
        today = date.today()
        past_monday = today - timedelta(days=today.weekday() + 7)       # a session that already happened, trainer-less
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO sessions (user_id, session_date, session_time, status, session_number) VALUES (%s, %s, '09:00', 'Booked', '1/1')",
                    (self.user_id, past_monday))
        conn.commit()
        conn.close()
        with self.assertRaises(HTTPException) as caught:
            self.renew(per_week=1, days="Monday", start=past_monday)
        self.assertEqual(caught.exception.detail["code"], "client_overlap")
        self.assertEqual(caught.exception.detail["overlaps"][0]["pack"], "")

    def test_the_trainer_conflicts_still_block_and_the_overlap_warning_does_not_override_them(self):
        monday = next_weekday(14, 0)
        self.renew(per_week=1, days="Monday", start=monday)             # the trainer is now busy on Mondays 09:00
        with self.assertRaises(HTTPException) as caught:
            self.renew(per_week=1, days="Monday", start=monday, overlaps=True)       # the client's overlap is accepted, the trainer's is not
        self.assertEqual(caught.exception.detail["code"], "conflicts")
        self.assertEqual({c["kind"] for c in caught.exception.detail["conflicts"]}, {"trainer_busy"})
        result = self.renew(per_week=1, days="Monday", start=monday, allow=True, overlaps=True)   # both confirmed
        self.assertEqual(result["total_sessions"], 2)

    def test_trainer_busy_and_trainer_hours_are_told_apart(self):
        monday = next_weekday(14, 0)
        # another client takes the trainer on Monday 09:00
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO users (nome, email) VALUES ('Otro Cliente', %s) RETURNING id", (f"other{DOMAIN}",))
        other = cur.fetchone()[0]
        cur.execute("INSERT INTO sessions (user_id, trainer_id, session_date, session_time, status, session_number) VALUES (%s, %s, %s, '09:00', 'Booked', '1/1')",
                    (other, self.trainer_id, monday))
        conn.commit()
        conn.close()
        with self.assertRaises(HTTPException) as busy:
            self.renew(per_week=1, days="Monday", start=monday)
        self.assertIn("trainer_busy", {c["kind"] for c in busy.exception.detail["conflicts"]})

        with self.assertRaises(HTTPException) as weekend:
            self.renew(per_week=1, days="Saturday", start=next_weekday(14, 5))       # Saturday and Sunday are never an option
        self.assertEqual(weekend.exception.status_code, 422)
        self.assertEqual(weekend.exception.detail["code"], "invalid_schedule")

        with self.assertRaises(HTTPException) as hours:
            self.renew(per_week=1, days="Monday", start=monday, time="23:00")        # a weekday, but outside the trainer's hours
        self.assertEqual({c["kind"] for c in hours.exception.detail["conflicts"]}, {"trainer_hours"})

    def test_the_preview_counts_sessions_and_lists_conflicts_and_overlaps_without_writing(self):
        monday = next_weekday(14, 0)
        self.renew(per_week=1, days="Monday", start=monday)
        self.free_the_trainer()
        plans_before, sessions_before = self.plans_rows(), self.sessions_rows()
        preview = route("/admin/packs/preview", "POST")(main.PackPreview(
            client_id=self.user_id, pack_id=self.pack_ids["individual"], sessions_per_week=1, schedule=pack_schedule.uniform("Monday", "09:00", self.trainer_id), start_date=monday.isoformat()))
        self.assertEqual(preview["total_sessions"], 2)
        self.assertNotIn("replaces", preview)                           # nothing is replaced any more
        self.assertEqual(preview["conflicts"], [])                      # the trainer is free
        self.assertEqual([o["pack"] for o in preview["overlaps"]], ["TEST parallel 2 weeks"] * 2)   # the client is not
        self.assertEqual((self.plans_rows(), self.sessions_rows()), (plans_before, sessions_before))

        free = route("/admin/packs/preview", "POST")(main.PackPreview(
            client_id=None, pack_id=self.pack_ids["individual"], sessions_per_week=1, schedule=pack_schedule.uniform("Wednesday", "16:00", self.trainer_id), start_date=next_weekday(20, 2).isoformat()))
        self.assertEqual((free["total_sessions"], free["conflicts"], free["overlaps"]), (2, [], []))

    # ----- sessions that existed before parallel packs
    def test_old_sessions_are_matched_by_date_and_nothing_is_rewritten(self):
        """Henrique's case: an October pack (closed by an old renewal) and a January pack."""
        conn = get_connection()
        cur = conn.cursor()
        october = date.today() + timedelta(days=5)
        january = date.today() + timedelta(days=90)
        cur.execute("INSERT INTO user_plans (user_id, plan_id, active, start_date, end_date, sessions_per_week, trainer_id) "
                    "VALUES (%s, %s, FALSE, %s, %s, 1, %s) RETURNING id", (self.user_id, self.plan_id, october, october + timedelta(days=21), self.trainer_id))
        old_pack = cur.fetchone()[0]
        cur.execute("INSERT INTO user_plans (user_id, plan_id, active, start_date, end_date, sessions_per_week, trainer_id) "
                    "VALUES (%s, %s, TRUE, %s, %s, 1, %s) RETURNING id", (self.user_id, self.plan_id, january, january + timedelta(days=21), self.trainer_id))
        new_pack = cur.fetchone()[0]
        for index in range(4):
            cur.execute("INSERT INTO sessions (user_id, trainer_id, session_date, session_time, status, session_number) VALUES (%s, %s, %s, '14:00', 'Booked', %s)",
                        (self.user_id, self.trainer_id, october + timedelta(days=7 * index), f"{index + 1}/4"))
            cur.execute("INSERT INTO sessions (user_id, trainer_id, session_date, session_time, status, session_number) VALUES (%s, %s, %s, '14:00', 'Booked', %s)",
                        (self.user_id, self.trainer_id, january + timedelta(days=7 * index), f"{index + 1}/4"))
        conn.commit()
        conn.close()
        before = self.sessions_rows()

        detail = self.detail()
        shown = {p["id"]: p for p in detail["packs"] if p["shown"]}
        self.assertEqual(set(shown), {old_pack, new_pack})              # the closed pack still has sessions to come: it is shown
        self.assertEqual([(p["total"], p["remaining"]) for p in detail["packs"]], [(4, 4), (4, 4)])
        by_pack = {}
        for session in detail["sessions"]:
            by_pack.setdefault(session["pack_id"], []).append(session["number"])
        self.assertEqual(by_pack[old_pack], ["1/4", "2/4", "3/4", "4/4"])
        self.assertEqual(by_pack[new_pack], ["1/4", "2/4", "3/4", "4/4"])
        self.assertEqual(self.sessions_rows(), before)                  # reading did not write anything

    # ----- emails
    def test_the_pack_email_has_only_the_new_packs_sessions(self):
        monday = next_weekday(14, 0)
        self.renew(per_week=1, days="Monday", start=monday, extra=["pt@thundbalance.com"])
        RECEIVED.clear()
        second = self.renew(per_week=2, days="Tuesday,Thursday", start=monday + timedelta(days=1), time="10:00",
                            extra=["pt@thundbalance.com"])
        self.assertEqual(second["total_sessions"], 4)
        import time
        from emails.transport import _pool
        for _ in range(3):
            _pool.submit(lambda: None).result(timeout=10)
        time.sleep(0.3)
        message = next(m for m in RECEIVED if m["to"] == f"hp{DOMAIN}")
        ics = base64.b64decode(message["attachments"][0]["data"]).decode()
        self.assertEqual(ics.count("BEGIN:VEVENT"), 4)                  # only the 4 sessions of the new pack
        self.assertIn("4", message["text"])


if __name__ == "__main__":
    unittest.main()

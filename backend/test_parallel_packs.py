"""Packs that run in parallel, any start date, and conflicts:

    python -m unittest test_parallel_packs -v

Google Mail is a local fake server, the Google Calendar is faked. The local
database is used and cleaned up.
"""
import base64
import json
import threading
import unittest
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer

from fastapi import HTTPException

import admin_api
import main
import packs
from database import get_connection

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
        cur.execute("INSERT INTO plans (nome, preco, duracao_meses, duration_weeks) VALUES ('TEST parallel 2 weeks', 0, 1, 2) RETURNING id")
        cls.plan_id = cur.fetchone()[0]
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
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
        self._orig = (packs.create_calendar_event, packs.delete_calendar_event)
        packs.create_calendar_event = lambda *a, **k: (self.events.append(a), k.get("event_id") or "evt")[1]
        packs.delete_calendar_event = lambda event_id: None
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO users (nome, email) VALUES ('Henrique Paralelo', %s) RETURNING id", (f"hp{DOMAIN}",))
        self.user_id = cur.fetchone()[0]
        conn.commit()
        conn.close()

    def tearDown(self):
        packs.create_calendar_event, packs.delete_calendar_event = self._orig
        self.cleanup()

    # ----- helpers
    def renew(self, *, per_week, days, start, time="09:00", allow=False, trainer=None, extra=None):
        return route("/admin/clients/{client_id}/renew-pack", "POST")(self.user_id, main.RenewPack(
            plan_id=self.plan_id, sessions_per_week=per_week, preferred_days=days, preferred_time=time,
            trainer_id=trainer or self.trainer_id, start_date=start.isoformat(),
            email_extra=extra if extra is not None else [], allow_conflicts=allow))

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

    # ----- parallel packs
    def test_a_second_pack_inside_the_first_leaves_both_active(self):
        monday = next_weekday(14, 0)
        first = self.renew(per_week=1, days="Monday", start=monday)
        self.assertEqual(first["total_sessions"], 2)
        before_plans, before_sessions = self.plans_rows(), self.sessions_rows()

        # 2 per week, starting inside the first pack's period
        second = self.renew(per_week=2, days="Tuesday,Thursday", start=monday + timedelta(days=1), time="10:00")
        self.assertEqual(second["total_sessions"], 4)

        plans_after = self.plans_rows()
        self.assertEqual(len(plans_after), 2)
        self.assertEqual(plans_after[0], before_plans[0])              # the first pack is untouched
        self.assertTrue(all(row[1] for row in plans_after))             # both active
        # the first pack's sessions are exactly as they were
        first_ids = [r[0] for r in before_sessions]
        still = [r for r in self.sessions_rows() if r[0] in first_ids]
        self.assertEqual([tuple(r) for r in still], [tuple(r) for r in before_sessions])

        pack_a, pack_b = plans_after[0][0], plans_after[1][0]
        owners = {r[0]: r[4] for r in self.sessions_rows()}
        self.assertEqual(sum(1 for v in owners.values() if v == pack_a), 2)
        self.assertEqual(sum(1 for v in owners.values() if v == pack_b), 4)

    def test_the_record_shows_one_card_per_pack_with_its_own_counters(self):
        monday = next_weekday(14, 0)
        self.renew(per_week=1, days="Monday", start=monday)
        self.renew(per_week=2, days="Tuesday,Thursday", start=monday + timedelta(days=1), time="10:00")

        detail = self.detail()
        cards = [p for p in detail["packs"] if p["shown"]]
        self.assertEqual(len(cards), 2)
        self.assertEqual([(p["total"], p["done"], p["remaining"]) for p in cards], [(2, 0, 2), (4, 0, 4)])
        self.assertEqual([p["sessions_per_week"] for p in cards], [1, 2])
        self.assertEqual(sum(p["total"] for p in cards), len([s for s in detail["sessions"] if s["status"] != "Cancelled"]))
        self.assertEqual({s["pack_id"] for s in detail["sessions"]}, {cards[0]["id"], cards[1]["id"]})
        self.assertEqual(detail["pack"]["id"], cards[1]["id"])          # the newest card is the default of "Renovar pack"
        # numbering belongs to each pack: 1/2, 2/2 and 1/4 ... 4/4
        numbers = sorted({(s["pack_id"], s["number"]) for s in detail["sessions"]})
        self.assertEqual([n for _, n in numbers if _ == cards[0]["id"]], ["1/2", "2/2"])
        self.assertEqual([n for _, n in numbers if _ == cards[1]["id"]], ["1/4", "2/4", "3/4", "4/4"])

        listed = next(c for c in route("/admin/clients", "GET")() if c["id"] == self.user_id)
        self.assertEqual((listed["packs_active"], listed["total"], listed["upcoming"]), (2, 6, 6))
        self.assertEqual(listed["next_session"], monday.isoformat())      # the earliest of ALL packs

    def test_the_client_dashboard_counts_every_pack(self):
        monday = next_weekday(14, 0)
        self.renew(per_week=1, days="Monday", start=monday)
        self.renew(per_week=2, days="Tuesday,Thursday", start=monday + timedelta(days=1), time="10:00")
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
        self.assertEqual(len(workflow["plans"]), 2)                          # both packs, not just the last
        self.assertEqual([(p["total"], p["remaining"]) for p in workflow["plans"]], [(2, 2), (4, 4)])
        self.assertEqual(workflow["sessions_remaining"], 6)                   # all the packs together
        self.assertEqual(len(workflow["sessions"]), 6)
        first_pack = workflow["plans"][0]["id"]
        self.assertEqual(sum(1 for s in workflow["sessions"] if s["pack_id"] == first_pack), 2)
        # the soonest upcoming session of ALL packs is the first Monday
        self.assertEqual(workflow["sessions"][0]["date"], monday.isoformat())

        claims = {"sub": "x", "email": f"hp{DOMAIN}"}
        found = route("/users/email/{email}", "GET")(f"hp{DOMAIN}", claims)
        self.assertEqual(found["plano"], "TEST parallel 2 weeks + TEST parallel 2 weeks")

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

    def test_approving_a_request_adds_a_pack_and_removes_nothing(self):
        monday = next_weekday(14, 0)
        self.renew(per_week=1, days="Monday", start=monday)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO client_requests (user_id, plan_id, sessions_per_week, preferred_days, preferred_time, status) "
            "VALUES (%s, %s, 1, 'Wednesday', '15:00', 'Pending') RETURNING id", (self.user_id, self.plan_id))
        request_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        route("/admin/approve-request", "POST")(main.ApproveRequest(
            request_id=request_id, trainer_id=self.trainer_id, start_date=(monday + timedelta(days=2)).isoformat(), email_extra=[]))
        self.assertEqual(len(self.plans_rows()), 2)
        self.assertTrue(all(r[1] for r in self.plans_rows()))

    # ----- conflicts
    def test_a_colliding_pack_is_refused_with_a_list_and_nothing_is_created(self):
        monday = next_weekday(14, 0)
        self.renew(per_week=1, days="Monday", start=monday)             # Mondays 09:00
        plans_before, sessions_before = self.plans_rows(), self.sessions_rows()

        with self.assertRaises(HTTPException) as caught:
            self.renew(per_week=1, days="Monday", start=monday)         # the same day and hour again
        self.assertEqual(caught.exception.status_code, 409)
        detail = caught.exception.detail
        self.assertEqual(detail["code"], "conflicts")
        kinds = {c["kind"] for c in detail["conflicts"]}
        self.assertIn("client_busy", kinds)
        self.assertEqual({c["date"] for c in detail["conflicts"] if c["kind"] == "client_busy"},
                         {monday.isoformat(), (monday + timedelta(days=7)).isoformat()})
        self.assertEqual((self.plans_rows(), self.sessions_rows()), (plans_before, sessions_before))   # nothing silently created
        self.assertEqual(RECEIVED and len([m for m in RECEIVED if "thundbalance-sesiones.ics" in json.dumps(m)]), 1)  # only the first pack's email

    def test_create_anyway_creates_everything_including_the_colliding_sessions(self):
        monday = next_weekday(14, 0)
        self.renew(per_week=1, days="Monday", start=monday)
        result = self.renew(per_week=1, days="Monday", start=monday, allow=True)
        self.assertEqual(result["total_sessions"], 2)
        self.assertEqual(len(self.plans_rows()), 2)
        same_slot = [r for r in self.sessions_rows() if r[1] == monday]
        self.assertEqual(len(same_slot), 2)                             # two sessions the same day and hour, on purpose

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

        with self.assertRaises(HTTPException) as hours:
            self.renew(per_week=1, days="Saturday", start=next_weekday(14, 5))       # nobody works on Saturdays
        self.assertEqual({c["kind"] for c in hours.exception.detail["conflicts"]}, {"trainer_hours"})

    def test_the_preview_counts_sessions_and_conflicts_without_writing(self):
        monday = next_weekday(14, 0)
        self.renew(per_week=1, days="Monday", start=monday)
        plans_before, sessions_before = self.plans_rows(), self.sessions_rows()
        preview = route("/admin/packs/preview", "POST")(main.PackPreview(
            client_id=self.user_id, plan_id=self.plan_id, sessions_per_week=1, preferred_days="Monday",
            preferred_time="09:00", trainer_id=self.trainer_id, start_date=monday.isoformat()))
        self.assertEqual(preview["total_sessions"], 2)
        self.assertEqual(len([c for c in preview["conflicts"] if c["kind"] == "client_busy"]), 2)
        self.assertEqual((self.plans_rows(), self.sessions_rows()), (plans_before, sessions_before))

        free = route("/admin/packs/preview", "POST")(main.PackPreview(
            client_id=None, plan_id=self.plan_id, sessions_per_week=1, preferred_days="Wednesday",
            preferred_time="16:00", trainer_id=self.trainer_id, start_date=next_weekday(20, 2).isoformat()))
        self.assertEqual((free["total_sessions"], free["conflicts"]), (2, []))

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
        self.renew(per_week=1, days="Monday", start=monday, extra=["info@thundbalance.com"])
        RECEIVED.clear()
        second = self.renew(per_week=2, days="Tuesday,Thursday", start=monday + timedelta(days=1), time="10:00",
                            extra=["info@thundbalance.com"])
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

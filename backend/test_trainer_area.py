"""Trainer area (backend):

    python -m unittest test_trainer_area -v

Real HTTP calls to the app (FastAPI TestClient) with the Firebase token check and the
Firebase account lookup replaced by fakes; the local database is used and cleaned up.
"""
import json
import unittest

import plans_schema
from datetime import date, timedelta

import testsafety
from fastapi.testclient import TestClient

import availability
import firebase_accounts
import main
import trainer_area
from database import get_connection

DOMAIN = "@test-trainer-area.example"
ISS = f"https://securetoken.google.com/{main.FIREBASE_PROJECT_ID}"
ADMIN = main.ADMIN_EMAIL


def claims(email, uid, verified=True):
    return {"iss": ISS, "email": email, "sub": uid, "email_verified": verified}


class TrainerAreaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        testsafety.require_local_database()
        main.ensure_client_lifecycle_columns()
        main.ensure_calendar_sync_columns()
        main.ensure_calendar_feed_columns()
        main.ensure_session_pack_column()
        main.ensure_trial_session_fields()
        main.ensure_trainer_area()
        cls.http = TestClient(main.app)
        cls.cleanup()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(f"INSERT INTO plans (nome, {plans_schema.price_column(cur)}, duracao_meses, duration_weeks) VALUES ('TEST trainer area', 0, 1, 1) RETURNING id")
        cls.plan_id = cur.fetchone()[0]
        ids = []
        for name in ("TEST TA Uno", "TEST TA Dos"):
            trainer_id = availability.create_trainer(cur, name)
            cur.execute("UPDATE trainers SET color = %s WHERE id = %s", ("#123456" if name.endswith("Uno") else "#654321", trainer_id))
            ids.append(trainer_id)
        cls.t1, cls.t2 = ids
        for trainer_id in ids:
            for day in ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"):
                cur.execute("INSERT INTO trainer_availability (trainer_id, day_of_week, start_time, end_time) VALUES (%s, %s, '08:00', '12:00')", (trainer_id, day))

        def user(name, email, uid):
            cur.execute("INSERT INTO users (nome, email, firebase_uid, telefono) VALUES (%s, %s, %s, '+34600111222') RETURNING id".replace("telefono", "telefone"), (name, email, uid))
            return cur.fetchone()[0]

        cls.ana = user("Ana Maria Prueba Lopez", f"ana{DOMAIN}", "uid-ana")
        cls.beto = user("Beto Prueba", f"beto{DOMAIN}", "uid-beto")
        cls.other = user("Otra Persona Gomez", f"otra{DOMAIN}", "uid-otra")
        cls.busy_client = user("Cliente Con Pack", f"pack{DOMAIN}", "uid-pack")
        cur.execute("INSERT INTO user_plans (user_id, plan_id, active, start_date, end_date) VALUES (%s, %s, TRUE, %s, %s) RETURNING id",
                    (cls.busy_client, cls.plan_id, date.today(), date.today() + timedelta(days=30)))
        cur.execute("INSERT INTO user_plans (user_id, plan_id, active) VALUES (%s, %s, TRUE) RETURNING id", (cls.ana, cls.plan_id))
        pack = cur.fetchone()[0]

        today = date.today()
        cls.past, cls.future = today - timedelta(days=5), today + timedelta(days=3)
        cls.session_ids = {}

        def session(key, user_id, trainer_id, day, hour, status="Booked", number="1/3", rescheduled=False):
            cur.execute(
                "INSERT INTO sessions (user_id, trainer_id, session_date, session_time, status, session_number, rescheduled, user_plan_id) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (user_id, trainer_id, day, hour, status, number, rescheduled, pack if user_id == cls.ana else None),
            )
            cls.session_ids[key] = cur.fetchone()[0]

        session("ana_past", cls.ana, cls.t1, cls.past, "09:00", number="1/3")
        session("beto_past", cls.beto, cls.t1, cls.past, "10:00", number="2/3", rescheduled=True)
        session("ana_future", cls.ana, cls.t1, cls.future, "09:00", number="3/3")
        session("ana_cancelled", cls.ana, cls.t1, cls.future, "10:00", status="Cancelled", number="4/3")
        session("other_trainer", cls.other, cls.t2, cls.future, "09:00", number="1/1")

        def trial(name, trainer_id, day, hour, status, token=None):
            cur.execute(
                "INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status, trainer_id, confirmation_token) "
                "VALUES (%s, %s, '+34600999888', 'x', 'y', %s, %s, %s, %s, %s)",
                (name, f"lead{DOMAIN}", day, hour, status, trainer_id, token))

        trial("Lead Confirmado Perez", cls.t1, cls.future, "11:00", "Confirmed")
        trial("Lead Pendiente Ruiz", cls.t1, cls.future, "11:00", "Pending")
        trial("Lead Esperando Sanz", cls.t1, cls.future, "08:00", "Approved", token="abc")
        conn.commit()
        conn.close()

    @classmethod
    def cleanup(cls):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE nome LIKE 'TEST TA %'")
        trainers = [r[0] for r in cur.fetchall()]
        cur.execute("SELECT id FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        users = [r[0] for r in cur.fetchall()]
        cur.execute("DELETE FROM trainer_access_log WHERE email LIKE %s OR trainer_id = ANY(%s)", (f"%{DOMAIN}", trainers))
        cur.execute("DELETE FROM trainer_access WHERE email LIKE %s OR trainer_id = ANY(%s)", (f"%{DOMAIN}", trainers))
        cur.execute("DELETE FROM sessions WHERE user_id = ANY(%s) OR trainer_id = ANY(%s)", (users, trainers))
        cur.execute("DELETE FROM user_plans WHERE user_id = ANY(%s)", (users,))
        cur.execute("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM users WHERE id = ANY(%s)", (users,))
        cur.execute("DELETE FROM trainer_availability WHERE trainer_id = ANY(%s)", (trainers,))
        cur.execute("DELETE FROM trainers WHERE id = ANY(%s)", (trainers,))
        cur.execute("DELETE FROM plans WHERE nome = 'TEST trainer area'")
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        cls.cleanup()

    def setUp(self):
        self.tokens = {
            "admin": claims(ADMIN, "uid-admin"),
            "client": claims(f"ana{DOMAIN}", "uid-ana"),
            "trainer1": claims(f"uno{DOMAIN}", "uid-t1"),
            "trainer2": claims(f"dos{DOMAIN}", "uid-t2"),
            "unverified": claims(f"uno{DOMAIN}", "uid-t1", verified=False),
        }
        self.firebase = {
            f"uno{DOMAIN}": {"uid": "uid-t1", "email_verified": True, "disabled": False},
            f"dos{DOMAIN}": {"uid": "uid-t2", "email_verified": True, "disabled": False},
            f"pack{DOMAIN}": {"uid": "uid-pack", "email_verified": True, "disabled": False},
            f"ana{DOMAIN}": {"uid": "uid-ana", "email_verified": True, "disabled": False},
            f"sinverificar{DOMAIN}": {"uid": "uid-nv", "email_verified": False, "disabled": False},
            ADMIN: {"uid": "uid-admin", "email_verified": True, "disabled": False},
        }
        self._verify = main.id_token.verify_firebase_token
        self._lookup = firebase_accounts.get_user_by_email
        main.id_token.verify_firebase_token = lambda token, *a, **k: self._claims_for(token)
        firebase_accounts.get_user_by_email = lambda email: self.firebase.get(email)
        trainer_area.forget()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM trainer_access WHERE email LIKE %s OR trainer_id IN (%s, %s)", (f"%{DOMAIN}", self.t1, self.t2))
        cur.execute("DELETE FROM trainer_access_log WHERE email LIKE %s", (f"%{DOMAIN}",))
        conn.commit()
        conn.close()

    def tearDown(self):
        main.id_token.verify_firebase_token = self._verify
        firebase_accounts.get_user_by_email = self._lookup
        trainer_area.forget()

    def _claims_for(self, token):
        if token not in self.tokens:
            raise ValueError("bad token")
        return self.tokens[token]

    def call(self, method, path, who=None, **kwargs):
        headers = {"Authorization": f"Bearer {who}"} if who else {}
        return self.http.request(method, path, headers=headers, **kwargs)

    def give_access(self, trainer_id, email, uid):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO trainer_access (trainer_id, firebase_uid, email, granted_by) VALUES (%s, %s, %s, 'test')", (trainer_id, uid, email))
        conn.commit()
        conn.close()
        trainer_area.forget()

    def window(self):
        return {"from": str(self.past - timedelta(days=1)), "to": str(self.future + timedelta(days=1))}

    # ------------------------------------------------------------------ access
    def test_a_trainer_sees_only_their_own_sessions_and_no_personal_data(self):
        self.give_access(self.t1, f"uno{DOMAIN}", "uid-t1")
        response = self.call("GET", "/trainer-area/me/sessions", "trainer1", params=self.window())
        self.assertEqual(response.status_code, 200, response.text)
        rows = response.json()
        names = {r["client_display_name"] for r in rows}
        self.assertEqual(names, {"Ana Lopez", "Beto Prueba", "Lead Perez"})                  # first name + last surname
        self.assertNotIn("Otra Gomez", names)                                                   # the other trainer's
        self.assertEqual(sum(1 for r in rows if r["is_trial"]), 1)                              # confirmed trial only
        for row in rows:
            self.assertEqual(set(row), {"session_id", "client_display_name", "session_number", "pack_name", "date", "time", "status", "is_trial"})
        text = json.dumps(rows)
        for secret in (DOMAIN, "600111222", "600999888", "@", "+34"):
            self.assertNotIn(secret, text)
        by_name = {r["client_display_name"]: r for r in rows}
        self.assertEqual(by_name["Ana Lopez"]["session_number"] in ("1/3", "3/3", "4/3"), True)
        self.assertEqual({r["status"] for r in rows if r["client_display_name"] == "Ana Lopez"}, {"completed", "booked", "cancelled"})
        self.assertEqual(by_name["Lead Perez"]["pack_name"], "Trial Session")
        self.assertIsNone(by_name["Lead Perez"]["session_number"])
        print("\nEXAMPLE trainer session JSON:", json.dumps(sorted(rows, key=lambda r: (r['date'], r['time']))[0]))

    def test_other_trainer_unverified_and_no_access_get_403(self):
        self.give_access(self.t1, f"uno{DOMAIN}", "uid-t1")
        for who, expected in (("trainer2", 403), ("unverified", 403), ("client", 403), ("admin", 403)):
            self.assertEqual(self.call("GET", "/trainer-area/me/sessions", who, params=self.window()).status_code, expected, who)
        self.assertEqual(self.call("GET", "/trainer-area/me/sessions", None, params=self.window()).status_code, 401)
        self.assertEqual(self.call("GET", "/trainer-area/me/summary", "trainer2").status_code, 403)
        self.assertEqual(self.call("GET", "/trainer-area/me/free-slots", "trainer2", params=self.window()).status_code, 403)

    def test_the_second_trainer_only_sees_theirs(self):
        self.give_access(self.t2, f"dos{DOMAIN}", "uid-t2")
        rows = self.call("GET", "/trainer-area/me/sessions", "trainer2", params=self.window()).json()
        self.assertEqual([r["client_display_name"] for r in rows], ["Otra Gomez"])

    def test_roles(self):
        self.give_access(self.t1, f"uno{DOMAIN}", "uid-t1")
        self.assertEqual(self.call("GET", "/me/roles", "trainer1").json(),
                         {"is_admin": False, "is_trainer": True, "trainer_id": self.t1, "trainer_name": "TEST TA Uno", "trainer_color": "#123456"})
        self.assertEqual(self.call("GET", "/me/roles", "unverified").json()["is_trainer"], False)
        self.assertEqual(self.call("GET", "/me/roles", "admin").json(), {"is_admin": True, "is_trainer": False, "trainer_id": None, "trainer_name": None, "trainer_color": None})
        self.assertEqual(self.call("GET", "/me/roles", "client").json()["is_trainer"], False)
        self.assertEqual(self.call("GET", "/me/roles").status_code, 401)

    def test_a_trainer_is_turned_away_from_client_endpoints(self):
        self.give_access(self.t1, f"uno{DOMAIN}", "uid-t1")
        for path in ("/client/workflow", "/reschedule-requests", "/my/inbox"):
            response = self.call("GET", path, "trainer1")
            self.assertEqual(response.status_code in (403, 404), True, (path, response.status_code))
        response = self.call("GET", "/client/workflow", "trainer1")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"]["code"], "trainer_account")
        self.assertEqual(self.call("POST", "/client-requests", "trainer1", json={}).status_code, 403)
        self.assertEqual(self.call("GET", "/client/workflow", "client").status_code, 200)    # a client still works
        # what a trainer DOES keep: their own profile (the site's Profile page)
        self.assertEqual(self.call("GET", f"/users/email/uno{DOMAIN}", "trainer1").status_code in (200, 404), True)
        self.assertEqual(self.call("GET", "/profile/1", "trainer1").status_code, 403)      # not theirs: ownership still applies, no longer "trainer_account"
        self.assertNotEqual(self.call("GET", "/profile/1", "trainer1").json().get("detail"), {"code": "trainer_account"} )

    # ----------------------------------------------------------------- summary
    def test_summary_numbers_and_validation(self):
        self.give_access(self.t1, f"uno{DOMAIN}", "uid-t1")
        window = {"period": "custom", **self.window()}
        data = self.call("GET", "/trainer-area/me/summary", "trainer1", params=window).json()
        self.assertEqual(data["sessions_booked"], 3)             # ana past + beto past + ana future (the cancelled one is not)
        self.assertEqual(data["sessions_completed"], 2)
        self.assertEqual(data["sessions_cancelled"], 1)
        self.assertEqual(data["sessions_rescheduled"], 1)
        self.assertEqual(data["trial_sessions"], 1)
        self.assertEqual(data["distinct_clients"], 2)
        self.assertEqual(data["hours_given"], 2.0)
        self.assertEqual(data["upcoming_7_days"] >= 2, True)     # ana future + the confirmed trial
        self.assertGreater(data["free_hours"], 0)
        self.assertEqual(sum(d["count"] for d in data["busiest_hours"]), 4)    # 3 live sessions + the confirmed trial
        self.assertEqual(set(data), {"period", "from", "to", "sessions_booked", "sessions_completed", "sessions_cancelled",
                                     "sessions_rescheduled", "upcoming_7_days", "hours_given", "distinct_clients", "trial_sessions",
                                     "free_hours", "busiest_weekdays", "busiest_hours"})
        for period in ("today", "week", "month"):
            self.assertEqual(self.call("GET", "/trainer-area/me/summary", "trainer1", params={"period": period}).status_code, 200)
        week = self.call("GET", "/trainer-area/me/summary", "trainer1", params={"period": "week"}).json()
        self.assertEqual(date.fromisoformat(week["from"]).weekday(), 0)                       # Monday first
        self.assertEqual((date.fromisoformat(week["to"]) - date.fromisoformat(week["from"])).days, 6)
        # bad ranges
        bad = [
            {"period": "custom", "from": "2026-02-01", "to": "2026-01-01"},
            {"period": "custom", "from": "2025-01-01", "to": "2026-03-01"},                   # more than 366 days
            {"period": "custom", "from": "nope", "to": "2026-01-01"},
            {"period": "custom"},
            {"period": "decade"},
        ]
        for params in bad:
            self.assertEqual(self.call("GET", "/trainer-area/me/summary", "trainer1", params=params).status_code, 422, params)
        self.assertEqual(self.call("GET", "/trainer-area/me/sessions", "trainer1", params={"from": "2026-02-01", "to": "2026-01-01"}).status_code, 422)
        self.assertEqual(self.call("GET", "/trainer-area/me/free-slots", "trainer1").status_code, 422)

    def test_free_slots_skip_taken_hours_and_the_past(self):
        self.give_access(self.t1, f"uno{DOMAIN}", "uid-t1")
        slots = self.call("GET", "/trainer-area/me/free-slots", "trainer1", params=self.window()).json()
        taken = {(str(self.future), "09:00"), (str(self.future), "11:00")}       # booked session + confirmed trial
        got = {(s["date"], s["time"]) for s in slots}
        self.assertTrue(taken.isdisjoint(got))
        self.assertIn((str(self.future), "10:00"), got)                          # the cancelled hour is free again
        self.assertNotIn((str(self.future), "08:00"), got)                       # approved trial, waiting: still holds the hour
        self.assertTrue(all(s["date"] >= str(date.today()) for s in slots))
        same = self.call("GET", f"/trainer/{self.t1}/available-times/{self.future}").json()
        self.assertEqual(sorted(s["time"] for s in slots if s["date"] == str(self.future)), sorted(same))   # the same rule as the existing endpoint

    # ------------------------------------------------------------------- admin
    def test_the_admin_sees_a_trainers_panel_and_others_can_not(self):
        for kind in ("summary", "sessions", "free-slots"):
            path = f"/admin/trainers/{self.t1}/panel/{kind}"
            params = self.window() if kind != "summary" else {"period": "week"}
            self.assertEqual(self.call("GET", path, "admin", params=params).status_code, 200, kind)
            self.assertEqual(self.call("GET", path, "client", params=params).status_code, 403, kind)
            self.assertEqual(self.call("GET", path, None, params=params).status_code, 401, kind)
        rows = self.call("GET", f"/admin/trainers/{self.t1}/panel/sessions", "admin", params=self.window()).json()
        self.assertEqual({r["client_display_name"] for r in rows}, {"Ana Lopez", "Beto Prueba", "Lead Perez"})
        self.assertEqual(self.call("GET", "/admin/trainers/999999/panel/summary", "admin").status_code, 404)

    # -------------------------------------------------------- grant / revoke
    def test_check_covers_every_case(self):
        def check(email, trainer_id=None):
            response = self.call("POST", "/admin/trainer-access/check", "admin", json={"trainer_id": trainer_id or self.t1, "email": email})
            self.assertEqual(response.status_code, 200, response.text)
            return response.json()

        self.assertEqual(check(f"nadie{DOMAIN}")["reason"], "no_account")
        self.assertFalse(check(f"nadie{DOMAIN}")["can_grant"])
        admin = check(ADMIN)                                                  # the administrator CAN be a trainer
        self.assertEqual((admin["can_grant"], admin["reason"], admin["is_admin"]), (True, None, True))
        self.assertEqual(check(f"pack{DOMAIN}")["reason"], "is_client_with_activity")
        self.assertTrue(check(f"pack{DOMAIN}")["is_client_with_activity"])
        self.assertEqual(check(f"sinverificar{DOMAIN}")["reason"], "email_not_verified")
        ok = check(f"uno{DOMAIN}")
        self.assertEqual((ok["can_grant"], ok["reason"], ok["account_exists"], ok["email_verified"]), (True, None, True, True))
        self.assertNotIn("firebase_uid", ok)
        self.give_access(self.t2, f"uno{DOMAIN}", "uid-t1")
        taken = check(f"uno{DOMAIN}")
        self.assertEqual((taken["reason"], taken["already_assigned_to_other_trainer"], taken["can_grant"]), ("already_assigned_to_other_trainer", True, False))
        self.assertEqual(self.call("POST", "/admin/trainer-access/check", "client", json={"trainer_id": self.t1, "email": "a@b.co"}).status_code, 403)
        self.assertEqual(self.call("POST", "/admin/trainer-access/check", "admin", json={"trainer_id": self.t1, "email": "not-an-email"}).status_code, 422)
        self.assertEqual(self.call("POST", "/admin/trainer-access/check", "admin", json={"trainer_id": 999999, "email": f"uno{DOMAIN}"}).status_code, 404)

    def test_the_admin_account_can_also_be_a_trainer(self):
        granted = self.call("POST", "/admin/trainer-access", "admin", json={"trainer_id": self.t2, "email": ADMIN, "confirm": True})
        self.assertEqual(granted.status_code, 200, granted.text)
        roles = self.call("GET", "/me/roles", "admin").json()
        self.assertEqual((roles["is_admin"], roles["is_trainer"], roles["trainer_id"]), (True, True, self.t2))
        self.assertEqual(self.call("GET", "/trainer-area/me/summary", "admin").status_code, 200)       # the trainer panel works for them
        self.assertEqual(self.call("GET", "/admin/clients", "admin").status_code, 200)                  # and they stay the admin
        self.assertEqual(self.call("GET", "/client/workflow", "admin").status_code in (200, 404), True)   # not turned away like a trainer
        self.assertEqual(self.call("DELETE", f"/admin/trainer-access/{self.t2}", "admin").status_code, 200)
        self.assertEqual(self.call("GET", "/trainer-area/me/summary", "admin").status_code, 403)

    def test_a_client_without_activity_can_become_a_trainer(self):
        self.firebase[f"beto{DOMAIN}"] = {"uid": "uid-beto", "email_verified": True, "disabled": False}
        response = self.call("POST", "/admin/trainer-access/check", "admin", json={"trainer_id": self.t1, "email": f"beto{DOMAIN}"})
        self.assertTrue(response.json()["can_grant"])

    def test_grant_needs_confirm_true_and_repeats_the_checks(self):
        body = {"trainer_id": self.t1, "email": f"uno{DOMAIN}"}
        for payload in (body, {**body, "confirm": False}, {**body, "confirm": "true"}, {**body, "confirm": 1}):
            self.assertEqual(self.call("POST", "/admin/trainer-access", "admin", json=payload).status_code, 422, payload)
        self.assertEqual(self.call("POST", "/admin/trainer-access", "client", json={**body, "confirm": True}).status_code, 403)
        # the server checks again: no account / admin / client with a pack are refused with 409
        for email, code in ((f"nadie{DOMAIN}", "no_account"), (f"pack{DOMAIN}", "is_client_with_activity")):
            response = self.call("POST", "/admin/trainer-access", "admin", json={"trainer_id": self.t1, "email": email, "confirm": True})
            self.assertEqual((response.status_code, response.json()["detail"]["code"]), (409, code))
        granted = self.call("POST", "/admin/trainer-access", "admin", json={**body, "confirm": True})
        self.assertEqual(granted.status_code, 200, granted.text)
        self.assertEqual(granted.json()["access_status"], "active")
        # works at once, and a second grant for the same trainer or email is refused
        self.assertEqual(self.call("GET", "/trainer-area/me/summary", "trainer1").status_code, 200)
        again = self.call("POST", "/admin/trainer-access", "admin", json={**body, "confirm": True})
        self.assertEqual(again.status_code, 409)
        other = self.call("POST", "/admin/trainer-access", "admin", json={"trainer_id": self.t2, "email": f"uno{DOMAIN}", "confirm": True})
        self.assertEqual((other.status_code, other.json()["detail"]["code"]), (409, "already_assigned_to_other_trainer"))
        listing = {r["trainer_id"]: r for r in self.call("GET", "/admin/trainer-access", "admin").json()}
        self.assertEqual((listing[self.t1]["access_status"], listing[self.t1]["email"]), ("active", f"uno{DOMAIN}"))
        self.assertEqual(listing[self.t2]["access_status"], "none")
        self.assertEqual(self.call("GET", "/admin/trainer-access", "client").status_code, 403)

    def test_revoke_is_soft_immediate_and_logged(self):
        self.call("POST", "/admin/trainer-access", "admin", json={"trainer_id": self.t1, "email": f"uno{DOMAIN}", "confirm": True})
        self.assertEqual(self.call("GET", "/trainer-area/me/summary", "trainer1").status_code, 200)
        self.assertEqual(self.call("DELETE", f"/admin/trainer-access/{self.t1}", "client").status_code, 403)
        self.assertEqual(self.call("DELETE", f"/admin/trainer-access/{self.t1}", "admin").status_code, 200)
        self.assertEqual(self.call("GET", "/trainer-area/me/summary", "trainer1").status_code, 403)           # immediate
        self.assertEqual(self.call("DELETE", f"/admin/trainer-access/{self.t1}", "admin").status_code, 404)   # nothing active left
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*), COUNT(revoked_at) FROM trainer_access WHERE trainer_id = %s", (self.t1,))
        self.assertEqual(cur.fetchone(), (1, 1))                                                              # the row stays
        cur.execute("SELECT action FROM trainer_access_log WHERE trainer_id = %s ORDER BY id", (self.t1,))
        self.assertEqual([r[0] for r in cur.fetchall()], ["grant", "revoke"])
        conn.close()
        # the same trainer can be given an access again later
        again = self.call("POST", "/admin/trainer-access", "admin", json={"trainer_id": self.t1, "email": f"uno{DOMAIN}", "confirm": True})
        self.assertEqual(again.status_code, 200, again.text)

    # ------------------------------------------------------------------ team
    def test_dominika_exists_with_her_own_colour(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id, color FROM trainers WHERE LOWER(SPLIT_PART(nome, ' ', 1)) = 'dominika'")
        rows = cur.fetchall()
        self.assertEqual(len(rows), 1)
        cur.execute("SELECT COUNT(*) FROM trainers WHERE LOWER(color) = LOWER(%s) AND id <> %s", (rows[0][1], rows[0][0]))
        self.assertEqual(cur.fetchone()[0], 0)
        conn.close()
        trainer_area.ensure_dominika()                                       # idempotent
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM trainers WHERE LOWER(SPLIT_PART(nome, ' ', 1)) = 'dominika'")
        self.assertEqual(cur.fetchone()[0], 1)
        conn.close()

    def test_google_event_colours_follow_the_trainers_table(self):
        import event_format
        event_format._color_cache.update(until=0.0, map={})
        self.assertEqual(event_format.trainer_color_id("TEST TA Uno"), "1")      # palette position of its colour or the fallback, never a crash
        self.assertEqual(event_format.trainer_color_id("Unknown Person"), "1")


if __name__ == "__main__":
    unittest.main()

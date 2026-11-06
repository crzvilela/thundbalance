"""The history of a client's packs:

    python -m unittest test_pack_history -v

A New pack replaces the current one WITHOUT deleting it (the old one becomes 'sustituido' with replaced_at), the
endpoint lists every pack newest first with its sessions, packs from before these columns get only what the data
says, and the endpoint is admin only. Google is faked; the local database is used and cleaned up.
"""
import unittest

import pack_schedule
import catalog_testing
from datetime import date, timedelta

import testsafety
from fastapi.testclient import TestClient

import google_fakes
import main
import packs
import pack_view
import plans_schema
from database import get_connection

DOMAIN = "@test-history.example"


def weekday_after(offset):
    day = date.today() + timedelta(days=offset)
    while day.weekday() > 4:
        day += timedelta(days=1)
    return day


class History(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        testsafety.require_local_database()
        for name in ("ensure_trial_session_fields", "ensure_session_pack_column", "ensure_calendar_sync_columns",
                     "ensure_client_lifecycle_columns", "ensure_client_workflow_fields"):
            getattr(main, name)()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 1")
        cls.trainer_id = cur.fetchone()[0]
        cur.execute(f"INSERT INTO plans (nome, {plans_schema.price_column(cur)}, duracao_meses, duration_weeks) VALUES ('TEST history', 0, 1, 2) RETURNING id")
        cls.plan_id = cur.fetchone()[0]
        cls.pack_ids = catalog_testing.make_pair(cur, cls.plan_id)
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
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
            cur.execute("DELETE FROM users WHERE id = ANY(%s)", (ids,))
        conn.commit()
        conn.close()

    def setUp(self):
        self.cleanup()
        self.google = google_fakes.FakeGoogle().install()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO users (nome, email) VALUES ('Henrique Historia', %s) RETURNING id", (f"hh{DOMAIN}",))
        self.user_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        main.app.dependency_overrides[main.require_admin] = lambda: {"email": main.ADMIN_EMAIL, "sub": "uid-admin"}
        self.http = TestClient(main.app)

    def tearDown(self):
        self.google.uninstall()
        main.app.dependency_overrides.clear()
        self.cleanup()

    def new_pack(self, start_offset, session_type=None, name=None, email=None):
        for route in main.app.routes:
            if getattr(route, "path", None) == "/admin/clients/{client_id}/renew-pack" and "POST" in route.methods:
                return route.endpoint(self.user_id, main.NewPack(
                    pack_id=self.pack_ids[session_type or "individual"], sessions_per_week=2, schedule=pack_schedule.uniform("Monday,Wednesday", "09:00", self.trainer_id), start_date=weekday_after(start_offset).isoformat(), email_extra=[],
                    email_client=False, allow_conflicts=True, allow_overlaps=True,
                    session_type=session_type, second_person_name=name, second_person_email=email))

    def history(self):
        response = self.http.get(f"/admin/clients/{self.user_id}/packs")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_a_new_pack_does_not_replace_the_current_one_both_are_active_and_each_keeps_its_own_numbers(self):
        self.new_pack(10)
        self.new_pack(30, "dual", "Beatriz Prueba", f"b{DOMAIN}")
        packs_list = self.history()
        self.assertEqual(len(packs_list), 2)                                    # nothing was lost
        newest, oldest = packs_list                                              # newest first
        self.assertEqual((newest["status"], oldest["status"]), ("activo", "activo"))
        self.assertNotIn("replaced_at", newest)                                  # nothing is "replaced" any more
        self.assertIsNotNone(newest["created_at"])
        self.assertEqual((newest["session_type"], newest["price_per_session"], newest["total_price"]), ("dual", 80, 80 * 4))
        self.assertEqual((oldest["session_type"], oldest["price_per_session"], oldest["total_price"]), ("individual", 65, 65 * 4))
        self.assertEqual((newest["duration_months"], newest["sessions_per_week"]), (1, 2))
        for pack in (newest, oldest):                                            # y is the total of THAT pack, x counts from 1
            self.assertEqual((pack["planned"], pack["used"], len(pack["sessions"])), (4, 0, 4))
            self.assertEqual([item["number"] for item in pack["sessions"]], ["1/4", "2/4", "3/4", "4/4"])
            self.assertEqual({item["status"] for item in pack["sessions"]}, {"Booked"})

    def test_old_packs_get_only_what_the_data_says_and_a_stored_sustituido_is_read_from_the_sessions(self):
        conn = get_connection()
        cur = conn.cursor()
        past = date.today() - timedelta(days=60)
        for active, start, status in ((False, past, "sustituido"), (True, past + timedelta(days=30), None)):
            cur.execute("INSERT INTO user_plans (user_id, plan_id, active, start_date, end_date, status) VALUES (%s, %s, %s, %s, %s, %s)",
                        (self.user_id, self.plan_id, active, start, start + timedelta(days=20), status))
        conn.commit()
        packs.ensure_pack_columns()                                              # what happens at the next start
        conn.close()
        newest, oldest = self.history()
        self.assertEqual(oldest["status"], "finalizado")                         # the old 'sustituido' state is not used any more
        self.assertIsNone(oldest["created_at"])                                  # when is unknown: not invented
        self.assertIsNone(oldest["price_per_session"])
        self.assertEqual(oldest["duration_months"], 1)                           # the one of its plan
        self.assertEqual(newest["status"], "finalizado")                         # active flag, no sessions, period over

    def test_the_state_rules(self):
        today = date.today()
        state = pack_view.pack_state
        self.assertEqual(state("sustituido", False, 8, 3, 0, today, today), "finalizado")   # an old stored state is ignored
        self.assertEqual(state(None, False, 8, 3, 5, today, today), "activo")               # sessions still to come
        self.assertEqual(state("activo", False, 8, 8, 0, today - timedelta(days=1), today), "finalizado")
        self.assertEqual(state("activo", False, 8, 0, 0, today, today), "cancelado")
        self.assertEqual(state(None, True, 0, 0, 0, today + timedelta(days=3), today), "activo")   # not started, no sessions yet

    def test_only_an_admin_can_read_it_and_the_client_has_no_such_endpoint(self):
        main.app.dependency_overrides.clear()
        self.assertEqual(TestClient(main.app).get(f"/admin/clients/{self.user_id}/packs").status_code, 401)
        self.assertEqual(self.http.get("/admin/clients/999999999/packs").status_code, 401)   # (no override any more)
        paths = {getattr(route, "path", "") for route in main.app.routes}
        self.assertNotIn("/me/packs", paths)

    def test_unknown_client_is_a_404(self):
        main.app.dependency_overrides[main.require_admin] = lambda: {"email": main.ADMIN_EMAIL, "sub": "uid-admin"}
        self.assertEqual(self.http.get("/admin/clients/999999999/packs").status_code, 404)


if __name__ == "__main__":
    unittest.main()

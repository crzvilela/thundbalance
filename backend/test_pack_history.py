"""The history of a client's packs:

    python -m unittest test_pack_history -v

A New pack replaces the current one WITHOUT deleting it (the old one becomes 'sustituido' with replaced_at), the
endpoint lists every pack newest first with its sessions, packs from before these columns get only what the data
says, and the endpoint is admin only. Google is faked; the local database is used and cleaned up.
"""
import unittest
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
                    plan_id=self.plan_id, sessions_per_week=2, preferred_days="Monday,Wednesday", preferred_time="09:00",
                    trainer_id=self.trainer_id, start_date=weekday_after(start_offset).isoformat(), email_extra=[],
                    email_client=False, allow_conflicts=True, confirm_replace=True,
                    session_type=session_type, second_person_name=name, second_person_email=email))

    def history(self):
        response = self.http.get(f"/admin/clients/{self.user_id}/packs")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_a_new_pack_replaces_the_current_one_and_both_stay_in_the_history(self):
        self.new_pack(10)
        self.new_pack(30, "dual", "Beatriz Prueba", f"b{DOMAIN}")
        packs_list = self.history()
        self.assertEqual(len(packs_list), 2)                                    # nothing was lost
        newest, oldest = packs_list                                              # newest first
        self.assertEqual((newest["status"], oldest["status"]), ("activo", "sustituido"))
        self.assertIsNone(newest["replaced_at"])
        self.assertIsNotNone(oldest["replaced_at"])
        self.assertIsNotNone(newest["created_at"])
        self.assertEqual((newest["session_type"], newest["price_per_session"], newest["total_price"]), ("dual", 80, 80 * 4))
        self.assertEqual((oldest["session_type"], oldest["price_per_session"], oldest["total_price"]), ("individual", 65, 65 * 4))
        self.assertEqual((newest["duration_months"], newest["sessions_per_week"]), (1, 2))
        self.assertEqual((newest["planned"], newest["used"], len(newest["sessions"])), (4, 0, 4))

    def test_the_replaced_packs_future_sessions_are_listed_as_cancelled_not_lost(self):
        self.new_pack(10)
        self.new_pack(11)                                                         # replaces from a date inside the first pack
        newest, oldest = self.history()
        self.assertEqual(oldest["planned"], 4)                                    # every session is still there
        self.assertEqual(oldest["cancelled"] + oldest["remaining"] + oldest["used"], 4)
        self.assertGreater(oldest["cancelled"], 0)
        self.assertEqual(oldest["sessions"][0]["number"], "1/4")

    def test_old_packs_get_only_what_the_data_says(self):
        conn = get_connection()
        cur = conn.cursor()
        past = date.today() - timedelta(days=60)
        for active, start in ((False, past), (True, past + timedelta(days=30))):
            cur.execute("INSERT INTO user_plans (user_id, plan_id, active, start_date, end_date) VALUES (%s, %s, %s, %s, %s)",
                        (self.user_id, self.plan_id, active, start, start + timedelta(days=20)))
        conn.commit()
        packs.ensure_pack_columns()                                              # what happens at the next start
        conn.close()
        newest, oldest = self.history()
        self.assertEqual(oldest["status"], "sustituido")                         # inactive and followed by a later pack
        self.assertIsNone(oldest["replaced_at"])                                 # when is unknown: not invented
        self.assertIsNone(oldest["created_at"])
        self.assertIsNone(oldest["price_per_session"])
        self.assertEqual(oldest["duration_months"], 1)                           # the one of its plan
        self.assertEqual(newest["status"], "finalizado")                         # active flag, no sessions, period over

    def test_the_state_rules(self):
        today = date.today()
        state = pack_view.pack_state
        self.assertEqual(state("sustituido", False, 8, 3, 0, today, today), "sustituido")
        self.assertEqual(state(None, True, 8, 3, 5, today, today), "activo")
        self.assertEqual(state("activo", False, 8, 8, 0, today - timedelta(days=1), today), "finalizado")
        self.assertEqual(state("activo", False, 8, 0, 0, today, today), "cancelado")

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

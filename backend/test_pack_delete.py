"""Excluir pack (Admin > Packs) and the form of a new pack:

    python -m unittest test_pack_delete -v

DELETE /admin/plans/{id}: a pack nobody used is deleted for good; a pack that clients use (or asked for) is only archived, so
their packs keep working. A pack created, edited or excluded never touches the landing page. A new pack carries the fields of
the form and its total is worked out by the server. The local database is used and cleaned up.
"""
import unittest

import testsafety
from fastapi.testclient import TestClient

import main
import pack_view
from database import get_connection

DOMAIN = "@test-delete.example"
NAME = "TEST delete Pack"


class DeletePack(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        testsafety.require_local_database()
        main.ensure_client_workflow_fields()

    @classmethod
    def cleanup(cls):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        ids = [row[0] for row in cur.fetchall()]
        if ids:
            cur.execute("DELETE FROM user_plans WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM client_requests WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM users WHERE id = ANY(%s)", (ids,))
        cur.execute("DELETE FROM pack_catalog WHERE name LIKE 'TEST delete%'")
        cur.execute("DELETE FROM plans WHERE nome LIKE 'TEST delete%'")
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        cls.cleanup()

    def setUp(self):
        self.cleanup()
        main.app.dependency_overrides[main.require_admin] = lambda: {"email": main.ADMIN_EMAIL, "sub": "uid-admin"}
        self.http = TestClient(main.app)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO users (nome, email) VALUES ('Cliente Delete', %s) RETURNING id", (f"cd{DOMAIN}",))
        self.user_id = cur.fetchone()[0]
        conn.commit()
        conn.close()

    def tearDown(self):
        main.app.dependency_overrides.clear()
        self.cleanup()

    def create(self, **changes):
        body = {"name": NAME, "session_type": "individual", "weeks": 8, "sessions_per_week_options": [2], "price_per_session": 62.5}
        body.update(changes)
        response = self.http.post("/admin/pack-catalog", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def rows(self, sql, params):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(sql, params)
        found = cur.fetchall()
        conn.close()
        return found

    def listed(self):
        return {pack["id"]: pack for pack in self.http.get("/admin/pack-catalog").json()["packs"]}

    def on_sale(self):
        return {pack["id"] for pack in TestClient(main.app).get("/pricing").json()["packs"]}

    # ----- the form of a new pack
    def test_a_new_pack_has_the_fields_of_the_form_and_the_server_works_out_the_totals(self):
        pack = self.create(objective="Ganar fuerza", benefits=["Plan de nutrición"], price_per_pack=1)      # a price sent for the pack is ignored
        for field in ("name", "objective", "weeks", "price_per_session", "benefits", "total_sessions", "price_total"):
            self.assertIn(field, pack)
        self.assertEqual((pack["name"], pack["objective"], pack["weeks"], pack["price_per_session"], pack["benefits"]),
                         (NAME, "Ganar fuerza", 8, 62.5, ["Plan de nutrición"]))
        self.assertEqual((pack["total_sessions"], pack["price_total"]), (16, 1000))                         # 16 sessions x 62.5, worked out by the server

    def test_a_pack_made_from_the_admin_form_has_no_separate_pack_price(self):
        pack = self.create(price_per_pack=None)
        self.assertIsNone(pack["price_per_pack"])
        self.assertEqual(pack["price_total"], pack["total_sessions"] * pack["price_per_session"])

    # ----- Excluir pack
    def test_a_pack_nobody_used_is_deleted_for_good(self):
        pack = self.create()
        response = self.http.delete(f"/admin/plans/{pack['id']}")
        self.assertEqual((response.status_code, response.json()["outcome"]), (200, "deleted"))
        self.assertNotIn(pack["id"], self.listed())
        self.assertNotIn(pack["id"], self.on_sale())
        self.assertEqual(self.rows("SELECT 1 FROM pack_catalog WHERE id = %s", (pack["id"],)), [])
        self.assertEqual(self.rows("SELECT 1 FROM plans WHERE id = %s", (pack["plan_id"],)), [])           # its snapshot goes too

    def test_a_pack_that_clients_use_is_archived_and_their_packs_keep_working(self):
        pack = self.create()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO user_plans (user_id, plan_id, catalog_pack_id, session_type, active, weeks, price_per_session, total_price, sessions_per_week) "
            "VALUES (%s, %s, %s, 'individual', TRUE, 8, 62.5, 1000, 2) RETURNING id", (self.user_id, pack["plan_id"], pack["id"]))
        user_plan = cur.fetchone()[0]
        conn.commit()
        conn.close()
        response = self.http.delete(f"/admin/plans/{pack['id']}")
        self.assertEqual((response.status_code, response.json()["outcome"]), (200, "archived"))
        self.assertFalse(response.json()["pack"]["active"])
        self.assertNotIn(pack["id"], self.on_sale())                                                       # hidden from the selectors
        self.assertTrue(self.listed()[pack["id"]]["archived_at"])                                          # still in the catalogue
        self.assertEqual(len(self.rows("SELECT 1 FROM user_plans WHERE id = %s AND active", (user_plan,))), 1)
        conn = get_connection()
        cur = conn.cursor()
        packs, _assignment = pack_view.user_packs(cur, self.user_id)                                      # the client's pack still reads fine
        conn.close()
        self.assertEqual([item["name"] for item in packs], [NAME])

    def test_a_pack_with_a_request_from_a_client_is_archived_too(self):
        pack = self.create()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO client_requests (user_id, plan_id, catalog_pack_id, session_type, status) VALUES (%s, %s, %s, 'individual', 'pending')",
                    (self.user_id, pack["plan_id"], pack["id"]))
        conn.commit()
        conn.close()
        self.assertEqual(self.http.delete(f"/admin/plans/{pack['id']}").json()["outcome"], "archived")
        self.assertEqual(len(self.rows("SELECT 1 FROM client_requests WHERE catalog_pack_id = %s", (pack["id"],))), 1)

    def test_an_archived_pack_that_nobody_used_can_still_be_deleted(self):
        pack = self.create()
        self.http.post(f"/admin/pack-catalog/{pack['id']}/archive")
        self.assertEqual(self.http.delete(f"/admin/plans/{pack['id']}").json()["outcome"], "deleted")

    def test_errors_are_clear(self):
        response = self.http.delete("/admin/plans/99999999")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"]["code"], "pack_not_found")
        self.assertIn(" / ", response.json()["detail"]["message"])                                         # Spanish / English
        main.app.dependency_overrides.clear()
        self.assertIn(TestClient(main.app).delete("/admin/plans/1").status_code, (401, 403))              # only an admin

    def test_the_pack_selection_of_the_client_reads_the_catalogue_not_the_landing_and_has_no_objective_on_the_page(self):
        pack = self.create(objective="Meta", benefits=["Uno"])
        public = {item["id"]: item for item in TestClient(main.app).get("/pricing").json()["packs"]}
        self.assertIn(pack["id"], public)                                                                  # the request page can offer it
        with open("../src/pages/TrainingRequest.jsx", encoding="utf-8") as handle:
            page = handle.read()
        self.assertNotIn("objective", page)
        self.assertNotIn("benefits", page)
        self.assertNotIn("landing", page.lower())


if __name__ == "__main__":
    unittest.main()

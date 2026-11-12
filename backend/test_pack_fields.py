"""Objective and benefits of a catalogue pack (Admin > Packs), and the totals that are worked out, not stored:

    python -m unittest test_pack_fields -v

Optional text fields on a pack: nothing breaks for a pack that has none; the server validates them (the browser is never
trusted); the total sessions and the total price are CALCULATED by the server; the client sees them on the landing card only
(GET /pricing feeds it): not in the e-mail nor on the request page. The local database is used and cleaned up.
"""
import unittest
from datetime import datetime

import testsafety
from fastapi.testclient import TestClient

import main
import pack_catalog
from database import get_connection
from emails import render_pack_summary_block

NAME = "TEST fields Pack 8 semanas"


class PackFields(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        testsafety.require_local_database()
        main.ensure_client_workflow_fields()

    @classmethod
    def cleanup(cls):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM pack_catalog WHERE name LIKE 'TEST fields%'")
        cur.execute("DELETE FROM plans WHERE nome LIKE 'TEST fields%'")
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        cls.cleanup()

    def setUp(self):
        self.cleanup()
        main.app.dependency_overrides[main.require_admin] = lambda: {"email": main.ADMIN_EMAIL, "sub": "uid-admin"}
        self.http = TestClient(main.app)

    def tearDown(self):
        main.app.dependency_overrides.clear()
        self.cleanup()

    def body(self, **changes):
        base = {"name": NAME, "session_type": "individual", "weeks": 8, "sessions_per_week_options": [2],
                "price_per_session": 60, "price_per_pack": None}
        base.update(changes)
        return base

    def create(self, **changes):
        response = self.http.post("/admin/pack-catalog", json=self.body(**changes))
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def refuse(self, field, **changes):
        response = self.http.post("/admin/pack-catalog", json=self.body(**changes))
        self.assertEqual(response.status_code, 422, response.text)
        detail = response.json()["detail"]
        self.assertEqual((detail["code"], detail["field"]), (f"invalid_{field}", field))
        self.assertIn(" / ", detail["message"])                              # one message in Spanish and English
        return detail

    # ----- create / read
    def test_a_pack_with_all_the_fields_keeps_them_and_works_out_its_totals(self):
        pack = self.create(objective="  Ganar   fuerza ", benefits=["Plan de nutrición", " Seguimiento semanal "])
        self.assertEqual(pack["objective"], "Ganar fuerza")                    # spaces tidied
        self.assertEqual(pack["benefits"], ["Plan de nutrición", "Seguimiento semanal"])
        self.assertEqual((pack["total_sessions"], pack["price_total"]), (16, 960))   # 8 weeks x 2 x 60
        self.assertEqual(pack["totals"], [{"per_week": 2, "sessions": 16, "total": 960}])
        again = next(item for item in self.http.get("/admin/pack-catalog").json()["packs"] if item["id"] == pack["id"])
        self.assertEqual((again["objective"], again["benefits"]), (pack["objective"], pack["benefits"]))

    def test_a_pack_without_the_new_fields_still_works(self):
        pack = self.create()
        self.assertEqual((pack["objective"], pack["benefits"]), (None, []))
        self.assertEqual(pack["price_total"], 960)

    def test_the_totals_come_from_the_server_and_never_from_the_browser(self):
        pack = self.create(total_sessions=1, price_total=1, totals=[], price_per_pack=None)
        self.assertEqual((pack["total_sessions"], pack["price_total"]), (16, 960))
        many = self.create(name=NAME + " b", sessions_per_week_options=[1, 3], price_per_session=50)
        self.assertEqual([(line["per_week"], line["sessions"], line["total"]) for line in many["totals"]], [(1, 8, 400), (3, 24, 1200)])
        self.assertEqual((many["total_sessions"], many["price_total"]), (None, None))   # the client chooses: no single total

    def test_an_explicit_pack_price_is_the_total_with_one_option(self):
        pack = self.create(price_per_pack=900)
        self.assertEqual((pack["total_sessions"], pack["price_total"]), (16, 900))

    # ----- validation
    def test_the_objective_is_validated(self):
        self.refuse("objective", objective="x" * 161)
        self.refuse("objective", objective="<b>fuerza</b>")
        self.refuse("objective", objective="a > b")
        self.refuse("objective", objective="línea\x00nula")
        self.assertEqual(self.create(objective="x" * 160)["objective"], "x" * 160)
        self.assertIsNone(self.create(name=NAME + " c", objective="   ")["objective"])     # blank = none

    def test_the_benefits_are_validated(self):
        self.refuse("benefits", benefits=[f"beneficio {n}" for n in range(9)])                 # at most 8
        self.refuse("benefits", benefits=["x" * 81])
        self.refuse("benefits", benefits=["<script>alert(1)</script>"])
        self.refuse("benefits", benefits=["Uno", "uno"])                                       # repeated, any case
        self.refuse("benefits", benefits=[5])
        eight = self.create(benefits=[f"beneficio {n}" for n in range(8)])
        self.assertEqual(len(eight["benefits"]), 8)
        self.assertEqual(self.create(name=NAME + " d", benefits=["", "  ", "Uno", "x" * 80])["benefits"], ["Uno", "x" * 80])   # blanks dropped

    def test_the_other_fields_are_still_validated(self):
        self.refuse("name", name="")
        self.refuse("weeks", weeks=0)
        self.refuse("price_per_session", price_per_session=-1)

    # ----- edit
    def test_editing_an_old_pack_without_the_fields_keeps_what_it_had_and_empty_clears_it(self):
        pack = self.create(objective="Meta", benefits=["Uno"])
        edit = self.body(name=NAME + " editado")                                  # an older form: no objective / benefits keys
        kept = self.http.put(f"/admin/pack-catalog/{pack['id']}", json=edit).json()
        self.assertEqual((kept["objective"], kept["benefits"]), ("Meta", ["Uno"]))
        cleared = self.http.put(f"/admin/pack-catalog/{pack['id']}", json={**edit, "objective": "", "benefits": []}).json()
        self.assertEqual((cleared["objective"], cleared["benefits"]), (None, []))
        refused = self.http.put(f"/admin/pack-catalog/{pack['id']}", json={**edit, "benefits": ["a", "A"]})
        self.assertEqual(refused.status_code, 422)

    def test_a_pack_that_existed_before_the_columns_has_them_empty(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM pack_catalog WHERE objective IS NULL AND benefits IS NULL")
        self.assertGreater(cur.fetchone()[0], 0)                                   # the seeded packs
        conn.close()
        main.ensure_client_workflow_fields()                                       # the next start: idempotent
        main.ensure_client_workflow_fields()

    # ----- the client
    def test_the_client_sees_the_fields_of_a_pack_on_sale_and_not_those_of_an_archived_one(self):
        pack = self.create(objective="Meta", benefits=["Uno", "Dos"])
        public = {item["name"]: item for item in TestClient(main.app).get("/pricing").json()["packs"]}
        mine = public[NAME]
        self.assertEqual((mine["objective"], mine["benefits"], mine["total_sessions"], mine["price_total"]), ("Meta", ["Uno", "Dos"], 16, 960))
        self.http.post(f"/admin/pack-catalog/{pack['id']}/archive")
        self.assertNotIn(NAME, {item["name"] for item in TestClient(main.app).get("/pricing").json()["packs"]})

    # ----- the e-mail
    def summary(self, **extra):
        return {"client_name": "Ana", "client_email": "ana@example.com", "plan_name": "Pack 8", "sessions_per_week": 2,
                "days": ["Monday"], "trainer": "Carles",
                "sessions": [{"id": 1, "start": datetime(2026, 10, 12, 9), "trainer": "Carles", "number": "1/1"}], **extra}

    def test_the_pack_email_never_shows_objective_or_benefits(self):
        # they only appear on the card of the landing page: not in the e-mail, even if the summary happens to carry them
        extra = {"objective": "Ganar fuerza", "benefits": ["Plan de nutrición", "Seguimiento semanal"]}
        for lang in ("es", "en", "ca"):
            block = render_pack_summary_block(self.summary(**extra), lang)
            for text in (block.html, block.text):
                self.assertNotIn("Ganar fuerza", text)
                self.assertNotIn("Plan de nutrición", text)
            plain = render_pack_summary_block(self.summary(), lang)
            self.assertEqual(plain.html, block.html)
            self.assertEqual(plain.text, block.text)


if __name__ == "__main__":
    unittest.main()

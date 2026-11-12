"""Which packs the Pricing section of the landing shows (landing_pricing.py):

    python -m unittest test_landing_pricing -v

The section keeps its own list of packs. The one-time migration reproduces what the page showed, a pack created later does
not enter the list, and the migration never runs twice over the same section. A scratch landing version is used (never the
draft or the published content); the local database is used and cleaned up.
"""
import copy
import unittest

import testsafety
from fastapi.testclient import TestClient
from psycopg2.extras import Json as PgJson

import landing_pricing
import main
from database import get_connection

VERSION = "test-landing-pricing"
NAME = "TEST landing Pack"


def pack(pack_id, session_type):
    return {"id": pack_id, "session_type": session_type, "name": f"P{pack_id}"}


def pricing_section(cards=3, **extra):
    return {"type": "pricing", "visible": True, "plans": [{"name": f"card {n}"} for n in range(cards)], **extra}


class Migration(unittest.TestCase):
    def test_the_list_reproduces_what_the_page_showed_by_type_in_catalogue_order(self):
        packs = [pack(1, "individual"), pack(2, "individual"), pack(3, "individual"), pack(4, "dual"), pack(5, "dual"), pack(6, "individual")]
        content = {"sections": {"pricing": pricing_section(cards=3)}}
        self.assertTrue(landing_pricing.migrate_content(content, packs))
        items = content["sections"]["pricing"]["planItems"]
        self.assertEqual([(item["plan_id"], item["card"]) for item in items],
                         [(1, 0), (2, 1), (3, 2), (6, None), (4, 0), (5, 1)])     # the 4th individual had no card: a plain one
        self.assertTrue(all(item["visible"] for item in items))

    def test_it_runs_once_a_section_that_has_a_list_is_never_touched(self):
        content = {"sections": {"pricing": pricing_section()}}
        landing_pricing.migrate_content(content, [pack(1, "individual")])
        first = copy.deepcopy(content)
        self.assertFalse(landing_pricing.migrate_content(content, [pack(1, "individual"), pack(2, "individual")]))
        self.assertEqual(content, first)                                              # no duplicate, the new pack is not added
        edited = {"sections": {"pricing": pricing_section(planItems=[])}}              # the admin emptied the list on purpose
        self.assertFalse(landing_pricing.migrate_content(edited, [pack(1, "individual")]))
        self.assertEqual(edited["sections"]["pricing"]["planItems"], [])

    def test_other_sections_and_odd_content_are_left_alone(self):
        content = {"sections": {"about": {"type": "about"}, "pricing": pricing_section()}}
        landing_pricing.migrate_content(content, [])
        self.assertNotIn("planItems", content["sections"]["about"])
        self.assertEqual(content["sections"]["pricing"]["planItems"], [])
        self.assertFalse(landing_pricing.migrate_content({}, []))
        self.assertFalse(landing_pricing.migrate_content(None, []))


class InDatabase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        testsafety.require_local_database()
        main.ensure_client_workflow_fields()
        main.ensure_landing_page_table()

    @classmethod
    def cleanup(cls):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM landing_page_content WHERE version = %s", (VERSION,))
        cur.execute("DELETE FROM pack_catalog WHERE name LIKE 'TEST landing%'")
        cur.execute("DELETE FROM plans WHERE nome LIKE 'TEST landing%'")
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

    def put_content(self, content):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO landing_page_content (version, content) VALUES (%s, %s)", (VERSION, PgJson(content)))
        conn.commit()
        conn.close()

    def read_content(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT content FROM landing_page_content WHERE version = %s", (VERSION,))
        content = cur.fetchone()[0]
        conn.close()
        return content

    def migrate(self):
        conn = get_connection()
        cur = conn.cursor()
        changed = landing_pricing.migrate_version(cur, VERSION)
        conn.commit()
        conn.close()
        return changed

    def test_the_saved_content_gets_its_list_once_with_the_packs_on_sale_and_a_new_pack_does_not_enter(self):
        self.put_content({"sections": {"pricing": pricing_section(cards=3)}})
        self.assertTrue(self.migrate())
        migrated = self.read_content()["sections"]["pricing"]["planItems"]
        on_sale = TestClient(main.app).get("/pricing").json()["packs"]
        self.assertEqual({item["plan_id"] for item in migrated}, {item["id"] for item in on_sale})
        self.assertEqual(len(migrated), len(on_sale))                                  # nobody twice
        created = self.http.post("/admin/pack-catalog", json={
            "name": NAME, "session_type": "individual", "weeks": 8, "sessions_per_week_options": [2], "price_per_session": 60}).json()
        self.assertFalse(self.migrate())                                              # the second run changes nothing
        after = self.read_content()["sections"]["pricing"]["planItems"]
        self.assertEqual(after, migrated)
        self.assertNotIn(created["id"], [item["plan_id"] for item in after])          # a new pack is NOT on the landing
        self.assertIn(created["id"], [item["id"] for item in TestClient(main.app).get("/pricing").json()["packs"]])   # but it can be chosen

    def test_the_catalogue_still_gives_objective_and_benefits_for_the_landing_card(self):
        created = self.http.post("/admin/pack-catalog", json={
            "name": NAME, "session_type": "individual", "weeks": 8, "sessions_per_week_options": [2], "price_per_session": 60,
            "objective": "Meta", "benefits": ["Uno"]}).json()
        mine = next(item for item in TestClient(main.app).get("/pricing").json()["packs"] if item["id"] == created["id"])
        self.assertEqual((mine["objective"], mine["benefits"], mine["total_sessions"]), ("Meta", ["Uno"], 16))

    def test_the_real_draft_and_published_content_already_carry_their_list(self):
        conn = get_connection()
        cur = conn.cursor()
        landing_pricing.migrate_all(cur)
        conn.commit()
        for version in ("draft", "published"):
            cur.execute("SELECT content FROM landing_page_content WHERE version = %s", (version,))
            row = cur.fetchone()
            for section in ((row[0] if row else {}).get("sections") or {}).values():
                if isinstance(section, dict) and section.get("type") == "pricing":
                    self.assertIn("planItems", section)
        conn.close()


if __name__ == "__main__":
    unittest.main()

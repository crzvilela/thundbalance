"""The Pricing section of the landing page: Individual | Dual, three prices each, written by hand (landing_pricing.py):

    python -m unittest test_landing_pricing -v

One public answer for everybody; the prices have no link with the catalogue of packs; the content written by the earlier
versions of the section is migrated once, after a backup, without losing anything. A scratch landing version is used for the
migration; the real draft is restored after the tests that save it. The local database is used and cleaned up.
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
PERIOD = {"en": "/session", "es": "/sesión", "ca": "/sessió"}


def pack(pack_id, session_type="individual", weeks=4, **changes):
    base = {"id": pack_id, "session_type": session_type, "name": f"P{pack_id}", "weeks": weeks, "sessions_per_week_options": [1, 2],
            "price_per_session": 65, "price_per_pack": None, "objective": None, "benefits": []}
    base.update(changes)
    return base


def text_card(**changes):
    base = {"name": "old", "period": PERIOD, "description": {"en": "Described", "es": "Descrito", "ca": "Descrit"},
            "features": [{"en": "Feature", "es": "Característica", "ca": "Característica"}],
            "buttonText": {"en": "Get Started", "es": "Empezar", "ca": "Començar"}, "highlighted": False}
    base.update(changes)
    return base


CATALOGUE = [pack(1, "individual", 4, name="Monthly Plan", price_per_session=65), pack(2, "individual", 12, name="Quarterly Plan", price_per_session=60),
             pack(3, "individual", 24, name="Semiannual Plan", price_per_session=55), pack(4, "dual", 4, name="Dual 1 Month Pack", price_per_session=80),
             pack(5, "dual", 12, name="Dual 3 Months Pack", price_per_session=75), pack(6, "dual", 24, name="Dual 6 Months Pack", price_per_session=70),
             pack(7, "individual", 8, name="ACTIVE", price_per_session=75), pack(8, "individual", 8, name="oooooo", price_per_session=19)]


def manual_cards():
    """The cards as the Prompt 60 left them on the real site: eight of them, the last two are extra packs."""
    return [{"id": f"card-{p['id']}", "type": p["session_type"], "visible": True, "name": p["name"], "price": f"€{p['price_per_session']}",
             "period": PERIOD, "features": [f"feature of {p['id']}"], "benefits": [], "objective": "", "highlighted": False} for p in CATALOGUE]


def section(**extra):
    return {"type": "pricing", "visible": True, "plans": [text_card(), text_card(), text_card()], **extra}


class Migration(unittest.TestCase):
    def migrated(self, **extra):
        content = {"sections": {"pricing": section(**extra)}}
        reports = landing_pricing.migrate_content(content, CATALOGUE)
        return content["sections"]["pricing"], reports

    def test_the_manual_cards_go_to_their_type_and_tier_with_the_price_and_features_the_page_showed(self):
        result, reports = self.migrated(cards=manual_cards())
        prices = result["prices"]
        self.assertEqual([tier["price"]["en"] for tier in prices["individual"]], ["€65/session", "€60/session", "€55/session"])
        self.assertEqual([tier["price"]["es"] for tier in prices["dual"]], ["€80/sesión", "€75/sesión", "€70/sesión"])
        self.assertEqual([tier["features"] for tier in prices["individual"]], [["feature of 1"], ["feature of 2"], ["feature of 3"]])
        self.assertEqual([tier["features"] for tier in prices["dual"]], [["feature of 4"], ["feature of 5"], ["feature of 6"]])
        self.assertEqual(reports[0]["placed"], 6)

    def test_what_does_not_fit_is_kept_not_deleted_and_reported(self):
        result, reports = self.migrated(cards=manual_cards())
        self.assertEqual([card["name"] for card in result["legacyCards"]], ["ACTIVE", "oooooo"])
        self.assertEqual(reports[0]["kept"], ["ACTIVE", "oooooo"])
        self.assertEqual(result["legacyCards"][0]["price"], "€75")                        # the whole card, as it was
        self.assertNotIn("cards", result)
        self.assertNotIn("planItems", result)
        self.assertEqual(len(result["plans"]), 3)                                          # the shared texts stay

    def test_individual_and_dual_never_mix(self):
        result, _ = self.migrated(cards=manual_cards())
        individual = repr(result["prices"]["individual"])
        dual = repr(result["prices"]["dual"])
        self.assertNotIn("€80", individual)
        self.assertNotIn("€70", individual)
        self.assertNotIn("€65", dual)
        self.assertNotIn("feature of 4", individual)
        self.assertNotIn("feature of 1", dual)

    def test_a_card_without_a_pack_goes_by_its_name_and_type(self):
        cards = [{"id": "manual-1", "type": "dual", "name": "Plan Trimestral", "price": "99 €", "features": ["x"]},
                 {"id": "manual-2", "type": "individual", "name": "Mi extra", "price": "1 €", "features": []}]
        result, _ = self.migrated(cards=cards)
        self.assertEqual(result["prices"]["dual"][1], {"price": "99 €", "features": ["x"]})
        self.assertEqual([card["name"] for card in result["legacyCards"]], ["Mi extra"])

    def test_the_format_of_the_plan_list_and_the_oldest_format_also_migrate(self):
        items = [{"plan_id": 1, "visible": True, "card": 0}, {"plan_id": 5, "visible": True, "card": 1}, {"plan_id": 99, "visible": True, "card": 2}]
        listed, _ = self.migrated(planItems=items)
        self.assertEqual(listed["prices"]["individual"][0]["price"]["en"], "€65/session")
        self.assertEqual(listed["prices"]["dual"][1]["price"]["en"], "€75/session")
        self.assertEqual(listed["prices"]["individual"][2]["price"], "")                   # a pack that no longer exists: nothing
        self.assertNotIn("legacyCards", listed)
        oldest, _ = self.migrated()
        self.assertEqual([tier["price"]["en"] for tier in oldest["prices"]["individual"]], ["€65/session", "€60/session", "€55/session"])
        self.assertEqual(oldest["prices"]["individual"][0]["features"], text_card()["features"])

    def test_it_runs_once_a_section_with_prices_is_never_touched(self):
        result, _ = self.migrated(cards=manual_cards())
        content = {"sections": {"pricing": result}}
        first = copy.deepcopy(content)
        self.assertEqual(landing_pricing.migrate_content(content, CATALOGUE + [pack(9, "dual", 4, name="New")]), [])
        self.assertEqual(content, first)

    def test_texts_never_exceed_their_limits_and_the_result_validates(self):
        cards = manual_cards()
        cards[0]["price"] = "€" + "9" * 90
        cards[0]["features"] = ["f" * 150] * 12
        result, _ = self.migrated(cards=cards)
        landing_pricing.validate_content({"sections": {"pricing": result}})              # does not raise
        tier = result["prices"]["individual"][0]
        self.assertEqual((len(tier["price"]["en"]) <= 60, len(tier["features"]), len(tier["features"][0])), (True, 10, 100))

    def test_other_sections_and_odd_content_are_left_alone(self):
        content = {"sections": {"about": {"type": "about"}, "pricing": section()}}
        landing_pricing.migrate_content(content, [])
        self.assertNotIn("prices", content["sections"]["about"])
        self.assertEqual(landing_pricing.migrate_content({}, []), [])
        self.assertEqual(landing_pricing.migrate_content(None, []), [])


class Validation(unittest.TestCase):
    def check(self, prices):
        landing_pricing.validate_content({"sections": {"pricing": {"type": "pricing", "prices": prices}}})

    def refuse(self, field, prices):
        with self.assertRaises(Exception) as raised:
            self.check(prices)
        self.assertEqual((raised.exception.status_code, raised.exception.detail["field"]), (422, field))
        self.assertIn(" / ", raised.exception.detail["message"])                          # Spanish / English

    def tier(self, **changes):
        return {"individual": [{"price": "45 €", "features": ["a"], **changes}], "dual": []}

    def test_limits_and_html(self):
        self.check(self.tier(price="x" * 60, features=["x" * 100] * 10))
        self.refuse("price", self.tier(price="x" * 61))
        self.refuse("price", self.tier(price="<b>45</b>"))
        self.refuse("price", self.tier(price={"en": "ok", "es": "a > b"}))
        self.refuse("features", self.tier(features=["x"] * 11))
        self.refuse("features", self.tier(features=["x" * 101]))
        self.refuse("features", self.tier(features=["<script>"]))
        self.refuse("features", self.tier(features="no"))

    def test_shapes(self):
        self.refuse("prices", {"trio": []})
        self.refuse("prices", {"individual": [{}, {}, {}, {}]})
        self.refuse("prices", {"individual": ["x"]})
        self.refuse("prices", [])
        landing_pricing.validate_content({"sections": {"pricing": section(cards=[{"id": "a"}])}})   # an older format: accepted
        landing_pricing.validate_content({})


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
        cur.execute("DELETE FROM landing_page_content WHERE version IN (%s, %s)", (VERSION, f"backup-{VERSION}"))
        cur.execute("DELETE FROM pack_catalog WHERE name LIKE 'TEST landing%'")
        cur.execute("DELETE FROM plans WHERE nome LIKE 'TEST landing%'")
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        cls.cleanup()

    def setUp(self):
        self.cleanup()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT content FROM landing_page_content WHERE version = 'draft'")
        row = cur.fetchone()
        self.draft = row[0] if row else None
        conn.close()
        main.app.dependency_overrides[main.require_admin] = lambda: {"email": main.ADMIN_EMAIL, "sub": "uid-admin"}
        self.http = TestClient(main.app)

    def tearDown(self):
        main.app.dependency_overrides.clear()
        if self.draft is not None:
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("UPDATE landing_page_content SET content = %s WHERE version = 'draft'", (PgJson(self.draft),))
            conn.commit()
            conn.close()
        self.cleanup()

    def scratch(self, content=None):
        conn = get_connection()
        cur = conn.cursor()
        if content is not None:
            cur.execute("INSERT INTO landing_page_content (version, content) VALUES (%s, %s)", (VERSION, PgJson(content)))
            conn.commit()
        cur.execute("SELECT content FROM landing_page_content WHERE version = %s", (VERSION,))
        row = cur.fetchone()
        conn.close()
        return row[0] if row else None

    def backup(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT content FROM landing_page_content WHERE version = %s", (f"backup-{VERSION}",))
        row = cur.fetchone()
        conn.close()
        return row[0] if row else None

    def migrate(self):
        conn = get_connection()
        cur = conn.cursor()
        reports = landing_pricing.migrate_version(cur, VERSION)
        conn.commit()
        conn.close()
        return reports

    def create_pack(self, **changes):
        body = {"name": NAME, "session_type": "individual", "weeks": 8, "sessions_per_week_options": [2], "price_per_session": 60}
        body.update(changes)
        response = self.http.post("/admin/pack-catalog", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_the_json_is_saved_in_a_backup_row_before_migrating_and_nothing_is_lost(self):
        original = {"sections": {"pricing": section(cards=manual_cards())}, "marker": "kept"}
        self.scratch(copy.deepcopy(original))
        reports = self.migrate()
        self.assertEqual(len(reports), 1)
        self.assertEqual(self.backup(), original)                                          # the old JSON, byte for byte
        migrated = self.scratch()
        self.assertEqual(migrated["marker"], "kept")
        self.assertIn("prices", migrated["sections"]["pricing"])
        self.assertEqual(len(migrated["sections"]["pricing"]["plans"]), 3)

    def test_it_migrates_once_and_the_backup_is_never_overwritten(self):
        self.scratch({"sections": {"pricing": section(planItems=[])}})
        self.assertEqual(len(self.migrate()), 1)
        backup = self.backup()
        after = self.scratch()
        self.assertEqual(self.migrate(), [])                                                # the second run changes nothing
        self.assertEqual((self.scratch(), self.backup()), (after, backup))

    def test_creating_editing_or_archiving_a_pack_never_changes_the_landing(self):
        self.scratch({"sections": {"pricing": section(planItems=[])}})
        self.migrate()
        before = self.scratch()
        created = self.create_pack()
        self.http.put(f"/admin/pack-catalog/{created['id']}", json={**created, "name": NAME + " edited", "price_per_session": 99})
        self.http.post(f"/admin/pack-catalog/{created['id']}/archive")
        self.http.delete(f"/admin/plans/{created['id']}")
        self.migrate()
        self.assertEqual(self.scratch(), before)

    def test_the_public_landing_is_the_same_with_and_without_a_token_or_a_role(self):
        anonymous = TestClient(main.app).get("/landing-page/content", params={"version": "published"})
        self.assertEqual(anonymous.status_code, 200)
        main.app.dependency_overrides.clear()
        for headers in ({"Authorization": "Bearer not-a-real-token"}, {"Authorization": "Bearer "}, {}):
            other = TestClient(main.app).get("/landing-page/content", params={"version": "published"}, headers=headers)
            self.assertEqual(other.status_code, 200)
            self.assertEqual(other.json(), anonymous.json())                               # a client's or an admin's token changes nothing
        self.assertIn("max-age", anonymous.headers["cache-control"])
        self.assertIn("public", anonymous.headers["cache-control"])
        with open(main.__file__, encoding="utf-8") as handle:
            source = handle.read()
        start = source.index("def get_landing_page_content")
        self.assertNotIn("pack_catalog", source[start:start + 1800])                       # the endpoint never reads the catalogue

    def test_the_draft_with_prices_is_saved_and_published_exactly_as_written_and_bad_ones_are_refused(self):
        prices = {"individual": [{"price": "45 € / sesión", "features": ["Uno", "Dos"]}] * 3, "dual": [{"price": "Desde 120 €", "features": []}] * 3}
        draft = copy.deepcopy(self.draft) if self.draft else {"sections": {}}
        draft.setdefault("sections", {})["pricing"] = {**section(), "prices": prices}
        self.assertEqual(self.http.put("/landing-page/content/draft", json={"content": draft}).status_code, 200)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT content FROM landing_page_content WHERE version = 'draft'")
        self.assertEqual(cur.fetchone()[0]["sections"]["pricing"]["prices"], prices)
        conn.close()
        for bad in ({"price": "x" * 61}, {"price": "<b>"}, {"features": ["f"] * 11}, {"features": ["x" * 101]}):
            draft["sections"]["pricing"]["prices"] = {"individual": [{"price": "1", "features": [], **bad}], "dual": []}
            response = self.http.put("/landing-page/content/draft", json={"content": draft})
            self.assertEqual(response.status_code, 422, bad)
            self.assertEqual(response.json()["detail"]["code"], "invalid_pricing")
        self.assertEqual(self.http.post("/landing-page/publish", json={"content": draft}).status_code, 422)

    def test_the_real_draft_and_published_content_carry_their_prices_after_the_migration(self):
        conn = get_connection()
        cur = conn.cursor()
        landing_pricing.migrate_all(cur)
        conn.commit()
        for version in ("draft", "published"):
            cur.execute("SELECT content FROM landing_page_content WHERE version = %s", (version,))
            row = cur.fetchone()
            for item in ((row[0] if row else {}).get("sections") or {}).values():
                if isinstance(item, dict) and item.get("type") == "pricing":
                    self.assertIn("prices", item)
                    self.assertEqual(set(item["prices"]), {"individual", "dual"})
        conn.close()


if __name__ == "__main__":
    unittest.main()

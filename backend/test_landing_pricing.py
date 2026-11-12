"""The Pricing section of the landing page: manual cards (landing_pricing.py):

    python -m unittest test_landing_pricing -v

The cards are written by hand and have nothing to do with the catalogue of packs. The one-time migration turns what the page
showed (a list of catalogue packs) into manual cards with the same values; the draft is validated when it is saved; creating,
editing or deleting a pack never changes the landing. A scratch landing version is used for the migration; the real draft is
restored after the tests that save it. The local database is used and cleaned up.
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


def pack(pack_id, session_type="individual", **changes):
    base = {"id": pack_id, "session_type": session_type, "name": f"P{pack_id}", "weeks": 8, "sessions_per_week_options": [2],
            "price_per_session": 60, "price_per_pack": None, "objective": None, "benefits": []}
    base.update(changes)
    return base


def old_card(**changes):
    base = {"name": "old", "period": {"en": "/session", "es": "/sesión", "ca": "/sessió"},
            "description": {"en": "Described", "es": "Descrito", "ca": "Descrit"},
            "descriptionStyle": {"fontSize": 20}, "features": [{"en": "Feature", "es": "Característica", "ca": "Característica"}],
            "buttonText": {"en": "Get Started", "es": "Empezar", "ca": "Començar"}, "buttonTextStyle": {"color": "#000"}, "highlighted": True}
    base.update(changes)
    return base


def old_section(**extra):
    return {"type": "pricing", "visible": True, "plans": [old_card(), old_card(highlighted=False)], **extra}


class Migration(unittest.TestCase):
    def test_every_item_becomes_a_manual_card_with_the_values_the_page_showed_in_the_same_order_and_visibility(self):
        packs = [pack(1, objective="Meta", benefits=["Uno", "Dos"]), pack(2, "dual", weeks=4, sessions_per_week_options=[1, 2, 3], price_per_session=62.5)]
        section = old_section(planItems=[{"plan_id": 2, "visible": True, "card": 1}, {"plan_id": 1, "visible": False, "card": 0}])
        content = {"sections": {"pricing": section}}
        self.assertTrue(landing_pricing.migrate_content(content, packs))
        cards = content["sections"]["pricing"]["cards"]
        self.assertEqual([card["name"] for card in cards], ["P2", "P1"])               # same order
        self.assertEqual([card["visible"] for card in cards], [True, False])            # same visibility
        second = cards[1]
        self.assertEqual((second["price"], second["objective"], second["benefits"]), ("€60", "Meta", ["Uno", "Dos"]))
        self.assertEqual(second["description"], old_card()["description"])             # texts of the old card are copied
        self.assertEqual(second["features"], old_card()["features"])
        self.assertEqual(second["buttonText"], old_card()["buttonText"])
        self.assertEqual((second["period"], second["highlighted"]), (old_card()["period"], True))
        self.assertEqual(second["descriptionStyle"], {"fontSize": 20})
        self.assertEqual(second["duration"]["es"], "8 semanas · 2 sesiones por semana")
        self.assertEqual(second["totalSessions"]["en"], "16 sessions in total")
        first = cards[0]
        self.assertEqual(first["price"], "€62.50")
        self.assertEqual(first["duration"]["en"], "4 weeks · choose 1 / 2 / 3 sessions a week")
        self.assertEqual(first["totalSessions"]["es"], "un solo precio para las dos personas")   # several options: no fixed total
        self.assertNotIn("planItems", content["sections"]["pricing"])
        self.assertNotIn("plan_id", repr(cards))                                          # no link with the catalogue

    def test_a_pack_that_no_longer_exists_disappears_in_silence(self):
        section = old_section(planItems=[{"plan_id": 1, "visible": True, "card": 0}, {"plan_id": 99, "visible": True, "card": 1}])
        content = {"sections": {"pricing": section}}
        landing_pricing.migrate_content(content, [pack(1)])
        self.assertEqual([card["name"] for card in content["sections"]["pricing"]["cards"]], ["P1"])

    def test_the_oldest_format_without_a_list_also_migrates_by_type(self):
        content = {"sections": {"pricing": old_section()}}
        landing_pricing.migrate_content(content, [pack(1), pack(2, "dual"), pack(3), pack(4)])
        self.assertEqual([card["name"] for card in content["sections"]["pricing"]["cards"]], ["P1", "P3", "P4", "P2"])
        extra = content["sections"]["pricing"]["cards"][2]                                # the third individual had no text card
        self.assertEqual((extra["description"], extra["features"], extra["highlighted"]), ("", [], False))

    def test_it_runs_once_a_section_with_cards_is_never_touched(self):
        content = {"sections": {"pricing": old_section(planItems=[{"plan_id": 1, "visible": True, "card": 0}])}}
        landing_pricing.migrate_content(content, [pack(1)])
        first = copy.deepcopy(content)
        self.assertFalse(landing_pricing.migrate_content(content, [pack(1), pack(2)]))
        self.assertEqual(content, first)                                                  # nothing duplicated or added
        emptied = {"sections": {"pricing": {"type": "pricing", "cards": []}}}            # the admin deleted every card
        self.assertFalse(landing_pricing.migrate_content(emptied, [pack(1)]))
        self.assertEqual(emptied["sections"]["pricing"]["cards"], [])

    def test_a_migrated_text_never_exceeds_its_limit_and_the_result_validates(self):
        content = {"sections": {"pricing": old_section(planItems=[{"plan_id": 1, "visible": True, "card": 0}])}}
        landing_pricing.migrate_content(content, [pack(1, name="N" * 90, objective="O" * 300, benefits=["B" * 150] * 12)])
        landing_pricing.validate_content(content)                                        # does not raise
        card = content["sections"]["pricing"]["cards"][0]
        self.assertEqual((len(card["name"]), len(card["objective"]), len(card["benefits"]), len(card["benefits"][0])), (60, 200, 10, 100))

    def test_other_sections_and_odd_content_are_left_alone(self):
        content = {"sections": {"about": {"type": "about"}, "pricing": old_section()}}
        landing_pricing.migrate_content(content, [])
        self.assertNotIn("cards", content["sections"]["about"])
        self.assertEqual(content["sections"]["pricing"]["cards"], [])
        self.assertFalse(landing_pricing.migrate_content({}, []))
        self.assertFalse(landing_pricing.migrate_content(None, []))


class Validation(unittest.TestCase):
    def check(self, **changes):
        landing_pricing.validate_content({"sections": {"pricing": {"type": "pricing", "cards": [{"id": "a", **changes}]}}})

    def refuse(self, field, **changes):
        with self.assertRaises(Exception) as raised:
            self.check(**changes)
        detail = raised.exception.detail
        self.assertEqual((raised.exception.status_code, detail["field"]), (422, field))
        self.assertIn(" / ", detail["message"])                                          # Spanish / English

    def test_the_limits_of_every_field(self):
        for field, limit in landing_pricing.TEXT_LIMITS.items():
            self.check(**{field: "x" * limit})
            self.refuse(field, **{field: "x" * (limit + 1)})
            self.refuse(field, **{field: "<b>x</b>"})
            self.refuse(field, **{field: {"en": "ok", "es": "a > b"}})                  # every language is checked
        self.assertEqual(landing_pricing.TEXT_LIMITS["name"], 60)
        self.assertEqual((landing_pricing.TEXT_LIMITS["price"], landing_pricing.TEXT_LIMITS["objective"]), (40, 200))

    def test_benefits_up_to_ten_of_a_hundred_characters(self):
        self.check(benefits=["x" * 100] * 10)
        self.refuse("benefits", benefits=["x"] * 11)
        self.refuse("benefits", benefits=["x" * 101])
        self.refuse("benefits", benefits=["<script>"])
        self.refuse("benefits", benefits="not a list")
        self.refuse("features", features=["x"] * 11)

    def test_other_shapes_are_refused_and_the_old_format_is_accepted(self):
        self.refuse("visible", visible="yes")
        self.refuse("name", name=5)
        landing_pricing.validate_content({"sections": {"pricing": old_section(planItems=[{"plan_id": 1, "visible": True, "card": 0}])}})   # no cards: old format
        landing_pricing.validate_content({})
        with self.assertRaises(Exception):
            landing_pricing.validate_content({"sections": {"pricing": {"type": "pricing", "cards": [{"id": "a"}] * 31}}})


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

    def put_scratch(self, content):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO landing_page_content (version, content) VALUES (%s, %s)", (VERSION, PgJson(content)))
        conn.commit()
        conn.close()

    def read_scratch(self):
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

    def create_pack(self, **changes):
        body = {"name": NAME, "session_type": "individual", "weeks": 8, "sessions_per_week_options": [2], "price_per_session": 60}
        body.update(changes)
        response = self.http.post("/admin/pack-catalog", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def card_body(self, **changes):
        card = {"id": "manual-1", "visible": True, "name": "Mi pack", "price": "Desde 120 €", "objective": "Meta", "benefits": ["Uno", "Dos"],
                "buttonText": "Empezar", "highlighted": False}
        card.update(changes)
        draft = copy.deepcopy(self.draft) if self.draft else {"sections": {}}
        draft.setdefault("sections", {})["pricing"] = {"type": "pricing", "visible": True, "plans": [], "cards": [card]}
        return {"content": draft}

    def test_the_saved_content_migrates_once_and_the_cards_hold_no_link_to_the_catalogue(self):
        created = self.create_pack(objective="Meta", benefits=["Uno"])
        self.put_scratch({"sections": {"pricing": old_section(planItems=[{"plan_id": created["id"], "visible": True, "card": 0}])}})
        self.assertTrue(self.migrate())
        cards = self.read_scratch()["sections"]["pricing"]["cards"]
        self.assertEqual((len(cards), cards[0]["name"], cards[0]["price"], cards[0]["objective"], cards[0]["benefits"]), (1, NAME, "€60", "Meta", ["Uno"]))
        self.assertFalse(self.migrate())                                                  # the second run changes nothing
        self.assertEqual(self.read_scratch()["sections"]["pricing"]["cards"], cards)

    def test_creating_editing_or_archiving_a_pack_never_changes_the_landing(self):
        self.put_scratch({"sections": {"pricing": old_section(planItems=[])}})
        self.migrate()
        before = self.read_scratch()
        created = self.create_pack()
        self.http.put(f"/admin/pack-catalog/{created['id']}", json={**created, "name": NAME + " edited", "price_per_session": 99})
        self.http.post(f"/admin/pack-catalog/{created['id']}/archive")
        self.migrate()
        self.assertEqual(self.read_scratch(), before)

    def test_the_draft_with_a_manual_card_is_saved_exactly_as_written(self):
        response = self.http.put("/landing-page/content/draft", json=self.card_body())
        self.assertEqual(response.status_code, 200, response.text)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT content FROM landing_page_content WHERE version = 'draft'")
        saved = cur.fetchone()[0]["sections"]["pricing"]["cards"]
        conn.close()
        self.assertEqual((saved[0]["name"], saved[0]["price"], saved[0]["benefits"]), ("Mi pack", "Desde 120 €", ["Uno", "Dos"]))

    def test_the_server_refuses_html_long_texts_and_too_many_benefits(self):
        for changes in ({"name": "x" * 61}, {"price": "<b>45</b>"}, {"objective": "x" * 201}, {"benefits": ["b"] * 11}, {"benefits": ["x" * 101]}):
            response = self.http.put("/landing-page/content/draft", json=self.card_body(**changes))
            self.assertEqual(response.status_code, 422, changes)
            self.assertEqual(response.json()["detail"]["code"], "invalid_pricing_card")
        response = self.http.post("/landing-page/publish", json=self.card_body(name="<i>x</i>"))
        self.assertEqual(response.status_code, 422)

    def test_the_public_landing_content_is_served_without_the_catalogue(self):
        with open(main.__file__, encoding="utf-8") as handle:
            source = handle.read()
        start = source.index("def get_landing_page_content")
        self.assertNotIn("pack_catalog", source[start:start + 1500])                       # the endpoint never reads the catalogue

    def test_the_real_draft_and_published_content_already_carry_their_cards(self):
        conn = get_connection()
        cur = conn.cursor()
        landing_pricing.migrate_all(cur)
        conn.commit()
        for version in ("draft", "published"):
            cur.execute("SELECT content FROM landing_page_content WHERE version = %s", (version,))
            row = cur.fetchone()
            for section in ((row[0] if row else {}).get("sections") or {}).values():
                if isinstance(section, dict) and section.get("type") == "pricing":
                    self.assertIn("cards", section)
                    self.assertNotIn("planItems", section)
        conn.close()


if __name__ == "__main__":
    unittest.main()

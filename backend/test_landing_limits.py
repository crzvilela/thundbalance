"""Limits of the landing page content: python -m unittest test_landing_limits -v

The content that exists today (the default one and the one stored in the database) must pass with room to spare; a document that is
too big, too deep, with too many items or a too long text is refused with a clear 422.
"""
import copy
import json
import unittest

from fastapi import HTTPException

import landing_limits as limits
import main
from database import get_connection
from landing_page_default import DEFAULT_LANDING_CONTENT


def refused(content, what="content"):
    with unittest.TestCase().assertRaises(HTTPException) as caught:
        limits.validate_structure(content, what)
    assert caught.exception.status_code == 422
    return caught.exception.detail


def nested(levels):
    value = "x"
    for _ in range(levels):
        value = {"a": value}
    return value


class LandingLimits(unittest.TestCase):
    def test_the_content_of_today_passes_with_room_to_spare(self):
        size = len(json.dumps(DEFAULT_LANDING_CONTENT, ensure_ascii=False).encode("utf-8"))
        self.assertLess(size * 4, limits.MAX_BYTES)                       # the limit is at least 4 times what the default needs
        self.assertIs(limits.validate_structure(DEFAULT_LANDING_CONTENT), DEFAULT_LANDING_CONTENT)

    def test_the_content_stored_in_the_database_passes(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT version, content FROM landing_page_content")
        rows = cur.fetchall()
        conn.close()
        for version, content in rows:
            limits.validate_structure(content, version)

    def test_a_document_that_is_too_big_is_refused(self):
        big = copy.deepcopy(DEFAULT_LANDING_CONTENT)
        big["padding"] = ["y" * 1500 for _ in range(100)]                  # ~150 KB: every text and the list are within their limits
        detail = refused(big)
        self.assertEqual(detail["code"], "landing_too_large")
        self.assertIn("KB", detail["message"])
        self.assertIn(" / ", detail["message"])                            # Spanish / English

    def test_a_document_that_is_too_deep_is_refused(self):
        limits.validate_structure(nested(limits.MAX_DEPTH - 1))
        self.assertEqual(refused(nested(limits.MAX_DEPTH + 5))["code"], "landing_too_deep")

    def test_a_list_with_too_many_items_is_refused(self):
        limits.validate_structure({"items": list(range(limits.MAX_LIST))})
        detail = refused({"sections": {"x": {"items": list(range(limits.MAX_LIST + 1))}}})
        self.assertEqual(detail["code"], "landing_too_many_items")
        self.assertEqual(detail["path"], "content.sections.x.items")       # where the problem is

    def test_an_object_with_too_many_keys_is_refused(self):
        self.assertEqual(refused({str(index): 1 for index in range(limits.MAX_KEYS + 1)})["code"], "landing_too_many_items")

    def test_a_text_that_is_too_long_is_refused_and_a_link_has_a_shorter_limit(self):
        limits.validate_structure({"t": "a" * limits.MAX_STRING})
        self.assertEqual(refused({"t": "a" * (limits.MAX_STRING + 1)})["code"], "landing_text_too_long")
        limits.validate_structure({"u": "https://example.com/" + "a" * (limits.MAX_URL - 20)})
        self.assertEqual(refused({"u": "https://example.com/" + "a" * limits.MAX_URL})["code"], "landing_text_too_long")
        self.assertEqual(refused({"i": "data:image/png;base64," + "A" * 600})["code"], "landing_text_too_long")   # an inline image
        self.assertEqual(refused({"k" * (limits.MAX_KEY + 1): 1})["code"], "landing_text_too_long")

    def test_the_routes_refuse_before_writing_anything(self):
        big = {"sections": {"hero": {"items": list(range(limits.MAX_LIST + 1))}}}
        for call in (
            lambda: main.save_landing_page_draft(main.LandingContentPayload(content=big)),
            lambda: main.publish_landing_page(main.LandingContentPayload(content=big)),
            lambda: main.save_footer_content(main.FooterContentPayload(footer=big, previous_footer={})),
            lambda: main.save_footer_content(main.FooterContentPayload(footer={}, previous_footer=big)),
        ):
            with self.assertRaises(HTTPException) as caught:
                call()
            self.assertEqual(caught.exception.status_code, 422)
            self.assertEqual(caught.exception.detail["code"], "landing_too_many_items")

    def test_the_emergency_switch_turns_the_limits_off(self):
        import os
        os.environ["LANDING_LIMITS"] = "off"
        try:
            limits.validate_structure({"t": "a" * (limits.MAX_STRING * 5)})
        finally:
            del os.environ["LANDING_LIMITS"]

    def test_the_pricing_card_validation_is_still_applied(self):
        # the structure is fine, so the 422 comes from landing_pricing: a price that is not valid is still refused
        content = copy.deepcopy(DEFAULT_LANDING_CONTENT)
        content.setdefault("sections", {})["pricing"] = {"type": "pricing", "prices": {"individual": [{"price": "9" * 1500}]}}
        with self.assertRaises(HTTPException) as caught:
            main.save_landing_page_draft(main.LandingContentPayload(content=content))
        self.assertEqual(caught.exception.status_code, 422)
        self.assertNotIn("landing_", str(caught.exception.detail.get("code", "")))      # not the new structure limits


if __name__ == "__main__":
    unittest.main()

"""Protections of the API: python -m unittest test_web_safety -v"""
import unittest
import uuid

from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
import web_safety
from database import get_connection

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32
JPG = b"\xff\xd8\xff\xe0" + b"0" * 32
GIF = b"GIF89a" + b"0" * 32
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


class Safety(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        web_safety.ensure_upload_table()
        cls.client = TestClient(main.app)

    def setUp(self):
        web_safety.token_limit.clear()

    def test_images_are_checked_by_their_first_bytes_and_svg_is_refused(self):
        self.assertEqual(web_safety.check_image("a.PNG", PNG), ".png")
        self.assertEqual(web_safety.check_image("a.jpeg", JPG), ".jpeg")
        self.assertEqual(web_safety.check_image("a.gif", GIF), ".gif")
        for name, data in (("a.svg", SVG), ("a.png", JPG), ("a.jpg", SVG), ("a.png", b""), ("a.exe", PNG), ("a", PNG)):
            with self.assertRaises(HTTPException) as caught:
                web_safety.check_image(name, data)
            self.assertEqual(caught.exception.status_code, 400)

    def test_an_uploaded_image_is_served_from_the_database_with_a_locked_down_policy(self):
        name = f"{uuid.uuid4().hex}.png"
        try:
            self.assertEqual(web_safety.save_upload(name, PNG), f"/uploads/{name}")
            answer = self.client.get(f"/uploads/{name}")
            self.assertEqual(answer.status_code, 200)
            self.assertEqual(answer.content, PNG)
            self.assertEqual(answer.headers["content-type"], "image/png")
            self.assertIn("sandbox", answer.headers["content-security-policy"])
            self.assertEqual(answer.headers["x-content-type-options"], "nosniff")
        finally:
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("DELETE FROM uploaded_files WHERE name = %s", (name,))
            conn.commit()
            conn.close()

    def test_unknown_and_path_like_names_are_not_found(self):
        self.assertEqual(self.client.get(f"/uploads/{uuid.uuid4().hex}.png").status_code, 404)
        self.assertEqual(self.client.get("/uploads/..%2Fmain.py").status_code, 404)

    def test_every_answer_carries_the_security_headers(self):
        answer = self.client.get("/health")
        for name in ("x-content-type-options", "x-frame-options", "referrer-policy", "strict-transport-security"):
            self.assertIn(name, answer.headers)

    def test_the_api_docs_are_off_by_default(self):
        self.assertEqual(self.client.get("/docs").status_code, 404)
        self.assertEqual(self.client.get("/openapi.json").status_code, 404)

    def test_the_link_routes_are_limited_per_connection(self):
        answers = [self.client.get("/reschedule-response/not-a-real-token").status_code for _ in range(web_safety.token_limit.limit + 2)]
        self.assertNotIn(429, answers[: web_safety.token_limit.limit])
        self.assertEqual(answers[-1], 429)
        self.assertEqual(self.client.get("/health").status_code, 200)         # the rest of the API is not affected

    def test_the_rate_limit_window_forgets(self):
        limit = web_safety.RateLimit(2, 0.05)
        self.assertFalse(limit.too_many("a"))
        self.assertFalse(limit.too_many("a"))
        self.assertTrue(limit.too_many("a"))
        self.assertFalse(limit.too_many("b"))
        import time
        time.sleep(0.06)
        self.assertFalse(limit.too_many("a"))

    def test_the_shared_limit_lives_in_the_database_and_survives_a_new_object(self):
        first = web_safety.SharedRateLimit("test-shared", 2, 60)
        first.clear()
        try:
            self.assertFalse(first.too_many("ip-1"))
            self.assertFalse(first.too_many("ip-1"))
            second = web_safety.SharedRateLimit("test-shared", 2, 60)          # like a restarted server: no memory, same database
            self.assertTrue(second.too_many("ip-1"))
            self.assertFalse(second.too_many("ip-2"))                          # another key is not affected
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("UPDATE rate_limit_hits SET hit_at = NOW() - INTERVAL '2 minutes' WHERE bucket = 'test-shared'")
            conn.commit()
            conn.close()
            self.assertFalse(second.too_many("ip-1"))                          # the window passed: the old hits are forgotten
        finally:
            first.clear()

    def test_if_the_database_fails_the_limit_still_works_from_memory(self):
        from unittest import mock
        limit = web_safety.SharedRateLimit("test-fallback", 2, 60)
        with mock.patch.object(web_safety, "get_connection", side_effect=RuntimeError("down")):
            self.assertFalse(limit.too_many("x"))
            self.assertFalse(limit.too_many("x"))
            self.assertTrue(limit.too_many("x"))

    def test_error_reporting_is_off_without_a_dsn(self):
        import os
        os.environ.pop("SENTRY_DSN", None)
        self.assertFalse(web_safety.start_error_reporting())


if __name__ == "__main__":
    unittest.main()

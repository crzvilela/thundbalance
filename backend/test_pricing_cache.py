"""/pricing is public, cached for 30 seconds and fresh after a change: python -m unittest test_pricing_cache -v"""
import unittest
from unittest import mock

from fastapi.testclient import TestClient

import main
from database import get_connection

ISS = f"https://securetoken.google.com/{main.FIREBASE_PROJECT_ID}"


class PricingCache(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = TestClient(main.app)

    def setUp(self):
        main.invalidate_pricing_cache()
        self._verify = main.id_token.verify_firebase_token
        main.id_token.verify_firebase_token = lambda *a, **k: {"iss": ISS, "email": main.ADMIN_EMAIL, "sub": "uid-admin", "email_verified": True}
        self.original = self.http.get("/pricing").json()["trial"]
        main.invalidate_pricing_cache()

    def tearDown(self):
        # put the trial prices back, whatever the test did
        self.http.put("/admin/trial-prices", json=self.original, headers={"Authorization": "Bearer x"})
        main.id_token.verify_firebase_token = self._verify
        main.invalidate_pricing_cache()

    def test_the_answer_says_it_may_be_cached_for_30_seconds(self):
        answer = self.http.get("/pricing")
        self.assertEqual(answer.status_code, 200)
        self.assertEqual(answer.headers["cache-control"], "public, max-age=30")
        self.assertEqual(self.http.get("/pricing").headers["cache-control"], "public, max-age=30")      # also when it comes from memory

    def test_a_second_visit_does_not_reach_the_database(self):
        real = main.pack_catalog.public_catalog
        with mock.patch.object(main.pack_catalog, "public_catalog", side_effect=real) as spy:
            first = self.http.get("/pricing").json()
            second = self.http.get("/pricing").json()
            third = self.http.get("/pricing").json()
        self.assertEqual(spy.call_count, 1)
        self.assertEqual(first, second)
        self.assertEqual(second, third)

    def test_an_admin_change_shows_at_once(self):
        before = self.http.get("/pricing").json()["trial"]["individual"]
        new = float(before) + 3
        changed = self.http.put("/admin/trial-prices", json={"individual": new, "dual": self.original["dual"]}, headers={"Authorization": "Bearer x"})
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual(self.http.get("/pricing").json()["trial"]["individual"], new)                 # no wait: the write cleared the memory

    def test_a_change_made_outside_the_site_shows_after_the_30_seconds(self):
        before = self.http.get("/pricing").json()["trial"]["individual"]
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("UPDATE pricing SET price = price + 7 WHERE kind = 'trial' AND session_type = 'individual'")
        conn.commit()
        conn.close()
        try:
            self.assertEqual(self.http.get("/pricing").json()["trial"]["individual"], before)          # still the cached one
            main._pricing_cache["at"] -= main.PRICING_CACHE_SECONDS + 1                                # 31 seconds later
            self.assertEqual(self.http.get("/pricing").json()["trial"]["individual"], float(before) + 7)
        finally:
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("UPDATE pricing SET price = price - 7 WHERE kind = 'trial' AND session_type = 'individual'")
            conn.commit()
            conn.close()

    def test_a_failed_write_keeps_the_cache(self):
        self.http.get("/pricing")
        self.assertIsNotNone(main._pricing_cache["value"])
        bad = self.http.put("/admin/trial-prices", json={"individual": -5, "dual": 50}, headers={"Authorization": "Bearer x"})
        self.assertGreaterEqual(bad.status_code, 400)
        self.assertIsNotNone(main._pricing_cache["value"])


if __name__ == "__main__":
    unittest.main()

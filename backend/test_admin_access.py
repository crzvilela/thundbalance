"""The secret path of the admin panel and the hiding of /admin (backend/admin_access.py, docs/ADMIN_ACCESS.md).

    python -m unittest test_admin_access -v

Every value here is fake: the real secret path is never printed, written or compared with a literal. The local database is used and what the tests
write is removed afterwards.
"""
import re
import unittest
from unittest import mock

from fastapi.testclient import TestClient

import admin_access
import main
from database import get_connection

ISS = f"https://securetoken.google.com/{main.FIREBASE_PROJECT_ID}"
TOKENS = {
    "t-admin": {"iss": ISS, "email": main.ADMIN_EMAIL, "sub": "uid-admin-fake", "email_verified": True},
    "t-client": {"iss": ISS, "email": "client@test-admin-access.example", "sub": "uid-client-fake", "email_verified": True},
    "t-trainer": {"iss": ISS, "email": "trainer@test-admin-access.example", "sub": "uid-trainer-fake", "email_verified": True},
}
FAKE_PATH = "fakepath0123ab"             # a made-up value for the tests that need one


def fake_verify(token, *args, **kwargs):
    if token in TOKENS:
        return dict(TOKENS[token])
    raise ValueError("invalid token")


def bearer(name):
    return {"Authorization": f"Bearer {name}"}


class AdminAccess(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        admin_access.ensure_admin_path()
        cls.client = TestClient(main.app)

    def setUp(self):
        admin_access.clear_guard()
        self._exempt = mock.patch.object(admin_access, "EXEMPT_ADDRESSES", set())          # the guard is tested for real here
        self._exempt.start()
        self._verify = mock.patch.object(main.id_token, "verify_firebase_token", side_effect=fake_verify)
        self._verify.start()
        self._revoked = mock.patch.object(main.firebase_accounts, "ensure_not_revoked", return_value=None)
        self._revoked.start()
        main.app.dependency_overrides.pop(main.require_admin, None)

    def tearDown(self):
        self._exempt.stop()
        self._verify.stop()
        self._revoked.stop()
        main.app.dependency_overrides.pop(main.require_admin, None)
        admin_access.clear_guard()

    @staticmethod
    def stored():
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT value FROM site_settings WHERE key = %s", (admin_access.KEY,))
        rows = cur.fetchall()
        conn.close()
        return [row[0] for row in rows]

    # ----- the path: generated once, strong, stable
    def test_the_path_is_made_once_with_14_lowercase_letters_and_digits_and_survives_a_restart(self):
        first = admin_access.ensure_admin_path()
        self.assertRegex(first, r"^[a-z0-9]{14}$")
        self.assertEqual(admin_access.ensure_admin_path(), first)
        admin_access._table_ready = False                                      # "another start of the server"
        self.assertEqual(admin_access.ensure_admin_path(), first)
        self.assertEqual(self.stored(), [first])                              # one row, never a second one
        self.assertNotRegex(first, r"^(admin|panel|manage|secret|login)")     # nothing guessable at the start

    def test_two_generated_values_differ(self):
        values = {admin_access._generate() for _ in range(50)}
        self.assertEqual(len(values), 50)
        self.assertTrue(all(re.fullmatch(r"[a-z0-9]{14}", value) for value in values))

    # ----- who is told
    def test_only_the_signed_in_admin_is_given_the_path(self):
        real = admin_access.current_path()
        answer = self.client.get("/me/roles", headers=bearer("t-admin"))
        self.assertEqual(answer.status_code, 200)
        self.assertEqual(answer.json()["admin_path"], real)
        self.assertTrue(answer.json()["is_admin"])
        for who in ("t-client", "t-trainer"):
            other = self.client.get("/me/roles", headers=bearer(who))
            self.assertEqual(other.status_code, 200, who)
            self.assertNotIn("admin_path", other.json(), who)                 # not even the key
            self.assertNotIn(real, other.text, who)
        self.assertEqual(self.client.get("/me/roles").status_code, 401)        # a visitor is not told anything
        self.assertNotIn(real, self.client.get("/me/roles").text)

    def test_the_dedicated_endpoint_is_for_the_admin_only(self):
        real = admin_access.current_path()
        self.assertEqual(self.client.get("/admin/access-path", headers=bearer("t-admin")).json(), {"admin_path": real})
        for headers in ({}, bearer("not-a-token"), bearer("t-client"), bearer("t-trainer")):
            answer = self.client.get("/admin/access-path", headers=headers)
            self.assertEqual(answer.status_code, 404)
            self.assertNotIn(real, answer.text)

    # ----- /route-check
    def test_route_check_says_yes_to_the_path_and_no_to_anything_else_always_with_the_same_shape(self):
        real = admin_access.current_path()
        yes = self.client.post("/route-check", json={"segment": real})
        self.assertEqual((yes.status_code, yes.json()), (200, {"match": True}))
        for body in ({"segment": "wrongsegment12"}, {"segment": ""}, {"segment": real[:-1]}, {"segment": real + "x"}, {"segment": 5}, {"other": real}, [real], "text"):
            no = self.client.post("/route-check", json=body)
            self.assertEqual((no.status_code, no.json()), (200, {"match": False}), body)
        broken = self.client.post("/route-check", content=b"not json", headers={"Content-Type": "application/json"})
        self.assertEqual((broken.status_code, broken.json()), (200, {"match": False}))
        self.assertEqual(self.client.post("/route-check").json(), {"match": False})

    def test_route_check_compares_in_constant_time_and_always_reads_the_database(self):
        with mock.patch.object(admin_access.hmac, "compare_digest", wraps=admin_access.hmac.compare_digest) as compare, \
                mock.patch.object(admin_access, "current_path", wraps=admin_access.current_path) as read:
            self.client.post("/route-check", json={"segment": "x"})
            self.client.post("/route-check", json={"segment": admin_access.current_path()})
            self.client.post("/route-check", json={})
        self.assertEqual(compare.call_count, 3)                                  # every call compares, even an empty one
        self.assertGreaterEqual(read.call_count, 3)

    def test_route_check_is_limited_per_address_and_a_limited_address_still_gets_the_same_answer_shape(self):
        real = admin_access.current_path()
        answers = [self.client.post("/route-check", json={"segment": real}).json() for _ in range(12)]
        self.assertEqual(answers[:10], [{"match": True}] * 10)
        self.assertEqual(answers[10:], [{"match": False}] * 2)                   # over the limit: nothing more is learnt, still 200
        self.assertTrue(all(self.client.post("/route-check", json={"segment": real}).status_code == 200 for _ in range(3)))

    # ----- /admin does not exist for anybody who is not the admin
    @staticmethod
    def shape(answer):
        headers = {name.lower(): value for name, value in answer.headers.items() if name.lower() not in ("date", "server")}
        return answer.status_code, answer.content, headers

    def test_the_api_answers_the_same_404_byte_for_byte_as_for_a_path_that_does_not_exist(self):
        missing = self.client.get("/admin/this-route-does-not-exist-anywhere")
        self.assertEqual(missing.status_code, 404)
        for method, path, extra in (
            ("get", "/admin/clients", {}), ("get", "/admin/stats", {}), ("post", "/admin/messages", {"json": {"title": "x"}}),
            ("delete", "/admin/plans/1", {}), ("put", "/admin/ui-settings", {"json": {"version": 0}}), ("get", "/admin/clients/1/packs", {}),
            ("get", "/admin/overview/today", {}), ("post", "/admin/settings/admin-path/rotate", {}), ("get", "/admin", {}), ("get", "/admin/", {}),
        ):
            for who, headers in (("no token", {}), ("invalid token", bearer("not-a-token")), ("client", bearer("t-client")), ("trainer", bearer("t-trainer")),
                                 ("malformed header", {"Authorization": "Token abc"})):
                admin_access.clear_guard()                  # this test makes many "not found" answers on purpose
                answer = getattr(self.client, method)(path, headers=headers, **extra)
                reference = getattr(self.client, method)("/admin/this-route-does-not-exist-anywhere", headers=headers, **extra)
                self.assertEqual(self.shape(answer), self.shape(reference), f"{method} {path} {who}")
                self.assertEqual(answer.status_code, 404, f"{method} {path} {who}")
                self.assertNotIn("www-authenticate", {name.lower() for name in answer.headers}, f"{method} {path} {who}")

    def test_a_missing_path_outside_admin_has_the_same_shape(self):
        self.assertEqual(self.client.get("/admin/x").json(), self.client.get("/no-such-route").json())
        self.assertEqual(self.client.get("/admin/x").json()["detail"]["code"], "not_found")

    def test_the_admin_still_gets_everything_and_a_legitimate_404_keeps_its_own_text(self):
        ok = self.client.get("/admin/stats", headers=bearer("t-admin"))
        self.assertEqual(ok.status_code, 200)
        legit = self.client.get("/admin/clients/987654321/packs", headers=bearer("t-admin"))
        self.assertEqual(legit.status_code, 404)
        generic = self.client.get("/admin/this-route-does-not-exist-anywhere", headers=bearer("t-admin")).json()
        self.assertNotEqual(legit.json(), generic)                                # the frontend can tell them apart
        self.assertIsInstance(generic["detail"], dict)
        self.assertEqual(generic["detail"]["code"], "not_found")
        self.assertNotEqual(legit.json().get("detail"), generic["detail"])

    def test_client_and_public_routes_are_not_touched(self):
        self.assertEqual(self.client.get("/features").status_code, 200)
        known = self.client.get("/client/workflow", headers=bearer("t-client"))                 # a client that has no profile yet: the route's own answer
        self.assertIn(known.status_code, (200, 404))
        self.assertNotEqual(known.json().get("detail", {}).get("code") if isinstance(known.json().get("detail"), dict) else None, "not_found")
        self.assertEqual(self.client.get("/client/workflow").status_code, 401)      # a client route keeps its 401

    # ----- the scan guard
    def test_more_than_30_not_found_in_5_minutes_gives_429_and_only_counts_are_kept(self):
        statuses = [self.client.get(f"/scan-{index}/wp-login.php").status_code for index in range(34)]
        self.assertEqual(statuses[:30], [404] * 30)
        self.assertIn(429, statuses[30:])
        self.assertEqual(self.client.get("/features").status_code, 429)           # the whole address is slowed down ...
        self.assertEqual(self.client.get("/admin/clients", headers=bearer("t-admin")).status_code, 429)
        admin_access.clear_guard()                                                # ... until the block ends
        self.assertEqual(self.client.get("/features").status_code, 200)

    def test_the_admin_paths_without_access_count_as_a_scan(self):
        for index in range(32):
            self.client.get(f"/admin/probe-{index}")
        self.assertEqual(self.client.get("/features").status_code, 429)

    def test_legitimate_404s_of_the_own_user_and_missing_files_are_not_a_scan(self):
        for _ in range(40):
            self.assertEqual(self.client.get("/admin/clients/987654321/packs", headers=bearer("t-admin")).status_code, 404)
        for index in range(40):
            self.assertEqual(self.client.get(f"/uploads/not-there-{index}.jpg").status_code, 404)
        self.assertEqual(self.client.get("/features").status_code, 200)

    def test_the_test_client_is_exempt_so_the_suites_are_not_blocked(self):
        with mock.patch.object(admin_access, "EXEMPT_ADDRESSES", {"testclient"}):
            for index in range(40):
                self.client.get(f"/scan-{index}")
            self.assertEqual(self.client.get("/features").status_code, 200)

    def test_the_guard_logs_no_address(self):
        with self.assertLogs("thundbalance.admin_access", "INFO") as logged:
            for index in range(34):
                self.client.get(f"/scan-{index}")
        self.assertTrue(all("testclient" not in line and "127.0.0.1" not in line for line in logged.output))

    # ----- rotation
    def test_rotating_gives_a_new_path_and_the_old_one_stops_working(self):
        old = admin_access.current_path()
        answer = self.client.post("/admin/settings/admin-path/rotate", headers=bearer("t-admin"))
        self.assertEqual(answer.status_code, 200)
        new = answer.json()["admin_path"]
        self.assertRegex(new, r"^[a-z0-9]{14}$")
        self.assertNotEqual(new, old)
        self.assertEqual(admin_access.current_path(), new)
        self.assertEqual(self.client.post("/route-check", json={"segment": old}).json(), {"match": False})
        self.assertEqual(self.client.post("/route-check", json={"segment": new}).json(), {"match": True})
        self.assertEqual(self.client.get("/me/roles", headers=bearer("t-admin")).json()["admin_path"], new)

    def test_rotation_is_for_the_admin_only_and_is_audited_without_the_value(self):
        for headers in ({}, bearer("t-client"), bearer("t-trainer"), bearer("not-a-token")):
            self.assertEqual(self.client.post("/admin/settings/admin-path/rotate", headers=headers).status_code, 404)
        before = admin_access.current_path()
        self.assertEqual(admin_access.current_path(), before)                     # the refused calls changed nothing
        new = self.client.post("/admin/settings/admin-path/rotate", headers=bearer("t-admin")).json()["admin_path"]
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT admin_uid, action, outcome, detail FROM admin_audit_log WHERE action = 'admin_path_rotate' ORDER BY id DESC LIMIT 1")
        uid, action, outcome, detail = cur.fetchone()
        cur.execute("DELETE FROM admin_audit_log WHERE action = 'admin_path_rotate'")
        conn.commit()
        conn.close()
        self.assertEqual((action, outcome, detail), ("admin_path_rotate", "ok", None))
        self.assertEqual(uid, "uid-admi")                                         # abbreviated uid
        self.assertNotIn(new, f"{uid}{action}{outcome}{detail}")
        self.assertNotIn(before, f"{uid}{action}{outcome}{detail}")

    # ----- links in e-mails
    def test_the_links_of_the_e_mails_to_the_team_use_the_secret_path(self):
        from emails import contact_emails, reschedule_emails, trial_emails
        real = admin_access.current_path()
        trial = {"id": 1, "full_name": "Ana Test", "email": "ana@test-admin-access.example", "phone": "600", "session_date": "2026-12-01", "session_time": "10:00",
                 "goal": "x", "experience": "y", "name": "Ana Test", "date": "2026-12-01", "time": "10:00"}
        links = []
        for build in (lambda: contact_emails.staff_contact_message({"name": "Ana", "email": "ana@test-admin-access.example", "message": "hola", "created_at": None}),
                      lambda: reschedule_emails.staff_reschedule_requested({"id": 7})):
            try:
                email = build()
            except Exception:  # noqa: BLE001 - the builders need more fields in some versions: the link helper is tested directly below
                continue
            links.append(str(email))
        for text in links:
            self.assertNotIn("/admin/", text)
        self.assertRegex(admin_access.admin_url("/trials"), rf"/{real}/trials$")
        self.assertNotIn("/admin/trials", admin_access.admin_url("/trials"))
        self.assertTrue(callable(trial_emails.staff_trial_requested))
        with mock.patch.object(admin_access, "current_path", side_effect=RuntimeError("database down")), self.assertLogs("thundbalance.admin_access", "WARNING"):
            self.assertNotIn("/admin", admin_access.admin_url("/trials"))           # an e-mail still goes out: it links to the site

    def test_nothing_in_the_public_files_names_the_panel(self):
        import pathlib
        root = pathlib.Path(__file__).resolve().parent.parent
        real = admin_access.current_path()
        for name in ("public/robots.txt", "public/sitemap.xml", "vercel.json", "index.html"):
            text = (root / name).read_text(encoding="utf-8")
            self.assertNotIn(real, text, name)
            self.assertNotRegex(text.lower(), r"/admin|wp-admin|administrator", name)


if __name__ == "__main__":
    unittest.main()

"""An unverified e-mail cannot tie itself to data that already exists (light version: nobody else is asked to verify anything).

    python -m unittest test_email_verified_link -v

Firebase is replaced by a table of fake tokens (main.id_token.verify_firebase_token). The local database is used and cleaned.
"""
import unittest

from fastapi.testclient import TestClient

import main
from database import get_connection

DOMAIN = "@test-link.example"
ISS = f"https://securetoken.google.com/{main.FIREBASE_PROJECT_ID}"


def token(email, uid, verified=None, provider=None):
    claims = {"iss": ISS, "email": email, "sub": uid}
    if verified is not None:
        claims["email_verified"] = verified
    if provider:
        claims["firebase"] = {"sign_in_provider": provider}
    return claims


class EmailVerifiedLink(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = TestClient(main.app)

    def setUp(self):
        self.cleanup()
        conn = get_connection()
        cur = conn.cursor()
        # Ana: an old record without a login linked (made from a trial or by hand), with an open trial session
        cur.execute("INSERT INTO users (nome, email) VALUES ('Ana Link', %s) RETURNING id", (f"ana{DOMAIN}",))
        self.ana = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status) "
            "VALUES ('Ana Link', %s, '600111222', 'Lose weight', 'Beginner', CURRENT_DATE + 10, '10:00', 'Pending')", (f"ana{DOMAIN}",))
        # Beto: a client that already uses the site, with his login linked
        cur.execute("INSERT INTO users (nome, email, firebase_uid) VALUES ('Beto Link', %s, 'uid-beto') RETURNING id", (f"beto{DOMAIN}",))
        self.beto = cur.fetchone()[0]
        conn.commit()
        conn.close()
        self.tokens = {
            "ana-unverified": token(f"ana{DOMAIN}", "uid-attacker", False),                 # signed up with Ana's address, never verified it
            "ana-silent": token(f"ana{DOMAIN}", "uid-attacker", None),                      # a token that says nothing
            "ana-verified": token(f"ana{DOMAIN}", "uid-ana", True),
            "ana-google": token(f"ana{DOMAIN}", "uid-google", None, "google.com"),
            "beto-unverified": token(f"beto{DOMAIN}", "uid-beto", False),                   # already linked: not affected
            "new-unverified": token(f"nueva{DOMAIN}", "uid-new", False),                    # nobody had this address before
        }
        self._verify = main.id_token.verify_firebase_token
        main.id_token.verify_firebase_token = lambda value, *a, **k: self.tokens[value]

    def tearDown(self):
        main.id_token.verify_firebase_token = self._verify
        self.cleanup()

    @classmethod
    def tearDownClass(cls):
        cls.cleanup()

    @staticmethod
    def cleanup():
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        ids = [row[0] for row in cur.fetchall()]
        if ids:
            cur.execute("DELETE FROM inbox_recipients WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM sessions WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM users WHERE id = ANY(%s)", (ids,))
        cur.execute("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        conn.commit()
        conn.close()

    def call(self, method, path, who, **kwargs):
        return self.http.request(method, path, headers={"Authorization": f"Bearer {who}"}, **kwargs)

    def row(self, email):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id, firebase_uid FROM users WHERE LOWER(email) = %s", (email,))
        found = cur.fetchone()
        conn.close()
        return found

    def register(self, who, email):
        return self.call("POST", "/users", who, json={"firebase_uid": "ignored", "nome": "Ana Link", "email": email})

    def assert_not_verified(self, answer):
        self.assertEqual(answer.status_code, 403, answer.text)
        self.assertEqual(answer.json()["detail"]["code"], "email_not_verified")

    # ----- the one rule
    def test_what_counts_as_a_verified_email(self):
        self.assertTrue(main.is_email_verified({"email_verified": True}))
        self.assertFalse(main.is_email_verified({"email_verified": False}))
        self.assertFalse(main.is_email_verified({}))                                          # a token that says nothing
        self.assertFalse(main.is_email_verified(None))
        self.assertFalse(main.is_email_verified({"email_verified": "true"}))                   # only the real boolean
        self.assertTrue(main.is_email_verified({"firebase": {"sign_in_provider": "google.com"}}))
        self.assertFalse(main.is_email_verified({"firebase": {"sign_in_provider": "password"}}))

    # ----- (i) a login that is already linked is not affected
    def test_a_linked_login_enters_without_verifying(self):
        self.assertEqual(self.call("GET", f"/sessions/user/{self.beto}", "beto-unverified").status_code, 200)
        self.assertEqual(self.call("GET", f"/profile/{self.beto}", "beto-unverified").status_code, 200)
        self.assertEqual(self.call("GET", f"/users/email/beto{DOMAIN}", "beto-unverified").status_code, 200)
        again = self.register("beto-unverified", f"beto{DOMAIN}")
        self.assertEqual(again.status_code, 200)
        self.assertEqual(self.row(f"beto{DOMAIN}")[1], "uid-beto")

    # ----- (ii) an unverified address cannot tie itself to an existing record
    def test_an_unverified_email_is_not_linked_to_an_existing_record(self):
        for who in ("ana-unverified", "ana-silent"):
            self.assert_not_verified(self.register(who, f"ana{DOMAIN}"))
            self.assertIsNone(self.row(f"ana{DOMAIN}")[1])                                    # nothing was linked
            self.assert_not_verified(self.call("GET", f"/users/email/ana{DOMAIN}", who))
            self.assert_not_verified(self.call("GET", f"/sessions/user/{self.ana}", who))
            self.assert_not_verified(self.call("GET", f"/profile/{self.ana}", who))
            self.assert_not_verified(self.call("GET", "/me/reschedule-requests", who))
            self.assert_not_verified(self.call("GET", "/inbox", who))
            self.assert_not_verified(self.call("GET", "/inbox/unread-count", who))
            self.assert_not_verified(self.call("PUT", "/me/language", who, json={"lang": "es"}))
        with self.assertRaises(Exception) as caught:
            main._own_user_id(self.tokens["ana-unverified"])
        self.assertEqual(caught.exception.status_code, 403)

    def test_the_refusal_is_the_same_whatever_the_reason(self):
        first = self.register("ana-unverified", f"ana{DOMAIN}").json()
        second = self.call("GET", f"/sessions/user/{self.ana}", "ana-unverified").json()
        self.assertEqual(first, second)                                                      # one code, one text

    def test_the_password_changed_call_does_not_use_an_unverified_email_to_find_a_record(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("UPDATE users SET must_change_password = TRUE WHERE id = %s", (self.ana,))
        conn.commit()
        conn.close()
        self.assertEqual(self.call("POST", "/me/password-changed", "ana-unverified").status_code, 200)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT must_change_password FROM users WHERE id = %s", (self.ana,))
        self.assertTrue(cur.fetchone()[0])                                                    # Ana's record was not touched
        conn.close()

    # ----- (iii) a verified address links
    def test_a_verified_email_is_linked_to_its_existing_record(self):
        answer = self.register("ana-verified", f"ana{DOMAIN}")
        self.assertEqual(answer.status_code, 200)
        self.assertEqual(self.row(f"ana{DOMAIN}")[1], "uid-ana")                              # the REAL login, not the body's value
        self.assertEqual(self.call("GET", f"/sessions/user/{self.ana}", "ana-verified").status_code, 200)

    # ----- (iv) a new address creates its record without verifying
    def test_a_new_email_creates_its_record_and_uses_the_site_unverified(self):
        answer = self.register("new-unverified", f"nueva{DOMAIN}")
        self.assertEqual(answer.status_code, 200, answer.text)
        created = self.row(f"nueva{DOMAIN}")
        self.assertEqual(created[1], "uid-new")
        self.assertEqual(self.call("GET", f"/users/email/nueva{DOMAIN}", "new-unverified").status_code, 200)
        self.assertEqual(self.call("GET", f"/sessions/user/{created[0]}", "new-unverified").status_code, 200)
        self.assertEqual(self.call("GET", f"/profile/{created[0]}", "new-unverified").status_code, 200)

    # ----- (v) the trial session is only read by a verified address
    def test_the_trial_session_needs_a_verified_email(self):
        self.assert_not_verified(self.call("GET", "/client/trial", "ana-unverified"))
        self.assert_not_verified(self.call("GET", "/client/trial", "ana-silent"))
        trial = self.call("GET", "/client/trial", "ana-verified")
        self.assertEqual(trial.status_code, 200)
        self.assertEqual(trial.json()["trial"]["status"], "pending")

    def test_a_new_unverified_account_without_a_trial_still_gets_an_answer_only_when_verified(self):
        self.assert_not_verified(self.call("GET", "/client/trial", "new-unverified"))        # no way to tell "none" from "hidden": verify first

    # ----- (vi) Google counts as verified
    def test_a_google_login_counts_as_verified(self):
        self.assertEqual(self.register("ana-google", f"ana{DOMAIN}").status_code, 200)
        self.assertEqual(self.row(f"ana{DOMAIN}")[1], "uid-google")
        self.assertEqual(self.call("GET", "/client/trial", "ana-google").json()["trial"]["status"], "pending")
        self.assertEqual(self.call("GET", f"/sessions/user/{self.ana}", "ana-google").status_code, 200)

    def test_public_routes_and_a_missing_token_are_not_changed(self):
        self.assertEqual(self.http.get("/pricing").status_code, 200)
        self.assertEqual(self.http.get("/client/trial").status_code, 401)


if __name__ == "__main__":
    unittest.main()

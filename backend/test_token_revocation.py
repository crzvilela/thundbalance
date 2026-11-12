"""A revoked login stops working at once on the sensitive routes: python -m unittest test_token_revocation -v

Firebase is replaced by fakes: the ID-token check of main (valid signature) and the revocation check of firebase_accounts.
"""
import logging
import unittest
from unittest import mock

from fastapi.testclient import TestClient

import firebase_accounts
import main
from database import get_connection

ISS = f"https://securetoken.google.com/{main.FIREBASE_PROJECT_ID}"
DOMAIN = "@test-revoke.example"


class Capture(logging.Handler):
    def __init__(self):
        super().__init__()
        self.lines = []

    def emit(self, record):
        self.lines.append(record.getMessage())


class Revocation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = TestClient(main.app)

    def setUp(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO users (nome, email, firebase_uid) VALUES ('Rita Revoke', %s, 'uid-rita') RETURNING id", (f"rita{DOMAIN}",))
        self.rita = cur.fetchone()[0]
        conn.commit()
        conn.close()
        self.tokens = {
            "admin": {"iss": ISS, "email": main.ADMIN_EMAIL, "sub": "uid-admin", "email_verified": True},
            "rita": {"iss": ISS, "email": f"rita{DOMAIN}", "sub": "uid-rita", "email_verified": True},
        }
        self._verify = main.id_token.verify_firebase_token
        main.id_token.verify_firebase_token = lambda token, *a, **k: self.tokens[token]
        self.calls = []
        self.outcome = None                                   # None = fine, or an exception to raise
        self._ensure = firebase_accounts.ensure_not_revoked

        def fake(token):
            self.calls.append(token)
            if self.outcome is not None:
                raise self.outcome
        firebase_accounts.ensure_not_revoked = fake
        self.capture = Capture()
        logging.getLogger().addHandler(self.capture)
        main._revocation_not_configured_logged = False

    def tearDown(self):
        main.id_token.verify_firebase_token = self._verify
        firebase_accounts.ensure_not_revoked = self._ensure
        logging.getLogger().removeHandler(self.capture)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        conn.commit()
        conn.close()

    def call(self, method, path, who, **kwargs):
        return self.http.request(method, path, headers={"Authorization": f"Bearer {who}"}, **kwargs)

    # ----- admin
    def test_a_revoked_admin_login_is_refused_with_a_plain_401(self):
        self.outcome = firebase_accounts.TokenRevoked()
        answer = self.call("GET", "/admin/calendar-status", "admin")
        self.assertEqual(answer.status_code, 401)
        self.assertEqual(answer.json()["detail"], "Invalid or expired login")                  # the same text as any invalid login
        write = self.call("POST", "/admin/clients/bulk", "admin", json={"action": "archive", "ids": [1]})
        self.assertEqual(write.status_code, 401)

    def test_a_valid_admin_login_works_and_is_checked(self):
        self.assertEqual(self.call("GET", "/admin/calendar-status", "admin").status_code, 200)
        self.assertEqual(self.calls, ["admin"])

    def test_if_firebase_does_not_answer_the_admin_routes_refuse(self):
        self.outcome = firebase_accounts.AccountError("ConnectionError")
        answer = self.call("GET", "/admin/calendar-status", "admin")
        self.assertEqual(answer.status_code, 503)
        self.assertIn("op=check_revoked error=AccountError", self.capture.lines)             # only the type of the error is logged

    def test_a_server_without_firebase_admin_still_lets_the_admin_in_and_says_so_once(self):
        self.outcome = firebase_accounts.AccountsUnavailable("variavel em falta")
        self.assertEqual(self.call("GET", "/admin/calendar-status", "admin").status_code, 200)
        self.assertEqual(self.call("GET", "/admin/calendar-status", "admin").status_code, 200)
        warnings = [line for line in self.capture.lines if "NOT checked" in line]
        self.assertEqual(len(warnings), 1)

    def test_a_non_admin_never_reaches_the_revocation_check_of_the_admin_routes(self):
        self.assertEqual(self.call("GET", "/admin/calendar-status", "rita").status_code, 403)
        self.assertEqual(self.calls, [])

    # ----- sensitive client routes
    def test_a_revoked_client_login_is_refused_on_a_route_that_changes_data(self):
        self.outcome = firebase_accounts.TokenRevoked()
        answer = self.call("PUT", "/me/language", "rita", json={"lang": "es"})
        self.assertEqual(answer.status_code, 401)
        self.assertEqual(self.call("DELETE", "/sessions/999999", "rita").status_code, 401)
        self.assertEqual(self.call("PUT", f"/profile/{self.rita}", "rita", json={"telefone": "600111222"}).status_code, 401)

    def test_a_valid_client_login_is_checked_on_a_write_and_works(self):
        answer = self.call("PUT", "/me/language", "rita", json={"lang": "es"})
        self.assertEqual(answer.status_code, 200, answer.text)
        self.assertEqual(self.calls, ["rita"])

    def test_if_firebase_does_not_answer_a_client_is_not_locked_out(self):
        self.outcome = firebase_accounts.AccountError("TimeoutError")
        answer = self.call("PUT", "/me/language", "rita", json={"lang": "es"})
        self.assertEqual(answer.status_code, 200, answer.text)                                  # a passing problem blocks nobody
        self.assertIn("op=check_revoked error=AccountError", self.capture.lines)

    def test_reading_routes_and_the_inbox_do_not_ask_firebase(self):
        self.outcome = firebase_accounts.TokenRevoked()                                        # it would refuse if it were asked
        self.assertEqual(self.call("GET", f"/sessions/user/{self.rita}", "rita").status_code, 200)
        self.assertEqual(self.call("GET", f"/profile/{self.rita}", "rita").status_code, 200)
        self.assertEqual(self.call("POST", "/inbox/read-all", "rita").status_code, 200)         # a mark on their own inbox: not sensitive
        self.assertEqual(self.calls, [])

    def test_public_routes_never_ask(self):
        self.outcome = firebase_accounts.TokenRevoked()
        self.assertEqual(self.http.get("/pricing").status_code, 200)
        self.assertEqual(self.calls, [])


class FakeAuth:
    """firebase_admin.auth with the error classes the real one has."""

    class RevokedIdTokenError(Exception):
        pass

    class UserDisabledError(Exception):
        pass

    class UserNotFoundError(Exception):
        pass

    class ExpiredIdTokenError(Exception):
        pass

    def __init__(self, outcome=None):
        self.outcome, self.count = outcome, 0

    def verify_id_token(self, token, check_revoked=False):
        assert check_revoked is True
        self.count += 1
        if self.outcome:
            raise self.outcome
        return {"uid": "x"}


class FirebaseCheck(unittest.TestCase):
    def setUp(self):
        firebase_accounts.forget_checked_tokens()
        self._auth = firebase_accounts._auth

    def tearDown(self):
        firebase_accounts._auth = self._auth
        firebase_accounts.forget_checked_tokens()

    def use(self, outcome=None):
        fake = FakeAuth(outcome)
        firebase_accounts._auth = lambda: fake
        return fake

    def test_a_deleted_a_disabled_and_a_revoked_account_are_all_refused(self):
        for error in (FakeAuth.RevokedIdTokenError("x"), FakeAuth.UserDisabledError("x"), FakeAuth.UserNotFoundError("x"), FakeAuth.ExpiredIdTokenError("x")):
            self.use(error)
            firebase_accounts.forget_checked_tokens()
            with self.assertRaises(firebase_accounts.TokenRevoked):
                firebase_accounts.ensure_not_revoked("t")

    def test_a_network_problem_is_an_account_error_with_only_the_type(self):
        self.use(ConnectionError("https://secret.example/?token=abc"))
        with self.assertRaises(firebase_accounts.AccountError) as caught:
            firebase_accounts.ensure_not_revoked("t")
        self.assertEqual(str(caught.exception), "ConnectionError")                              # nothing of the message

    def test_without_firebase_admin_it_says_so(self):
        def unavailable():
            raise firebase_accounts.AccountsUnavailable("variavel em falta")
        firebase_accounts._auth = unavailable
        with self.assertRaises(firebase_accounts.AccountsUnavailable):
            firebase_accounts.ensure_not_revoked("t")

    def test_a_good_answer_is_remembered_for_a_few_seconds_only(self):
        fake = self.use()
        for _ in range(5):
            firebase_accounts.ensure_not_revoked("same-token")
        self.assertEqual(fake.count, 1)                                                       # the panel's many requests ask Firebase once
        firebase_accounts.ensure_not_revoked("another-token")
        self.assertEqual(fake.count, 2)
        later = firebase_accounts.time.monotonic() + firebase_accounts.REVOCATION_CACHE_SECONDS + 1
        with mock.patch.object(firebase_accounts.time, "monotonic", return_value=later):
            firebase_accounts.ensure_not_revoked("same-token")
        self.assertEqual(fake.count, 3)                                                       # and asked again after the cache time

    def test_a_refusal_is_never_remembered(self):
        self.use(FakeAuth.RevokedIdTokenError("x"))
        for _ in range(2):
            with self.assertRaises(firebase_accounts.TokenRevoked):
                firebase_accounts.ensure_not_revoked("t")
        fake = self.use()                                                                      # the account came back: it works at once
        firebase_accounts.ensure_not_revoked("t")
        self.assertEqual(fake.count, 1)


if __name__ == "__main__":
    unittest.main()

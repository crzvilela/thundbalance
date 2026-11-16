"""The anti-robot challenge (proof of work):  python -m unittest test_challenge -v

Uses the local database (app_secrets / challenge_used / rate_limit_hits); the rows it creates are removed. No mail is sent.
"""
import base64
import hashlib
import json
import logging
import os
import time
import unittest
from unittest import mock

from fastapi import HTTPException
from fastapi.testclient import TestClient

import challenge
import contact_messages as cm
import main
import testsafety
from database import get_connection

DOMAIN = "@test-challenge.example"
ISS = f"https://securetoken.google.com/{main.FIREBASE_PROJECT_ID}"


def solve(ch, age=10):
    """What the browser does: tries 0, 1, 2... until SHA-256(salt + n) is the challenge. `age` moves the issue time back (the form
    is not 'filled in under two seconds')."""
    for number in range(ch["max"] + 1):
        if hashlib.sha256(f"{ch['salt']}{number}".encode()).hexdigest() == ch["challenge"]:
            return {**ch, "number": number}
    raise AssertionError("no solution")


def pack(solution):
    return base64.urlsafe_b64encode(json.dumps(solution).encode()).decode().rstrip("=")


def fresh(age=10, maximum=None):
    """A solved challenge issued `age` seconds ago, as the string the forms send."""
    now = int(time.time()) - age
    with mock.patch.object(challenge, "BASE_MAX", maximum or 300):
        ch = challenge.issue(1, now=now)
    return pack(solve(ch))


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        testsafety.require_local_database()
        cm.ensure_contact_table()
        cls.client = TestClient(main.app)

    def setUp(self):
        patcher = mock.patch.object(challenge, "_enforced", True)
        patcher.start()
        self.addCleanup(patcher.stop)
        challenge.issue_limit.clear()
        self._clean()
        self.addCleanup(self._clean)

    @staticmethod
    def _clean():
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM contact_messages WHERE email LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        conn.commit()
        conn.close()


class Issue(Base):
    def test_a_challenge_is_signed_and_has_what_the_browser_needs(self):
        answer = self.client.get("/challenge")
        self.assertEqual(answer.status_code, 200)
        self.assertEqual(answer.headers["cache-control"], "no-store")
        ch = answer.json()
        self.assertEqual(set(ch), {"id", "salt", "challenge", "max", "iat", "exp", "sig", "algorithm"})
        self.assertEqual(ch["max"], challenge.BASE_MAX)
        self.assertEqual(ch["exp"] - ch["iat"], challenge.TTL_SECONDS)
        self.assertNotIn("number", ch)

    def test_the_secret_never_appears_in_an_answer(self):
        key = challenge.secret_key().decode()
        self.assertNotIn(key, self.client.get("/challenge").text)
        self.assertNotIn(key, self.client.post("/contact-messages", json={"name": "x", "email": f"a{DOMAIN}", "message": "hola hola"}).text)

    def test_the_secret_is_created_alone_kept_in_the_database_and_never_logged(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM app_secrets WHERE name = 'challenge_hmac_key'")
        conn.commit()
        with mock.patch.dict(os.environ, {"CHALLENGE_HMAC_KEY": "", "ALTCHA_HMAC_KEY": ""}), mock.patch.object(challenge, "_key", None):
            with self.assertNoLogs("thundbalance.challenge", level=logging.DEBUG):
                first = challenge.secret_key()
            self.assertGreaterEqual(len(first), 32)
            cur.execute("SELECT value FROM app_secrets WHERE name = 'challenge_hmac_key'")
            self.assertEqual(cur.fetchone()[0].encode(), first)
            challenge._key = None                         # a restart: the same key comes back from the table (idempotent)
            self.assertEqual(challenge.secret_key(), first)
        conn.close()
        challenge._key = None                              # the next call settles on whatever the database holds

    def test_a_key_from_the_environment_is_used_when_there_is_one(self):
        with mock.patch.dict(os.environ, {"CHALLENGE_HMAC_KEY": "k" * 32}), mock.patch.object(challenge, "_key", None):
            self.assertEqual(challenge.secret_key(), b"k" * 32)

    def test_the_difficulty_grows_with_the_requests_of_the_same_ip_and_it_has_a_ceiling(self):
        base = challenge.BASE_MAX
        self.assertEqual(challenge.difficulty(1), base)
        self.assertEqual(challenge.difficulty(challenge.STEP_EVERY), base)
        self.assertEqual(challenge.difficulty(challenge.STEP_EVERY + 1), base * 2)
        self.assertEqual(challenge.difficulty(10 ** 6), base * 2 ** challenge.MAX_STEPS)

    def test_asking_for_challenges_too_often_is_limited_per_ip(self):
        headers = {"X-Forwarded-For": "1.1.1.1, 203.0.113.77"}
        with mock.patch.object(challenge, "HARD_LIMIT", 3):
            codes = [self.client.get("/challenge", headers=headers).status_code for _ in range(5)]
            self.assertEqual(codes, [200, 200, 200, 429, 429])
            other = self.client.get("/challenge", headers={"X-Forwarded-For": "1.1.1.1, 203.0.113.78"})
            self.assertEqual(other.status_code, 200)         # another address is not affected


class Verify(Base):
    def refused(self, payload, reason, now=None):
        with self.assertRaises(HTTPException) as caught:
            challenge.check_and_use(payload, now=now)
        self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(caught.exception.detail["code"], "challenge_failed")
        self.assertEqual(caught.exception.detail["reason"], reason)

    def test_a_valid_solution_is_accepted_once(self):
        payload = fresh()
        challenge.check_and_use(payload)
        self.refused(payload, "used")

    def test_missing_or_garbage_is_refused(self):
        for value in (None, "", "not base64 at all", pack({"id": "x"}), base64.b64encode(b"[1,2]").decode(), "A" * 5000):
            with self.assertRaises(HTTPException) as caught:
                challenge.check_and_use(value)
            self.assertEqual(caught.exception.detail["code"], "challenge_failed", value)

    def test_a_changed_or_wrong_solution_is_refused(self):
        data = json.loads(base64.urlsafe_b64decode(fresh() + "=="))
        self.refused(pack({**data, "number": data["number"] + 1}), "invalid")
        self.refused(pack({**data, "max": data["max"] * 1000}), "invalid")          # the difficulty is signed: it cannot be lowered or raised
        self.refused(pack({**data, "salt": "00" + data["salt"]}), "invalid")
        self.refused(pack({**data, "sig": "0" * 64}), "invalid")
        self.refused(pack({**data, "number": -1}), "invalid")

    def test_a_challenge_signed_with_another_key_is_refused(self):
        payload = fresh()
        with mock.patch.object(challenge, "_key", b"another key, another key, another key!"):
            self.refused(payload, "invalid")

    def test_an_expired_challenge_is_refused(self):
        self.refused(fresh(), "expired", now=int(time.time()) + challenge.TTL_SECONDS + 5)

    def test_a_solution_sent_in_under_two_seconds_is_asked_again_not_used_up(self):
        payload = fresh(age=0)
        self.refused(payload, "too_fast")
        challenge.check_and_use(payload, now=int(time.time()) + 3)          # a moment later the same solution is good
        self.refused(payload, "used", now=int(time.time()) + 3)

    def test_used_ids_are_cleaned_up_after_they_expire(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO challenge_used (id, exp) VALUES ('old-test-id', %s) ON CONFLICT DO NOTHING", (int(time.time()) - 1000,))
        conn.commit()
        challenge.ensure_tables()
        cur.execute("SELECT COUNT(*) FROM challenge_used WHERE id = 'old-test-id'")
        self.assertEqual(cur.fetchone()[0], 0)
        conn.close()


class Forms(Base):
    def trial_body(self, **extra):
        from datetime import date, timedelta
        day = date.today() + timedelta(days=3)
        return {"privacy_consent": True, "consent_version": "test", "full_name": "Ana Reto", "email": f"ana{DOMAIN}", "phone": "+34613502662",
                "age": 30, "goals": [main.TRIAL_GOALS[0]], "experience": "beginner", "session_date": day.isoformat(), "session_time": "10:00",
                "lang": "es", **extra}

    def contact_body(self, **extra):
        return {"privacy_consent": True, "consent_version": "test", "name": "Ana Ruiz", "email": f"ana{DOMAIN}", "message": "Hola, quiero informacion.",
                "language": "es", **extra}

    def setUp(self):
        super().setUp()
        cm._limit.clear()
        p = mock.patch.object(cm, "send_email_async", lambda *a, **k: None)
        p.start()
        self.addCleanup(p.stop)

    def test_contact_without_or_with_a_bad_solution_is_refused_and_a_good_one_accepted(self):
        for extra in ({}, {"challenge": "garbage"}, {"challenge": fresh(age=2000)}):
            answer = self.client.post("/contact-messages", json=self.contact_body(**extra))
            self.assertEqual(answer.status_code, 400, extra)
            self.assertEqual(answer.json()["detail"]["code"], "challenge_failed")
        payload = fresh()
        self.assertEqual(self.client.post("/contact-messages", json=self.contact_body(challenge=payload)).status_code, 200)
        again = self.client.post("/contact-messages", json=self.contact_body(challenge=payload))        # the same solution twice
        self.assertEqual((again.status_code, again.json()["detail"]["reason"]), (400, "used"))

    def test_the_hidden_field_still_pretends_it_worked_without_storing_anything(self):
        answer = self.client.post("/contact-messages", json=self.contact_body(website="http://spam"))
        self.assertEqual((answer.status_code, answer.json()), (200, {"ok": True}))

    def test_a_typo_does_not_use_up_the_solution(self):
        payload = fresh()
        bad = self.client.post("/contact-messages", json=self.contact_body(challenge=payload, email="not-an-email"))
        self.assertIn(bad.status_code, (400, 422))
        self.assertNotEqual(bad.json().get("detail", {}).get("code") if isinstance(bad.json().get("detail"), dict) else None, "challenge_failed")
        self.assertEqual(self.client.post("/contact-messages", json=self.contact_body(challenge=payload)).status_code, 200)

    def test_the_trial_asks_for_it_too(self):
        with mock.patch.object(main, "_too_many_trial_requests", return_value=False):
            missing = self.client.post("/trial-sessions", json=self.trial_body())
            self.assertEqual(missing.status_code, 400, missing.text)
            self.assertEqual(missing.json()["detail"]["code"], "challenge_failed")
            ok = self.client.post("/trial-sessions", json=self.trial_body(challenge=fresh()))
            self.assertNotEqual(ok.json().get("detail", {}).get("code") if isinstance(ok.json().get("detail"), dict) else None, "challenge_failed", ok.text)

    def register(self, who, payload=None):
        body = {"firebase_uid": "x", "nome": "Ana Perfil", "email": f"{who}{DOMAIN}"}
        if payload:
            body["challenge"] = payload
        return self.client.post("/users", headers={"Authorization": f"Bearer {who}"}, json=body)

    def test_a_new_profile_needs_it_but_an_existing_one_signs_in_without_it(self):
        original = main.id_token.verify_firebase_token
        main.id_token.verify_firebase_token = lambda token, *a, **k: {"iss": ISS, "email": f"{token}{DOMAIN}", "sub": f"uid-{token}", "email_verified": True}
        self.addCleanup(setattr, main.id_token, "verify_firebase_token", original)
        refused = self.register("newbie")
        self.assertEqual((refused.status_code, refused.json()["detail"]["code"]), (400, "challenge_failed"))
        created = self.register("newbie", fresh())
        self.assertEqual((created.status_code, created.json()["message"]), (200, "User created successfully"))
        again = self.register("newbie")                                       # the profile exists: no challenge needed
        self.assertEqual((again.status_code, again.json()["message"]), (200, "User already exists"))

    def test_the_open_routes_that_must_stay_open_do_not_ask_for_it(self):
        for path in ("/pricing", "/trainers", "/features", "/health/ready"):
            self.assertNotEqual(self.client.get(path).status_code, 400, path)


if __name__ == "__main__":
    unittest.main()

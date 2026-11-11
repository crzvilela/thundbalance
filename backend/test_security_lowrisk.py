"""The three low-risk points of the security audit:  python -m unittest test_security_lowrisk -v

A2  the real client IP behind the proxy (a forged X-Forwarded-For does not get around a limit) and the trial limit per e-mail;
B3  CORS: localhost only in development, never "*";
M4  video uploads: extension, Content-Type and the real signature of the file must agree.
The local database is used and the rows are removed afterwards. Mail is not sent.
"""
import os
import shutil
import tempfile
import unittest
from datetime import date, timedelta
from types import SimpleNamespace
from unittest import mock

from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
import trainer_choice
import web_safety
from database import get_connection

DOMAIN = "@test-lowrisk.example"


def request(forwarded=None, host="10.0.0.1"):
    headers = {} if forwarded is None else {"x-forwarded-for": forwarded}
    return SimpleNamespace(headers=headers, client=SimpleNamespace(host=host))


# ------------------------------------------------------------------------------------------------ A2: the client IP
class ClientIp(unittest.TestCase):
    def test_the_address_the_proxy_appended_is_the_client_never_the_first_value(self):
        self.assertEqual(web_safety.get_client_ip(request("66.66.66.66, 203.0.113.9"), hops=1), "203.0.113.9")        # the first is forged
        self.assertEqual(web_safety.get_client_ip(request("1.1.1.1, 2.2.2.2, 203.0.113.9"), hops=1), "203.0.113.9")
        self.assertEqual(web_safety.get_client_ip(request("203.0.113.9"), hops=1), "203.0.113.9")

    def test_with_two_proxies_the_second_from_the_end_is_the_client(self):
        self.assertEqual(web_safety.get_client_ip(request("66.66.66.66, 203.0.113.9, 172.70.0.1"), hops=2), "203.0.113.9")
        self.assertEqual(web_safety.get_client_ip(request("203.0.113.9"), hops=2), "10.0.0.1")        # shorter than the proxies: not trusted

    def test_without_the_header_or_with_garbage_the_connection_address_is_used(self):
        self.assertEqual(web_safety.get_client_ip(request(None), hops=1), "10.0.0.1")
        self.assertEqual(web_safety.get_client_ip(request("", host="198.51.100.4"), hops=1), "198.51.100.4")
        self.assertEqual(web_safety.get_client_ip(request("1.2.3.4, not-an-ip"), hops=1), "10.0.0.1")
        self.assertEqual(web_safety.get_client_ip(request("1.2.3.4, <script>"), hops=1), "10.0.0.1")
        self.assertEqual(web_safety.get_client_ip(request("66.66.66.66, 203.0.113.9"), hops=0), "10.0.0.1")        # 0: the header is ignored
        self.assertEqual(web_safety.get_client_ip(SimpleNamespace(headers={}, client=None), hops=1), "unknown")

    def test_ipv6_is_written_one_way(self):
        self.assertEqual(web_safety.get_client_ip(request("2001:DB8:0:0:0:0:0:1"), hops=1), "2001:db8::1")

    def test_the_default_is_one_proxy_and_it_is_a_setting(self):
        self.assertEqual(web_safety.TRUSTED_PROXY_HOPS, 1)
        with mock.patch.dict(os.environ, {"TRUSTED_PROXY_HOPS": "2", "TEST_LIMIT": "x"}):
            self.assertEqual(web_safety.env_int("TRUSTED_PROXY_HOPS", 1, minimum=0), 2)
            self.assertEqual(web_safety.env_int("TEST_LIMIT", 7), 7)                                  # not a number: the default
            self.assertEqual(web_safety.env_int("NOT_SET_ANYWHERE", 5), 5)

    def test_no_limiter_reads_the_address_on_its_own(self):
        here = os.path.dirname(os.path.abspath(__file__))
        for name in ("main.py", "contact_messages.py", "trainer_choice.py", "web_safety.py"):
            source = open(os.path.join(here, name), encoding="utf-8").read()
            self.assertNotIn("request.client.host", source.replace("peer = (request.client.host", ""), name)       # only get_client_ip does
            self.assertNotIn('headers.get("x-forwarded-for"', source.replace('request.headers.get("x-forwarded-for", "")', ""), name)


class Limits(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.ensure_trial_session_fields()
        cls.client = TestClient(main.app)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 1")
        conn.close()

    def setUp(self):
        main._trial_hits.clear()
        trainer_choice.reset_rate_limit()
        self.cleanup()

    def tearDown(self):
        main._trial_hits.clear()
        self.cleanup()

    @staticmethod
    def cleanup():
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        conn.commit()
        conn.close()

    # ----- the limit per address cannot be dodged with a forged header
    def test_a_forged_first_value_does_not_get_around_the_availability_limit(self):
        with mock.patch.object(trainer_choice, "RATE_LIMIT", 3):
            codes = [self.client.get("/pack-availability", headers={"X-Forwarded-For": f"9.9.9.{n}, 203.0.113.50"}).status_code for n in range(5)]
            self.assertEqual(codes[:3], [200, 200, 200])
            self.assertEqual(codes[3:], [429, 429])                                                   # the same client, whatever it writes first
            other = self.client.get("/pack-availability", headers={"X-Forwarded-For": "9.9.9.1, 203.0.113.51"})
            self.assertEqual(other.status_code, 200)                                                  # another client is not affected

    def test_a_forged_first_value_does_not_get_around_the_trial_limit(self):
        body = {"full_name": "Ana García", "email": "not-an-email", "phone": "600123456", "goals": ["Lose weight"], "experience": "Beginner",
                "session_date": (date.today() + timedelta(days=10)).isoformat(), "session_time": "10:00"}
        with mock.patch.object(main._trial_hits, "limit", 2):
            codes = [self.client.post("/trial-sessions", json=body, headers={"X-Forwarded-For": f"8.8.8.{n}, 203.0.113.60"}).status_code for n in range(4)]
        self.assertEqual(codes, [422, 422, 429, 429])               # the first two reach the validation; then the address is limited

    def test_the_limits_are_settings_with_sensible_defaults(self):
        self.assertEqual((main.TRIAL_LIMIT, main.TRIAL_WINDOW_SECONDS), (5, 3600))
        self.assertEqual((main.TRIAL_EMAIL_LIMIT, main.TRIAL_EMAIL_WINDOW_SECONDS), (3, 86400))
        self.assertEqual(trainer_choice.RATE_LIMIT, 60)

    # ----- the limit per e-mail
    def trial(self, email, ip="203.0.113.70"):
        return self.client.post("/trial-sessions", headers={"X-Forwarded-For": f"1.1.1.1, {ip}"}, json={
            "full_name": "Ana García", "email": email, "phone": "600123456", "goals": ["Lose weight"], "experience": "Beginner",
            "session_date": self.slot(), "session_time": "10:00"})

    @staticmethod
    def slot():
        day = date.today() + timedelta(days=14)
        while day.weekday() > 4:
            day += timedelta(days=1)
        return day.isoformat()

    def test_the_same_email_cannot_make_more_than_three_requests_a_day(self):
        with mock.patch.object(main, "notify_trial_requested"), mock.patch.object(main.mailer, "send_trial_received"), \
                mock.patch.object(main._trial_hits, "limit", 100):                            # only the e-mail limit is under test
            answers = [self.trial(f"ana{DOMAIN}") for _ in range(5)]
            self.assertEqual([answer.status_code for answer in answers], [200, 409, 409, 429, 429])        # created, then "you already have one", then limited
            self.assertEqual(answers[3].json()["detail"], "Too many requests from this connection. Please try again later.")      # generic
            # the same address written another way counts as the same one
            self.assertEqual(self.trial(f"  ANA{DOMAIN} ".strip()).status_code, 429)
            # another e-mail from the same connection is not blocked by it
            self.assertEqual(self.trial(f"otra{DOMAIN}").status_code, 200)

    def test_the_answer_does_not_tell_whether_the_email_exists(self):
        with mock.patch.object(main, "notify_trial_requested"), mock.patch.object(main.mailer, "send_trial_received"), \
                mock.patch.object(main._trial_hits, "limit", 100), mock.patch.object(main._trial_email_hits, "limit", 1):
            self.assertEqual(self.trial(f"nuevo{DOMAIN}").status_code, 200)
            known = self.trial(f"nuevo{DOMAIN}")                                              # limited
            unknown_first = self.trial(f"nunca{DOMAIN}")
            unknown_second = self.trial(f"nunca{DOMAIN}")
            self.assertEqual((known.status_code, unknown_second.status_code), (429, 429))
            self.assertEqual(known.json(), unknown_second.json())                            # the same answer for an e-mail that exists or not
            self.assertEqual(unknown_first.status_code, 200)

    def test_the_email_is_never_stored_in_the_limit_table(self):
        key = main._email_limit_key(f"Ana {DOMAIN}")
        self.assertNotIn("ana", key.lower().replace("email:", ""))
        self.assertTrue(key.startswith("email:"))
        self.assertEqual(main._email_limit_key(f"ana{DOMAIN}"), main._email_limit_key(f" ANA{DOMAIN} "))


# ------------------------------------------------------------------------------------------------ B3: CORS
class Cors(unittest.TestCase):
    def test_production_allows_only_the_production_site_and_what_the_environment_lists(self):
        with mock.patch.dict(os.environ, {"ENV": "", "ENVIRONMENT": ""}):
            self.assertEqual(web_safety.cors_origins(extra=""), ["https://thundbalance.vercel.app"])          # nothing set: only the main origin
            origins = web_safety.cors_origins(extra="https://thundbalance.com/, https://www.thundbalance.com")
            self.assertEqual(origins, ["https://thundbalance.vercel.app", "https://thundbalance.com", "https://www.thundbalance.com"])

    def test_localhost_is_refused_in_production_even_when_the_environment_lists_it(self):
        with mock.patch.dict(os.environ, {"ENV": "production", "ENVIRONMENT": ""}):
            origins = web_safety.cors_origins(extra="http://localhost:5173, http://127.0.0.1:5173, http://localhost:3000, http://[::1]:5173, https://thundbalance.com")
        self.assertEqual(origins, ["https://thundbalance.vercel.app", "https://thundbalance.com"])
        for origin in origins:
            self.assertNotIn("localhost", origin)
            self.assertNotIn("127.0.0.1", origin)

    def test_a_wildcard_or_a_non_web_origin_is_never_accepted(self):
        origins = web_safety.cors_origins(extra="*, null, file://x, ftp://a, javascript:alert(1), ")
        self.assertEqual(origins, ["https://thundbalance.vercel.app"])
        self.assertNotIn("*", web_safety.cors_origins(extra="*", development=True))

    def test_development_adds_localhost(self):
        for value in ("development", "dev", "local", "Development"):
            with mock.patch.dict(os.environ, {"ENV": value, "ENVIRONMENT": ""}):
                self.assertTrue(web_safety.is_development(), value)
                origins = web_safety.cors_origins(extra="")
                self.assertIn("http://localhost:5173", origins)
                self.assertIn("http://127.0.0.1:5173", origins)
                self.assertIn("https://thundbalance.vercel.app", origins)
        with mock.patch.dict(os.environ, {"ENV": "", "ENVIRONMENT": "development"}):
            self.assertTrue(web_safety.is_development())
        with mock.patch.dict(os.environ, {"ENV": "", "ENVIRONMENT": "prod"}):
            self.assertFalse(web_safety.is_development())

    def test_the_running_app_in_this_environment_answers_cors_for_the_production_site_and_not_for_localhost(self):
        self.assertFalse(web_safety.is_development())               # the tests run like production: nothing set
        client = TestClient(main.app)
        allowed = client.options("/health", headers={"Origin": "https://thundbalance.vercel.app", "Access-Control-Request-Method": "GET"})
        self.assertEqual(allowed.headers.get("access-control-allow-origin"), "https://thundbalance.vercel.app")
        refused = client.options("/health", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
        self.assertIsNone(refused.headers.get("access-control-allow-origin"))
        self.assertNotIn("http://localhost:5173", main.CORS_ORIGINS)


# ------------------------------------------------------------------------------------------------ M4: videos
MP4 = b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2avc1mp41" + b"\x00" * 64
MOV = b"\x00\x00\x00\x14ftypqt  \x00\x00\x00\x00qt  " + b"\x00" * 64
OLD_MOV = b"\x00\x00\x00\x08wide\x00\x00\x10\x00mdat" + b"\x00" * 64
WEBM = b"\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01" + b"\x00" * 64
FAKE = b"MZ\x90\x00 this is a program, not a video" * 4                     # an executable renamed .mp4
HTML = b"<html><script>alert(1)</script></html>" * 3


class Videos(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)

    def setUp(self):
        self.folder = tempfile.mkdtemp()
        self.patches = [mock.patch.object(main, "UPLOAD_DIR", self.folder)]
        for patcher in self.patches:
            patcher.start()
        main.app.dependency_overrides[main.require_admin] = lambda: {"email": main.ADMIN_EMAIL}

    def tearDown(self):
        main.app.dependency_overrides.pop(main.require_admin, None)
        for patcher in self.patches:
            patcher.stop()
        shutil.rmtree(self.folder, ignore_errors=True)

    def upload(self, name, data, content_type):
        return self.client.post("/landing-page/upload-video", files={"file": (name, data, content_type)})

    def test_real_videos_are_accepted_under_a_name_the_server_makes(self):
        for name, data, content_type in (("clip.mp4", MP4, "video/mp4"), ("Clip.MOV", MOV, "video/quicktime"), ("old.mov", OLD_MOV, "video/quicktime"),
                                         ("clip.webm", WEBM, "video/webm"), ("phone.mp4", MP4, "application/octet-stream"), ("nodeclared.mov", MOV, "")):
            answer = self.upload(name, data, content_type)
            self.assertEqual(answer.status_code, 200, (name, answer.text))
            url = answer.json()["url"]
            stored = os.path.basename(url)
            self.assertRegex(stored, r"^[0-9a-f]{32}\.(mp4|mov|webm)$")                            # uuid + the validated extension
            self.assertNotIn(os.path.splitext(name)[0].lower(), stored)                           # the name sent is not used
            self.assertEqual(open(os.path.join(self.folder, stored), "rb").read(), data)

    def test_a_fake_file_renamed_to_mp4_is_rejected(self):
        for name, data, content_type in (("virus.mp4", FAKE, "video/mp4"), ("page.mp4", HTML, "video/mp4"), ("empty.mp4", b"", "video/mp4"),
                                         ("tiny.mp4", b"abc", "video/mp4"), ("fake.webm", FAKE, "video/webm"), ("fake.mov", HTML, "video/quicktime")):
            answer = self.upload(name, data, content_type)
            self.assertEqual(answer.status_code, 415, name)
        self.assertEqual(os.listdir(self.folder), [])                                          # nothing was written

    def test_the_extension_the_content_type_and_the_signature_must_agree(self):
        self.assertEqual(self.upload("a.mp4", WEBM, "video/webm").status_code, 415)           # a WebM called .mp4
        self.assertEqual(self.upload("a.webm", MP4, "video/mp4").status_code, 415)            # an MP4 called .webm
        self.assertEqual(self.upload("a.mp4", MP4, "video/webm").status_code, 415)            # the declared type is another video type
        self.assertEqual(self.upload("a.mp4", MP4, "image/png").status_code, 415)
        self.assertEqual(self.upload("a.mp4", MP4, "text/html").status_code, 415)
        self.assertEqual(self.upload("a.mov", MOV, "video/mp4").status_code, 415)
        self.assertEqual(self.upload("a.exe", MP4, "video/mp4").status_code, 415)             # an extension that is not allowed
        self.assertEqual(self.upload("noextension", MP4, "video/mp4").status_code, 415)
        self.assertEqual(os.listdir(self.folder), [])

    def test_a_path_in_the_name_changes_nothing_and_the_size_limit_stays(self):
        answer = self.upload("../../../etc/passwd.mp4", MP4, "video/mp4")
        self.assertEqual(answer.status_code, 200)
        self.assertEqual(len(os.listdir(self.folder)), 1)
        with mock.patch.object(main, "MAX_VIDEO_SIZE_BYTES", 100):
            too_big = self.upload("big.mp4", MP4 + b"0" * 200, "video/mp4")
            self.assertEqual(too_big.status_code, 400)
            self.assertIn("too large", too_big.json()["detail"])

    def test_the_signature_check_by_itself(self):
        self.assertEqual(web_safety.check_video("a.MP4", "video/mp4; codecs=avc1", MP4), ".mp4")
        with self.assertRaises(HTTPException) as caught:
            web_safety.check_video("a.mp4", "video/mp4", FAKE)
        self.assertEqual(caught.exception.status_code, 415)

    def test_only_the_admin_can_upload(self):
        main.app.dependency_overrides.pop(main.require_admin, None)
        self.assertEqual(self.upload("clip.mp4", MP4, "video/mp4").status_code, 401)


if __name__ == "__main__":
    unittest.main()

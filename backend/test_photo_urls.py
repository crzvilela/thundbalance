"""Only our own uploads and Google photos can be a client's photo: python -m unittest test_photo_urls -v"""
import os
import unittest
from unittest import mock

from fastapi.testclient import TestClient

import main
import photo_urls
from database import get_connection

DOMAIN = "@test-photos.example"
ISS = f"https://securetoken.google.com/{main.FIREBASE_PROJECT_ID}"


class CleanPhotoUrl(unittest.TestCase):
    def test_our_own_uploads_are_accepted(self):
        for value in ("/uploads/0123456789abcdef0123456789abcdef.png", "/uploads/photo-1.JPG",
                      "https://thundbalance.onrender.com/uploads/a1b2.jpg", "https://thundbalance-api.onrender.com/uploads/a1b2.webp"):
            self.assertEqual(photo_urls.clean_photo_url(value), value, value)

    def test_google_account_photos_are_accepted(self):
        for value in ("https://lh3.googleusercontent.com/a/ACg8ocJxyz=s96-c", "https://lh4.googleusercontent.com/-abc/photo.jpg",
                      "https://lh3.googleusercontent.com/a-/AOh14Gh?sz=50"):
            self.assertEqual(photo_urls.clean_photo_url(value), value, value)

    def test_an_address_of_any_other_server_is_refused(self):
        for value in ("https://evil.example/pixel.gif?client=1", "http://evil.example/p.png", "https://attacker.com/uploads/a.png",
                      "https://lh3.googleusercontent.com.evil.example/a.png",                     # a look-alike host
                      "https://evil.example/https://lh3.googleusercontent.com/a.png",            # the Google address hidden in the path
                      "https://lh3.googleusercontent.com@evil.example/a.png",                    # user info: the real host is evil.example
                      "https://evil.example#@lh3.googleusercontent.com/a.png",
                      "https://thundbalance.onrender.com.evil.example/uploads/a.png",
                      "https://lh3.googleusercontent.com:8443/a.png",                            # another port
                      "http://lh3.googleusercontent.com/a.png",                                  # not https
                      "//evil.example/uploads/a.png", "/\\evil.example/a.png", "javascript:alert(1)", "data:image/svg+xml;base64,PHN2Zz4=",
                      "ftp://lh3.googleusercontent.com/a.png", "https://www.googleusercontent.com/a.png",
                      "https://thundbalance.onrender.com/uploads/../secret.png", "https://thundbalance.onrender.com/other/a.png",
                      "https://thundbalance.onrender.com/uploads/a.png?x=https://evil.example"):
            self.assertIsNone(photo_urls.clean_photo_url(value), value)

    def test_empty_long_and_odd_values_are_ignored(self):
        for value in (None, "", "   ", "https://lh3.googleusercontent.com/" + "a" * 600, "/uploads/a b.png", "/uploads/a\nb.png", "/uploads/", "/uploads/.hidden",
                      "/other/a.png", "uploads/a.png", 12345):
            self.assertIsNone(photo_urls.clean_photo_url(value), repr(value))

    def test_localhost_only_counts_while_developing(self):
        local = "http://localhost:8000/uploads/a1b2.jpg"
        with mock.patch.dict(os.environ, {"ENV": "", "ENVIRONMENT": ""}):
            self.assertIsNone(photo_urls.clean_photo_url(local))                          # in production an address of localhost is refused
        with mock.patch.dict(os.environ, {"ENV": "development"}):
            self.assertEqual(photo_urls.clean_photo_url("http://127.0.0.1/uploads/a1b2.jpg"), "http://127.0.0.1/uploads/a1b2.jpg")


class Registration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = TestClient(main.app)

    def setUp(self):
        self.cleanup()
        self._verify = main.id_token.verify_firebase_token
        self.uid_counter = 0
        main.id_token.verify_firebase_token = lambda token, *a, **k: {"iss": ISS, "email": f"{token}{DOMAIN}", "sub": f"uid-{token}", "email_verified": True}

    def tearDown(self):
        main.id_token.verify_firebase_token = self._verify
        self.cleanup()

    @staticmethod
    def cleanup():
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        conn.commit()
        conn.close()

    def register(self, who, foto):
        return self.http.post("/users", headers={"Authorization": f"Bearer {who}"},
                              json={"firebase_uid": "x", "nome": "Foto Prueba", "email": f"{who}{DOMAIN}", "foto": foto})

    def saved(self, who):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT foto FROM users WHERE email = %s", (f"{who}{DOMAIN}",))
        row = cur.fetchone()
        conn.close()
        return row

    def test_a_photo_of_another_server_is_ignored_and_the_registration_still_works(self):
        answer = self.register("tracker", "https://evil.example/pixel.gif?who=client")
        self.assertEqual(answer.status_code, 200, answer.text)
        self.assertEqual(self.saved("tracker"), (None,))                                  # the account exists, with no photo

    def test_our_uploads_and_google_photos_are_kept(self):
        self.assertEqual(self.register("own", "/uploads/abcdef0123.png").status_code, 200)
        self.assertEqual(self.saved("own"), ("/uploads/abcdef0123.png",))
        google = "https://lh3.googleusercontent.com/a/ACg8ocJ=s96-c"
        self.assertEqual(self.register("google", google).status_code, 200)
        self.assertEqual(self.saved("google"), (google,))

    def test_no_photo_is_fine(self):
        self.assertEqual(self.register("none", None).status_code, 200)
        self.assertEqual(self.saved("none"), (None,))


class OldValues(unittest.TestCase):
    def setUp(self):
        Registration.cleanup()

    def tearDown(self):
        Registration.cleanup()

    def test_old_addresses_that_do_not_qualify_are_emptied_and_uploads_stay(self):
        values = {"keep-upload": "/uploads/a1b2c3.png", "keep-api": "https://thundbalance.onrender.com/uploads/a1b2c3.png",
                  "keep-google": "https://lh3.googleusercontent.com/a/ACg=s96-c", "clear-evil": "https://evil.example/p.gif",
                  "clear-http": "http://evil.example/p.gif", "clear-data": "data:image/svg+xml;base64,PHN2Zz4="}
        conn = get_connection()
        cur = conn.cursor()
        for name, foto in values.items():
            cur.execute("INSERT INTO users (nome, email, foto) VALUES (%s, %s, %s)", (name, f"{name}{DOMAIN}", foto))
        cur.execute("INSERT INTO users (nome, email) VALUES ('no photo', %s)", (f"nophoto{DOMAIN}",))
        conn.commit()
        conn.close()
        before = photo_urls.clean_stored_photos()
        self.assertGreaterEqual(before, 3)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT split_part(email, '@', 1), foto FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        rows = dict(cur.fetchall())
        conn.close()
        for name, foto in values.items():
            self.assertEqual(rows[name], foto if name.startswith("keep") else None, name)
        self.assertIsNone(rows["nophoto"])
        self.assertEqual(photo_urls.clean_stored_photos(), 0)                              # running it again changes nothing (idempotent)


if __name__ == "__main__":
    unittest.main()

"""Firebase Admin initialisation and its diagnostics:

    python -m unittest test_firebase_accounts -v

The failure reasons are tested with temporary files. The real key (if
FIREBASE_CREDENTIALS_PATH points to one) is only *loaded*: no request is made
to Firebase and nothing is created.
"""
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

import firebase_accounts as fa
import main


def reset():
    """Forget any previous initialisation (tests only)."""
    try:
        import firebase_admin
        if fa._app is not None:
            firebase_admin.delete_app(fa._app)
    except Exception:
        pass
    fa._app = None
    fa._reason = None


class Initialisation(unittest.TestCase):
    def setUp(self):
        reset()
        self._env = os.environ.get("FIREBASE_CREDENTIALS_PATH")
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        reset()
        if self._env is None:
            os.environ.pop("FIREBASE_CREDENTIALS_PATH", None)
        else:
            os.environ["FIREBASE_CREDENTIALS_PATH"] = self._env
        self.tmp.cleanup()

    def init(self):
        out = io.StringIO()
        with redirect_stdout(out):
            result = fa.init_firebase_admin()
        return result, out.getvalue().strip()

    def test_variable_missing_or_empty(self):
        for value in (None, "", "   "):
            reset()
            if value is None:
                os.environ.pop("FIREBASE_CREDENTIALS_PATH", None)
            else:
                os.environ["FIREBASE_CREDENTIALS_PATH"] = value
            (ready, reason), line = self.init()
            self.assertFalse(ready)
            self.assertEqual(reason, "variável em falta")
            self.assertEqual(line, "Firebase Admin: NÃO inicializado (motivo: variável em falta)")

    def test_file_not_found(self):
        os.environ["FIREBASE_CREDENTIALS_PATH"] = os.path.join(self.tmp.name, "does-not-exist.json")
        (ready, reason), line = self.init()
        self.assertEqual((ready, reason), (False, "ficheiro não encontrado"))
        self.assertIn("ficheiro não encontrado", line)
        self.assertNotIn(self.tmp.name, line)            # the path is not printed

    def test_invalid_json(self):
        for content in ("{not json", json.dumps({"hello": "world"}), ""):
            reset()
            path = os.path.join(self.tmp.name, "key.json")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(content)
            os.environ["FIREBASE_CREDENTIALS_PATH"] = path
            (ready, reason), _ = self.init()
            self.assertEqual((ready, reason), (False, "JSON inválido"), content[:20])

    def test_package_missing(self):
        saved = {name: sys.modules.get(name) for name in ("firebase_admin", "firebase_admin.credentials")}
        sys.modules["firebase_admin"] = None            # makes "import firebase_admin" raise ImportError
        try:
            (ready, reason), line = self.init()
        finally:
            for name, module in saved.items():
                if module is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = module
        self.assertEqual((ready, reason), (False, "pacote em falta"))
        self.assertIn("pacote em falta", line)

    def test_failed_calls_raise_unavailable_with_the_reason(self):
        os.environ.pop("FIREBASE_CREDENTIALS_PATH", None)
        for call in (lambda: fa.create_login("a@b.co", "x", "A"), lambda: fa.set_password("uid", "x")):
            with self.assertRaises(fa.AccountsUnavailable) as caught:
                call()
            self.assertEqual(str(caught.exception), "variável em falta")

    def test_a_missing_key_does_not_stop_the_server_or_other_routes(self):
        os.environ.pop("FIREBASE_CREDENTIALS_PATH", None)
        main.init_firebase_admin_at_startup()            # the real startup hook: must not raise
        self.assertEqual(main.home()["message"], "ThundBalance API Running")
        for route in main.app.routes:                     # an unrelated public route still answers
            if getattr(route, "path", None) == "/schedule":
                self.assertIsInstance(route.endpoint(), dict)

    def test_health_endpoint(self):
        os.environ.pop("FIREBASE_CREDENTIALS_PATH", None)
        endpoint = next(r for r in main.app.routes if getattr(r, "path", None) == "/admin/firebase-status")
        self.assertIn(main.require_admin, [d.call for d in endpoint.dependant.dependencies])
        answer = endpoint.endpoint()
        self.assertEqual(set(answer), {"firebase_admin_ready", "reason"})
        self.assertEqual(answer, {"firebase_admin_ready": False, "reason": "variável em falta"})
        for header in (None, "Bearer nope"):
            with self.assertRaises(Exception) as caught:
                main.require_admin(header)
            self.assertEqual(caught.exception.status_code, 401)

    def test_503_names_the_reason(self):
        import client_accounts
        os.environ.pop("FIREBASE_CREDENTIALS_PATH", None)
        endpoint = next(r for r in main.app.routes if getattr(r, "path", None) == "/admin/clients" and "POST" in r.methods).endpoint
        from fastapi import HTTPException
        with self.assertRaises(HTTPException) as caught:
            endpoint(client_accounts.CreateClient(name="Ana", email="ana503@test-clients.example"))
        self.assertEqual(caught.exception.status_code, 503)
        self.assertIn("variável em falta", caught.exception.detail)
        self.assertIn("Account creation is not configured", caught.exception.detail)

    @unittest.skipUnless(os.path.isfile(r"C:\Segredos\firebase-service-account.json"), "real key not on this machine")
    def test_the_real_key_loads_once_and_is_idempotent(self):
        os.environ["FIREBASE_CREDENTIALS_PATH"] = r"C:\Segredos\firebase-service-account.json"
        (ready, reason), line = self.init()
        self.assertEqual((ready, reason, line), (True, "ok", "Firebase Admin: OK"))
        (ready, reason), second_line = self.init()        # second call: same app, no second log line
        self.assertEqual((ready, reason, second_line), (True, "ok", ""))
        import firebase_admin
        self.assertIs(firebase_admin.get_app(), fa._app)


if __name__ == "__main__":
    unittest.main()

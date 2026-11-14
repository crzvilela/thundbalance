"""A path or a method that does not exist, and a bug, answer in JSON in the common shape of the API:

    python -m unittest test_error_format -v

{"detail": {"code": "...", "message": "Español. / English."}}: a stable code, a message, never a stack trace or a bare "Not Found".
"""
import json
import logging
import unittest

from fastapi.testclient import TestClient

import main


class ErrorShape(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = TestClient(main.app, raise_server_exceptions=False)

    def test_a_path_that_does_not_exist_is_a_404_in_json_in_the_common_shape(self):
        for path in ("/no-such-route", "/admin/nothing-here", "/me/export/extra", "/landing-page/unknown"):
            response = self.http.get(path)
            self.assertEqual(response.status_code, 404, path)
            self.assertIn("application/json", response.headers["content-type"])
            self.assertEqual(response.json(), {"detail": {"code": "not_found", "message": "No encontrado. / Not found."}}, path)
            self.assertNotIn("Traceback", response.text)

    def test_a_method_that_is_not_allowed_is_a_405_in_json_and_keeps_the_allow_header(self):
        response = self.http.delete("/health")
        self.assertEqual(response.status_code, 405)
        self.assertEqual(response.json()["detail"]["code"], "method_not_allowed")
        self.assertIn(" / ", response.json()["detail"]["message"])
        self.assertIn("GET", response.headers.get("allow", ""))

    def test_the_errors_of_a_route_keep_their_own_shape(self):
        response = self.http.get("/admin/stats")                                           # no token
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json(), {"detail": "Authentication required"})
        self.assertEqual(self.http.get("/schedule/not-a-date").status_code, 422)

    def test_the_public_content_still_answers(self):
        self.assertEqual(self.http.get("/health").json(), {"status": "ok"})

    def test_an_unexpected_error_is_a_500_in_the_same_shape_without_details_and_logs_only_its_type(self):
        @main.app.get("/__boom_for_tests")
        def boom():
            raise RuntimeError("secret detail of ana@example.com")

        try:
            with self.assertLogs(level="ERROR") as captured:
                response = self.http.get("/__boom_for_tests")
        finally:
            main.app.router.routes[:] = [route for route in main.app.router.routes if getattr(route, "path", "") != "/__boom_for_tests"]
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()["detail"]["code"], "internal_error")
        body = json.dumps(response.json())
        self.assertNotIn("secret detail", body)
        self.assertNotIn("ana@example.com", body)
        self.assertNotIn("Traceback", body)
        logs = "\n".join(captured.output)
        self.assertIn("RuntimeError", logs)
        self.assertNotIn("ana@example.com", logs)
        self.assertNotIn("secret detail", logs)


if __name__ == "__main__":
    logging.disable(logging.NOTSET)
    unittest.main()

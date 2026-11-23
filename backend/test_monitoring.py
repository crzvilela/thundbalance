"""The error monitoring, the keep-alive and /health/ready (monitoring.py, monitoring_routes.py, keepalive.py):

    python -m unittest test_monitoring -v

Nothing personal is ever kept; repeated errors only raise a counter; the alerts are rare; the monitoring can never hurt the site.
"""
import json
import unittest
from unittest import mock

import testsafety
from fastapi.testclient import TestClient

import keepalive
import main
import monitoring
import monitoring_routes
from database import get_connection
from emails import monitor_emails

TYPE = "ZzMonitorTestError"
BASE = 1_800_000_000          # a realistic clock: the 6 hours are counted from the last alert
PERSONAL = ["ana.garcia@example.com", "+34 600 123 456", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEFghiJKL", "Ana Garcia Zuniga"]


def flush():
    monitoring._worker.submit(lambda: None).result(10)           # the recording runs in the background worker


class Scrub(unittest.TestCase):
    def test_an_event_full_of_personal_data_comes_out_clean(self):
        dirty = ("null value in column \"email\" of relation \"users\" violates not-null constraint "
                 "DETAIL: Failing row contains (10062, null, Ana Garcia Zuniga, ana.garcia@example.com, +34 600 123 456). "
                 "token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEFghiJKL secret=Zx9QpL2mNv8TrKd4WcYb7HsJf3GaUe1O "
                 "see https://thundbalance.example/reschedule-response/abc123?token=SECRET and 'Ana Garcia Zuniga' called +34 911 222 333")
        clean = monitoring.scrub(dirty)
        for private in PERSONAL + ["+34 911 222 333", "Zx9QpL2mNv8TrKd4WcYb7HsJf3GaUe1O", "https://", "SECRET", "10062"]:
            self.assertNotIn(private, clean, private)
        self.assertLessEqual(len(clean), 200)
        self.assertNotIn("Failing row contains (", clean.replace("Failing row contains (...)", ""))
        self.assertEqual(monitoring.scrub(None), "")

    def test_the_fingerprint_is_stable_and_only_depends_on_what_identifies_the_error(self):
        one = monitoring.fingerprint("backend", "KeyError", "main.py", 10, "GET /a")
        self.assertEqual(one, monitoring.fingerprint("backend", "KeyError", "main.py", 10, "GET /a"))
        self.assertNotEqual(one, monitoring.fingerprint("backend", "KeyError", "main.py", 11, "GET /a"))
        self.assertNotEqual(one, monitoring.fingerprint("frontend", "KeyError", "main.py", 10, "GET /a"))


class Monitoring(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        testsafety.require_local_database()
        main.ensure_client_workflow_fields()
        monitoring.ensure_schema()
        cls.http = TestClient(main.app, raise_server_exceptions=False)

    def sql(self, query, args=()):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(query, args or None)
        rows = cur.fetchall() if cur.description else []
        conn.commit()
        conn.close()
        return rows

    def clean(self):
        self.sql("DELETE FROM app_errors WHERE error_type LIKE 'Zz%' OR route_pattern LIKE '%zz-monitor%' OR source = 'frontend' AND error_type LIKE 'Zz%'")
        self.sql("DELETE FROM app_settings WHERE key IN (%s, %s)", (monitoring.LAST_DIGEST_KEY, monitoring.LAST_SPIKE_KEY))

    def setUp(self):
        self.clean()
        monitoring.reset_spikes()
        monitoring_routes.REPORT_LIMIT.clear()
        monitoring_routes._ready_limit.hits.clear()
        main.app.dependency_overrides.clear()

    def tearDown(self):
        main.app.dependency_overrides.clear()
        main.app.router.routes[:] = [route for route in main.app.router.routes if "zz-monitor" not in getattr(route, "path", "")]
        self.clean()

    def mine(self):
        return self.sql("SELECT source, error_type, function, file, route_pattern, status_code, count, status FROM app_errors WHERE error_type LIKE 'Zz%' OR route_pattern LIKE '%zz-monitor%'")

    # ----- the backend
    def test_a_500_is_recorded_without_personal_data_and_a_repeat_only_raises_the_count(self):
        class ZzBoom(RuntimeError):
            pass

        @main.app.get("/zz-monitor/boom/{item}")
        def boom(item: str):
            raise ZzBoom("secret detail of ana.garcia@example.com +34 600 123 456")

        for _ in range(3):
            response = self.http.get("/zz-monitor/boom/ana.garcia@example.com?token=SECRETTOKEN1234567890abcdef")
            self.assertEqual(response.status_code, 500)
        flush()
        rows = self.sql("SELECT source, error_type, function, file, route_pattern, status_code, count, status, message FROM app_errors WHERE route_pattern LIKE '%zz-monitor%'")
        self.assertEqual(len(rows), 1)                                                          # ONE row, not one per occurrence
        source, error_type, function, file, route, status, count, state, message = rows[0]
        self.assertEqual((source, error_type, status, count, state), ("backend", "ZzBoom", 500, 3, "new"))
        self.assertIsInstance(function, str)
        self.assertEqual(route, "GET /zz-monitor/boom/{item}")                                  # the pattern, never the address with the data
        stored = json.dumps(rows)
        for private in PERSONAL + ["SECRETTOKEN", "secret detail", "ana.garcia"]:
            self.assertNotIn(private, stored, private)

    def test_the_noise_is_not_recorded(self):
        for path, expected in (("/zz-monitor/nothing", 404), ("/schedule/not-a-date", 422)):
            self.assertEqual(self.http.get(path).status_code, expected)
        self.assertEqual(self.http.get("/admin/stats").status_code, 404)
        self.assertEqual(self.http.delete("/health").status_code, 405)
        flush()
        self.assertEqual(self.mine(), [])
        monitoring.record_exception(mock.Mock(method="GET", scope={}), ConnectionResetError("x"))        # the client going away
        flush()
        self.assertEqual(self.mine(), [])

    def test_the_monitoring_can_never_hurt_a_request(self):
        with mock.patch.object(monitoring, "_store", side_effect=RuntimeError("database gone")):
            @main.app.get("/zz-monitor/boom2")
            def boom():
                raise ValueError("x")
            self.assertEqual(self.http.get("/zz-monitor/boom2").status_code, 500)                 # still the normal answer
        with mock.patch.object(monitoring, "_worker") as worker:
            worker.submit.side_effect = RuntimeError("no worker")
            monitoring.record({"source": "backend", "error_type": "ZzX"})                         # swallowed
            monitoring.record_exception(mock.Mock(method="GET", scope={}), ValueError("x"))

    def test_the_cap_of_distinct_errors_the_oldest_resolved_go_first_and_new_ones_are_ignored_when_full(self):
        with mock.patch.object(monitoring, "MAX_FINGERPRINTS", self.sql("SELECT COUNT(*) FROM app_errors")[0][0] + 2):
            for number in range(2):
                monitoring._store({"source": "backend", "error_type": f"ZzCap{number}", "file": "a.py", "line": number, "route_pattern": "GET /zz-monitor/cap"})
            monitoring._store({"source": "backend", "error_type": "ZzCapOver", "file": "a.py", "line": 9, "route_pattern": "GET /zz-monitor/cap"})
            self.assertEqual(self.sql("SELECT COUNT(*) FROM app_errors WHERE error_type = 'ZzCapOver'")[0][0], 0)       # full of unresolved: ignored
            self.sql("UPDATE app_errors SET status = 'resolved', last_seen = NOW() - INTERVAL '2 days' WHERE error_type = 'ZzCap0'")
            monitoring._store({"source": "backend", "error_type": "ZzCapOver", "file": "a.py", "line": 9, "route_pattern": "GET /zz-monitor/cap"})
            self.assertEqual(self.sql("SELECT COUNT(*) FROM app_errors WHERE error_type = 'ZzCapOver'")[0][0], 1)
            self.assertEqual(self.sql("SELECT COUNT(*) FROM app_errors WHERE error_type = 'ZzCap0'")[0][0], 0)           # the resolved one made room

    def test_the_daily_job_removes_the_resolved_ones_older_than_30_days(self):
        monitoring._store({"source": "backend", "error_type": "ZzOld", "file": "a.py", "line": 1, "route_pattern": "GET /zz-monitor/old"})
        monitoring._store({"source": "backend", "error_type": "ZzRecent", "file": "a.py", "line": 2, "route_pattern": "GET /zz-monitor/recent"})
        self.sql("UPDATE app_errors SET status = 'resolved', last_seen = NOW() - INTERVAL '31 days' WHERE error_type = 'ZzOld'")
        self.sql("UPDATE app_errors SET status = 'resolved', last_seen = NOW() - INTERVAL '2 days' WHERE error_type = 'ZzRecent'")
        monitoring.cleanup()
        self.assertEqual([row[1] for row in self.mine()], ["ZzRecent"])

    # ----- the frontend
    def report(self, **changes):
        body = {"error_type": "ZzTypeError", "message": "Cannot read properties of undefined", "route": "/dashboard", "release": "abc1234"}
        body.update(changes)
        return self.http.post("/client-errors/report", content=json.dumps(body), headers={"Content-Type": "text/plain;charset=UTF-8"})

    def test_a_report_of_the_frontend_is_kept_cleaned_and_deduplicated(self):
        for _ in range(3):
            self.assertEqual(self.report(message="Failed for ana.garcia@example.com phone +34 600 123 456").status_code, 204)
        flush()
        rows = self.mine()
        self.assertEqual([(row[0], row[1], row[6]) for row in rows], [("frontend", "ZzTypeError", 3)])
        stored = json.dumps(self.sql("SELECT message, route_pattern FROM app_errors WHERE error_type = 'ZzTypeError'"))
        for private in PERSONAL:
            self.assertNotIn(private, stored, private)

    def test_a_report_is_validated_limited_and_never_accepts_more_than_the_minimum(self):
        self.assertEqual(self.report(extra="field").status_code, 422)                             # no extra field
        self.assertEqual(self.report(error_type="x" * 81).status_code, 422)
        self.assertEqual(self.report(message="x" * 201).status_code, 422)
        self.assertEqual(self.report(route="x" * 81).status_code, 422)
        self.assertEqual(self.report(release="x" * 41).status_code, 422)
        self.assertEqual(self.http.post("/client-errors/report", content=b"not json").status_code, 422)
        self.assertEqual(self.http.post("/client-errors/report", content=b'["x"]').status_code, 422)
        self.assertEqual(self.report(message="x" * 200).status_code, 204)

    def test_a_big_body_is_refused_also_without_a_content_length(self):
        big = json.dumps({"error_type": "ZzBig", "message": "m", "route": "/", "release": "r", "padding": "x" * 3000})
        self.assertEqual(self.http.post("/client-errors/report", content=big).status_code, 413)
        chunked = self.http.post("/client-errors/report", content=(chunk for chunk in (big[:1500].encode(), big[1500:].encode())))      # streamed: chunked
        self.assertEqual(chunked.status_code, 413)
        flush()
        self.assertEqual(self.mine(), [])

    def test_reports_are_rate_limited_per_address_and_the_noise_is_ignored(self):
        for _ in range(10):
            self.assertEqual(self.report(error_type="ZzLimit").status_code, 204)
        response = self.report(error_type="ZzLimit")
        self.assertEqual((response.status_code, response.headers.get("retry-after")), (429, "600"))
        self.assertEqual(response.json()["detail"]["code"], "rate_limited")
        monitoring_routes.REPORT_LIMIT.clear()
        for noise in ("ChunkLoadError", "AbortError", "Failed to fetch dynamically imported module: x"):
            self.assertEqual(self.report(error_type="ZzNoise", message=noise).status_code, 204)
        self.assertEqual(self.report(error_type="ZzNoise", message="at chrome-extension://abc").status_code, 204)
        flush()
        self.assertEqual([row for row in self.mine() if row[1] == "ZzNoise"], [])

    # ----- the admin page
    def test_the_page_of_the_admin_only_opens_for_the_admin(self):
        self.assertEqual(self.http.get("/admin/system-errors").status_code, 404)
        self.assertEqual(self.http.post("/admin/system-errors/1/status", json={"status": "seen"}).status_code, 404)
        main.app.dependency_overrides[main.require_admin] = lambda: {"email": main.ADMIN_EMAIL, "sub": "uid-admin"}
        monitoring._store({"source": "backend", "error_type": "ZzPage", "function": "f", "file": "a.py", "line": 3, "route_pattern": "GET /zz-monitor/page", "status_code": 500})
        answer = self.http.get("/admin/system-errors").json()
        item = next(entry for entry in answer["items"] if entry["error_type"] == "ZzPage")
        self.assertEqual((item["count"], item["status"], item["source"]), (1, "new", "backend"))
        self.assertGreaterEqual(answer["summary"]["new_24h"], 1)
        self.assertEqual(answer["summary"]["last_error"]["error_type"], "ZzPage")
        self.assertEqual(self.http.post(f"/admin/system-errors/{item['id']}/status", json={"status": "resolved"}).json()["status"], "resolved")
        self.assertEqual(self.http.post(f"/admin/system-errors/{item['id']}/status", json={"status": "bogus"}).status_code, 422)
        self.assertEqual(self.http.post(f"/admin/system-errors/{item['id']}/status", json={"status": "seen", "x": 1}).status_code, 422)
        self.assertTrue(all(entry["status"] == "resolved" for entry in self.http.get("/admin/system-errors", params={"status": "resolved"}).json()["items"]))

    # ----- the alerts
    def test_the_daily_summary_sends_nothing_when_nothing_is_new_and_never_personal_data_otherwise(self):
        sent = []
        with mock.patch.object(monitoring, "_send", side_effect=lambda mail: sent.append(mail)):
            self.sql("DELETE FROM app_errors")
            self.assertEqual(monitoring.daily_summary(), 0)
            self.assertEqual(sent, [])
            monitoring._store({"source": "backend", "error_type": "ZzDigest", "function": "f", "file": "a.py", "line": 3, "route_pattern": "GET /zz-monitor/d", "message": "ana.garcia@example.com"})
            self.assertEqual(monitoring.daily_summary(), 1)
            self.assertEqual(len(sent), 1)
            subject, html, text = sent[0]
            self.assertIn("ZzDigest", html)
            for private in PERSONAL + ["ana.garcia"]:
                self.assertNotIn(private, html + text + subject)
            self.assertEqual(monitoring.daily_summary(), 0)                                         # the same error is not reported again
            self.assertEqual(len(sent), 1)
            monitoring._store({"source": "backend", "error_type": "ZzDigest2", "function": "f", "file": "a.py", "line": 4, "route_pattern": "GET /zz-monitor/d2"})
            with mock.patch.dict("os.environ", {"MONITOR_EMAILS": "off"}):
                self.assertEqual(monitoring.daily_summary(), 0)
            self.assertEqual(len(sent), 1)                                                          # MONITOR_EMAILS=off: nothing

    def test_the_spike_alert_needs_more_than_20_errors_in_10_minutes_and_respects_the_6_hours(self):
        sent = []
        with mock.patch.object(monitoring, "_send_spike", side_effect=lambda count: sent.append(count)), \
                mock.patch.object(monitoring._worker, "submit", side_effect=lambda function, *args: function(*args)):
            for second in range(20):
                self.assertFalse(monitoring.note_5xx(now=BASE + second))
            self.assertEqual(sent, [])
            self.assertTrue(monitoring.note_5xx(now=BASE + 21))                                           # the 21st
            self.assertEqual(sent, [21])
            for second in range(30):
                monitoring.note_5xx(now=BASE + 100 + second)
            self.assertEqual(sent, [21])                                                             # not again for 6 hours
            monitoring.reset_spikes()
            monitoring._last_spike_alert = BASE + 21
            for second in range(21):
                monitoring.note_5xx(now=BASE + 21 + 6 * 3600 + second)
            self.assertEqual(len(sent), 2)                                                           # after the 6 hours: possible again
            with mock.patch.dict("os.environ", {"MONITOR_EMAILS": "off"}):
                monitoring.reset_spikes()
                for second in range(30):
                    monitoring.note_5xx(now=BASE + 99999 + second)
            self.assertEqual(len(sent), 2)

    def test_the_two_alert_emails_hold_only_types_places_and_counts(self):
        items = [{"source": "backend", "error_type": "KeyError", "where": "main.py:10", "route": "GET /x", "count": 4}]
        for subject, html, text in (monitor_emails.digest_email(items), monitor_emails.spike_email(25, 10, items)):
            self.assertIn("KeyError", html)
            self.assertTrue(subject)

    # ----- /health and /health/ready
    def test_health_stays_light_and_ready_checks_the_database(self):
        self.assertEqual(self.http.get("/health").json(), {"status": "ok"})
        self.assertEqual(self.http.get("/health/ready").json(), {"status": "ok"})
        with mock.patch.object(monitoring_routes, "get_connection", side_effect=RuntimeError("down")):
            response = self.http.get("/health/ready")
        self.assertEqual((response.status_code, response.json()), (503, {"status": "degraded"}))     # no detail

    def test_ready_has_a_small_rate_limit(self):
        for _ in range(30):
            self.http.get("/health/ready")
        self.assertEqual(self.http.get("/health/ready").status_code, 429)


class KeepAlive(unittest.TestCase):
    def setUp(self):
        keepalive.reset()

    def test_it_only_starts_in_production_with_the_public_address_and_not_switched_off(self):
        production = {"RENDER_EXTERNAL_URL": "https://example.onrender.com"}
        self.assertTrue(keepalive.enabled(production))
        self.assertFalse(keepalive.enabled({}))                                                        # local: no address
        self.assertFalse(keepalive.enabled({**production, "ENVIRONMENT": "development"}))
        self.assertFalse(keepalive.enabled({**production, "ENV": "local"}))
        self.assertFalse(keepalive.enabled({**production, "KEEP_ALIVE": "off"}))
        self.assertFalse(keepalive.enabled({"RENDER_EXTERNAL_URL": "http://localhost:8000"}))          # only a public https address

    def test_start_is_refused_where_it_must_not_run_and_runs_once_otherwise(self):
        self.assertFalse(keepalive.start({}))
        self.assertFalse(keepalive.start({"RENDER_EXTERNAL_URL": "https://x.onrender.com", "KEEP_ALIVE": "off"}))
        calls = []
        env = {"RENDER_EXTERNAL_URL": "https://x.onrender.com"}
        self.assertTrue(keepalive.start(env, sleep=lambda seconds: None, opener=lambda request, timeout: calls.append(request.full_url) or mock.Mock(), loop=False))
        self.assertFalse(keepalive.start(env, sleep=lambda seconds: None, loop=False))                 # a second call does nothing

    def test_a_failed_request_is_swallowed(self):
        def broken(request, timeout):
            raise OSError("network down")
        self.assertFalse(keepalive.ping("https://x.onrender.com", broken))
        self.assertTrue(keepalive.ping("https://x.onrender.com", lambda request, timeout: mock.Mock()))
        seen = []
        keepalive.ping("https://x.onrender.com/", lambda request, timeout: seen.append(request.full_url) or mock.Mock())
        self.assertEqual(seen, ["https://x.onrender.com/health"])


if __name__ == "__main__":
    unittest.main()

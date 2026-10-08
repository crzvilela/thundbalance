"""Archiving training requests (nothing is deleted):

    python -m unittest test_archive_requests -v

Uses the LOCAL database and removes what it creates.
"""
import unittest
from datetime import date, timedelta

from fastapi import HTTPException

import main
from database import get_connection


def endpoint(path, method):
    for route in main.app.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", ()):
            return route.endpoint
    raise LookupError(path)


class ArchiveRequests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.ensure_client_workflow_fields()      # the real startup migration (twice: must be idempotent)
        main.ensure_client_workflow_fields()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO users (nome, email) VALUES ('Archive Test', 'archive.test@test-clients.example') RETURNING id")
        cls.user_id = cur.fetchone()[0]
        cur.execute("SELECT id FROM plans ORDER BY id LIMIT 1")
        cls.plan_id = cur.fetchone()[0]
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 1")
        cls.trainer_id = cur.fetchone()[0]
        cls.ids = {}
        for status in ("Pending", "Approved", "Rejected"):
            cur.execute(
                "INSERT INTO client_requests (user_id, plan_id, sessions_per_week, preferred_days, preferred_time, status) "
                "VALUES (%s, %s, 1, 'Monday', '09:00', %s) RETURNING id", (cls.user_id, cls.plan_id, status))
            cls.ids[status] = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO sessions (user_id, trainer_id, session_date, session_time, request_id, session_number, status, google_event_id) "
            "VALUES (%s, %s, %s, '09:00', %s, '1/1', 'Booked', 'event-keep-me') RETURNING id",
            (cls.user_id, cls.trainer_id, date.today() + timedelta(days=40), cls.ids["Approved"]))
        cls.session_id = cur.fetchone()[0]
        cur.execute("INSERT INTO user_plans (user_id, plan_id, active) VALUES (%s, %s, TRUE) RETURNING id", (cls.user_id, cls.plan_id))
        cls.user_plan_id = cur.fetchone()[0]
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM sessions WHERE user_id = %s", (cls.user_id,))
        cur.execute("DELETE FROM user_plans WHERE user_id = %s", (cls.user_id,))
        cur.execute("DELETE FROM client_requests WHERE user_id = %s", (cls.user_id,))
        cur.execute("DELETE FROM users WHERE id = %s", (cls.user_id,))
        conn.commit()
        conn.close()

    def setUp(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("UPDATE client_requests SET archived_at = NULL WHERE user_id = %s", (self.user_id,))
        conn.commit()
        conn.close()

    def listed(self, archived=None):
        rows = endpoint("/admin/client-requests", "GET")(archived) if archived else endpoint("/admin/client-requests", "GET")()
        return {row[0] for row in rows if row[0] in self.ids.values()}

    def archive(self, request_id):
        return endpoint("/admin/archive-request", "POST")(main.ArchiveRequest(request_id=request_id))

    def unarchive(self, request_id):
        return endpoint("/admin/unarchive-request", "POST")(main.ArchiveRequest(request_id=request_id))

    def test_default_list_hides_archived_and_only_shows_them(self):
        everything = set(self.ids.values())
        self.assertEqual(self.listed(), everything)
        self.assertEqual(self.listed("only"), set())
        self.archive(self.ids["Pending"])
        self.assertEqual(self.listed(), everything - {self.ids["Pending"]})
        self.assertEqual(self.listed("only"), {self.ids["Pending"]})
        self.assertEqual(self.listed("include"), everything)

    def test_archiving_works_in_every_status_and_unarchive_restores_each(self):
        for status, request_id in self.ids.items():
            self.archive(request_id)
        self.assertEqual(self.listed(), set())
        self.assertEqual(self.listed("only"), set(self.ids.values()))
        for status, request_id in self.ids.items():
            self.unarchive(request_id)
        self.assertEqual(self.listed(), set(self.ids.values()))
        # each one is back with the status it had
        rows = {row[0]: row[6] for row in endpoint("/admin/client-requests", "GET")() if row[0] in self.ids.values()}
        for status, request_id in self.ids.items():
            self.assertEqual(rows[request_id], status)

    def test_nothing_is_deleted_or_changed(self):
        conn = get_connection()
        cur = conn.cursor()

        def snapshot():
            cur.execute("SELECT id, status, trainer_id, session_date, session_time, google_event_id FROM sessions WHERE user_id = %s ORDER BY id", (self.user_id,))
            sessions = cur.fetchall()
            cur.execute("SELECT id, plan_id, active FROM user_plans WHERE user_id = %s ORDER BY id", (self.user_id,))
            plans = cur.fetchall()
            cur.execute("SELECT id, status, rejection_reason FROM client_requests WHERE user_id = %s ORDER BY id", (self.user_id,))
            requests = cur.fetchall()
            conn.rollback()
            return sessions, plans, requests

        before = snapshot()
        self.archive(self.ids["Approved"])
        self.archive(self.ids["Approved"])            # repeating it changes nothing
        self.assertEqual(snapshot(), before)
        self.unarchive(self.ids["Approved"])
        self.assertEqual(snapshot(), before)
        conn.close()
        self.assertEqual(before[0][0][5], "event-keep-me")

    def test_repeat_keeps_the_original_archive_date_and_unknown_id_is_404(self):
        self.archive(self.ids["Rejected"])
        first = {r[0]: r[8] for r in endpoint("/admin/client-requests", "GET")("only")}[self.ids["Rejected"]]
        self.archive(self.ids["Rejected"])
        second = {r[0]: r[8] for r in endpoint("/admin/client-requests", "GET")("only")}[self.ids["Rejected"]]
        self.assertEqual(first, second)
        for action in (self.archive, self.unarchive):
            with self.assertRaises(HTTPException) as caught:
                action(999999999)
            self.assertEqual(caught.exception.status_code, 404)

    def test_bad_filter_and_protection(self):
        with self.assertRaises(HTTPException) as caught:
            endpoint("/admin/client-requests", "GET")("everything")
        self.assertEqual(caught.exception.status_code, 422)
        for path, method in (("/admin/archive-request", "POST"), ("/admin/unarchive-request", "POST"), ("/admin/client-requests", "GET")):
            for route in main.app.routes:
                if getattr(route, "path", None) == path and method in route.methods:
                    self.assertIn(main.require_admin, [d.call for d in route.dependant.dependencies], path)

    def test_the_client_keeps_seeing_their_request(self):
        """Archiving is an admin-side filter only: the client's own view of the
        request (their workflow) does not change."""
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM client_requests WHERE user_id = %s AND LOWER(status) = 'pending'", (self.user_id,))
        before = cur.fetchone()[0]
        conn.close()
        self.archive(self.ids["Pending"])
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM client_requests WHERE user_id = %s AND LOWER(status) = 'pending'", (self.user_id,))
        self.assertEqual(cur.fetchone()[0], before)
        conn.close()

    def test_clients_pending_flag_ignores_archived(self):
        def flag():
            for client in endpoint("/admin/clients", "GET")():
                if client["id"] == self.user_id:
                    return client["has_pending_request"]
        self.assertTrue(flag())
        self.archive(self.ids["Pending"])
        self.assertFalse(flag())


if __name__ == "__main__":
    unittest.main()

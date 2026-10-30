"""Bulk actions of the admin panel (select several, act once):

    python -m unittest test_bulk_actions -v

Each bulk endpoint calls the SAME function as the single action, answers per item, never stops at the first error,
accepts at most 200 ids and is admin only. Google Calendar and Firebase are fakes; the local database is used and cleaned.
"""
import unittest
from datetime import date, timedelta

from fastapi import HTTPException

import bulk_actions
import client_lifecycle
import google_fakes
import main
import testsafety
from database import get_connection

DOMAIN = "@test-bulk.example"
ADMIN_CLAIMS = {"sub": "admin-uid", "email": main.ADMIN_EMAIL}
BULK_PATHS = (
    "/admin/clients/bulk", "/admin/sessions/bulk", "/admin/trial-sessions/bulk", "/admin/client-requests/bulk",
    "/admin/messages/bulk", "/admin/plans/bulk", "/admin/trainers/bulk", "/admin/training-videos/bulk", "/admin/contact-messages/bulk",
)


def route(path):
    for item in main.app.routes:
        if getattr(item, "path", None) == path and "POST" in getattr(item, "methods", ()):
            return item
    raise LookupError(path)


def call(path, **body):
    """Runs a bulk endpoint as the admin."""
    endpoint = route(path).endpoint
    payload = bulk_actions.BulkPayload(**body)
    try:
        return endpoint(payload, ADMIN_CLAIMS)
    except TypeError:
        return endpoint(payload)


def monday(offset):
    day = date.today() + timedelta(days=offset)
    while day.weekday() != 0:
        day += timedelta(days=1)
    return day


class Bulk(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        testsafety.require_local_database()
        main.ensure_trial_session_fields()
        main.ensure_session_pack_column()
        main.ensure_calendar_sync_columns()
        main.ensure_client_lifecycle_columns()
        main.ensure_client_workflow_fields()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 1")
        cls.trainer_id = cur.fetchone()[0]
        cur.execute("INSERT INTO plans (nome, preco, duracao_meses, duration_weeks) VALUES ('TEST bulk 3 weeks', 0, 1, 3) RETURNING id")
        cls.plan_id = cur.fetchone()[0]
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        cls.cleanup()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM plans WHERE nome LIKE 'TEST bulk%'")
        conn.commit()
        conn.close()

    @classmethod
    def cleanup(cls):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        ids = [row[0] for row in cur.fetchall()]
        if ids:
            cur.execute("DELETE FROM sessions WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM user_plans WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM client_requests WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM users WHERE id = ANY(%s)", (ids,))
        cur.execute("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM email_log WHERE destinatario LIKE %s", (f"%{DOMAIN}",))
        conn.commit()
        conn.close()

    def setUp(self):
        self.cleanup()
        self.google = google_fakes.FakeGoogle().install()
        self.firebase_deleted = []
        accounts = client_lifecycle.accounts
        self._orig = (accounts.find_uid, accounts.set_disabled, accounts.delete_account)
        accounts.find_uid = lambda uid, email: uid
        accounts.set_disabled = lambda uid, disabled: None
        accounts.delete_account = lambda uid: self.firebase_deleted.append(uid) or True

    def tearDown(self):
        self.google.uninstall()
        accounts = client_lifecycle.accounts
        accounts.find_uid, accounts.set_disabled, accounts.delete_account = self._orig
        self.cleanup()

    # ----- helpers
    def user(self, key, name=None, uid=None):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO users (firebase_uid, nome, email) VALUES (%s, %s, %s) RETURNING id",
                    (uid or f"uid-{key}", name or f"Bulk {key}", f"{key}{DOMAIN}"))
        user_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        return user_id

    def query(self, sql, args=()):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(sql, args)
        rows = cur.fetchall()
        conn.close()
        return rows

    # ----- limits, shape and access
    def test_every_bulk_endpoint_is_admin_only(self):
        for path in BULK_PATHS:
            dependencies = [d.dependency for d in route(path).dependencies]
            params = [d.call for d in route(path).dependant.dependencies]
            self.assertTrue(main.require_admin in dependencies or main.require_admin in params, path)

    def test_nothing_chosen_too_many_and_unknown_actions_are_refused(self):
        with self.assertRaises(HTTPException) as caught:
            call("/admin/plans/bulk", action="delete", ids=[])
        self.assertEqual(caught.exception.status_code, 422)
        with self.assertRaises(HTTPException) as caught:
            call("/admin/plans/bulk", action="delete", ids=list(range(1, bulk_actions.MAX_IDS + 2)))
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(bulk_actions.MAX_IDS, 200)
        for path in BULK_PATHS[:-1]:
            with self.assertRaises(HTTPException) as caught:
                call(path, action="explode", ids=[1])
            self.assertEqual(caught.exception.status_code, 422, path)
        self.assertEqual(bulk_actions.clean_ids([3, 3, 1, 3, 2]), [3, 1, 2])

    # ----- sessions: the Google event of EVERY one goes away; a failing item does not stop the others
    def test_cancelling_several_sessions_removes_all_their_google_events(self):
        user_id = self.user("ana", "Ana María Ruiz")
        main_route = [r for r in main.app.routes if getattr(r, "path", "") == "/admin/clients/{client_id}/renew-pack"][0]
        main_route.endpoint(user_id, main.NewPack(
            plan_id=self.plan_id, sessions_per_week=2, preferred_days="Monday,Wednesday", preferred_time="10:00",
            trainer_id=self.trainer_id, start_date=monday(10).isoformat(), email_extra=[], allow_conflicts=True, confirm_replace=True))
        rows = self.query("SELECT id, google_event_id FROM sessions WHERE user_id = %s ORDER BY session_date, session_time, id", (user_id,))
        self.assertEqual(len(rows), 6)
        self.assertEqual(len(self.google.events), 6)
        chosen = [row[0] for row in rows[:4]]
        answer = call("/admin/sessions/bulk", action="cancel", ids=chosen + [987654321])
        self.assertEqual((answer["total"], answer["done"], answer["failed"]), (5, 4, 1))
        bad = next(item for item in answer["results"] if not item["ok"])
        self.assertEqual(bad["id"], 987654321)
        self.assertTrue(bad["error"])
        self.assertEqual(len(self.google.events), 2)                              # the four events are gone
        for session_id, event_id in rows[:4]:
            self.assertNotIn(event_id, self.google.events)
        for session_id, event_id in rows[4:]:
            self.assertIn(event_id, self.google.events)                           # the others are untouched
        statuses = dict(self.query("SELECT id, status FROM sessions WHERE user_id = %s", (user_id,)))
        self.assertEqual([statuses[i] for i in chosen], ["Cancelled"] * 4)
        again = call("/admin/sessions/bulk", action="cancel", ids=chosen)          # repeating is harmless
        self.assertEqual(again["failed"], 0)

    def test_a_google_outage_does_not_stop_the_cancellations(self):
        user_id = self.user("ana2")
        conn = get_connection()
        cur = conn.cursor()
        ids = []
        for n in range(3):
            cur.execute(
                "INSERT INTO sessions (user_id, trainer_id, session_date, session_time, session_number, status, google_event_id) "
                "VALUES (%s, %s, %s, '09:00', %s, 'Booked', %s) RETURNING id",
                (user_id, self.trainer_id, date.today() + timedelta(days=30 + n), f"{n + 1}/3", f"evt-bulk-{n}"))
            ids.append(cur.fetchone()[0])
        conn.commit()
        conn.close()
        self.google.fail = True
        answer = call("/admin/sessions/bulk", action="cancel", ids=ids)
        self.assertEqual((answer["done"], answer["failed"]), (3, 0))              # cancelled whatever Google answers
        self.assertEqual({row[0] for row in self.query("SELECT status FROM sessions WHERE user_id = %s", (user_id,))}, {"Cancelled"})
        self.assertEqual({row[0] for row in self.query("SELECT calendar_sync_status FROM sessions WHERE user_id = %s", (user_id,))}, {"failed"})

    # ----- clients
    def test_archiving_and_restoring_several_clients_with_one_refused(self):
        first, second = self.user("c1"), self.user("c2")
        admin_row = self.user("admin-row", uid="admin-uid")
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("UPDATE users SET email = %s WHERE id = %s", (main.ADMIN_EMAIL, admin_row))        # the protected account
        conn.commit()
        conn.close()
        try:
            answer = call("/admin/clients/bulk", action="archive", ids=[first, second, admin_row])
            self.assertEqual((answer["done"], answer["failed"]), (2, 1))
            self.assertFalse(next(item for item in answer["results"] if item["id"] == admin_row)["ok"])
            archived = {row[0] for row in self.query("SELECT id FROM users WHERE archived_at IS NOT NULL AND id = ANY(%s)", ([first, second, admin_row],))}
            self.assertEqual(archived, {first, second})
            restored = call("/admin/clients/bulk", action="unarchive", ids=[first, second])
            self.assertEqual(restored["done"], 2)
            self.assertEqual(self.query("SELECT COUNT(*) FROM users WHERE archived_at IS NOT NULL AND id = ANY(%s)", ([first, second],))[0][0], 0)
        finally:
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("DELETE FROM users WHERE id = %s", (admin_row,))
            conn.commit()
            conn.close()

    def test_archiving_clients_can_cancel_their_future_sessions_and_events(self):
        user_id = self.user("c3")
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO sessions (user_id, trainer_id, session_date, session_time, session_number, status, google_event_id) "
            "VALUES (%s, %s, %s, '09:00', '1/1', 'Booked', 'evt-c3') RETURNING id", (user_id, self.trainer_id, date.today() + timedelta(days=20)))
        session_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        self.google.events["evt-c3"] = {"summary": "x"}
        refused = call("/admin/clients/bulk", action="archive", ids=[user_id], cancel_future_sessions=True)
        self.assertEqual(refused["failed"], 1)                                      # the second confirmation is still needed
        answer = call("/admin/clients/bulk", action="archive", ids=[user_id], cancel_future_sessions=True, confirm_cancel=True)
        self.assertEqual(answer["done"], 1)
        self.assertEqual(self.query("SELECT status FROM sessions WHERE id = %s", (session_id,))[0][0], "Cancelled")

    def test_deleting_several_clients_needs_the_word_and_removes_each_one(self):
        first, second = self.user("d1", "Delete One"), self.user("d2", "Delete Two")
        with self.assertRaises(HTTPException) as caught:
            call("/admin/clients/bulk", action="delete", ids=[first, second])
        self.assertEqual(caught.exception.status_code, 422)
        with self.assertRaises(HTTPException):
            call("/admin/clients/bulk", action="delete", ids=[first, second], confirm_word="no")
        self.assertEqual(self.query("SELECT COUNT(*) FROM users WHERE id = ANY(%s)", ([first, second],))[0][0], 2)
        answer = call("/admin/clients/bulk", action="delete", ids=[first, 987654321, second], confirm_word=" eliminar ")
        self.assertEqual((answer["done"], answer["failed"]), (2, 1))
        self.assertEqual(self.query("SELECT COUNT(*) FROM users WHERE id = ANY(%s)", ([first, second],))[0][0], 0)
        self.assertEqual(sorted(self.firebase_deleted), ["uid-d1", "uid-d2"])

    # ----- plans, requests, trial sessions
    def test_plans_in_use_fail_and_the_others_are_deleted(self):
        user_id = self.user("p1")
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO plans (nome, preco, duracao_meses, duration_weeks) VALUES ('TEST bulk free', 0, 1, 1) RETURNING id")
        free = cur.fetchone()[0]
        cur.execute("INSERT INTO user_plans (user_id, plan_id, active) VALUES (%s, %s, TRUE)", (user_id, self.plan_id))
        conn.commit()
        conn.close()
        answer = call("/admin/plans/bulk", action="delete", ids=[self.plan_id, free])
        self.assertEqual((answer["done"], answer["failed"]), (1, 1))
        self.assertEqual(next(item for item in answer["results"] if item["id"] == self.plan_id)["ok"], False)
        self.assertEqual(self.query("SELECT COUNT(*) FROM plans WHERE id = %s", (free,))[0][0], 0)
        self.assertEqual(self.query("SELECT COUNT(*) FROM plans WHERE id = %s", (self.plan_id,))[0][0], 1)

    def test_requests_are_archived_and_restored_in_bulk(self):
        user_id = self.user("r1")
        conn = get_connection()
        cur = conn.cursor()
        ids = []
        for status in ("Pending", "Rejected"):
            cur.execute("INSERT INTO client_requests (user_id, plan_id, sessions_per_week, preferred_days, preferred_time, status) "
                        "VALUES (%s, %s, 1, 'Monday', '09:00', %s) RETURNING id", (user_id, self.plan_id, status))
            ids.append(cur.fetchone()[0])
        conn.commit()
        conn.close()
        answer = call("/admin/client-requests/bulk", action="archive", ids=ids + [987654321])
        self.assertEqual((answer["done"], answer["failed"]), (2, 1))
        self.assertEqual(self.query("SELECT COUNT(*) FROM client_requests WHERE archived_at IS NOT NULL AND id = ANY(%s)", (ids,))[0][0], 2)
        self.assertEqual(call("/admin/client-requests/bulk", action="unarchive", ids=ids)["done"], 2)
        self.assertEqual(self.query("SELECT status FROM client_requests WHERE id = ANY(%s) ORDER BY id", (ids,)), [("Pending",), ("Rejected",)])

    def test_trial_sessions_are_cancelled_in_bulk_only_when_approved_or_confirmed(self):
        conn = get_connection()
        cur = conn.cursor()
        ids = {}
        for status in ("Pending", "Approved", "Confirmed"):
            cur.execute(
                "INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status, trainer_id, google_event_id) "
                "VALUES ('Trial Person', %s, '600333444', 'Lose weight', 'Beginner', %s, '12:00', %s, %s, %s) RETURNING id",
                (f"{status.lower()}{DOMAIN}", date.today() + timedelta(days=15), status, self.trainer_id, f"evt-trial-{status}"))
            ids[status] = cur.fetchone()[0]
            self.google.events[f"evt-trial-{status}"] = {"summary": "trial"}
        conn.commit()
        conn.close()
        answer = call("/admin/trial-sessions/bulk", action="cancel", ids=list(ids.values()))
        self.assertEqual((answer["done"], answer["failed"]), (2, 1))
        self.assertFalse(next(item for item in answer["results"] if item["id"] == ids["Pending"])["ok"])
        statuses = dict(self.query("SELECT id, status FROM trial_sessions WHERE id = ANY(%s)", (list(ids.values()),)))
        self.assertEqual((statuses[ids["Pending"]], statuses[ids["Approved"]], statuses[ids["Confirmed"]]), ("Pending", "Cancelled", "Cancelled"))


if __name__ == "__main__":
    unittest.main()

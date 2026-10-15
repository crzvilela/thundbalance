"""Archiving and deleting clients:

    python -m unittest test_client_lifecycle -v

Firebase and Google Calendar are replaced by fakes; the local database is used
and cleaned up.
"""
import unittest
from datetime import date, timedelta
from types import SimpleNamespace

from fastapi import HTTPException

import client_lifecycle
import main
from database import get_connection

DOMAIN = "@test-lifecycle.example"
ADMIN_CLAIMS = {"sub": "admin-uid", "email": main.ADMIN_EMAIL}


def route(path, method="POST"):
    for r in main.app.routes:
        if getattr(r, "path", None) == path and method in getattr(r, "methods", ()):
            return r
    raise LookupError(path)


class Gone(Exception):
    resp = SimpleNamespace(status=404)


class Lifecycle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.ensure_client_lifecycle_columns()
        main.ensure_calendar_sync_columns()
        main.ensure_session_pack_column()
        main.ensure_trial_session_fields()
        main.ensure_email_log_table()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 1")
        cls.trainer_id = cur.fetchone()[0]
        cur.execute("INSERT INTO plans (nome, preco, duracao_meses, duration_weeks) VALUES ('TEST lifecycle', 0, 1, 1) RETURNING id")
        cls.plan_id = cur.fetchone()[0]
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        cls.cleanup()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM plans WHERE id = %s", (cls.plan_id,))
        conn.commit()
        conn.close()

    @classmethod
    def cleanup(cls):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        ids = [r[0] for r in cur.fetchall()]
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
        self.firebase = {"users": {"uid-ana": {"disabled": False}}, "calls": []}
        self.google_deleted = []
        self.google_fail = False
        self.firebase_fail = False

        def find_uid(uid, email):
            self.firebase["calls"].append(("find", uid))
            if self.firebase_fail:
                raise client_lifecycle.accounts.AccountError("down")
            return uid if uid in self.firebase["users"] else None

        def set_disabled(uid, disabled):
            self.firebase["calls"].append(("disabled", uid, disabled))
            self.firebase["users"][uid]["disabled"] = disabled

        def delete_account(uid):
            self.firebase["calls"].append(("delete", uid))
            if self.firebase_fail:
                raise client_lifecycle.accounts.AccountError("down")
            return self.firebase["users"].pop(uid, None) is not None

        def delete_event(event_id):
            if self.google_fail:
                raise RuntimeError("calendar down")
            if event_id in self.google_deleted:
                raise Gone()                       # already deleted: counts as success
            self.google_deleted.append(event_id)

        acc = client_lifecycle.accounts
        gcal = client_lifecycle.google_calendar
        self._orig = (acc.find_uid, acc.set_disabled, acc.delete_account, gcal.delete_calendar_event)
        acc.find_uid, acc.set_disabled, acc.delete_account = find_uid, set_disabled, delete_account
        gcal.delete_calendar_event = delete_event

        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO users (nome, email, firebase_uid, foto) VALUES ('Ana Prueba Lifecycle', %s, 'uid-ana', NULL) RETURNING id",
            (f"ana{DOMAIN}",),
        )
        self.user_id = cur.fetchone()[0]
        cur.execute("INSERT INTO user_plans (user_id, plan_id, active) VALUES (%s, %s, TRUE) RETURNING id", (self.user_id, self.plan_id))
        pack_id = cur.fetchone()[0]
        future = date.today() + timedelta(days=10)
        past = date.today() - timedelta(days=10)
        self.session_ids = []
        for index, (day, event) in enumerate(((past, "evt-past"), (future, "evt-future-1"), (future + timedelta(days=7), "evt-future-2"))):
            cur.execute(
                "INSERT INTO sessions (user_id, trainer_id, session_date, session_time, status, session_number, google_event_id, user_plan_id) "
                "VALUES (%s, %s, %s, '10:00', 'Booked', %s, %s, %s) RETURNING id",
                (self.user_id, self.trainer_id, day, f"{index + 1}/3", event, pack_id),
            )
            self.session_ids.append(cur.fetchone()[0])
        cur.execute(
            "INSERT INTO client_requests (user_id, plan_id, sessions_per_week, preferred_days, preferred_time, status) "
            "VALUES (%s, %s, 1, 'Monday', '10:00', 'Pending')", (self.user_id, self.plan_id))
        cur.execute(
            "INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status, google_event_id) "
            "VALUES ('Ana Prueba Lifecycle', %s, '600', 'x', 'y', %s, '09:00', 'Confirmed', 'evt-trial') RETURNING id",
            (f"ana{DOMAIN}", past))
        self.trial_id = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO email_log (tipo, referencia, destinatario, estado) VALUES ('trial_approved', %s, %s, 'enviado')",
            (str(self.trial_id), f"ana{DOMAIN}"))
        conn.commit()
        conn.close()

    def tearDown(self):
        acc = client_lifecycle.accounts
        gcal = client_lifecycle.google_calendar
        acc.find_uid, acc.set_disabled, acc.delete_account, gcal.delete_calendar_event = self._orig
        self.cleanup()

    # ----- helpers
    def archive(self, **fields):
        return route("/admin/clients/{client_id}/archive").endpoint(
            self.user_id, client_lifecycle.ArchivePayload(**fields), ADMIN_CLAIMS)

    def unarchive(self):
        return route("/admin/clients/{client_id}/unarchive").endpoint(self.user_id, ADMIN_CLAIMS)

    def delete(self, name="Ana Prueba Lifecycle", confirm=True, claims=None):
        return route("/admin/clients/{client_id}/delete").endpoint(
            self.user_id, client_lifecycle.DeletePayload(confirm_data=confirm, confirm_name=name), claims or ADMIN_CLAIMS)

    def one(self, sql, *args):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(sql, args)
        value = cur.fetchall()
        conn.close()
        return value

    def counts(self):
        uid = self.user_id
        return {
            "users": self.one("SELECT COUNT(*) FROM users WHERE id = %s", uid)[0][0],
            "sessions": self.one("SELECT COUNT(*) FROM sessions WHERE user_id = %s", uid)[0][0],
            "plans": self.one("SELECT COUNT(*) FROM user_plans WHERE user_id = %s", uid)[0][0],
            "requests": self.one("SELECT COUNT(*) FROM client_requests WHERE user_id = %s", uid)[0][0],
            "trials": self.one("SELECT COUNT(*) FROM trial_sessions WHERE email LIKE %s", f"%{DOMAIN}")[0][0],
            "emails": self.one("SELECT COUNT(*) FROM email_log WHERE destinatario LIKE %s", f"%{DOMAIN}")[0][0],
        }

    def listed(self, archived=None):
        endpoint = route("/admin/clients", "GET").endpoint
        rows = endpoint(archived) if archived else endpoint()
        return [r["id"] for r in rows]

    # ----- security
    def test_every_new_endpoint_needs_the_admin(self):
        for path in ("/admin/clients/{client_id}/archive", "/admin/clients/{client_id}/unarchive", "/admin/clients/{client_id}/delete"):
            self.assertIn(main.require_admin, [d.call for d in route(path).dependant.dependencies], path)
        with self.assertRaises(HTTPException) as caught:          # no token at all
            main.require_admin(authorization=None)
        self.assertEqual(caught.exception.status_code, 401)
        with self.assertRaises(HTTPException) as bad:             # not a Firebase token
            main.require_admin(authorization="Bearer not-a-token")
        self.assertEqual(bad.exception.status_code, 401)

    def test_the_admin_and_the_caller_can_not_be_archived_or_deleted(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO users (nome, email, firebase_uid) VALUES ('Admin', %s, 'uid-admin') RETURNING id", (main.ADMIN_EMAIL,))
        admin_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        try:
            for call in (
                lambda: route("/admin/clients/{client_id}/archive").endpoint(admin_id, client_lifecycle.ArchivePayload(), ADMIN_CLAIMS),
                lambda: route("/admin/clients/{client_id}/delete").endpoint(
                    admin_id, client_lifecycle.DeletePayload(confirm_data=True, confirm_name="Admin"), ADMIN_CLAIMS),
            ):
                with self.assertRaises(HTTPException) as caught:
                    call()
                self.assertEqual((caught.exception.status_code, caught.exception.detail["code"]), (403, "protected_account"))
        finally:
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("DELETE FROM users WHERE id = %s", (admin_id,))
            conn.commit()
            conn.close()

        # the caller's own account, even if it is not the configured admin email
        with self.assertRaises(HTTPException) as own:
            self.archive_as({"sub": "uid-ana", "email": f"other{DOMAIN}"})
        self.assertEqual(own.exception.status_code, 403)
        with self.assertRaises(HTTPException) as same_email:
            self.archive_as({"sub": "someone", "email": f"ANA{DOMAIN}"})
        self.assertEqual(same_email.exception.status_code, 403)
        self.assertEqual(self.counts()["users"], 1)
        self.assertEqual(self.firebase["calls"], [])               # Firebase was never touched

    def archive_as(self, claims):
        return route("/admin/clients/{client_id}/archive").endpoint(self.user_id, client_lifecycle.ArchivePayload(), claims)

    # ----- archive
    def test_archiving_without_cancelling_keeps_sessions_and_events(self):
        self.assertIn(self.user_id, self.listed())
        result = self.archive()
        self.assertEqual((result["cancelled_sessions"], result["account"]), (0, "disabled"))
        self.assertTrue(self.firebase["users"]["uid-ana"]["disabled"])    # can not sign in
        self.assertEqual(self.google_deleted, [])                         # events stay
        statuses = self.one("SELECT status FROM sessions WHERE user_id = %s", self.user_id)
        self.assertEqual({s[0] for s in statuses}, {"Booked"})
        self.assertNotIn(self.user_id, self.listed())                     # out of the normal list ...
        self.assertIn(self.user_id, self.listed("only"))                  # ... and in "Archivados"
        users = route("/admin/users", "GET").endpoint()
        self.assertNotIn(self.user_id, [row[0] for row in users])
        self.assertEqual(self.one("SELECT COUNT(*) FROM users WHERE archived_at IS NULL")[0][0],
                         route("/admin/stats", "GET").endpoint()["users"])

        again = self.archive()                                            # repeating is harmless
        self.assertEqual(again["cancelled_sessions"], 0)

    def test_cancelling_future_sessions_needs_the_second_confirmation(self):
        with self.assertRaises(HTTPException) as caught:
            self.archive(cancel_future_sessions=True)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual((caught.exception.detail["code"], caught.exception.detail["count"]), ("confirm_cancel", 2))
        self.assertEqual(self.firebase["calls"], [])                      # nothing happened
        self.assertEqual(self.google_deleted, [])

        result = self.archive(cancel_future_sessions=True, confirm_cancel=True)
        self.assertEqual(result["cancelled_sessions"], 2)
        self.assertEqual(sorted(self.google_deleted), ["evt-future-1", "evt-future-2"])   # the past one stays
        rows = dict(self.one("SELECT id, status FROM sessions WHERE user_id = %s", self.user_id))
        self.assertEqual([rows[i] for i in self.session_ids], ["Booked", "Cancelled", "Cancelled"])

    def test_unarchiving_reenables_the_login_and_does_not_recreate_sessions(self):
        self.archive(cancel_future_sessions=True, confirm_cancel=True)
        result = self.unarchive()
        self.assertEqual(result["account"], "enabled")
        self.assertFalse(self.firebase["users"]["uid-ana"]["disabled"])
        self.assertIn(self.user_id, self.listed())
        self.assertNotIn(self.user_id, self.listed("only"))
        rows = dict(self.one("SELECT id, status FROM sessions WHERE user_id = %s", self.user_id))
        self.assertEqual([rows[i] for i in self.session_ids], ["Booked", "Cancelled", "Cancelled"])   # still cancelled

    def test_a_firebase_failure_changes_nothing(self):
        self.firebase_fail = True
        with self.assertRaises(HTTPException) as caught:
            self.archive(cancel_future_sessions=True, confirm_cancel=True)
        self.assertEqual(caught.exception.status_code, 502)
        self.assertIn(self.user_id, self.listed())
        statuses = self.one("SELECT status FROM sessions WHERE user_id = %s", self.user_id)
        self.assertEqual({s[0] for s in statuses}, {"Booked"})

    def test_a_calendar_failure_while_archiving_is_reported_and_retried(self):
        self.google_fail = True
        result = self.archive(cancel_future_sessions=True, confirm_cancel=True)
        self.assertEqual((result["cancelled_sessions"], result["calendar"]["failed"]), (2, 2))
        self.assertNotIn(self.user_id, self.listed())                     # the archive itself stands
        self.google_fail = False
        again = self.archive()                                            # repeating finishes the events
        self.assertEqual((again["calendar"]["deleted"], again["calendar"]["failed"]), (2, 0))
        self.assertEqual(sorted(self.google_deleted), ["evt-future-1", "evt-future-2"])

    # ----- delete
    def test_deleting_needs_the_box_and_the_exact_name(self):
        for kwargs in ({"confirm": False}, {"name": "Ana"}, {"name": ""}):
            with self.assertRaises(HTTPException) as caught:
                self.delete(**kwargs)
            self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(self.counts()["users"], 1)
        self.assertEqual(self.google_deleted, [])

    def test_deleting_removes_everything(self):
        result = self.delete(name="  ana   PRUEBA lifecycle ")
        self.assertTrue(result["deleted"])
        self.assertEqual([s["id"] for s in result["steps"]], ["calendar", "database", "firebase", "profile"])
        self.assertEqual(sorted(self.google_deleted), ["evt-future-1", "evt-future-2", "evt-past", "evt-trial"])
        self.assertEqual(self.counts(), {"users": 0, "sessions": 0, "plans": 0, "requests": 0, "trials": 0, "emails": 0})
        self.assertNotIn("uid-ana", self.firebase["users"])

        audit = self.one("SELECT admin_uid, action, client_id, outcome, detail FROM admin_audit_log WHERE client_id = %s AND action = 'delete'",
                         self.user_id)
        self.assertEqual([(a[0], a[1], a[2], a[3]) for a in audit], [("admin-uid", "delete", self.user_id, "ok")])
        joined = " ".join(str(v) for row in audit for v in row).lower()
        self.assertNotIn("ana", joined)                                   # no personal data in the audit trail
        self.assertNotIn(DOMAIN, joined)

    def test_a_failed_step_is_reported_and_repeating_finishes_it(self):
        self.google_fail = True
        with self.assertRaises(HTTPException) as caught:
            self.delete()
        detail = caught.exception.detail
        self.assertEqual((caught.exception.status_code, detail["code"]), (502, "delete_incomplete"))
        self.assertEqual(detail["remaining"], ["calendar", "database", "firebase", "profile"])
        self.assertFalse(detail["steps"][0]["ok"])
        self.assertEqual(self.counts()["sessions"], 3)                    # nothing else was touched
        self.assertIn("uid-ana", self.firebase["users"])

        self.google_fail = False
        self.firebase_fail = True                                         # now Firebase is the one that fails
        with self.assertRaises(HTTPException) as second:
            self.delete()
        self.assertEqual(second.exception.detail["remaining"], ["firebase", "profile"])
        counts = self.counts()
        self.assertEqual((counts["users"], counts["sessions"], counts["trials"]), (1, 0, 0))

        self.firebase_fail = False
        done = self.delete()                                              # the third time everything is already done
        self.assertTrue(done["deleted"])
        self.assertEqual(self.counts()["users"], 0)
        self.assertNotIn("uid-ana", self.firebase["users"])

    def test_things_that_are_already_gone_count_as_success(self):
        self.google_deleted += ["evt-past", "evt-trial"]                  # Google answers 404/410 for these
        del self.firebase["users"]["uid-ana"]                             # and Firebase has no such user
        result = self.delete()
        self.assertTrue(result["deleted"])
        firebase_step = next(s for s in result["steps"] if s["id"] == "firebase")
        self.assertEqual(firebase_step["detail"], {"deleted": False})
        self.assertEqual(self.counts()["users"], 0)


if __name__ == "__main__":
    unittest.main()

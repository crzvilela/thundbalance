"""The export of a client's data and the request to delete an account (privacy.py):

    python -m unittest test_privacy -v

Two clients are made, Ana and Bea. Each one only gets her own data; the export never holds a login id, a token, a calendar event id or
a name that belongs to the other one. Firebase and Google Calendar are replaced by fakes; the local database is used and cleaned up.
"""
import json
import re
import unittest
import uuid
from datetime import date, timedelta
from types import SimpleNamespace

from fastapi.testclient import TestClient

import client_erasure
import client_lifecycle
import contact_messages
import inbox
import main
import plans_schema
import privacy
import reschedule_requests
import testsafety
import web_safety
from database import get_connection

DOMAIN = "@test-privacy.example"
ANA, BEA = f"ana{DOMAIN}", f"bea{DOMAIN}"
ADMIN = {"sub": "admin-uid-1234567890", "email": main.ADMIN_EMAIL, "email_verified": True}
FORBIDDEN_KEYS = {"firebase_uid", "calendar_feed_token", "confirmation_token", "token", "google_event_id", "cancelled_by", "decided_by",
                  "created_by", "handled_by", "uid", "password", "calendar_extra", "feed_sequence", "idempotency_key"}


class Gone(Exception):
    resp = SimpleNamespace(status=404)


def claims(uid, email, verified=True, provider="password"):
    return {"sub": uid, "email": email, "email_verified": verified, "firebase": {"sign_in_provider": provider}}


class Privacy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        testsafety.require_local_database()
        main.ensure_client_lifecycle_columns()
        main.ensure_calendar_sync_columns()
        main.ensure_calendar_feed_columns()
        main.ensure_session_pack_column()
        main.ensure_trial_session_fields()
        main.ensure_email_log_table()
        inbox.ensure_tables()
        contact_messages.ensure_contact_table()
        reschedule_requests.ensure_tables()
        web_safety.ensure_upload_table()
        web_safety.ensure_rate_limit_table()
        client_erasure.ensure_schema()
        privacy.ensure_schema()
        privacy.ensure_schema()                                                           # idempotent
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 1")
        cls.trainer_id = cur.fetchone()[0]
        cur.execute(f"INSERT INTO plans (nome, {plans_schema.price_column(cur)}, duracao_meses, duration_weeks) VALUES ('TEST privacy', 0, 1, 1) RETURNING id")
        cls.plan_id = cur.fetchone()[0]
        conn.commit()
        conn.close()

    @classmethod
    def cleanup(cls):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        ids = [row[0] for row in cur.fetchall()]
        cur.execute("DELETE FROM user_plans WHERE plan_id IN (SELECT id FROM plans WHERE nome = 'TEST privacy')")
        cur.execute("DELETE FROM inbox_messages WHERE title LIKE 'PRIVTEST %'")
        if ids:
            cur.execute("DELETE FROM deletion_requests WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM admin_audit_log WHERE client_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM reschedule_requests WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM sessions WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM client_requests WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM inbox_recipients WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM users WHERE id = ANY(%s)", (ids,))
        cur.execute("DELETE FROM inbox_recipients WHERE recipient_email LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM contact_messages WHERE email LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM email_log WHERE destinatario LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM uploaded_files WHERE name LIKE 'testprivacy-%'")
        cur.execute("DELETE FROM client_erasure_pending")
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        cls.cleanup()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM user_plans WHERE plan_id = %s", (cls.plan_id,))
        cur.execute("DELETE FROM plans WHERE id = %s", (cls.plan_id,))
        conn.commit()
        conn.close()

    # --------------------------------------------------------------------------------------------------- fixtures
    def setUp(self):
        self.cleanup()
        privacy.EXPORT_LIMIT.clear()
        self.firebase = {"users": {"uid-pa": {}, "uid-pb": {}}}
        self.deleted_events = []

        def find_uid(uid, email):
            return uid if uid in self.firebase["users"] else None

        def delete_account(uid):
            return self.firebase["users"].pop(uid, None) is not None

        def delete_event(event_id, notify=False):
            if event_id in self.deleted_events:
                raise Gone()
            self.deleted_events.append(event_id)

        acc, gcal = client_lifecycle.accounts, client_lifecycle.google_calendar
        self._orig = (acc.find_uid, acc.delete_account, gcal.delete_calendar_event, privacy.send_email_async)
        acc.find_uid, acc.delete_account, gcal.delete_calendar_event = find_uid, delete_account, delete_event
        self.sent = []
        privacy.send_email_async = lambda *args, **kwargs: self.sent.append((args, kwargs))
        self.ana, self.bea = self.make_clients()
        self.current = claims("uid-pa", ANA)
        main.app.dependency_overrides[main.require_client] = lambda: self.current
        main.app.dependency_overrides[main.require_admin] = lambda: ADMIN
        self.http = TestClient(main.app)

    def tearDown(self):
        acc, gcal = client_lifecycle.accounts, client_lifecycle.google_calendar
        acc.find_uid, acc.delete_account, gcal.delete_calendar_event, privacy.send_email_async = self._orig
        main.app.dependency_overrides.clear()
        self.cleanup()

    def sql(self, query, args=()):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(query, args)
        rows = cur.fetchall() if cur.description else []
        conn.commit()
        conn.close()
        return rows

    def make_clients(self):
        conn = get_connection()
        cur = conn.cursor()
        ids = {}
        future = date.today() + timedelta(days=10)
        for key, name, email, uid in (("a", "Ana Privtest Zuniga", ANA, "uid-pa"), ("b", "Bea Privtest Lopez", BEA, "uid-pb")):
            photo = f"testprivacy-{uuid.uuid4().hex}.png"
            cur.execute("INSERT INTO users (nome, email, firebase_uid, foto, telefone, cidade, calendar_feed_token, lang) VALUES (%s, %s, %s, %s, %s, %s, %s, 'es') RETURNING id",
                        (name, email, uid, f"/uploads/{photo}", f"+3460{'1' if key == 'a' else '2'}00000", f"City-{key.upper()}", f"FEEDTOKEN-{key.upper()}"))
            user_id = ids[key] = cur.fetchone()[0]
            cur.execute("INSERT INTO uploaded_files (name, content_type, data, size, owner_user_id) VALUES (%s, 'image/png', %s, 3, %s)", (photo, b"png", user_id))
            cur.execute("INSERT INTO user_plans (user_id, plan_id, active, session_type, second_person_name, second_person_email, total_price, price_per_session, trainer_id) "
                        "VALUES (%s, %s, TRUE, 'dual', %s, %s, 130, 65, %s) RETURNING id", (user_id, self.plan_id, f"Second-{key.upper()}", f"second-{key}{DOMAIN}", self.trainer_id))
            pack = cur.fetchone()[0]
            cur.execute("INSERT INTO sessions (user_id, trainer_id, session_date, session_time, status, session_number, google_event_id, user_plan_id, cancelled_by) "
                        "VALUES (%s, %s, %s, '10:00', 'Booked', '1/1', %s, %s, %s) RETURNING id", (user_id, self.trainer_id, future, f"evt-{key}", pack, f"canceller-{key}"))
            session = cur.fetchone()[0]
            cur.execute("INSERT INTO reschedule_requests (session_id, user_id, original_date, original_time, requested_date, requested_time, client_note, token, decided_by, admin_note) "
                        "VALUES (%s, %s, %s, '10:00', %s, '11:00', %s, %s, %s, %s)", (session, user_id, future, future + timedelta(days=1), f"NOTE-{key.upper()}", f"RESCHEDTOKEN-{key.upper()}", f"decider-{key}", f"ADMINNOTE-{key.upper()}"))
            cur.execute("INSERT INTO client_requests (user_id, plan_id, sessions_per_week, preferred_days, preferred_time, status) VALUES (%s, %s, 1, 'Monday', '10:00', 'Pending')", (user_id, self.plan_id))
            cur.execute("INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status, google_event_id, confirmation_token) "
                        "VALUES (%s, %s, '600', %s, 'Beginner', %s, '09:00', 'Approved', %s, %s)", (name, email, f"GOAL-{key.upper()}", future, f"evt-trial-{key}", f"TRIALTOKEN-{key.upper()}"))
            cur.execute("INSERT INTO contact_messages (name, email, message) VALUES (%s, %s, %s)", (name, email, f"CONTACT-{key.upper()}"))
            cur.execute("INSERT INTO email_log (tipo, referencia, destinatario, estado, lang) VALUES (%s, 'x', %s, 'sent', 'es')", (f"type-{key}", email))
            cur.execute("INSERT INTO inbox_messages (kind, type, title, body, audience, created_by, visible_from) VALUES ('notice', 'info', %s, %s, 'client', %s, NOW()) RETURNING id",
                        (f"PRIVTEST {key.upper()}", f"INBOX-{key.upper()}", f"creator-{key}"))
            cur.execute("INSERT INTO inbox_recipients (message_id, user_id, recipient_email) VALUES (%s, %s, %s)", (cur.fetchone()[0], user_id, email))
        conn.commit()
        conn.close()
        return ids["a"], ids["b"]

    def export(self, **kwargs):
        return self.http.get("/me/export", **kwargs)

    # ------------------------------------------------------------------------------------------------------ the client export
    def test_a_client_only_exports_her_own_data(self):
        response = self.export()
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        text = json.dumps(data)
        for mark in ("Ana Privtest", ANA, "City-A", "Second-A", "NOTE-A", "GOAL-A", "CONTACT-A", "INBOX-A", "type-a", "ADMINNOTE-A"):
            self.assertIn(mark, text, mark)
        for mark in ("Bea Privtest", BEA, "City-B", "Second-B", "NOTE-B", "GOAL-B", "CONTACT-B", "INBOX-B", "type-b", "ADMINNOTE-B", "second-b"):
            self.assertNotIn(mark, text, mark)
        self.assertEqual((len(data["packs"]), len(data["sessions"]), len(data["pack_requests"]), len(data["reschedule_requests"])), (1, 1, 1, 1))
        self.assertEqual((len(data["inbox"]), len(data["contact_messages"]), len(data["trial_sessions"]), len(data["emails_sent"])), (1, 1, 1, 1))
        self.assertEqual(data["photo"]["kind"], "upload")
        self.assertTrue(data["photo"]["data_base64"])
        self.current = claims("uid-pb", BEA)                                                    # the other client gets hers
        other = json.dumps(self.export().json())
        self.assertIn("Bea Privtest", other)
        self.assertNotIn("Ana Privtest", other)
        self.assertNotIn(ANA, other)

    def test_the_export_holds_no_forbidden_field_or_value(self):
        data = self.export().json()
        found = set()

        def walk(item):
            if isinstance(item, dict):
                for key, value in item.items():
                    found.add(key)
                    walk(value)
            elif isinstance(item, list):
                for value in item:
                    walk(value)
        walk(data)
        self.assertEqual(found & FORBIDDEN_KEYS, set())
        text = json.dumps(data)
        for secret in ("uid-pa", "uid-pb", "FEEDTOKEN", "RESCHEDTOKEN", "TRIALTOKEN", "evt-a", "evt-trial", "canceller-", "decider-", "creator-", "firebase"):
            self.assertNotIn(secret, text, secret)
        self.assertNotIn("admin_audit", text)

    def test_an_id_in_the_request_changes_nothing(self):
        mine = self.export().json()
        for url in (f"/me/export?user_id={self.bea}", f"/me/export?client_id={self.bea}&id={self.bea}", f"/me/export?email={BEA}"):
            privacy.EXPORT_LIMIT.clear()
            other = self.http.get(url, headers={"X-User-Id": str(self.bea)})
            self.assertEqual(other.status_code, 200)
            self.assertEqual(json.dumps(other.json()["profile"]), json.dumps(mine["profile"]))
            self.assertNotIn("Bea Privtest", other.text)

    def test_the_file_is_a_download_that_is_never_cached(self):
        response = self.export()
        self.assertRegex(response.headers["content-disposition"], r'^attachment; filename="thundbalance-datos-\d{4}-\d{2}-\d{2}\.json"$')
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertIn("application/json", response.headers["content-type"])

    def test_three_exports_an_hour_and_then_a_clear_429(self):
        for _ in range(3):
            self.assertEqual(self.export().status_code, 200)
        response = self.export()
        self.assertEqual((response.status_code, response.json()["detail"]["code"]), (429, "too_many_exports"))
        self.current = claims("uid-pb", BEA)
        self.assertEqual(self.export().status_code, 200)                                        # the limit is per client

    def test_an_invalid_token_or_an_unverified_email_is_refused(self):
        main.app.dependency_overrides.pop(main.require_client)
        self.assertEqual(self.http.get("/me/export").status_code, 401)                           # no token
        self.assertEqual(self.http.get("/me/export", headers={"Authorization": "Bearer not-a-token"}).status_code, 401)
        self.assertEqual(self.http.post("/me/deletion-request", json={"confirm": True}).status_code, 401)
        main.app.dependency_overrides[main.require_client] = lambda: self.current
        self.current = claims("uid-pa", ANA, verified=False)
        for response in (self.export(), self.http.post("/me/deletion-request", json={"confirm": True}), self.http.get("/me/deletion-request")):
            self.assertEqual((response.status_code, response.json()["detail"]["code"]), (403, "email_not_verified"))
        self.assertEqual(self.sql("SELECT COUNT(*) FROM deletion_requests WHERE user_id = %s", (self.ana,))[0][0], 0)
        self.current = claims("uid-pa", ANA, verified=False, provider="google.com")             # Google only gives verified addresses
        self.assertEqual(self.export().status_code, 200)

    def test_an_unverified_login_cannot_reach_a_record_it_is_not_linked_to(self):
        self.current = claims("someone-else", ANA, verified=False)                              # same address, another login id
        self.assertEqual(self.export().status_code, 403)

    # ------------------------------------------------------------------------------------------------ the deletion request
    def test_a_deletion_request_needs_confirmation_deletes_nothing_and_there_is_only_one_pending(self):
        self.assertEqual(self.http.post("/me/deletion-request", json={"confirm": False}).status_code, 422)
        first = self.http.post("/me/deletion-request", json={"confirm": True})
        self.assertEqual((first.status_code, first.json()["status"], first.json()["already_pending"]), (200, "pending", False))
        again = self.http.post("/me/deletion-request", json={"confirm": True})
        self.assertEqual((again.json()["status"], again.json()["already_pending"], again.json()["id"]), ("pending", True, first.json()["id"]))
        self.assertEqual(self.sql("SELECT COUNT(*) FROM deletion_requests WHERE user_id = %s AND status = 'pending'", (self.ana,))[0][0], 1)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM users WHERE id = %s", (self.ana,))[0][0], 1)       # nothing was deleted
        self.assertEqual(self.sql("SELECT COUNT(*) FROM sessions WHERE user_id = %s", (self.ana,))[0][0], 1)
        self.assertEqual(self.http.get("/me/deletion-request").json()["status"], "pending")
        self.current = claims("uid-pb", BEA)
        self.assertEqual(self.http.get("/me/deletion-request").json()["status"], "none")           # Bea sees nothing of Ana's request

    def test_the_team_and_the_client_are_told_and_the_team_notice_holds_only_the_name_and_the_date(self):
        self.http.post("/me/deletion-request", json={"confirm": True})
        self.assertEqual(len(self.sent), 2)
        (team_args, team_kwargs), (client_args, client_kwargs) = self.sent
        self.assertEqual(team_kwargs["kind"], "deletion_request_team")
        team_text = " ".join(str(part) for part in team_args[1:4])
        self.assertIn("Ana Privtest Zuniga", team_text)
        self.assertIn(date.today().isoformat(), team_text)
        for private in (ANA, "City-A", "+34601", "Second-A", "CONTACT-A"):
            self.assertNotIn(private, team_text)                                                # nothing beyond the name and the date
        self.assertEqual(client_args[0], ANA)
        self.assertEqual(client_kwargs["lang"], "es")
        self.assertIn("Hemos recibido", client_args[1])                                         # in the language of the client
        self.http.post("/me/deletion-request", json={"confirm": True})
        self.assertEqual(len(self.sent), 2)                                                     # a repeated request sends nothing again

    def test_the_admin_account_cannot_ask_to_be_deleted(self):
        self.current = claims("admin-uid", main.ADMIN_EMAIL)
        self.sql("INSERT INTO users (nome, email, firebase_uid) VALUES ('Admin Privtest', %s, 'admin-uid')", (f"admin{DOMAIN}",))
        self.assertIn(self.http.post("/me/deletion-request", json={"confirm": True}).status_code, (403, 404))

    # --------------------------------------------------------------------------------------------------------- the admin
    def test_the_admin_exports_a_client_and_it_is_audited_without_personal_data(self):
        response = self.http.get(f"/admin/clients/{self.ana}/export")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Ana Privtest", response.text)
        self.assertNotIn("Bea Privtest", response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(self.http.get("/admin/clients/99999999/export").status_code, 404)
        rows = self.sql("SELECT admin_uid, action, client_id, outcome, detail FROM admin_audit_log WHERE client_id = %s AND action = 'export'", (self.ana,))
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0][0], rows[0][1], rows[0][3]), (ADMIN["sub"][:6], "export", "ok"))   # an abbreviated uid
        self.assertNotIn("Ana", repr(rows))
        self.assertNotIn(ANA, repr(rows))
        main.app.dependency_overrides.pop(main.require_admin)
        self.assertEqual(self.http.get(f"/admin/clients/{self.ana}/export").status_code, 401)   # only the admin

    def test_the_admin_sees_the_requests_and_a_client_does_not_use_the_admin_routes(self):
        self.http.post("/me/deletion-request", json={"confirm": True})
        items = self.http.get("/admin/deletion-requests").json()["items"]
        mine = [item for item in items if item["client_id"] == self.ana]
        self.assertEqual((len(mine), mine[0]["status"], mine[0]["client_name"]), (1, "pending", "Ana Privtest Zuniga"))
        main.app.dependency_overrides.pop(main.require_admin)
        self.assertIn(self.http.get("/admin/deletion-requests").status_code, (401, 403))
        self.assertIn(self.http.post(f"/admin/deletion-requests/{mine[0]['id']}/approve", json={"confirm": True}).status_code, (401, 403))

    def test_approving_runs_the_complete_deletion_and_closes_the_request(self):
        request_id = self.http.post("/me/deletion-request", json={"confirm": True}).json()["id"]
        self.assertEqual(self.http.post(f"/admin/deletion-requests/{request_id}/approve", json={"confirm": False}).status_code, 422)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM users WHERE id = %s", (self.ana,))[0][0], 1)       # not without the confirmation
        response = self.http.post(f"/admin/deletion-requests/{request_id}/approve", json={"confirm": True})
        self.assertEqual((response.status_code, response.json()["status"]), (200, "completed"))
        count = lambda query, args: self.sql(query, args)[0][0]                                  # noqa: E731
        self.assertEqual(count("SELECT COUNT(*) FROM users WHERE id = %s", (self.ana,)), 0)
        self.assertEqual(count("SELECT COUNT(*) FROM sessions WHERE user_id = %s", (self.ana,)), 0)
        self.assertEqual(count("SELECT COUNT(*) FROM client_requests WHERE user_id = %s", (self.ana,)), 0)
        self.assertEqual(count("SELECT COUNT(*) FROM contact_messages WHERE email = %s", (ANA,)), 0)
        self.assertEqual(count("SELECT COUNT(*) FROM trial_sessions WHERE email = %s", (ANA,)), 0)
        self.assertEqual(count("SELECT COUNT(*) FROM email_log WHERE destinatario = %s", (ANA,)), 0)
        self.assertEqual(count("SELECT COUNT(*) FROM inbox_recipients WHERE recipient_email = %s", (ANA,)), 0)
        self.assertEqual(count("SELECT COUNT(*) FROM uploaded_files WHERE owner_user_id = %s", (self.ana,)), 0)
        self.assertEqual(count("SELECT COUNT(*) FROM user_plans WHERE user_id = %s", (self.ana,)), 0)    # the pack stays anonymized, without her
        self.assertNotIn("uid-pa", self.firebase["users"])
        self.assertIn("evt-a", self.deleted_events)
        self.assertEqual(count("SELECT COUNT(*) FROM users WHERE id = %s", (self.bea,)), 1)                 # Bea is untouched
        self.assertEqual(count("SELECT COUNT(*) FROM sessions WHERE user_id = %s", (self.bea,)), 1)
        row = self.sql("SELECT status, handled_by FROM deletion_requests WHERE id = %s", (request_id,))[0]
        self.assertEqual((row[0], row[1]), ("completed", ADMIN["sub"][:6]))
        audit = self.sql("SELECT admin_uid, action, outcome, detail FROM admin_audit_log WHERE client_id = %s ORDER BY id", (self.ana,))
        self.assertIn("deletion_approved", [item[1] for item in audit])
        self.assertNotIn("Ana", repr(audit))
        self.assertNotIn(ANA, repr(audit))
        self.assertEqual(self.http.post(f"/admin/deletion-requests/{request_id}/approve", json={"confirm": True}).status_code, 409)   # not twice

    def test_rejecting_deletes_nothing_and_keeps_a_short_reason(self):
        request_id = self.http.post("/me/deletion-request", json={"confirm": True}).json()["id"]
        for reason in ("", "   ", "<b>no</b>"):
            self.assertEqual(self.http.post(f"/admin/deletion-requests/{request_id}/reject", json={"reason": reason}).status_code, 422)
        response = self.http.post(f"/admin/deletion-requests/{request_id}/reject", json={"reason": "Tienes un pack activo"})
        self.assertEqual((response.status_code, response.json()["status"]), (200, "rejected"))
        self.assertEqual(self.sql("SELECT COUNT(*) FROM users WHERE id = %s", (self.ana,))[0][0], 1)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM sessions WHERE user_id = %s", (self.ana,))[0][0], 1)
        state = self.http.get("/me/deletion-request").json()
        self.assertEqual((state["status"], state["reason"]), ("rejected", "Tienes un pack activo"))
        again = self.http.post("/me/deletion-request", json={"confirm": True}).json()                  # she may ask again after a rejection
        self.assertEqual((again["status"], again["already_pending"]), ("pending", False))
        audit = self.sql("SELECT action, detail FROM admin_audit_log WHERE client_id = %s", (self.ana,))
        self.assertIn("deletion_rejected", [item[0] for item in audit])
        self.assertNotIn("pack activo", repr(audit))                                                    # the reason is not copied into the audit log

    def test_no_log_line_holds_an_address_a_name_or_exported_content(self):
        with self.assertLogs(level="DEBUG") as captured:
            self.export()
            self.http.post("/me/deletion-request", json={"confirm": True})
            self.http.get(f"/admin/clients/{self.ana}/export")
        logs = "\n".join(captured.output)
        for private in (ANA, "Ana Privtest", "City-A", "CONTACT-A", "GOAL-A", "uid-pa"):
            self.assertNotIn(private, logs, private)
        self.assertFalse(re.search(r"[\w.]+@test-privacy", logs))


if __name__ == "__main__":
    unittest.main()

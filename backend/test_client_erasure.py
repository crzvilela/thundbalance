"""Deleting a client leaves nothing of them behind (GDPR): python -m unittest test_client_erasure -v

Firebase and Google Calendar are replaced by fakes; the local database is used and cleaned up. Two clients are made: Ana, who is deleted,
and Bea, who must stay exactly as she is (except for the address of Ana that appears inside Bea's records, which is emptied).
"""
import os
import unittest
import uuid
from datetime import date, timedelta
from types import SimpleNamespace

from fastapi import HTTPException

import client_erasure
import client_lifecycle
import contact_messages
import inbox
import main
import plans_schema
import reschedule_requests
import testsafety
import web_safety
from database import get_connection

DOMAIN = "@test-erasure.example"
ANA = f"ana{DOMAIN}"
BEA = f"bea{DOMAIN}"
ANA_NAME = "Ana Erasuretest Zuniga"
ADMIN_CLAIMS = {"sub": "admin-uid", "email": main.ADMIN_EMAIL}
AUDIT_TABLES = {"admin_audit_log", "contact_message_audit", "inbox_audit", "trainer_access_log", "trainer_access"}


def delete_route():
    for route in main.app.routes:
        if getattr(route, "path", None) == "/admin/clients/{client_id}/delete" and "POST" in getattr(route, "methods", ()):
            return route.endpoint
    raise LookupError


def call_delete(client_id, name=ANA_NAME):
    return delete_route()(client_id, client_lifecycle.DeletePayload(confirm_data=True, confirm_name=name), ADMIN_CLAIMS)


class Gone(Exception):
    resp = SimpleNamespace(status=404)


class Erasure(unittest.TestCase):
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
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 1")
        cls.trainer_id = cur.fetchone()[0]
        cur.execute(f"INSERT INTO plans (nome, {plans_schema.price_column(cur)}, duracao_meses, duration_weeks) VALUES ('TEST erasure', 0, 1, 1) RETURNING id")
        cls.plan_id = cur.fetchone()[0]
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

    @classmethod
    def cleanup(cls):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        ids = [row[0] for row in cur.fetchall()]
        cur.execute("DELETE FROM user_plans WHERE plan_id IN (SELECT id FROM plans WHERE nome = 'TEST erasure')")
        cur.execute("DELETE FROM inbox_messages WHERE title LIKE 'TESTER %'")
        if ids:
            cur.execute("DELETE FROM reschedule_requests WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM sessions WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM user_plans WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM client_requests WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM inbox_recipients WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM users WHERE id = ANY(%s)", (ids,))
        cur.execute("DELETE FROM inbox_recipients WHERE recipient_email LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM trial_sessions WHERE email LIKE %s OR second_person_email LIKE %s", (f"%{DOMAIN}", f"%{DOMAIN}"))
        cur.execute("DELETE FROM contact_messages WHERE email LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM email_log WHERE destinatario LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM uploaded_files WHERE name LIKE 'testerasure-%'")
        cur.execute("DELETE FROM client_erasure_pending")
        conn.commit()
        conn.close()
        for name in os.listdir(main.UPLOAD_DIR):
            if name.startswith("testerasure-"):
                os.remove(os.path.join(main.UPLOAD_DIR, name))

    # ----------------------------------------------------------------------------------------------- fixtures
    def setUp(self):
        self.cleanup()
        self.firebase = {"users": {"uid-ana": {}, "uid-bea": {}}, "calls": []}
        self.google_deleted = []
        self.google_fail = False
        self.firebase_fail = False

        def find_uid(uid, email):
            if self.firebase_fail:
                raise client_lifecycle.accounts.AccountError("down")
            return uid if uid in self.firebase["users"] else None

        def delete_account(uid):
            self.firebase["calls"].append(("delete", uid))
            if self.firebase_fail:
                raise client_lifecycle.accounts.AccountError("down")
            return self.firebase["users"].pop(uid, None) is not None

        def delete_event(event_id, notify=False):
            if self.google_fail:
                raise RuntimeError("calendar down")
            if event_id in self.google_deleted:
                raise Gone()
            self.google_deleted.append(event_id)

        acc, gcal = client_lifecycle.accounts, client_lifecycle.google_calendar
        self._orig = (acc.find_uid, acc.delete_account, gcal.delete_calendar_event)
        acc.find_uid, acc.delete_account = find_uid, delete_account
        gcal.delete_calendar_event = delete_event
        self.ana, self.bea = self.make_clients()

    def tearDown(self):
        acc, gcal = client_lifecycle.accounts, client_lifecycle.google_calendar
        acc.find_uid, acc.delete_account, gcal.delete_calendar_event = self._orig
        self.cleanup()

    def sql(self, query, args=()):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(query, args)
        rows = cur.fetchall() if cur.description else []
        conn.commit()
        conn.close()
        return rows

    def one(self, query, args=()):
        return self.sql(query, args)[0][0]

    def make_clients(self):
        photo_ana = f"testerasure-{uuid.uuid4().hex}.png"
        photo_ana_old = f"testerasure-{uuid.uuid4().hex}.png"
        photo_bea = f"testerasure-{uuid.uuid4().hex}.png"
        conn = get_connection()
        cur = conn.cursor()
        ids = {}
        for key, name, email, uid, photo in (("ana", ANA_NAME, ANA, "uid-ana", photo_ana), ("bea", "Bea Erasuretest Lopez", BEA, "uid-bea", photo_bea)):
            cur.execute("INSERT INTO users (nome, email, firebase_uid, foto, telefone) VALUES (%s, %s, %s, %s, %s) RETURNING id",
                        (name, email, uid, f"/uploads/{photo}", "+34600" + ("111111" if key == "ana" else "222222")))
            ids[key] = cur.fetchone()[0]
        # photos: Ana has the current one (owned), an older one (owned) and the file on the disk; Bea has hers
        for name, owner in ((photo_ana, ids["ana"]), (photo_ana_old, ids["ana"]), (photo_bea, ids["bea"])):
            cur.execute("INSERT INTO uploaded_files (name, content_type, data, size, owner_user_id) VALUES (%s, 'image/png', %s, 3, %s)", (name, b"png", owner))
        with open(os.path.join(main.UPLOAD_DIR, photo_ana), "wb") as handle:
            handle.write(b"png")
        self.photos = {"ana": photo_ana, "ana_old": photo_ana_old, "bea": photo_bea}
        future = date.today() + timedelta(days=10)
        for key, email, second in (("ana", ANA, None), ("bea", BEA, ANA)):
            uid = ids[key]
            cur.execute(
                "INSERT INTO user_plans (user_id, plan_id, active, session_type, second_person_name, second_person_email, extra_emails, "
                "calendar_share, calendar_extra, total_price, price_per_session) VALUES (%s, %s, TRUE, %s, %s, %s, %s, TRUE, %s, 130, 65) RETURNING id",
                (uid, self.plan_id, "dual" if second else "individual", "Second Person" if second else f"Mum {key}", second or f"mum-{key}{DOMAIN}",
                 [ANA, f"keep-{key}{DOMAIN}"] if key == "bea" else [f"extra-ana{DOMAIN}"], f"{ANA},keep-bea{DOMAIN}" if key == "bea" else f"extra-ana{DOMAIN}"))
            pack = cur.fetchone()[0]
            for index in range(2):
                cur.execute(
                    "INSERT INTO sessions (user_id, trainer_id, session_date, session_time, status, session_number, google_event_id, user_plan_id) "
                    "VALUES (%s, %s, %s, '10:00', 'Booked', %s, %s, %s) RETURNING id",
                    (uid, self.trainer_id, future + timedelta(days=index), f"{index + 1}/2", f"evt-{key}-{index}", pack))
                session = cur.fetchone()[0]
            cur.execute(
                "INSERT INTO reschedule_requests (session_id, user_id, original_date, original_time, requested_date, requested_time, client_note, token) "
                "VALUES (%s, %s, %s, '10:00', %s, '11:00', %s, %s)", (session, uid, future + timedelta(days=1), future + timedelta(days=2), f"note of {key}", uuid.uuid4().hex))
            cur.execute("INSERT INTO client_requests (user_id, plan_id, sessions_per_week, preferred_days, preferred_time, status, second_person_email) "
                        "VALUES (%s, %s, 1, 'Monday', '10:00', 'Pending', %s)", (uid, self.plan_id, ANA if key == "bea" else None))
            cur.execute(
                "INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status, google_event_id, second_person_email, extra_emails, calendar_extra) "
                "VALUES (%s, %s, '600', 'Lose weight', 'Beginner', %s, '09:00', 'Approved', %s, %s, %s, %s)",
                (ANA_NAME if key == "ana" else "Bea Erasuretest Lopez", email if key == "ana" else BEA, future, f"evt-trial-{key}", ANA if key == "bea" else None,
                 [ANA.upper(), f"keep{DOMAIN}"] if key == "bea" else None, f"{ANA}" if key == "bea" else None))
            cur.execute("INSERT INTO contact_messages (name, email, message) VALUES (%s, %s, %s)", (ANA_NAME if key == "ana" else "Bea", email.upper() if key == "ana" else email, f"hello from {key}"))
            cur.execute("INSERT INTO email_log (tipo, referencia, destinatario, estado) VALUES ('welcome', %s, %s, 'sent')", (str(uid), email))
            cur.execute("INSERT INTO email_log (tipo, referencia, destinatario, estado) VALUES ('pack_summary', %s, %s, 'sent')", (str(uid), email))
        # inbox: a system message only for Ana (goes), a system message for Ana and Bea (stays), an admin message to Ana (stays), a row waiting for Ana's e-mail
        cur.execute("INSERT INTO inbox_messages (kind, type, title, body, main_lang, audience, visible_from) VALUES ('system', 'pack_approved', 'TESTER only ana', 'Hello Ana Erasuretest', 'es', 'user', NOW()) RETURNING id")
        only_ana = cur.fetchone()[0]
        cur.execute("INSERT INTO inbox_messages (kind, type, title, body, main_lang, audience, visible_from) VALUES ('system', 'pack_approved', 'TESTER both', 'for two', 'es', 'user', NOW()) RETURNING id")
        both = cur.fetchone()[0]
        cur.execute("INSERT INTO inbox_messages (kind, type, title, body, main_lang, audience, visible_from) VALUES ('admin', 'broadcast', 'TESTER broadcast', 'news', 'es', 'all', NOW()) RETURNING id")
        broadcast = cur.fetchone()[0]
        for message, user, email in ((only_ana, ids["ana"], ANA), (both, ids["ana"], ANA), (both, ids["bea"], BEA), (broadcast, ids["ana"], ANA), (broadcast, ids["bea"], BEA)):
            cur.execute("INSERT INTO inbox_recipients (message_id, user_id, recipient_email) VALUES (%s, %s, %s)", (message, user, email))
        cur.execute("INSERT INTO inbox_messages (kind, type, title, body, main_lang, audience, visible_from) VALUES ('system', 'trial_approved', 'TESTER waiting', 'for her address', 'es', 'user', NOW()) RETURNING id")
        waiting = cur.fetchone()[0]
        cur.execute("INSERT INTO inbox_recipients (message_id, user_id, recipient_email) VALUES (%s, NULL, %s)", (waiting, ANA))       # waiting for an account
        self.messages = {"only_ana": only_ana, "waiting": waiting, "both": both, "broadcast": broadcast}
        conn.commit()
        conn.close()
        return ids["ana"], ids["bea"]

    # ----------------------------------------------------------------------------------------------- what is left
    def text_columns(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' "
            "AND data_type IN ('text', 'character varying', 'ARRAY', 'jsonb', 'json') ORDER BY table_name")
        rows = [r for r in cur.fetchall() if r[0] not in AUDIT_TABLES]
        conn.close()
        return rows

    def traces_of(self, *needles):
        """Every (table.column) where any needle still appears, looking at every text / array / json column of the database."""
        found = []
        for table, column, _type in self.text_columns():
            for needle in needles:
                if self.one(f'SELECT COUNT(*) FROM "{table}" WHERE "{column}"::text ILIKE %s', (f"%{needle}%",)):
                    found.append(f"{table}.{column}")
        return found

    def snapshot_of_bea(self):
        return {
            "user": self.sql("SELECT nome, email, firebase_uid, foto, telefone FROM users WHERE id = %s", (self.bea,)),
            "sessions": self.sql("SELECT session_date, google_event_id, status FROM sessions WHERE user_id = %s ORDER BY id", (self.bea,)),
            "reschedule": self.sql("SELECT client_note FROM reschedule_requests WHERE user_id = %s", (self.bea,)),
            "contact": self.sql("SELECT name, email, message FROM contact_messages WHERE email = %s", (BEA,)),
            "email_log": self.sql("SELECT tipo, destinatario FROM email_log WHERE destinatario = %s ORDER BY id", (BEA,)),
            "photo": self.sql("SELECT name, owner_user_id FROM uploaded_files WHERE owner_user_id = %s", (self.bea,)),
            "inbox": self.sql("SELECT message_id FROM inbox_recipients WHERE user_id = %s ORDER BY id", (self.bea,)),
            "pack": self.sql("SELECT total_price, price_per_session, active, session_type FROM user_plans WHERE user_id = %s", (self.bea,)),
            "trial": self.sql("SELECT full_name, email, status, google_event_id FROM trial_sessions WHERE email = %s", (BEA,)),
        }

    # ----------------------------------------------------------------------------------------------- the deletion
    def test_nothing_of_the_client_is_left_anywhere(self):
        before = self.snapshot_of_bea()
        self.assertTrue(self.traces_of("erasuretest zuniga", ANA, f"extra-ana{DOMAIN}"), "the fixture must put Ana's data everywhere")
        answer = call_delete(self.ana)
        self.assertTrue(answer["deleted"])
        self.assertEqual([step["id"] for step in answer["steps"]], ["calendar", "database", "firebase", "profile"])
        # every text, array and json column of every table (the audit logs apart): neither her name, nor any of her addresses
        self.assertEqual(self.traces_of("erasuretest zuniga", ANA, f"extra-ana{DOMAIN}", f"mum-ana{DOMAIN}", "+34600111111", "note of ana", "hello from ana"), [])
        # the profile, the login, the events, the photos (database and disk)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM users WHERE id = %s", (self.ana,)), [(0,)])
        self.assertNotIn("uid-ana", self.firebase["users"])
        self.assertEqual(sorted(self.google_deleted), ["evt-ana-0", "evt-ana-1", "evt-trial-ana"])
        self.assertEqual(self.sql("SELECT COUNT(*) FROM uploaded_files WHERE owner_user_id = %s OR name = ANY(%s)", (self.ana, [self.photos["ana"], self.photos["ana_old"]])), [(0,)])
        self.assertFalse(os.path.exists(os.path.join(main.UPLOAD_DIR, self.photos["ana"])))
        for table in ("sessions", "client_requests", "reschedule_requests", "inbox_recipients"):
            self.assertEqual(self.sql(f"SELECT COUNT(*) FROM {table} WHERE user_id = %s", (self.ana,)), [(0,)], table)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM client_erasure_pending"), [(0,)])
        # the system messages that were only hers (also the one waiting for her address) are gone; the one she shared and the broadcast stay
        remaining = {row[0] for row in self.sql("SELECT id FROM inbox_messages WHERE id = ANY(%s)", (list(self.messages.values()),))}
        self.assertEqual(remaining, {self.messages["both"], self.messages["broadcast"]})
        # Bea is exactly as she was
        self.assertEqual(self.snapshot_of_bea(), before)

    def test_the_packs_stay_as_anonymous_accounting(self):
        call_delete(self.ana)
        rows = self.sql(
            "SELECT user_id, active, total_price, price_per_session, plan_id, second_person_name, second_person_email, extra_emails, calendar_share, calendar_extra "
            "FROM user_plans WHERE user_id IS NULL AND plan_id = %s", (self.plan_id,))
        self.assertEqual(len(rows), 1)
        user_id, active, total, per_session, plan, name, second_email, extra, share, calendar_extra = rows[0]
        self.assertEqual((user_id, active, float(total), float(per_session), plan), (None, False, 130.0, 65.0, self.plan_id))
        self.assertEqual((name, second_email, extra, share, calendar_extra), (None, None, None, False, None))       # nothing that identifies a person

    def test_her_address_is_emptied_inside_other_peoples_records_and_only_there(self):
        call_delete(self.ana)
        pack = self.sql("SELECT second_person_name, second_person_email, extra_emails, calendar_extra FROM user_plans WHERE user_id = %s", (self.bea,))[0]
        self.assertEqual(pack, (None, None, [f"keep-bea{DOMAIN}"], f"keep-bea{DOMAIN}"))                          # Ana out, Bea's own address stays
        trial = self.sql("SELECT second_person_email, extra_emails, calendar_extra FROM trial_sessions WHERE email = %s", (BEA,))[0]
        self.assertEqual(trial, (None, [f"keep{DOMAIN}"], None))
        self.assertEqual(self.sql("SELECT second_person_email FROM client_requests WHERE user_id = %s", (self.bea,)), [(None,)])
        self.assertEqual(self.sql("SELECT email FROM users WHERE id = %s", (self.bea,)), [(BEA,)])               # her own record is untouched

    # ----------------------------------------------------------------------------------------------- what the admin sees
    def test_the_preview_lists_counts_and_nothing_personal(self):
        for route in main.app.routes:
            if getattr(route, "path", None) == "/admin/clients/{client_id}/erasure-preview":
                endpoint = route.endpoint
        counts = endpoint(self.ana, ADMIN_CLAIMS)["counts"]
        self.assertEqual(counts["sessions"], 2)
        self.assertEqual(counts["calendar_events"], 3)
        self.assertEqual(counts["requests"], 1)
        self.assertEqual(counts["reschedule_requests"], 1)
        self.assertEqual(counts["trial_sessions"], 1)
        self.assertEqual(counts["contact_messages"], 1)
        self.assertEqual(counts["system_messages"], 2)
        self.assertEqual(counts["photos"], 2)                          # her two photos (the one the profile points to is one of them)
        self.assertEqual(counts["packs_anonymized"], 1)
        self.assertTrue(counts["login_account"])
        for key, value in counts.items():                              # numbers and a yes / no: never a name or an address
            self.assertIsInstance(value, (int, bool), key)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM users WHERE id = %s", (self.ana,)), [(1,)])                # a preview deletes nothing

    # ----------------------------------------------------------------------------------------------- partial failures
    def test_if_firebase_fails_the_deletion_stops_leaves_a_mark_and_can_be_repeated(self):
        before = self.snapshot_of_bea()
        self.firebase_fail = True
        with self.assertRaises(HTTPException) as caught:
            call_delete(self.ana)
        self.assertEqual(caught.exception.status_code, 502)
        self.assertEqual(caught.exception.detail["code"], "delete_incomplete")
        self.assertEqual(caught.exception.detail["remaining"], ["firebase", "profile"])
        pending = client_erasure.list_pending()
        self.assertEqual([(item["client_id"], item["stopped_at"], item["error_type"], item["attempts"]) for item in pending], [(self.ana, "firebase", "AccountError", 1)])
        # the data was already erased (database step committed); the profile is what lets it be repeated
        self.assertEqual(self.sql("SELECT COUNT(*) FROM users WHERE id = %s", (self.ana,)), [(1,)])
        self.assertEqual(self.sql("SELECT COUNT(*) FROM contact_messages WHERE LOWER(email) = %s", (ANA,)), [(0,)])
        self.assertEqual(self.snapshot_of_bea(), before)                                   # and nothing of Bea broke
        self.assertEqual(self.sql("SELECT outcome, detail FROM admin_audit_log WHERE client_id = %s ORDER BY id DESC LIMIT 1", (self.ana,)), [("partial", "stopped_at=firebase")])
        # the daily job repeats it once Firebase answers again
        self.firebase_fail = False
        result = client_erasure.retry_pending()
        self.assertEqual(result, {"retried": 1, "finished": 1, "failed": 0})
        self.assertEqual(self.sql("SELECT COUNT(*) FROM users WHERE id = %s", (self.ana,)), [(0,)])
        self.assertNotIn("uid-ana", self.firebase["users"])
        self.assertEqual(client_erasure.list_pending(), [])
        self.assertEqual(self.traces_of("erasuretest zuniga", ANA), [])
        self.assertEqual(self.snapshot_of_bea(), before)

    def test_the_mark_holds_only_the_step_and_the_type_of_the_error(self):
        self.firebase_fail = True
        with self.assertRaises(HTTPException):
            call_delete(self.ana)
        columns = self.sql("SELECT column_name FROM information_schema.columns WHERE table_name = 'client_erasure_pending' ORDER BY ordinal_position")
        self.assertEqual([c[0] for c in columns], ["client_id", "stopped_at", "error_type", "attempts", "first_at", "updated_at"])
        text = self.one("SELECT client_id::text || ' ' || stopped_at || ' ' || COALESCE(error_type, '') FROM client_erasure_pending")
        self.assertEqual(text, f"{self.ana} firebase AccountError")                                   # an id, a step and a type: nothing else

    def test_if_the_calendar_fails_nothing_is_deleted_and_the_deletion_can_be_repeated(self):
        before = self.snapshot_of_bea()
        self.google_fail = True
        with self.assertRaises(HTTPException) as caught:
            call_delete(self.ana)
        self.assertEqual(caught.exception.detail["remaining"], ["calendar", "database", "firebase", "profile"])
        self.assertEqual(client_erasure.list_pending()[0]["stopped_at"], "calendar")
        self.assertEqual(self.sql("SELECT COUNT(*) FROM sessions WHERE user_id = %s", (self.ana,)), [(2,)])       # still all there
        self.assertEqual(self.sql("SELECT COUNT(*) FROM contact_messages WHERE LOWER(email) = %s", (ANA,)), [(1,)])
        self.google_fail = False
        self.assertTrue(call_delete(self.ana)["deleted"])                                  # the admin repeats it
        self.assertEqual(client_erasure.list_pending(), [])
        self.assertEqual(self.traces_of("erasuretest zuniga", ANA), [])
        self.assertEqual(self.snapshot_of_bea(), before)

    def test_a_deletion_that_keeps_failing_is_not_retried_for_ever(self):
        self.firebase_fail = True
        with self.assertRaises(HTTPException):
            call_delete(self.ana)
        self.sql("UPDATE client_erasure_pending SET attempts = %s", (client_erasure.MAX_ATTEMPTS,))
        self.assertEqual(client_erasure.retry_pending(), {"retried": 0, "finished": 0, "failed": 0})

    def test_the_confirmation_is_still_needed_and_nothing_changes_without_it(self):
        with self.assertRaises(HTTPException) as caught:
            delete_route()(self.ana, client_lifecycle.DeletePayload(confirm_data=True, confirm_name="somebody else"), ADMIN_CLAIMS)
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM users WHERE id = %s", (self.ana,)), [(1,)])
        self.assertEqual(self.sql("SELECT COUNT(*) FROM client_erasure_pending"), [(0,)])

    # ----------------------------------------------------------------------------------------------- photos
    def test_a_new_profile_photo_replaces_the_old_one(self):
        first, second = f"testerasure-{uuid.uuid4().hex}.png", f"testerasure-{uuid.uuid4().hex}.png"
        web_safety.save_upload(first, b"one", owner_user_id=self.bea)
        web_safety.save_upload(second, b"two", owner_user_id=self.bea)
        names = [row[0] for row in self.sql("SELECT name FROM uploaded_files WHERE owner_user_id = %s", (self.bea,))]
        self.assertEqual(names, [second])                                    # one photo per person: the fixture's own photo went too

    def test_delete_stored_photo_removes_the_database_row_and_the_disk_file(self):
        name = f"testerasure-{uuid.uuid4().hex}.png"
        web_safety.save_upload(name, b"x")
        with open(os.path.join(main.UPLOAD_DIR, name), "wb") as handle:
            handle.write(b"x")
        web_safety.delete_stored_photo(f"/uploads/{name}", main.UPLOAD_DIR)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM uploaded_files WHERE name = %s", (name,)), [(0,)])
        self.assertFalse(os.path.exists(os.path.join(main.UPLOAD_DIR, name)))
        web_safety.delete_stored_photo("https://example.com/not-ours.png", main.UPLOAD_DIR)                  # an outside address is ignored


if __name__ == "__main__":
    unittest.main()

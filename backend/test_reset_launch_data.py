"""Testes do script de limpeza de lancamento (scripts/reset_launch_data.py):

    python -m unittest test_reset_launch_data -v

Trabalha numa COPIA temporaria da base local (CREATE DATABASE ... TEMPLATE), com
Firebase e Calendar falsos. A base local original nao e tocada.
"""
import csv
import io
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

import psycopg2

import database

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "scripts"))
import reset_launch_data as reset  # noqa: E402

COPY_NAME = "thundbalance_reset_test"
ADMIN = "boss@admin.test"
PASSWORD = os.getenv("DB_PASSWORD", "123456")
URL = f"postgresql://postgres:{PASSWORD}@localhost/{COPY_NAME}"


def admin_connection():
    conn = psycopg2.connect(host="localhost", database="postgres", user="postgres", password=PASSWORD)
    conn.autocommit = True
    return conn


class FakeFirebase:
    def __init__(self, emails):
        self.emails = emails           # uid -> email
        self.deleted = []

    def ready(self):
        return True, "ok"

    def existing(self, uids):
        return {uid: self.emails[uid] for uid in uids if uid in self.emails}

    def total_accounts(self):
        return len(self.emails)

    def delete(self, uids):
        self.deleted.extend(uids)
        return len(uids), 0


class FakeCalendar:
    own_email = "service@project.iam.gserviceaccount.com"

    def __init__(self, events):
        self.events = events
        self.deleted = []

    def target(self):
        return "...ce.com"

    def list_events(self):
        return self.events

    def delete(self, ids):
        self.deleted.extend(ids)
        return len(ids), 0


def run(*argv):
    out = io.StringIO()
    with redirect_stdout(out):
        code = reset.main(list(argv))
    return code, out.getvalue()


class ResetLaunchData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # CREATE DATABASE ... TEMPLATE needs the source database free: when the whole suite
        # runs, other tests may have left pooled connections open on it.
        database._drop_idle()
        conn = admin_connection()
        cur = conn.cursor()
        cur.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname IN ('thundbalance', %s) AND pid <> pg_backend_pid()", (COPY_NAME,))
        cur.execute(f"DROP DATABASE IF EXISTS {COPY_NAME}")
        cur.execute(f"CREATE DATABASE {COPY_NAME} TEMPLATE thundbalance")
        conn.close()
        cls._url = database.DATABASE_URL
        database.DATABASE_URL = URL
        os.environ["DATABASE_URL"] = URL
        os.environ.pop("ADMIN_EMAIL", None)
        cls.tmp = tempfile.mkdtemp(prefix="reset_test_")

    @classmethod
    def tearDownClass(cls):
        database.DATABASE_URL = cls._url
        os.environ.pop("DATABASE_URL", None)
        shutil.rmtree(cls.tmp, ignore_errors=True)
        conn = admin_connection()
        conn.cursor().execute(f"DROP DATABASE IF EXISTS {COPY_NAME}")
        conn.close()

    def setUp(self):
        self.original = (reset.make_firebase, reset.make_calendar)
        conn = database.get_connection()
        cur = conn.cursor()
        # known state: one admin, three clients with data in every table
        for table in ("sessions", "client_requests", "user_plans", "trial_sessions", "email_log", "admin_audit_log"):
            cur.execute(f"DELETE FROM {table}")
        cur.execute("DELETE FROM users")
        cur.execute("SELECT id FROM plans ORDER BY id LIMIT 1")
        plan_id = cur.fetchone()[0]
        cur.execute("SELECT id FROM trainers ORDER BY id LIMIT 1")
        trainer_id = cur.fetchone()[0]
        cur.execute("INSERT INTO users (firebase_uid, nome, email) VALUES ('uid-admin', 'Boss', %s) RETURNING id", (ADMIN,))
        cur.execute("INSERT INTO users (firebase_uid, nome, email) VALUES ('uid-a', 'Ana A', 'ana@x.test') RETURNING id")
        ana = cur.fetchone()[0]
        cur.execute("INSERT INTO users (firebase_uid, nome, email) VALUES ('uid-b', 'Bia B', 'BIA@x.test') RETURNING id")
        cur.execute("INSERT INTO users (nome, email) VALUES ('No Uid', NULL)")
        cur.execute("INSERT INTO user_plans (user_id, plan_id, active) VALUES (%s, %s, TRUE)", (ana, plan_id))
        cur.execute("INSERT INTO sessions (user_id, trainer_id, session_date, session_time, status) "
                    "VALUES (%s, %s, CURRENT_DATE + 3, '10:00', 'Booked')", (ana, trainer_id))
        cur.execute("INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status) "
                    "VALUES ('Ana A', 'ana@x.test', '600123456', 'g', 'Beginner', CURRENT_DATE + 5, '10:00', 'Pending')")
        cur.execute("INSERT INTO email_log (tipo, referencia, destinatario, estado) VALUES ('t', '1', 'ana@x.test', 'sent')")
        cur.execute("INSERT INTO admin_audit_log (admin_uid, action, client_id, outcome) VALUES ('uid-admin', 'archive', %s, 'ok')", (ana,))
        cur.execute("INSERT INTO admin_audit_log (admin_uid, action, client_id, outcome) VALUES ('uid-admin', 'settings', NULL, 'ok')")
        conn.commit()
        conn.close()
        self.firebase = FakeFirebase({"uid-admin": ADMIN, "uid-a": "ana@x.test", "uid-b": "bia@x.test", "uid-orphan": "o@x.test"})
        reset.make_firebase = lambda: self.firebase
        reset.make_calendar = lambda: self.calendar
        self.calendar = FakeCalendar([])
        self.backup = os.path.join(self.tmp, f"b{id(self)}")

    def tearDown(self):
        reset.make_firebase, reset.make_calendar = self.original

    def counts(self):
        conn = database.get_connection()
        cur = conn.cursor()
        result = {}
        for table in ("users", "sessions", "user_plans", "client_requests", "trial_sessions", "email_log",
                      "admin_audit_log", "trainers", "trainer_availability", "plans",
                      "landing_page_content", "training_videos", "app_settings"):
            cur.execute(f"SELECT COUNT(*) FROM {table}")
            result[table] = cur.fetchone()[0]
        conn.close()
        return result

    def execute(self, *extra):
        return run("--execute", "--confirm", "RESET THUNDBALANCE", "--db-name", COPY_NAME,
                   "--admin-email", ADMIN, "--backup-dir", self.backup, *extra)

    # ---------------------------------------------------------------- tests
    def test_simulation_writes_nothing_and_prints_no_personal_data(self):
        before = self.counts()
        code, text = run("--admin-email", ADMIN)
        self.assertEqual(code, 0)
        self.assertEqual(self.counts(), before)
        self.assertEqual(self.firebase.deleted, [])
        for private in ("ana@x.test", "bia@x.test", "Ana A", "uid-a"):
            self.assertNotIn(private, text)
        self.assertIn("SIMULACAO", text)
        self.assertNotIn(ADMIN, text)       # the admin e-mail is masked

    def test_without_an_admin_it_aborts(self):
        code, text = run()
        self.assertEqual(code, 1)
        self.assertIn("ADMIN_EMAIL", text)

    def test_conflicting_admin_sources_abort(self):
        os.environ["ADMIN_EMAIL"] = "other@admin.test"
        try:
            code, _ = run("--admin-email", ADMIN)
        finally:
            os.environ.pop("ADMIN_EMAIL")
        self.assertEqual(code, 1)

    def test_execute_needs_the_confirmation_text_and_the_database_name(self):
        before = self.counts()
        self.assertEqual(run("--execute", "--db-name", COPY_NAME, "--admin-email", ADMIN)[0], 1)
        self.assertEqual(run("--execute", "--confirm", "RESET THUNDBALANCE", "--db-name", "thundbalance",
                             "--admin-email", ADMIN)[0], 1)
        self.assertEqual(self.counts(), before)
        self.assertFalse(os.path.exists(self.backup))

    def test_execute_clears_clients_and_keeps_the_configuration(self):
        before = self.counts()
        self.calendar = FakeCalendar([
            {"id": "e1", "summary": "Ana A 1/12", "creator": {"email": FakeCalendar.own_email}},
            {"id": "e2", "summary": "Trial Session - Ana", "creator": {"email": FakeCalendar.own_email}},
            {"id": "e3", "summary": "Lunch", "extendedProperties": {"private": {"app": "thundbalance"}}},
            {"id": "e4", "summary": "Ana B 2/10", "creator": {"email": "person@x.test"}},
            {"id": "e5", "summary": "Dentist", "creator": {"email": FakeCalendar.own_email}},
        ])
        code, text = self.execute("--purge-calendar")
        self.assertEqual(code, 0, text)
        after = self.counts()
        for table in ("sessions", "user_plans", "client_requests", "trial_sessions", "email_log"):
            self.assertEqual(after[table], 0, table)
        self.assertEqual(after["users"], 1)                       # only the admin
        self.assertEqual(after["admin_audit_log"], 1)             # the one not tied to a client
        for table in ("trainers", "trainer_availability", "plans", "landing_page_content", "training_videos", "app_settings"):
            self.assertEqual(after[table], before[table], table)
        self.assertEqual(sorted(self.firebase.deleted), ["uid-a", "uid-b"])   # not the admin, not the orphan
        self.assertEqual(sorted(self.calendar.deleted), ["e1", "e2", "e3"])   # not people's events
        for private in ("ana@x.test", "Ana A"):
            self.assertNotIn(private, text)
        self.assertIn("OK:", text)

    def test_backup_files_exist_and_match(self):
        code, _ = self.execute()
        self.assertEqual(code, 0)
        with open(os.path.join(self.backup, "users.csv"), encoding="utf-8", newline="") as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual(len(rows), 3)                            # the three non-admin rows
        self.assertNotIn(ADMIN, [row["email"] for row in rows])
        for name in ("sessions.csv", "user_plans.csv", "trial_sessions.csv", "email_log.csv", "admin_audit_log.csv"):
            self.assertTrue(os.path.getsize(os.path.join(self.backup, name)) > 0, name)

    def test_ids_restart_after_the_reset(self):
        self.assertEqual(self.execute()[0], 0)
        conn = database.get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status) "
                    "VALUES ('N', 'n@x.test', '600123456', 'g', 'Beginner', CURRENT_DATE + 5, '10:00', 'Pending') RETURNING id")
        self.assertEqual(cur.fetchone()[0], 1)
        conn.rollback()
        conn.close()

    def test_a_failed_backup_deletes_nothing(self):
        before = self.counts()
        original = reset.write_backup

        def broken(*args, **kwargs):
            raise reset.Abort("backup failed")

        reset.write_backup = broken
        try:
            code, _ = self.execute()
        finally:
            reset.write_backup = original
        self.assertEqual(code, 1)
        self.assertEqual(self.counts(), before)
        self.assertEqual(self.firebase.deleted, [])

    def test_a_backup_folder_inside_the_repository_is_refused(self):
        before = self.counts()
        inside = os.path.join(reset.REPO, "backups_should_not_exist")
        code, _ = run("--execute", "--confirm", "RESET THUNDBALANCE", "--db-name", COPY_NAME,
                      "--admin-email", ADMIN, "--backup-dir", inside)
        self.assertEqual(code, 1)
        self.assertEqual(self.counts(), before)
        self.assertFalse(os.path.exists(inside))

    def test_event_classification(self):
        own = FakeCalendar.own_email
        kind = reset.classify_event
        self.assertEqual(kind({"summary": "x", "extendedProperties": {"private": {"app": "thundbalance"}}}, own), "tagged")
        self.assertEqual(kind({"summary": "Ana Silva 3/12", "creator": {"email": own}}, own), "legacy")
        self.assertEqual(kind({"summary": "Trial Session - Ana", "creator": {"email": own}}, own), "legacy")
        self.assertEqual(kind({"summary": "[Pendiente] Trial Session · Ana", "creator": {"email": own}}, own), "legacy")
        self.assertIsNone(kind({"summary": "Ana Silva 3/12", "creator": {"email": "p@x.test"}}, own))
        self.assertIsNone(kind({"summary": "Meeting", "creator": {"email": own}}, own))


if __name__ == "__main__":
    unittest.main()

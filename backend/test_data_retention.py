"""Retention of old personal data: python -m unittest test_data_retention -v

OFF by default: nothing is deleted until RETENTION_ENABLED=true. When it is on, only what has passed its time goes.
"""
import logging
import os
import unittest
from unittest import mock

import contact_messages
import data_retention
import main
import testsafety
import web_safety
from database import get_connection

DOMAIN = "@test-retention.example"
ON = {"RETENTION_ENABLED": "true", "RETENTION_CONTACT_DAYS": "365", "RETENTION_TRIAL_DAYS": "365", "RETENTION_EMAIL_LOG_DAYS": "180"}


class Capture(logging.Handler):
    def __init__(self):
        super().__init__()
        self.lines = []

    def emit(self, record):
        self.lines.append(record.getMessage())


class Retention(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        testsafety.require_local_database()
        main.ensure_trial_session_fields()
        main.ensure_email_log_table()
        main.ensure_client_lifecycle_columns()
        contact_messages.ensure_contact_table()
        web_safety.ensure_rate_limit_table()

    def setUp(self):
        self.cleanup()
        for name in list(ON) + ["RETENTION_JOB"]:
            os.environ.pop(name, None)
        self.make_rows()

    def tearDown(self):
        for name in list(ON) + ["RETENTION_JOB"]:
            os.environ.pop(name, None)
        self.cleanup()

    @staticmethod
    def cleanup():
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM contact_messages WHERE email LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM email_log WHERE destinatario LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM rate_limit_hits WHERE bucket = 'test-retention'")
        conn.commit()
        conn.close()

    def sql(self, query, args=()):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(query, args)
        rows = cur.fetchall() if cur.description else []
        conn.commit()
        conn.close()
        return rows

    def make_rows(self):
        conn = get_connection()
        cur = conn.cursor()
        for label, days in (("old", 400), ("recent", 10)):
            cur.execute("INSERT INTO contact_messages (name, email, message, created_at) VALUES (%s, %s, 'hi', NOW() - make_interval(days => %s))",
                        (f"Name {label}", f"contact-{label}{DOMAIN}", days))
            cur.execute("INSERT INTO email_log (tipo, referencia, destinatario, estado, criado_em) VALUES ('welcome', '1', %s, 'sent', NOW() - make_interval(days => %s))",
                        (f"log-{label}{DOMAIN}", 200 if label == "old" else 20))
        cur.execute("INSERT INTO email_log (tipo, referencia, destinatario, estado, criado_em) VALUES ('welcome', '1', %s, 'sent', NOW() - make_interval(days => 170))", (f"log-between{DOMAIN}",))
        # trial requests: status, age, and a client record that makes the owner an active (or archived) client
        trials = (("declined-old", "Declined", 400), ("cancelled-old", "Cancelled", 400), ("rejected-old", "Rejected", 400), ("pending-old", "Pending", 400),
                  ("approved-old", "Approved", 400), ("confirmed-old", "Confirmed", 400), ("declined-recent", "Declined", 30),
                  ("declined-active", "Declined", 400), ("declined-archived", "Declined", 400))
        for label, status, days in trials:
            cur.execute(
                "INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status, created_at) "
                "VALUES (%s, %s, '600', 'g', 'e', CURRENT_DATE, '10:00', %s, NOW() - make_interval(days => %s))", (f"Trial {label}", f"trial-{label}{DOMAIN}", status, days))
        cur.execute("INSERT INTO users (nome, email) VALUES ('Active Client', %s)", (f"trial-declined-active{DOMAIN}",))
        cur.execute("INSERT INTO users (nome, email, archived_at) VALUES ('Archived Client', %s, NOW())", (f"trial-declined-archived{DOMAIN}",))
        cur.execute("INSERT INTO rate_limit_hits (bucket, key, hit_at) VALUES ('test-retention', 'old-ip', NOW() - INTERVAL '3 days')")
        cur.execute("INSERT INTO rate_limit_hits (bucket, key, hit_at) VALUES ('test-retention', 'new-ip', NOW())")
        conn.commit()
        conn.close()

    def contacts(self):
        return {r[0] for r in self.sql("SELECT split_part(email, '@', 1) FROM contact_messages WHERE email LIKE %s", (f"%{DOMAIN}",))}

    def trials(self):
        return {r[0] for r in self.sql("SELECT split_part(email, '@', 1) FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))}

    def logs(self):
        return {r[0] for r in self.sql("SELECT split_part(destinatario, '@', 1) FROM email_log WHERE destinatario LIKE %s", (f"%{DOMAIN}",))}

    # ----------------------------------------------------------------------------------------------- off by default
    def test_retention_is_off_by_default_and_deletes_nothing(self):
        self.assertFalse(data_retention.enabled())
        self.assertEqual(data_retention.run_retention(), {"enabled": False})
        data_retention.run_daily()                                                         # the whole daily job, still with retention off
        self.assertEqual(self.contacts(), {"contact-old", "contact-recent"})
        self.assertEqual(len(self.trials()), 9)
        self.assertEqual(self.logs(), {"log-old", "log-recent", "log-between"})

    def test_only_a_clear_yes_turns_it_on(self):
        for value in ("", "false", "0", "no", "off", "maybe", "TRUE ", " yes", "1", "on"):
            with mock.patch.dict(os.environ, {"RETENTION_ENABLED": value}):
                self.assertEqual(data_retention.enabled(), value.strip().lower() in ("true", "1", "yes", "on"), value)

    def test_the_periods_have_defaults_and_a_bad_value_does_not_break_them(self):
        config = data_retention.settings()
        self.assertEqual((config["contact_days"], config["trial_days"], config["email_log_days"]), (365, 365, 180))
        with mock.patch.dict(os.environ, {"RETENTION_CONTACT_DAYS": "abc", "RETENTION_TRIAL_DAYS": "-5", "RETENTION_EMAIL_LOG_DAYS": "30"}):
            config = data_retention.settings()
            self.assertEqual((config["contact_days"], config["trial_days"], config["email_log_days"]), (365, 1, 30))

    # ----------------------------------------------------------------------------------------------- on: only what passed its time
    def test_when_it_is_on_only_what_passed_its_time_goes(self):
        with mock.patch.dict(os.environ, ON):
            counts = data_retention.run_retention()
        self.assertEqual(counts, {"enabled": True, "contact_messages": 1, "trial_sessions": 5, "email_log": 1})
        self.assertEqual(self.contacts(), {"contact-recent"})
        self.assertEqual(self.logs(), {"log-recent", "log-between"})                       # 200 days old went, 170 stays (the limit is 180)
        # declined, cancelled, rejected and never-answered requests past their time went (and the archived client's); everything else stays
        self.assertEqual(self.trials(), {"trial-approved-old", "trial-confirmed-old", "trial-declined-recent", "trial-declined-active"})

    def test_an_open_request_and_an_active_client_are_never_touched_however_old(self):
        with mock.patch.dict(os.environ, {**ON, "RETENTION_TRIAL_DAYS": "1"}):
            data_retention.run_retention()
        remaining = self.trials()
        for kept in ("trial-approved-old", "trial-confirmed-old", "trial-declined-active"):
            self.assertIn(kept, remaining)

    def test_the_periods_come_from_the_environment(self):
        with mock.patch.dict(os.environ, {**ON, "RETENTION_CONTACT_DAYS": "5", "RETENTION_EMAIL_LOG_DAYS": "10"}):
            counts = data_retention.run_retention()
        self.assertEqual(self.contacts(), set())                                           # the 10-day-old one passed 5 days too
        self.assertEqual(self.logs(), set())
        self.assertEqual(counts["contact_messages"], 2)

    def test_other_tables_and_other_peoples_rows_are_not_touched(self):
        users_before = self.sql("SELECT COUNT(*) FROM users")
        sessions_before = self.sql("SELECT COUNT(*) FROM sessions")
        with mock.patch.dict(os.environ, ON):
            data_retention.run_retention()
        self.assertEqual(self.sql("SELECT COUNT(*) FROM users"), users_before)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM sessions"), sessions_before)

    # ----------------------------------------------------------------------------------------------- the daily job
    def test_the_daily_job_logs_only_counts(self):
        capture = Capture()
        logging.getLogger("thundbalance.retention").addHandler(capture)
        logging.getLogger("thundbalance.retention").setLevel(logging.INFO)
        try:
            with mock.patch.dict(os.environ, ON):
                data_retention.run_safely()
        finally:
            logging.getLogger("thundbalance.retention").removeHandler(capture)
        text = " ".join(capture.lines)
        self.assertIn("retention=on", text)
        self.assertIn("contact_messages=1", text)
        for private in (DOMAIN, "contact-old", "Name old", "Trial declined", "old-ip"):
            self.assertNotIn(private, text)

    def test_the_rate_limit_addresses_are_removed_after_a_day_even_with_retention_off(self):
        self.assertEqual(self.sql("SELECT COUNT(*) FROM rate_limit_hits WHERE bucket = 'test-retention'"), [(2,)])
        data_retention.run_daily()
        self.assertEqual(self.sql("SELECT key FROM rate_limit_hits WHERE bucket = 'test-retention'"), [("new-ip",)])

    def test_a_failure_of_the_job_never_raises_and_logs_only_the_type(self):
        capture = Capture()
        logging.getLogger("thundbalance.retention").addHandler(capture)
        try:
            with mock.patch.object(data_retention, "run_daily", side_effect=RuntimeError("Failing row contains (ana@x.com)")):
                self.assertIsNone(data_retention.run_safely())
        finally:
            logging.getLogger("thundbalance.retention").removeHandler(capture)
        self.assertEqual(capture.lines, ["op=run_daily error=RuntimeError"])

    def test_the_job_can_be_switched_off_and_does_not_start_twice(self):
        with mock.patch.dict(os.environ, {"RETENTION_JOB": "off"}):
            self.assertFalse(data_retention.job_enabled())
            before = data_retention._started
            data_retention.start_background()
            self.assertEqual(data_retention._started, before)                              # nothing started
        self.assertTrue(data_retention.job_enabled())


if __name__ == "__main__":
    unittest.main()

"""Titles of the events a client receives, and the .ics files built from them:

    python -m unittest test_calendar_titles -v

No database needed for the title/ics tests; the last group uses the local database
(trial session lifecycle) with the Google calendar faked.
"""
import re
import unittest
from datetime import date, datetime, time

import calendar_feed
import calendar_titles as titles
from emails.ics import build_ics
from emails.pack_emails import build_pack_ics
from emails.trial_emails import client_trial_cancelled, client_trial_confirmed
from event_format import session_title, trial_title


def unfold(ics):
    return ics.replace("\r\n ", "")


class Titles(unittest.TestCase):
    def test_pack_session_title_has_trainer_and_position(self):
        self.assertEqual(titles.client_session_title("Matilda", "1/12"), "ThundBalance · Sesión con Matilda 1/12")

    def test_only_the_trainer_first_name_is_used(self):
        self.assertEqual(titles.client_session_title("Matilda Ruiz Pérez", "3/8"), "ThundBalance · Sesión con Matilda 3/8")

    def test_missing_parts_are_left_out(self):
        self.assertEqual(titles.client_session_title("Matilda"), "ThundBalance · Sesión con Matilda")
        self.assertEqual(titles.client_session_title(None, "2/4"), "ThundBalance · Sesión 2/4")
        self.assertEqual(titles.client_session_title("", ""), "ThundBalance · Sesión")

    def test_trial_title(self):
        self.assertEqual(titles.client_trial_title("Matilda"), "ThundBalance · Trial Session con Matilda")
        self.assertEqual(titles.client_trial_title(None), "ThundBalance · Trial Session")

    def test_the_number_is_the_same_as_the_studio_event(self):
        # the studio calendar writes "Ana Ruiz 1/12" from the same stored number
        self.assertEqual(session_title("Ana María Ruiz", "1/12"), "Ana Ruiz 1/12")
        self.assertTrue(titles.client_session_title("Matilda", "1/12").endswith(" 1/12"))

    def test_studio_trial_title_for_a_single_name_and_a_full_name(self):
        self.assertEqual(trial_title("Ana María Ruiz"), "Trial Session - Ana Ruiz")
        self.assertEqual(trial_title("Ana"), "Trial Session - Ana")

    def test_the_number_does_not_change_when_another_session_is_cancelled(self):
        # numbers are stored once ("2/12"): the title is a pure function of them
        before = titles.client_session_title("Matilda", "2/12")
        self.assertEqual(titles.client_session_title("Matilda", "2/12"), before)

    def test_sequence_includes_the_title_version(self):
        self.assertEqual(titles.session_sequence(0), titles.TITLE_VERSION)
        self.assertEqual(titles.session_sequence(2), 2 + titles.TITLE_VERSION)
        self.assertGreater(titles.session_sequence(0), 0)      # above what was published with the old title


class IcsFiles(unittest.TestCase):
    def pack_summary(self):
        return {"sessions": [
            {"id": 11, "start": datetime(2026, 10, 14, 10, 0), "trainer": "Matilda", "number": "1/12"},
            {"id": 12, "start": datetime(2026, 12, 16, 10, 0), "trainer": "Matilda", "number": "2/12"},
        ]}

    def test_pack_ics_title_uid_sequence_and_timezone(self):
        ics = unfold(build_pack_ics(self.pack_summary()))
        self.assertIn("SUMMARY:ThundBalance · Sesión con Matilda 1/12", ics)
        self.assertIn("SUMMARY:ThundBalance · Sesión con Matilda 2/12", ics)
        self.assertIn("UID:session-11@thundbalance.com", ics)
        self.assertIn(f"SEQUENCE:{titles.TITLE_VERSION}", ics)
        # Europe/Madrid: 14 Oct 10:00 is summer time (UTC+2), 16 Dec 10:00 winter time (UTC+1)
        self.assertIn("DTSTART:20261014T080000Z", ics)
        self.assertIn("DTSTART:20261216T090000Z", ics)

    def test_the_email_and_the_feed_publish_the_same_title_and_sequence(self):
        email_ics = unfold(build_pack_ics({"sessions": [
            {"id": 7, "start": datetime(2026, 11, 3, 10, 0), "trainer": "Carles", "number": "1/12"}]}))

        class Cursor:
            def execute(self, sql, params=None):
                self.sql = sql

            def fetchone(self):
                return None

            def fetchall(self):
                return [(7, date(2026, 11, 3), time(10, 0), "Booked", 0, "Carles", "1/12")] if "FROM sessions" in self.sql else []

        feed = unfold(calendar_feed.build_feed(Cursor(), 1, today=date(2026, 10, 20)))
        for expected in ("SUMMARY:ThundBalance · Sesión con Carles 1/12", "UID:session-7@thundbalance.com",
                         f"SEQUENCE:{titles.TITLE_VERSION}", "DTSTART:20261103T090000Z"):
            self.assertIn(expected, email_ics)
            self.assertIn(expected, feed)

    def test_trial_confirmation_ics(self):
        _, _, _, ics = client_trial_confirmed("Ana", datetime(2026, 10, 14, 10, 0), "Matilda", 42, "es")
        ics = unfold(ics)
        self.assertIn("SUMMARY:ThundBalance · Trial Session con Matilda", ics)
        self.assertIn("UID:trial-42@thundbalance.com", ics)
        self.assertIn("SEQUENCE:0", ics)
        self.assertIn("STATUS:CONFIRMED", ics)
        self.assertIn("DTSTART:20261014T080000Z", ics)       # 10:00 Madrid (summer) = 08:00Z
        self.assertIn("DTEND:20261014T090000Z", ics)

    def test_trial_cancellation_ics_cancels_the_same_uid_with_a_higher_sequence(self):
        _, _, _, ics = client_trial_cancelled("Ana", datetime(2026, 10, 14, 10, 0), "es", trial_id=42,
                                              trainer="Matilda", sequence=1)
        ics = unfold(ics)
        self.assertIn("METHOD:CANCEL", ics)
        self.assertIn("UID:trial-42@thundbalance.com", ics)
        self.assertIn("STATUS:CANCELLED\r\nSEQUENCE:1", ics)
        self.assertGreater(1, 0)
        # without a trial id (it was never confirmed) there is no calendar file
        self.assertIsNone(client_trial_cancelled("Ana", datetime(2026, 10, 14, 10, 0), "es")[3])

    def test_sequence_only_goes_up(self):
        old = unfold(build_ics([{"id": "x", "start": datetime(2026, 11, 3, 10), "summary": "a", "sequence": 0}]))
        new = unfold(build_ics([{"id": "x", "start": datetime(2026, 11, 3, 10), "summary": "b",
                                 "sequence": titles.session_sequence(0)}]))
        self.assertLess(int(re.search(r"SEQUENCE:(\d+)", old).group(1)), int(re.search(r"SEQUENCE:(\d+)", new).group(1)))


class TrialInTheFeed(unittest.TestCase):
    """The confirmed trial is part of the client's subscription feed; others are not."""

    def feed(self, trials, email="ana@example.com"):
        class Cursor:
            def execute(self, sql, params=None):
                self.sql = " ".join(sql.split())

            def fetchone(self):
                return (email,) if email is not None and "FROM users" in self.sql else None

            def fetchall(self):
                return trials if "FROM trial_sessions" in self.sql else []

        return unfold(calendar_feed.build_feed(Cursor(), 1, today=date(2026, 10, 20)))

    def row(self, status, sequence=0, confirmed=True, legacy=False):
        # id, date, time, status, feed_sequence, trainer, confirmed_at set, token is null
        return (42, date(2026, 11, 3), time(10, 0), status, sequence, "Matilda Ruiz", confirmed, legacy)

    def test_a_confirmed_trial_is_in_the_feed_with_the_email_uid(self):
        feed = self.feed([self.row("Confirmed")])
        self.assertIn("UID:trial-42@thundbalance.com", feed)
        self.assertIn("SUMMARY:ThundBalance · Trial Session con Matilda", feed)
        self.assertIn("STATUS:CONFIRMED\r\nSEQUENCE:0", feed)

    def test_a_trial_that_was_not_confirmed_is_not_in_the_feed(self):
        for status, confirmed in (("Pending", False), ("Approved", False), ("Rejected", False), ("Declined", False)):
            self.assertNotIn("trial-42", self.feed([self.row(status, confirmed=confirmed)]), status)

    def test_a_trial_declined_or_cancelled_after_confirming_is_marked_cancelled(self):
        for status in ("Declined", "Cancelled"):
            feed = self.feed([self.row(status, sequence=1, confirmed=True)])
            self.assertIn("UID:trial-42@thundbalance.com", feed)
            self.assertIn("STATUS:CANCELLED\r\nSEQUENCE:1", feed)

    def test_a_trial_approved_before_the_confirmation_flow_counts_as_confirmed(self):
        self.assertIn("UID:trial-42@thundbalance.com", self.feed([self.row("Approved", confirmed=False, legacy=True)]))

    def test_no_account_email_means_no_trial_events(self):
        self.assertNotIn("trial-42", self.feed([self.row("Confirmed")], email=None))


if __name__ == "__main__":
    unittest.main()

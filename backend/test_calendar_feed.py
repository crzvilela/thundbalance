"""Tests for the subscribable calendar feed and the calendar blocks of the pack email:

    python -m unittest test_calendar_feed -v

No database needed: the feed builder is fed through a fake cursor.
"""
import re
import os
import unittest
from datetime import date, time

from emails import build_pack_email
import calendar_feed

os.environ["CLIENT_CALENDAR_ENABLED"] = "true"      # these tests look at the calendar parts of the emails


class FakeCursor:
    """Answers each query of the feed by what it asks for."""

    def __init__(self, sessions=(), trials=(), email="ana@example.com"):
        self.sessions, self.trials, self.email = list(sessions), list(trials), email
        self.params = None
        self._last = ""

    def execute(self, sql, params=None):
        self._last = " ".join(sql.split())
        if "FROM sessions" in self._last:
            self.params = params

    def fetchone(self):
        return (self.email,) if "FROM users" in self._last else None

    def fetchall(self):
        if "FROM sessions" in self._last:
            return self.sessions
        if "FROM trial_sessions" in self._last:
            return self.trials
        return []


class CalendarFeedTests(unittest.TestCase):
    def feed(self):
        rows = [
            (7, date(2026, 11, 3), time(10, 0), "Booked", 0, "Carles Puig", "1/12"),
            (8, date(2026, 11, 5), time(10, 0), "Cancelled", 2, "Carles Puig", "2/12"),
        ]
        return calendar_feed.build_feed(FakeCursor(rows), 1, today=date(2026, 10, 20))

    def test_feed_has_stable_uids_sequence_and_cancelled_status(self):
        feed = self.feed()
        self.assertIn("UID:session-7@thundbalance.com", feed)
        self.assertIn("UID:session-8@thundbalance.com", feed)
        # the SEQUENCE is the session's own counter plus the title version
        self.assertIn("STATUS:CANCELLED\r\nSEQUENCE:3", feed)
        self.assertIn("STATUS:CONFIRMED\r\nSEQUENCE:1", feed)
        self.assertNotIn("METHOD:", feed)
        self.assertIn("X-WR-CALNAME:ThundBalance", feed)

    def test_feed_times_are_utc_of_madrid_wall_clock(self):
        # 3 Nov 2026 is winter time (UTC+1): 10:00 Madrid = 09:00Z
        self.assertIn("DTSTART:20261103T090000Z", self.feed())
        self.assertIn("DTEND:20261103T100000Z", self.feed())

    def test_feed_is_minimal(self):
        feed = self.feed()
        self.assertIn("SUMMARY:ThundBalance · Sesión con Carles 1/12", feed)
        self.assertIn("SUMMARY:ThundBalance · Sesión con Carles 2/12", feed)
        self.assertNotIn("Puig", feed)
        self.assertNotIn("@gmail", feed)
        self.assertIn(r"LOCATION:ThundBalance\, Carrer de Pallars 286\, Barcelona", feed)

    def test_window_starts_30_days_back(self):
        cursor = FakeCursor()
        calendar_feed.build_feed(cursor, 1, today=date(2026, 10, 20))
        self.assertEqual(cursor.params[1], date(2026, 9, 20))

    def test_urls(self):
        links = calendar_feed.feed_urls("abc_DEF-123", base_url="https://api.example.com/")
        self.assertEqual(links["https"], "https://api.example.com/calendar/feed/abc_DEF-123.ics")
        self.assertEqual(links["webcal"], "webcal://api.example.com/calendar/feed/abc_DEF-123.ics")
        self.assertEqual(
            links["google"],
            "https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fapi.example.com%2Fcalendar%2Ffeed%2Fabc_DEF-123.ics",
        )

    def test_token_is_random_and_url_safe(self):
        tokens = {calendar_feed._new_token() for _ in range(50)}
        self.assertEqual(len(tokens), 50)
        for token in tokens:
            self.assertRegex(token, r"^[A-Za-z0-9_-]{43}$")
            self.assertTrue(calendar_feed._TOKEN.match(token))

    def test_pack_email_carries_calendar_buttons_in_one_language(self):
        links = calendar_feed.feed_urls("t" * 43, base_url="https://api.example.com")
        from datetime import datetime
        summary = {
            "client_name": "David", "client_email": "d@example.com", "plan_name": "Plan", "sessions_per_week": 2,
            "days": ["Monday"], "trainer": "Carles", "calendar_links": links,
            "sessions": [{"id": 1, "start": datetime(2026, 11, 3, 10), "trainer": "Carles", "number": "1/1"}],
        }
        wanted = {
            "en": ("Add to my Google Calendar", "Download .ics", "Open the attached file to add the sessions to your calendar.", "up to 24 hours"),
            "es": ("Añadir a mi Google Calendar", "Descargar .ics", "Abre el archivo adjunto para añadir las sesiones a tu calendario.", "hasta 24 horas"),
            "ca": ("Afegir al meu Google Calendar", "Descarregar .ics", "Obre el fitxer adjunt per afegir les sessions al teu calendari.", "fins a 24 hores"),
        }
        for lang, labels in wanted.items():
            _, html, text = build_pack_email(summary, lang=lang)
            for label in labels:
                self.assertIn(label, html)
            for other, other_labels in wanted.items():
                if other != lang:
                    for label in other_labels:
                        self.assertNotIn(label, html)
            self.assertEqual(len(re.findall(r"calendar\.google\.com/calendar/r\?cid=", html)), 1)
        # the studio copy never carries the client's private link
        _, team_html, _ = build_pack_email(summary, team_subject=True)
        self.assertNotIn("/calendar/feed/", team_html)


if __name__ == "__main__":
    unittest.main()

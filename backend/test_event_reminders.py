"""No event we write has reminders (docs/CALENDAR_REMINDERS.md): created, updated and patched events all say so.

    python -m unittest test_event_reminders -v

No network: a fake Google service records the calls.
"""
import unittest
from unittest import mock

import calendar_sync
import event_format
import google_calendar as gc
from test_calendar_guests import FakeService

OFF = {"useDefault": False, "overrides": []}


def session_body():
    return event_format.build_session_event(client_name="Ana Ruiz", session_date="2026-11-16", session_time="10:00", trainer_name="Carles",
                                            session_number="1/8", session_id=7)


def trial_body(pending):
    return event_format.build_trial_event(full_name="Ana Ruiz", session_date="2026-11-16", session_time="10:00", trainer_name="Carles",
                                          trial_id=3, pending=pending)


class Reminders(unittest.TestCase):
    def google(self):
        service = FakeService()
        patches = [mock.patch.object(gc, "get_calendar_service", return_value=service), mock.patch.object(gc, "get_calendar_id", return_value="cal"),
                   mock.patch.object(gc, "delegation_active", return_value=True)]
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)
        return service

    def test_the_bodies_of_packs_and_trials_carry_no_reminders(self):
        for body in (session_body(), trial_body(True), trial_body(False)):
            self.assertEqual(body["reminders"], OFF)

    def test_a_created_event_is_sent_with_no_reminders(self):
        service = self.google()
        for body, event_id in ((session_body(), "tbpack0001"), (trial_body(True), "tbtrial001")):
            gc._insert(service, body, event_id)
        for call in service.events().log:
            self.assertEqual(call[0], "insert")
            self.assertEqual(call[1]["body"]["reminders"], OFF)

    def test_every_patch_sends_empty_reminders_so_old_ones_are_lost(self):
        service = self.google()
        body = session_body()
        gc.patch_calendar_event("tbpack0001", {key: body[key] for key in calendar_sync.EVENT_FIELDS})        # what "Sincronizar" / a moved session sends
        gc.update_calendar_event("tbpack0001", "2026-11-17", "11:00")                                         # a bare move
        gc.update_calendar_event("tbpack0001", "2026-11-17", "11:00", client_name="Ana Ruiz", trainer_name="Carles", session_number="1/8")
        gc.update_trial_session_event("tbtrial001", "Ana Ruiz", None, None, None, None, "2026-11-16", "10:00", trainer_name="Carles", trial_id=3, pending=False)
        calls = service.events().log
        self.assertEqual([call[0] for call in calls], ["patch"] * 4)
        for call in calls:
            self.assertEqual(call[1]["body"]["reminders"], OFF, call)

    def test_nothing_else_of_the_event_changes(self):
        body = session_body()
        without = {key: value for key, value in body.items() if key != "reminders"}
        self.assertEqual(set(without), {"summary", "location", "description", "colorId", "start", "end", "extendedProperties"})

    def test_sincronizar_updates_an_event_that_still_has_reminders(self):
        body = session_body()
        existing = {"summary": body["summary"], "description": body["description"], "start": body["start"], "end": body["end"]}
        self.assertTrue(event_format.differs({**existing, "reminders": {"useDefault": True}}, body))      # the calendar's defaults: 10 min mail, 30 min popup
        self.assertTrue(event_format.differs({**existing, "reminders": {"useDefault": False, "overrides": [{"method": "popup", "minutes": 30}]}}, body))
        self.assertFalse(event_format.differs({**existing, "reminders": {"useDefault": False}}, body))     # what Google returns once they are gone


if __name__ == "__main__":
    unittest.main()

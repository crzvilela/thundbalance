"""Fake Google Calendar for the tests (no real call is ever made).

The app talks to Google only through google_calendar.create_calendar_event_status /
patch_calendar_event / delete_calendar_event (calendar_sync's central rule calls them).
`FakeGoogle` replaces them with a recorder that behaves like Google: creating an event that
already exists answers "already there", patching or deleting one that does not exist raises
a 404, and any call can be made to fail.

`delegate_to_packs()` is for the older tests that fake Google by assigning
packs.create_calendar_event / packs.delete_calendar_event: the real functions are replaced by
ones that call whatever those two names are at that moment.
"""
import google_calendar as gc


class FakeHttpError(Exception):
    """What googleapiclient raises: an object with resp.status."""

    def __init__(self, status):
        super().__init__(f"HTTP {status}")
        self.resp = type("Resp", (), {"status": status})()


class FakeGoogle:
    def __init__(self):
        self.events = {}          # event_id -> {"summary", "description", "start", "end", ...}
        self.calls = []           # [("create" | "patch" | "delete", event_id)]
        self.fail = False         # True: every call raises (a Google outage)
        self.fail_for = set()     # event ids whose calls fail
        self._saved = None

    # ----- what the app calls
    def _check(self, event_id):
        if self.fail or event_id in self.fail_for:
            raise RuntimeError("google down")

    def create(self, trainer, client_name, client_email, date, time, number=None, event_id=None, session_id=None,
               client_phone=None, pack_name=None, session_type=None, second_person_name=None):
        import event_format
        self.calls.append(("create", event_id))
        self._check(event_id)
        body = event_format.build_session_event(
            client_name=client_name, client_email=client_email, client_phone=client_phone, session_date=date,
            session_time=time, trainer_name=trainer, pack_name=pack_name, session_number=number, session_id=session_id,
            session_type=session_type, second_person_name=second_person_name)
        if event_id in self.events:
            return event_id, False                       # a 409: already there
        self.events[event_id] = body
        return event_id, True

    def patch(self, event_id, body):
        self.calls.append(("patch", event_id))
        self._check(event_id)
        if event_id not in self.events:
            raise FakeHttpError(404)
        self.events[event_id].update(body)

    def delete(self, event_id):
        self.calls.append(("delete", event_id))
        self._check(event_id)
        if event_id not in self.events:
            raise FakeHttpError(404)
        del self.events[event_id]

    def create_trial(self, full_name, email, phone, goal, experience, session_date, session_time, trainer_name=None,
                     event_id=None, trial_id=None, session_type=None, second_person_name=None, pending=False):
        """google_calendar.create_trial_session_event: the real event body, the same "already there" rule."""
        import event_format
        self.calls.append(("create", event_id))
        self._check(event_id)
        if event_id not in self.events:
            self.events[event_id] = event_format.build_trial_event(
                full_name=full_name, email=email, phone=phone, session_date=session_date, session_time=session_time,
                trainer_name=trainer_name, goal=goal, experience=experience, trial_id=trial_id,
                session_type=session_type, second_person_name=second_person_name, pending=pending)
        return event_id

    def list_events(self, time_min, time_max):
        if self.fail:
            raise RuntimeError("google down")
        return [{"id": event_id, "status": "confirmed", **body} for event_id, body in self.events.items()]

    def get(self, event_id):
        self._check(event_id)
        if event_id not in self.events:
            raise FakeHttpError(404)
        return {"id": event_id, "status": "confirmed", **self.events[event_id]}

    # ----- installing it
    def install(self):
        import trial_confirmation
        self._saved = (gc.create_calendar_event_status, gc.patch_calendar_event, gc.delete_calendar_event,
                       gc.list_calendar_events, gc.get_calendar_event)
        # trial_confirmation imported these two by name; its update goes through gc.patch_calendar_event (faked above)
        self._saved_trials = (trial_confirmation.create_trial_session_event, trial_confirmation.delete_calendar_event)
        trial_confirmation.create_trial_session_event = self.create_trial
        trial_confirmation.delete_calendar_event = self.delete
        gc.create_calendar_event_status = self.create
        gc.patch_calendar_event = self.patch
        gc.delete_calendar_event = self.delete
        gc.list_calendar_events = self.list_events
        gc.get_calendar_event = self.get
        return self

    def uninstall(self):
        if self._saved:
            (gc.create_calendar_event_status, gc.patch_calendar_event, gc.delete_calendar_event,
             gc.list_calendar_events, gc.get_calendar_event) = self._saved
            self._saved = None
        if getattr(self, "_saved_trials", None):
            import trial_confirmation
            trial_confirmation.create_trial_session_event, trial_confirmation.delete_calendar_event = self._saved_trials
            self._saved_trials = None

    def count(self, kind):
        return sum(1 for item in self.calls if item[0] == kind)


def delegate_to_packs():
    """Returns restore(). See the module docstring."""
    import packs
    saved = (gc.create_calendar_event_status, gc.patch_calendar_event, gc.delete_calendar_event)
    gc.create_calendar_event_status = lambda *a, **k: (packs.create_calendar_event(*a, **k), True)
    gc.patch_calendar_event = lambda event_id, body: None
    gc.delete_calendar_event = lambda event_id: packs.delete_calendar_event(event_id)

    def restore():
        gc.create_calendar_event_status, gc.patch_calendar_event, gc.delete_calendar_event = saved

    return restore

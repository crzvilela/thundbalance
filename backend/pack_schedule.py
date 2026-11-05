"""The weekly schedule of a pack: ONE ENTRY PER TRAINING DAY, each with its own hour and its own trainer.

    [{"weekday": "Monday", "time": "18:00", "trainer_id": 3}, {"weekday": "Wednesday", "time": "09:00", "trainer_id": 1}]

Every flow that chooses or stores the schedule of a pack (the client's request, the admin's "Nuevo pack", a client created
with a pack, the approval of a request) uses this module: there is no single hour for the whole pack any more. The number of
entries is the pack's sessions per week, the weekdays are all different and each hour is a whole hour the trainer works.

Free hours: the same rules as the rest of the app (availability.py): the trainer is active, works at that weekday and hour, and
- when a window (start date and number of weeks) is given - has no booked session or pending / approved / confirmed trial on any
of those dates. GET /pack-availability (public, rate limited) offers exactly that list, and the server checks it again when the
pack or the request is saved (409 "schedule_unavailable" with the free trainers and hours of that day).

Old rows (before this existed) keep their single hour in preferred_days / preferred_time: they are only READ (legacy_entries)
and shown as "fixed schedule (old)"; nothing new is ever written that way.
"""
import json
import re
from datetime import datetime, timedelta

from fastapi import HTTPException
from pydantic import BaseModel

from availability import SESSION_HOURS, WEEKDAYS, hhmm, to_minutes

MAX_WEEKS_WINDOW = 60


class ScheduleEntry(BaseModel):
    """One training day of a pack, as the endpoints receive it."""
    weekday: str
    time: str
    trainer_id: int | None = None          # open only in the client's request (the studio assigns it when approving)


def _bad(message, field="schedule"):
    return HTTPException(status_code=422, detail={"code": "invalid_schedule", "field": field, "message": message})


def _get(item, key):
    return item.get(key) if isinstance(item, dict) else getattr(item, key, None)


def clean(entries, sessions_per_week=None, trainer_required=True):
    """The entries as plain dicts sorted by weekday, or a 422 "invalid_schedule". Checks: a list, as many entries as sessions per
    week (when given), each weekday known and used once, each hour HH:MM on the hour, and a trainer id on every entry (unless
    `trainer_required` is False: the client's request may leave the trainer open)."""
    if not isinstance(entries, (list, tuple)) or not entries:
        raise _bad("Choose the day and hour of every weekly session. / Elige el día y la hora de cada sesión semanal.")
    result, seen = [], set()
    for item in entries:
        weekday, time, trainer = _get(item, "weekday"), _get(item, "time"), _get(item, "trainer_id")
        if weekday not in WEEKDAYS:
            raise _bad("Use a weekday such as Monday. / Usa un día de la semana, por ejemplo Monday.")
        if weekday in seen:
            raise _bad("Each day can only appear once. / Cada día solo puede aparecer una vez.")
        seen.add(weekday)
        if not re.fullmatch(r"\d{2}:\d{2}", str(time or "")) or not (0 <= int(str(time)[:2]) <= 23) or str(time)[3:] != "00":
            raise _bad("Use the hour as HH:00. / Usa la hora como HH:00.")
        if trainer in (None, ""):
            if trainer_required:
                raise _bad("Choose a trainer for every day. / Elige un entrenador para cada día.")
            trainer = None
        else:
            try:
                trainer = int(trainer)
            except (TypeError, ValueError):
                raise _bad("Invalid trainer. / Entrenador no válido.") from None
        result.append({"weekday": weekday, "time": str(time), "trainer_id": trainer})
    if sessions_per_week is not None and len(result) != int(sessions_per_week):
        raise _bad(f"Choose exactly {int(sessions_per_week)} day(s), one per weekly session. / Elige exactamente {int(sessions_per_week)} día(s), uno por sesión semanal.")
    return sorted(result, key=lambda entry: WEEKDAYS.index(entry["weekday"]))


def weekdays(entries):
    return [entry["weekday"] for entry in entries]


def days_csv(entries):
    """The weekdays as the old text column keeps them (display and older readers): "Monday,Wednesday"."""
    return ",".join(weekdays(entries))


def main_trainer(entries):
    """The first entry's trainer: the pack's `trainer_id` for the places that still show one trainer per pack."""
    return entries[0]["trainer_id"] if entries else None


def dumps(entries):
    return json.dumps([{"weekday": e["weekday"], "time": e["time"], "trainer_id": e["trainer_id"]} for e in entries])


def loads(value):
    """The stored schedule (JSON text, a list or None) as a list of entries; [] when there is none (an old, single-hour row)."""
    if value in (None, ""):
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return []
    return [dict(entry) for entry in value] if isinstance(value, list) else []


def all_names(cursor):
    """{trainer_id: name} of every trainer (to show a stored schedule: the entries only keep ids)."""
    cursor.execute("SELECT id, nome FROM trainers")
    return dict(cursor.fetchall())


def named(entries, names):
    """The entries with the trainer's name added (read side only)."""
    return [{**entry, "trainer": names.get(entry.get("trainer_id"))} for entry in entries]


def legacy_entries(days, time, trainer_id=None):
    """READ ONLY: the single hour of an old row as per-day entries (the admin prefills the form with it and labels it "old")."""
    items = [day.strip() for day in str(days or "").split(",") if day.strip() in WEEKDAYS]
    stamp = str(time or "")[:5]
    return [{"weekday": day, "time": stamp, "trainer_id": trainer_id} for day in items] if stamp else []


def uniform(days, time, trainer_id):
    """The same hour and trainer on every given day. A convenience for tests and seeds: no flow uses it."""
    items = days if isinstance(days, (list, tuple)) else [day.strip() for day in str(days).split(",") if day.strip()]
    return [{"weekday": day, "time": str(time)[:5], "trainer_id": trainer_id} for day in items]


# ---------------------------------------------------------------------------------------------- dates
def slots(start_date, entries, total):
    """The first `total` sessions on or after `start_date`, in date order: [(date 'YYYY-MM-DD', time 'HH:MM', trainer_id)]."""
    by_day = {WEEKDAYS.index(entry["weekday"]): entry for entry in entries}
    if not by_day:
        raise HTTPException(status_code=400, detail="Request must include at least one preferred day")
    current = datetime.strptime(start_date, "%Y-%m-%d")
    found = []
    while len(found) < total:
        entry = by_day.get(current.weekday())
        if entry:
            found.append((current.strftime("%Y-%m-%d"), entry["time"], entry["trainer_id"]))
        current += timedelta(days=1)
    return found


# ---------------------------------------------------------------------------------------------- availability
class Grid:
    """Who works when and who is busy, loaded in a few queries (never one query per hour).

        grid = Grid.load(cursor, start_date="2026-01-12", weeks=8)
        grid.trainers("Monday", "18:00")  -> [{"id", "name"}, ...] free ones
        grid.hours()                      -> {"Monday": [{"time": "07:00", "trainers": [...]}, ...], ...}

    Without a start date only the working hours count (nothing is booked in the abstract week)."""

    def __init__(self, trainers, windows, busy):
        self.trainer_list = trainers            # [(id, name)]
        self.windows = windows                  # {(trainer_id, weekday): [(from_min, to_min)]}
        self.busy = busy                        # {(trainer_id, weekday, "HH:MM")}

    @classmethod
    def load(cls, cursor, start_date=None, weeks=None):
        cursor.execute("SELECT id, nome FROM trainers WHERE active ORDER BY id")
        trainers = cursor.fetchall()
        cursor.execute("SELECT trainer_id, day_of_week, start_time, end_time FROM trainer_availability")
        windows = {}
        for trainer_id, weekday, start, end in cursor.fetchall():
            windows.setdefault((trainer_id, weekday), []).append((to_minutes(start), to_minutes(end)))
        busy = set()
        if start_date and weeks:
            first = datetime.strptime(start_date, "%Y-%m-%d").date()
            last = first + timedelta(days=7 * min(int(weeks), MAX_WEEKS_WINDOW))
            cursor.execute(
                """
                SELECT trainer_id, session_date, session_time FROM sessions
                WHERE status = 'Booked' AND trainer_id IS NOT NULL AND session_date >= %s AND session_date < %s
                UNION
                SELECT trainer_id, session_date, session_time FROM trial_sessions
                WHERE LOWER(status) IN ('pending', 'approved', 'confirmed') AND trainer_id IS NOT NULL
                  AND session_date >= %s AND session_date < %s
                """,
                (first, last, first, last),
            )
            for trainer_id, day, stamp in cursor.fetchall():
                busy.add((trainer_id, WEEKDAYS[day.weekday()], hhmm(stamp)))
        return cls(trainers, windows, busy)

    def works(self, trainer_id, weekday, time):
        start = to_minutes(time)
        return any(low <= start and start + SESSION_HOURS * 60 <= high for low, high in self.windows.get((trainer_id, weekday), []))

    def free(self, trainer_id, weekday, time):
        return self.works(trainer_id, weekday, time) and (trainer_id, weekday, hhmm(time)) not in self.busy

    def trainers(self, weekday, time):
        return [{"id": trainer_id, "name": name} for trainer_id, name in self.trainer_list if self.free(trainer_id, weekday, time)]

    def hours(self):
        result = {day: [] for day in WEEKDAYS}
        for day in WEEKDAYS:
            for hour in range(0, 24):
                stamp = f"{hour:02d}:00"
                free = self.trainers(day, stamp)
                if free:
                    result[day].append({"time": stamp, "trainers": free})
        return result


def weeks_of(cursor, catalog_pack_id, sessions_per_week):
    """How many weeks a catalogue pack lasts with that many sessions per week (the window of the free hours)."""
    import pack_catalog
    return pack_catalog.sale(cursor, catalog_pack_id, sessions_per_week)["weeks"]


def problems(cursor, entries, start_date=None, weeks=None, grid=None):
    """The entries whose trainer is NOT free at their day and hour: [{"weekday", "time", "trainer_id", "alternatives": [{id, name}],
    "times": [free hours of that day]}]. [] when every entry is free. A trainer left open (None) is only checked to have SOMEONE free."""
    grid = grid or Grid.load(cursor, start_date, weeks)
    found = []
    for entry in entries:
        free = grid.trainers(entry["weekday"], entry["time"])
        chosen = entry["trainer_id"]
        ok = bool(free) if chosen is None else any(item["id"] == chosen for item in free)
        if not ok:
            found.append({
                "weekday": entry["weekday"], "time": entry["time"], "trainer_id": chosen, "alternatives": free,
                "times": [item["time"] for item in grid.hours()[entry["weekday"]]],
            })
    return found


def unavailable(found):
    """The 409 every flow answers when a chosen day / hour / trainer is not free any more (somebody took it a moment ago)."""
    return HTTPException(status_code=409, detail={
        "code": "schedule_unavailable",
        "message": "Some of the chosen hours are not free any more. / Algunas de las horas elegidas ya no están libres.",
        "entries": found,
    })


def ensure_free(cursor, entries, start_date=None, weeks=None):
    """Raises the 409 above when any entry is not free; otherwise returns the entries."""
    found = problems(cursor, entries, start_date, weeks)
    if found:
        raise unavailable(found)
    return entries


def ensure_columns(cursor):
    """The stored schedule of a pack (JSONB; client_requests gets its own column in main.py). Idempotent; never touches existing rows."""
    cursor.execute("ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS schedule JSONB")

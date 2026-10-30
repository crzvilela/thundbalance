"""Choosing a trainer for a day and hour, and the alternatives when the chosen one is busy.

The rules are NOT written again here: a trainer can take a slot when availability.slot_problem says so (active, working
hours, no booked session, no approved / confirmed / pending-with-trainer trial). This module only asks that function for
every active trainer and shapes the answer.

  GET /available-trainers?date=YYYY-MM-DD&time=HH:MM[&exclude_session_id=N]   (public; the trial form is public)
  GET /available-trainers?weekday=Monday&time=HH:MM                            (working hours only: for a weekly pack request)
  -> [{"id": 1, "name": "Carles"}, ...]   only id and name, at most RATE_LIMIT requests a minute per connection

The three flows that let the client choose a trainer (trial, pack request, change of date) answer 409 with
{"code": "trainer_unavailable", "message", "alternatives": [{"id", "name"}]} when the chosen one stopped being free
(someone else booked it a moment ago); the page shows the alternatives again.
"""
import re
import threading
import time as _time
from collections import defaultdict, deque
from datetime import datetime

from fastapi import HTTPException, Request

from availability import WEEKDAYS, slot_problem, within_hours
from database import get_connection

RATE_LIMIT = 60                 # requests per connection per minute
_hits = defaultdict(deque)
_lock = threading.Lock()


def _too_many(ip):
    now = _time.monotonic()
    with _lock:
        queue = _hits[ip]
        while queue and now - queue[0] > 60:
            queue.popleft()
        if len(queue) >= RATE_LIMIT:
            return True
        queue.append(now)
        if len(_hits) > 5000:           # forget connections that went quiet
            for key in [key for key, value in _hits.items() if not value or now - value[-1] > 60]:
                _hits.pop(key, None)
    return False


def reset_rate_limit():
    with _lock:
        _hits.clear()


def free_trainers(cursor, day, time, ignore_session_id=None):
    """[{"id", "name"}] of the active trainers who can take a one-hour session on `day` at `time`."""
    cursor.execute("SELECT id, nome FROM trainers WHERE active ORDER BY id")
    return [
        {"id": trainer_id, "name": name} for trainer_id, name in cursor.fetchall()
        if slot_problem(cursor, trainer_id, day, time, ignore_session_id=ignore_session_id) is None
    ]


def working_trainers(cursor, weekdays, time):
    """[{"id", "name"}] of the active trainers who work at `time` on EVERY weekday given (a weekly pack: working hours only)."""
    cursor.execute("SELECT id, nome FROM trainers WHERE active ORDER BY id")
    return [
        {"id": trainer_id, "name": name} for trainer_id, name in cursor.fetchall()
        if all(within_hours(cursor, trainer_id, weekday, time) for weekday in weekdays)
    ]


def unavailable(alternatives, message="The chosen trainer is not available at that time."):
    """The 409 the three flows answer when the chosen trainer is not free any more."""
    return HTTPException(status_code=409, detail={"code": "trainer_unavailable", "message": message, "alternatives": alternatives})


def clean_time(value):
    text = str(value or "")
    if not re.fullmatch(r"\d{2}:\d{2}", text) or not (0 <= int(text[:2]) <= 23 and 0 <= int(text[3:]) <= 59):
        raise HTTPException(status_code=422, detail="Use the time as HH:MM")
    return text


def register_trainer_choice_routes(app):
    @app.get("/available-trainers")
    def available_trainers(request: Request, time: str, date: str | None = None, weekday: str | None = None,
                           exclude_session_id: int | None = None):
        ip = (request.client.host if request.client else "") or "unknown"
        if _too_many(ip):
            raise HTTPException(status_code=429, detail="Too many requests. Please try again in a minute.")
        time = clean_time(time)
        conn = get_connection()
        cursor = conn.cursor()
        try:
            if weekday:
                if weekday not in WEEKDAYS:
                    raise HTTPException(status_code=422, detail="Use a weekday such as Monday")
                return working_trainers(cursor, [weekday], time)
            try:
                datetime.strptime(str(date), "%Y-%m-%d")
            except ValueError:
                raise HTTPException(status_code=422, detail="Use the date as YYYY-MM-DD") from None
            return free_trainers(cursor, date, time, ignore_session_id=exclude_session_id)
        finally:
            cursor.close()
            conn.close()

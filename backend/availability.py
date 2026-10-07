"""Trainer availability: the single source of truth for "can this trainer
take a session at this date and time?".

Availability is stored per trainer and weekday in trainer_availability
(start_time/end_time). Sessions last one hour and start on the hour, so a
trainer available 07:00-14:00 can START a session from 07:00 up to 13:00.
"""

from datetime import date as date_type, datetime

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
SESSION_HOURS = 1

# Initial team, seeded once (see ensure_trainers_and_availability). After that
# the hours are edited from the admin panel and never overwritten.
SEED_TRAINERS = [
    ("Carles", 7, 14),
    ("David", 7, 14),
    ("Guille", 7, 21),
    ("Matilda", 7, 21),
]
SEED_DAYS = WEEKDAYS[:5]  # Monday to Friday, the days the site offers


def hhmm(value):
    """'07:00:00' / datetime.time / '7:00' -> '07:00'."""
    text = str(value)
    hour, minute = text.split(":")[:2]
    return f"{int(hour):02d}:{int(minute):02d}"


def to_minutes(value):
    hour, minute = hhmm(value).split(":")
    return int(hour) * 60 + int(minute)


def weekday_name(day):
    """Weekday name for a date, a 'YYYY-MM-DD' string or a datetime."""
    if isinstance(day, str):
        day = datetime.strptime(day[:10], "%Y-%m-%d").date()
    if isinstance(day, datetime):
        day = day.date()
    return WEEKDAYS[day.weekday()]


def _windows(cursor, trainer_id, weekday):
    cursor.execute(
        """
        SELECT start_time, end_time FROM trainer_availability
        WHERE trainer_id = %s AND day_of_week = %s
        """,
        (trainer_id, weekday),
    )
    return [(to_minutes(row[0]), to_minutes(row[1])) for row in cursor.fetchall()]


def within_hours(cursor, trainer_id, weekday, time):
    """True when a one-hour session starting at `time` fits the trainer's
    working hours on that weekday."""
    start = to_minutes(time)
    end = start + SESSION_HOURS * 60
    return any(low <= start and end <= high for low, high in _windows(cursor, trainer_id, weekday))


def has_conflict(cursor, trainer_id, day, time, ignore_session_id=None, ignore_trial_id=None):
    """True when the trainer already has a booked session or an approved
    trial at that exact date and time."""
    cursor.execute(
        """
        SELECT 1 FROM sessions
        WHERE trainer_id = %s AND session_date = %s AND session_time = %s
          AND status = 'Booked' AND (%s::int IS NULL OR id <> %s::int)
        LIMIT 1
        """,
        (trainer_id, str(day)[:10], hhmm(time), ignore_session_id, ignore_session_id),
    )
    if cursor.fetchone():
        return True
    cursor.execute(
        """
        SELECT 1 FROM trial_sessions
        WHERE trainer_id = %s AND session_date = %s AND session_time = %s
          AND LOWER(status) = 'approved' AND (%s::int IS NULL OR id <> %s::int)
        LIMIT 1
        """,
        (trainer_id, str(day)[:10], hhmm(time), ignore_trial_id, ignore_trial_id),
    )
    return cursor.fetchone() is not None


def slot_problem(cursor, trainer_id, day, time, ignore_session_id=None, ignore_trial_id=None):
    """None when the trainer can take the slot, otherwise a human-readable
    reason (used verbatim in error messages)."""
    cursor.execute("SELECT nome, active FROM trainers WHERE id = %s", (trainer_id,))
    trainer = cursor.fetchone()
    if not trainer:
        return "Trainer not found."
    name, active = trainer
    if not active:
        return f"{name} is no longer available for new sessions."

    weekday = weekday_name(day)
    windows = _windows(cursor, trainer_id, weekday)
    start = to_minutes(time)
    if not any(low <= start and start + SESSION_HOURS * 60 <= high for low, high in windows):
        if not windows:
            return f"{name} does not work on {weekday}s."
        low, high = min(w[0] for w in windows), max(w[1] for w in windows)
        return (
            f"{name} is not available on {weekday}s at {hhmm(time)} "
            f"(works {low // 60:02d}:{low % 60:02d}-{high // 60:02d}:{high % 60:02d})."
        )

    if has_conflict(cursor, trainer_id, day, time, ignore_session_id, ignore_trial_id):
        return f"{name} already has a session on {str(day)[:10]} at {hhmm(time)}."
    return None


def _busy_times(cursor, day, trainer_ids=None, ignore_session_id=None):
    """{trainer_id: {"HH:MM", ...}} already taken on `day`, in two queries."""
    key = str(day)[:10]
    busy = {}
    cursor.execute(
        """
        SELECT trainer_id, session_time FROM sessions
        WHERE session_date = %s AND status = 'Booked'
          AND (%s::int IS NULL OR id <> %s::int)
        """,
        (key, ignore_session_id, ignore_session_id),
    )
    rows = cursor.fetchall()
    cursor.execute(
        """
        SELECT trainer_id, session_time FROM trial_sessions
        WHERE session_date = %s AND LOWER(status) = 'approved'
        """,
        (key,),
    )
    rows += cursor.fetchall()
    for trainer_id, time in rows:
        if trainer_id is not None and time is not None and (trainer_ids is None or trainer_id in trainer_ids):
            busy.setdefault(trainer_id, set()).add(hhmm(time))
    return busy


def _start_times(windows):
    times = set()
    for low, high in windows:
        hour = (low + 59) // 60
        while (hour + SESSION_HOURS) * 60 <= high:
            times.add(f"{hour:02d}:00")
            hour += 1
    return times


def free_start_times(cursor, trainer_id, day, ignore_session_id=None):
    """Start times ("HH:00") the trainer can still take on a given date."""
    times = _start_times(_windows(cursor, trainer_id, weekday_name(day)))
    taken = _busy_times(cursor, day, {trainer_id}, ignore_session_id).get(trainer_id, set())
    return sorted(times - taken)


def free_start_times_any_trainer(cursor, day):
    """Start times on `day` when at least one active trainer is free
    (a fixed number of queries, however many trainers there are)."""
    weekday = weekday_name(day)
    cursor.execute(
        """
        SELECT ta.trainer_id, ta.start_time, ta.end_time
        FROM trainer_availability ta JOIN trainers t ON t.id = ta.trainer_id
        WHERE t.active AND ta.day_of_week = %s
        """,
        (weekday,),
    )
    windows = {}
    for trainer_id, start, end in cursor.fetchall():
        windows.setdefault(trainer_id, []).append((to_minutes(start), to_minutes(end)))
    busy = _busy_times(cursor, day)
    free = set()
    for trainer_id, trainer_windows in windows.items():
        free |= _start_times(trainer_windows) - busy.get(trainer_id, set())
    return sorted(free)


def trainers_for_slot(cursor, day, time):
    """Active trainers who can take the slot, as [(id, name)]."""
    cursor.execute("SELECT id, nome FROM trainers WHERE active ORDER BY id")
    return [
        (trainer_id, name) for trainer_id, name in cursor.fetchall()
        if slot_problem(cursor, trainer_id, day, time) is None
    ]


def weekly_start_times(cursor):
    """{weekday: [start times with at least one active trainer working]}"""
    cursor.execute(
        """
        SELECT ta.day_of_week, ta.start_time, ta.end_time
        FROM trainer_availability ta JOIN trainers t ON t.id = ta.trainer_id
        WHERE t.active
        """
    )
    result = {day: set() for day in WEEKDAYS}
    for weekday, start, end in cursor.fetchall():
        if weekday not in result:
            continue
        hour = (to_minutes(start) + 59) // 60
        while (hour + SESSION_HOURS) * 60 <= to_minutes(end):
            result[weekday].add(f"{hour:02d}:00")
            hour += 1
    return {day: sorted(times) for day, times in result.items()}


def ensure_trainers_and_availability(conn):
    """Creates the real trainers and their weekly hours, once.

    - Existing trainers whose first name matches (e.g. "David Miller") are
      renamed and reused, so nothing that points to them breaks.
    - Any other trainer is marked inactive (kept, never deleted) and stops
      being offered anywhere.
    - A marker row in app_settings makes this run only the first time, so
      hours edited later in the admin panel are never overwritten.
    """
    cursor = conn.cursor()
    try:
        cursor.execute("ALTER TABLE trainers ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE")
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        )
        cursor.execute("SELECT 1 FROM app_settings WHERE key = 'trainers_seeded_v1'")
        if cursor.fetchone():
            conn.commit()
            return

        cursor.execute("SELECT id, nome FROM trainers ORDER BY id")
        existing = cursor.fetchall()
        keep_ids = []

        for name, start_hour, end_hour in SEED_TRAINERS:
            match = next(
                (row for row in existing
                 if row[0] not in keep_ids and str(row[1]).split(" ")[0].strip().lower() == name.lower()),
                None,
            )
            if match:
                trainer_id = match[0]
                cursor.execute("UPDATE trainers SET nome = %s, active = TRUE WHERE id = %s", (name, trainer_id))
            else:
                trainer_id = create_trainer(cursor, name)
            keep_ids.append(trainer_id)

            cursor.execute("DELETE FROM trainer_availability WHERE trainer_id = %s", (trainer_id,))
            for day in SEED_DAYS:
                cursor.execute(
                    """
                    INSERT INTO trainer_availability (trainer_id, day_of_week, start_time, end_time)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (trainer_id, day, f"{start_hour:02d}:00", f"{end_hour:02d}:00"),
                )

        cursor.execute("UPDATE trainers SET active = FALSE WHERE id <> ALL(%s)", (keep_ids,))
        cursor.execute(
            "INSERT INTO app_settings (key, value) VALUES ('trainers_seeded_v1', 'done') ON CONFLICT (key) DO NOTHING"
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()


def validate_hours(hours):
    """Checks a {weekday: {start, end} | None} mapping; raises ValueError with
    a message that can be shown to the admin."""
    for day, window in hours.items():
        if day not in WEEKDAYS:
            raise ValueError(f"Unknown weekday: {day}")
        if window is None:
            continue
        try:
            low, high = to_minutes(window.start), to_minutes(window.end)
        except Exception:
            raise ValueError(f"Invalid hours for {day}")
        if low % 60 or high % 60:
            raise ValueError(f"{day}: use whole hours (e.g. 07:00)")
        if not 0 <= low < high <= 23 * 60:
            raise ValueError(f"{day}: the end must be after the start (and not later than 23:00)")


def save_hours(cursor, trainer_id, hours):
    """Replaces a trainer's weekly hours. A weekday set to None is a day off."""
    cursor.execute("DELETE FROM trainer_availability WHERE trainer_id = %s", (trainer_id,))
    for day, window in hours.items():
        if window is None:
            continue
        cursor.execute(
            """
            INSERT INTO trainer_availability (trainer_id, day_of_week, start_time, end_time)
            VALUES (%s, %s, %s, %s)
            """,
            (trainer_id, day, hhmm(window.start), hhmm(window.end)),
        )


def create_trainer(cursor, name, specialty=None):
    """Inserts a trainer and returns its id. Works on databases where the
    trainers table also has an email column (production)."""
    cursor.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'trainers'"
    )
    columns = {row[0] for row in cursor.fetchall()}
    fields, values = ["nome", "especialidade"], [name, specialty or "Personal Training"]
    if "email" in columns:
        fields.append("email")
        values.append(f"{name.lower().replace(' ', '.')}@thundbalance.com")
    cursor.execute(
        f"INSERT INTO trainers ({', '.join(fields)}) VALUES ({', '.join(['%s'] * len(fields))}) RETURNING id",
        values,
    )
    return cursor.fetchone()[0]


def trainer_usage(cursor, trainer_id):
    """(has_history, upcoming): whether anything points to the trainer, and how
    many future sessions/approved trials would be left without a trainer."""
    cursor.execute(
        """
        SELECT
            (SELECT COUNT(*) FROM sessions WHERE trainer_id = %(id)s)
          + (SELECT COUNT(*) FROM client_requests WHERE trainer_id = %(id)s)
          + (SELECT COUNT(*) FROM trial_sessions WHERE trainer_id = %(id)s),
            (SELECT COUNT(*) FROM sessions
               WHERE trainer_id = %(id)s AND status = 'Booked' AND session_date >= CURRENT_DATE)
          + (SELECT COUNT(*) FROM trial_sessions
               WHERE trainer_id = %(id)s AND LOWER(status) = 'approved' AND session_date >= CURRENT_DATE)
        """,
        {"id": trainer_id},
    )
    total, upcoming = cursor.fetchone()
    return total > 0, upcoming


def purge_unused_inactive_trainers(conn):
    """Deletes inactive trainers that nothing points to. Inactive trainers that
    still have history stay hidden (their past sessions keep a name)."""
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM trainers WHERE NOT active")
        for (trainer_id,) in cursor.fetchall():
            has_history, _ = trainer_usage(cursor, trainer_id)
            if not has_history:
                cursor.execute("DELETE FROM trainer_availability WHERE trainer_id = %s", (trainer_id,))
                cursor.execute("DELETE FROM trainers WHERE id = %s", (trainer_id,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()

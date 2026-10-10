"""Creating a pack: the single implementation shared by renewing a pack,
approving a client's request and creating a client from the admin panel.

Packs are PARALLEL: creating one never closes, replaces or deletes the packs a
client already has. Each pack has its own period, schedule and numbering, and
its sessions carry sessions.user_plan_id (sessions from before that column
existed are matched to a pack by date when they are read, never rewritten).

Database rows go in first and Google Calendar events afterwards; the caller
owns the transaction and the list of created event ids, so everything can be
rolled back together.
"""
import traceback
from datetime import datetime, timedelta

from fastapi import HTTPException

from availability import has_conflict, slot_problem, weekday_name, within_hours
from emails import clean_recipients, send_pack_summary_email, team_emails
from emails.dates import parse_madrid
import calendar_sync
from google_calendar import create_calendar_event, delete_calendar_event, describe_error

DAY_MAP = {
    "Monday": 0,
    "Tuesday": 1,
    "Wednesday": 2,
    "Thursday": 3,
    "Friday": 4,
    "Saturday": 5,
    "Sunday": 6
}


def generate_session_dates(
    start_date,
    preferred_days,
    total_sessions
):

    selected_days = [
        DAY_MAP[day.strip()]
        for day in preferred_days.split(",")
        if day.strip() in DAY_MAP
    ]
    if not selected_days:
        raise HTTPException(status_code=400, detail="Request must include at least one preferred day")

    current_date = datetime.strptime(
        start_date,
        "%Y-%m-%d"
    )

    dates = []

    while len(dates) < total_sessions:

        if current_date.weekday() in selected_days:

            dates.append(
                current_date.strftime("%Y-%m-%d")
            )

        current_date += timedelta(days=1)

    return dates


def find_conflicts(cursor, *, user_id, trainer_id, session_dates, preferred_time):
    """Sessions of a planned pack that collide with something. Returns a list of
    {"date", "time", "kind", "message"}; kind is one of
      client_busy    the client already has a (non-cancelled) session at that day and hour
      trainer_busy   the trainer already has another session then
      trainer_hours  the trainer does not work at that day / hour
    Nothing is written."""
    time = str(preferred_time)[:5]
    busy_days = set()
    if user_id:
        cursor.execute(
            """
            SELECT session_date FROM sessions
            WHERE user_id = %s AND status = 'Booked' AND session_date = ANY(%s::date[])
              AND to_char(session_time, 'HH24:MI') = %s
            """,
            (user_id, list(session_dates), time),
        )
        busy_days = {str(row[0]) for row in cursor.fetchall()}

    conflicts = []
    for day in session_dates:
        if str(day) in busy_days:
            conflicts.append({
                "date": str(day), "time": time, "kind": "client_busy",
                "message": "The client already has a session at that day and time.",
            })
        problem = slot_problem(cursor, trainer_id, day, time)
        if problem:
            hours_ok = within_hours(cursor, trainer_id, weekday_name(day), time)
            kind = "trainer_busy" if hours_ok and has_conflict(cursor, trainer_id, day, time) else "trainer_hours"
            conflicts.append({"date": str(day), "time": time, "kind": kind, "message": problem})
    return conflicts


def preview_pack(cursor, *, user_id, plan_id, trainer_id, sessions_per_week, preferred_days, preferred_time, start_date):
    """What a pack would create, without creating anything: the sessions and the
    conflicts (see find_conflicts). The start date may be any day."""
    cursor.execute("SELECT nome, duration_weeks FROM plans WHERE id = %s", (plan_id,))
    plan = cursor.fetchone()
    if not plan or not plan[1]:
        raise HTTPException(status_code=404, detail="Plan not found")
    _, days = validate_pack_request(
        cursor, trainer_id=trainer_id, sessions_per_week=sessions_per_week,
        preferred_days=preferred_days, start_date=start_date,
    )
    total = plan[1] * sessions_per_week
    dates = generate_session_dates(start_date, ",".join(days), total)
    return {
        "total_sessions": total,
        "dates": dates,
        "first_date": dates[0],
        "last_date": dates[-1],
        "conflicts": find_conflicts(
            cursor, user_id=user_id, trainer_id=trainer_id, session_dates=dates, preferred_time=preferred_time,
        ),
    }


def conflict_error(conflicts, trainer_name):
    """The 409 the panel turns into the "conflicts" list of the modal."""
    return HTTPException(
        status_code=409,
        detail={
            "code": "conflicts",
            "message": f"{len(conflicts)} session(s) would collide with something. Review them or create anyway.",
            "trainer": trainer_name,
            "conflicts": conflicts,
        },
    )


def create_pack(
    cursor, created_event_ids, *, user_id, client_name, client_email, plan_id, trainer_id,
    trainer_name, sessions_per_week, preferred_days, preferred_time, start_date,
    request_id=None, allow_conflicts=False
):
    """The one place that creates a pack: records the period and schedule,
    inserts every session and creates its Google Calendar event.

    Database rows go in first and the calendar events afterwards; the id of
    every event created is appended to `created_event_ids`, so the caller can
    delete them if anything fails later (before or at commit). Nothing is
    committed here.

    The client's other packs are left exactly as they are (parallel packs).
    allow_conflicts: with colliding sessions (client busy, trainer busy or
    outside their hours) and allow_conflicts=False nothing is created and a 409
    with the list is raised; with True ("Crear igualmente") everything is
    created and nothing is silently dropped.

    Returns {"plan_name", "total_sessions", "session_dates", "sessions",
    "calendar_failed", "calendar_errors"} where sessions is
    [{"id", "start" (Madrid datetime), "trainer", "number"}]. Sessions whose
    calendar event could not be created are still created (and flagged).
    """
    cursor.execute("SELECT nome, duration_weeks FROM plans WHERE id = %s", (plan_id,))
    plan = cursor.fetchone()
    if not plan or not plan[1]:
        raise HTTPException(status_code=404, detail="Plan not found")
    plan_name, weeks = plan

    total_sessions = weeks * sessions_per_week
    session_dates = generate_session_dates(start_date, preferred_days, total_sessions)

    conflicts = find_conflicts(
        cursor, user_id=user_id, trainer_id=trainer_id, session_dates=session_dates,
        preferred_time=preferred_time,
    )
    if conflicts and not allow_conflicts:
        raise conflict_error(conflicts, trainer_name)

    cursor.execute(
        """
        INSERT INTO user_plans
        (user_id, plan_id, active, start_date, end_date, sessions_per_week,
         preferred_days, preferred_time, trainer_id)
        VALUES (%s, %s, TRUE, %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (user_id, plan_id, session_dates[0], session_dates[-1], sessions_per_week,
         preferred_days, preferred_time, trainer_id)
    )
    pack_id = cursor.fetchone()[0]

    pending = []
    for index, session_date in enumerate(session_dates, start=1):
        session_number = f"{index}/{total_sessions}"
        cursor.execute(
            """
            INSERT INTO sessions
            (user_id, trainer_id, session_date, session_time, request_id, session_number, status, user_plan_id)
            VALUES (%s, %s, %s, %s, %s, %s, 'Booked', %s)
            RETURNING id
            """,
            (user_id, trainer_id, session_date, preferred_time, request_id, session_number, pack_id)
        )
        pending.append((cursor.fetchone()[0], session_date, session_number))

    # A calendar failure never stops the sessions from existing: it is recorded
    # on each session (calendar_sync_status / calendar_sync_error), shown in the
    # panel, and "Sincronizar con calendario" creates what is missing.
    key = calendar_sync.instance_key(cursor)
    calendar_errors = []
    sessions = []
    for session_id, session_date, session_number in pending:
        try:
            event_id = create_calendar_event(
                trainer_name, client_name, client_email, session_date, preferred_time, session_number,
                event_id=calendar_sync.event_id_for(key, session_id), session_id=session_id,
            )
            created_event_ids.append(event_id)
            calendar_sync.record(cursor, session_id, True, event_id=event_id)
        except Exception as error:  # noqa: BLE001
            reason = describe_error(error)
            print(f"Calendar event for session {session_id} could not be created: {reason}")
            traceback.print_exc()
            calendar_sync.record(cursor, session_id, False, reason)
            calendar_errors.append(reason)
        sessions.append({
            "id": session_id,
            "start": parse_madrid(session_date, str(preferred_time)[:5]),
            "trainer": trainer_name,
            "number": session_number,
        })

    return {
        "pack_id": pack_id,
        "conflicts": conflicts,
        "plan_name": plan_name,
        "total_sessions": total_sessions,
        "session_dates": session_dates,
        "sessions": sessions,
        "calendar_failed": len(calendar_errors),
        "calendar_errors": sorted(set(calendar_errors)),
    }


def delete_created_events(created_event_ids):
    """Removes calendar events created by a pack whose creation did not finish."""
    for event_id in created_event_ids:
        try:
            delete_calendar_event(event_id)
        except Exception:
            traceback.print_exc()


def clean_pack_recipients(email_extra, client_email):
    """Extra recipients for the pack email (None = the team's default
    addresses). Checked before anything is created, so a typo is reported
    without side effects."""
    wanted = team_emails() if email_extra is None else email_extra
    try:
        return clean_recipients(wanted, exclude=[client_email])
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


def email_pack(created, *, client_name, client_email, days, sessions_per_week, trainer_name, to_client, extra):
    """Sends the pack summary after the sessions are saved. A failure never
    undoes them: it is reported in the answer so the panel can warn the admin."""
    summary = {
        "client_name": client_name,
        "client_email": client_email,
        "plan_name": created["plan_name"],
        "sessions_per_week": sessions_per_week,
        "days": days,
        "trainer": trainer_name,
        "sessions": created["sessions"],
    }
    result = send_pack_summary_email(summary, to_client=to_client, extra_recipients=extra)
    return {"sent_to": result.sent_to, "failed": result.failed, "problem": result.problem}


def validate_pack_request(cursor, *, trainer_id, sessions_per_week, preferred_days, start_date):
    """Checks the parts of a pack request that do not depend on the client:
    trainer, sessions per week, training days and a well-formed start date (no
    minimum). Returns (trainer_name, days)."""
    cursor.execute("SELECT nome FROM trainers WHERE id = %s", (trainer_id,))
    trainer = cursor.fetchone()
    if not trainer:
        raise HTTPException(status_code=404, detail="Trainer not found")

    if not 1 <= sessions_per_week <= 7:
        raise HTTPException(status_code=400, detail="Sessions per week must be between 1 and 7")

    days = [day.strip() for day in preferred_days.split(",") if day.strip()]
    if not days or any(day not in DAY_MAP for day in days):
        raise HTTPException(status_code=422, detail="Please choose valid training days.")

    # Any day is allowed (today, inside the current pack, or in the past: the
    # panel asks for a confirmation before sending a past date).
    try:
        datetime.strptime(start_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=422, detail="Please choose a valid start date.")

    return trainer[0], days


def ensure_pack_columns():
    """sessions.user_plan_id: which pack a session belongs to (NULL for sessions
    created before this existed; they are matched by date when read)."""
    from database import get_connection
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_plan_id INTEGER")
        conn.commit()
    finally:
        cursor.close()
        conn.close()

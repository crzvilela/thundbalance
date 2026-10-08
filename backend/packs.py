"""Creating a pack: the single implementation shared by renewing a pack,
approving a client's request and creating a client from the admin panel.

Database rows go in first and Google Calendar events afterwards; the caller
owns the transaction and the list of created event ids, so everything can be
rolled back together.
"""
import traceback
from datetime import datetime, timedelta

from fastapi import HTTPException

from availability import slot_problem
from emails import clean_recipients, send_pack_summary_email, team_emails
from emails.dates import parse_madrid
from google_calendar import create_calendar_event, delete_calendar_event

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


def create_pack(
    cursor, created_event_ids, *, user_id, client_name, client_email, plan_id, trainer_id,
    trainer_name, sessions_per_week, preferred_days, preferred_time, start_date,
    request_id=None, replace_plans="deactivate"
):
    """The one place that creates a pack: records the period and schedule,
    inserts every session and creates its Google Calendar event.

    Database rows go in first and the calendar events afterwards; the id of
    every event created is appended to `created_event_ids`, so the caller can
    delete them if anything fails later (before or at commit). Nothing is
    committed here.

    replace_plans: "deactivate" keeps the previous pack as history (renewals);
    "delete" removes it (approving a client's request, as before).

    Returns {"plan_name", "total_sessions", "session_dates", "sessions"} where
    sessions is [{"id", "start" (Madrid datetime), "trainer", "number"}].
    """
    cursor.execute("SELECT nome, duration_weeks FROM plans WHERE id = %s", (plan_id,))
    plan = cursor.fetchone()
    if not plan or not plan[1]:
        raise HTTPException(status_code=404, detail="Plan not found")
    plan_name, weeks = plan

    total_sessions = weeks * sessions_per_week
    session_dates = generate_session_dates(start_date, preferred_days, total_sessions)

    # Every generated session must fit the trainer's working hours and not
    # collide with another session, before anything is written.
    problems = []
    for session_date in session_dates:
        problem = slot_problem(cursor, trainer_id, session_date, preferred_time)
        if problem:
            problems.append(f"{session_date}: {problem}")
    if problems:
        shown = "; ".join(problems[:3])
        extra = f" (+{len(problems) - 3} more)" if len(problems) > 3 else ""
        raise HTTPException(
            status_code=409,
            detail=f"{trainer_name} cannot take this schedule. {shown}{extra}",
        )

    if replace_plans == "delete":
        cursor.execute("DELETE FROM user_plans WHERE user_id = %s", (user_id,))
    else:
        cursor.execute("UPDATE user_plans SET active = FALSE WHERE user_id = %s", (user_id,))
    cursor.execute(
        """
        INSERT INTO user_plans
        (user_id, plan_id, active, start_date, end_date, sessions_per_week,
         preferred_days, preferred_time, trainer_id)
        VALUES (%s, %s, TRUE, %s, %s, %s, %s, %s, %s)
        """,
        (user_id, plan_id, session_dates[0], session_dates[-1], sessions_per_week,
         preferred_days, preferred_time, trainer_id)
    )

    pending = []
    for index, session_date in enumerate(session_dates, start=1):
        session_number = f"{index}/{total_sessions}"
        cursor.execute(
            """
            INSERT INTO sessions
            (user_id, trainer_id, session_date, session_time, request_id, session_number, status)
            VALUES (%s, %s, %s, %s, %s, %s, 'Booked')
            RETURNING id
            """,
            (user_id, trainer_id, session_date, preferred_time, request_id, session_number)
        )
        pending.append((cursor.fetchone()[0], session_date, session_number))

    sessions = []
    for session_id, session_date, session_number in pending:
        event_id = create_calendar_event(
            trainer_name, client_name, client_email, session_date, preferred_time, session_number
        )
        created_event_ids.append(event_id)
        cursor.execute("UPDATE sessions SET google_event_id = %s WHERE id = %s", (event_id, session_id))
        sessions.append({
            "id": session_id,
            "start": parse_madrid(session_date, str(preferred_time)[:5]),
            "trainer": trainer_name,
            "number": session_number,
        })

    return {
        "plan_name": plan_name,
        "total_sessions": total_sessions,
        "session_dates": session_dates,
        "sessions": sessions,
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
    trainer, sessions per week, training days and start date. Returns
    (trainer_name, days). Raises HTTPException with the same messages the
    renewal always used."""
    cursor.execute("SELECT nome FROM trainers WHERE id = %s", (trainer_id,))
    trainer = cursor.fetchone()
    if not trainer:
        raise HTTPException(status_code=404, detail="Trainer not found")

    if not 1 <= sessions_per_week <= 7:
        raise HTTPException(status_code=400, detail="Sessions per week must be between 1 and 7")

    days = [day.strip() for day in preferred_days.split(",") if day.strip()]
    if not days or any(day not in DAY_MAP for day in days):
        raise HTTPException(status_code=422, detail="Please choose valid training days.")

    try:
        start = datetime.strptime(start_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=422, detail="Please choose a valid start date.")
    if start < datetime.now().date():
        raise HTTPException(status_code=422, detail="The start date cannot be in the past.")

    return trainer[0], days

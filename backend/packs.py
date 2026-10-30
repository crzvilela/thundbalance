"""Creating a pack: the single implementation shared by renewing a pack,
approving a client's request and creating a client from the admin panel.

A client has ONE active pack. A new pack replaces the previous one from its
start date (any day): the previous pack's sessions that are still to come from
that date on are cancelled and their calendar events deleted, but only once
the admin has confirmed it (the preview says how many first; without
confirm_replace the request is answered with a 409 "replaces_pack"). Sessions
that already happened are never touched and the numbers (x/n) of every
session stay fixed: cancelling never renumbers.
Each pack has its own period, schedule and numbering, and its sessions carry
sessions.user_plan_id (sessions from before that column existed are matched to
a pack by date when they are read, never rewritten).

Database rows go in first and Google Calendar events afterwards; the caller
owns the transaction and the list of created event ids, so everything can be
rolled back together.
"""
import traceback
from datetime import datetime, timedelta

from fastapi import HTTPException

from availability import has_conflict, slot_problem, weekday_name, within_hours
import pricing
from database import get_connection
from emails import clean_recipients, send_pack_summary_email, team_emails
from emails.dates import parse_madrid
import calendar_feed
import calendar_sync
from google_calendar import create_calendar_event, delete_calendar_event, describe_error, http_status

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


def sessions_to_replace(cursor, user_id, start_date):
    """The client's Booked sessions that a pack starting on `start_date` would
    replace: those still to come (today or later) from that date on. Returns
    [{"id", "date", "event_id"}], oldest first. Nothing is written."""
    if not user_id:
        return []
    cursor.execute(
        """
        SELECT id, session_date, google_event_id FROM sessions
        WHERE user_id = %s AND status = 'Booked'
          AND session_date >= GREATEST(%s::date, CURRENT_DATE)
        ORDER BY session_date, session_time, id
        """,
        (user_id, start_date),
    )
    return [{"id": row[0], "date": str(row[1]), "event_id": row[2]} for row in cursor.fetchall()]


def replacement_summary(replaced):
    """What the panel shows before confirming: how many sessions of the
    previous pack will be cancelled, and between which dates."""
    return {
        "count": len(replaced),
        "first_date": replaced[0]["date"] if replaced else None,
        "last_date": replaced[-1]["date"] if replaced else None,
    }


def find_conflicts(cursor, *, user_id, trainer_id, session_dates, preferred_time, ignore_session_ids=None):
    """Sessions of a planned pack that collide with something. Returns a list of
    {"date", "time", "kind", "message"}; kind is one of
      client_busy    the client already has a (non-cancelled) session at that day and hour
      trainer_busy   the trainer already has another session then
      trainer_hours  the trainer does not work at that day / hour
    ignore_session_ids: sessions the new pack is replacing (they will be
    cancelled, so they collide with nothing). Nothing is written."""
    time = str(preferred_time)[:5]
    ignored = list(ignore_session_ids or [])
    busy_days = set()
    if user_id:
        cursor.execute(
            """
            SELECT session_date FROM sessions
            WHERE user_id = %s AND status = 'Booked' AND session_date = ANY(%s::date[])
              AND to_char(session_time, 'HH24:MI') = %s
              AND id <> ALL(%s::int[])
            """,
            (user_id, list(session_dates), time, ignored),
        )
        busy_days = {str(row[0]) for row in cursor.fetchall()}

    conflicts = []
    for day in session_dates:
        if str(day) in busy_days:
            conflicts.append({
                "date": str(day), "time": time, "kind": "client_busy",
                "message": "The client already has a session at that day and time.",
            })
        problem = slot_problem(cursor, trainer_id, day, time, ignore_session_ids=ignored)
        if problem:
            hours_ok = within_hours(cursor, trainer_id, weekday_name(day), time)
            kind = (
                "trainer_busy"
                if hours_ok and has_conflict(cursor, trainer_id, day, time, ignore_session_ids=ignored)
                else "trainer_hours"
            )
            conflicts.append({"date": str(day), "time": time, "kind": kind, "message": problem})
    return conflicts


def preview_pack(cursor, *, user_id, plan_id, trainer_id, sessions_per_week, preferred_days, preferred_time, start_date,
                 session_type=None):
    """What a pack would create, without creating anything: the sessions and the
    conflicts (see find_conflicts). The start date may be any day."""
    cursor.execute("SELECT nome, duration_weeks, duracao_meses FROM plans WHERE id = %s", (plan_id,))
    plan = cursor.fetchone()
    if not plan or not plan[1]:
        raise HTTPException(status_code=404, detail="Plan not found")
    _, days = validate_pack_request(
        cursor, trainer_id=trainer_id, sessions_per_week=sessions_per_week,
        preferred_days=preferred_days, start_date=start_date,
    )
    total = plan[1] * sessions_per_week
    dates = generate_session_dates(start_date, ",".join(days), total)
    replaced = sessions_to_replace(cursor, user_id, start_date)
    try:       # the price is shown, never invented: no price for this duration = no figures (create_pack refuses it)
        quote = pricing.pack_quote(cursor, pricing.normalize_type(session_type), plan[2], total)
    except HTTPException:
        quote = {"price_per_session": None, "total_price": None}
    return {
        "total_sessions": total,
        "price_per_session": pricing.number(quote["price_per_session"]),
        "total_price": pricing.number(quote["total_price"]),
        "dates": dates,
        "first_date": dates[0],
        "last_date": dates[-1],
        "replaces": replacement_summary(replaced),
        "conflicts": find_conflicts(
            cursor, user_id=user_id, trainer_id=trainer_id, session_dates=dates, preferred_time=preferred_time,
            ignore_session_ids=[item["id"] for item in replaced],
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


def replace_error(summary):
    """The 409 the panel turns into the "this cancels N sessions" confirmation."""
    return HTTPException(
        status_code=409,
        detail={
            "code": "replaces_pack",
            "message": (
                f"{summary['count']} session(s) of the current pack would be cancelled. "
                "Confirm to replace it."
            ),
            **summary,
        },
    )


def create_pack(
    cursor, created_event_ids, *, user_id, client_name, client_email, plan_id, trainer_id,
    trainer_name, sessions_per_week, preferred_days, preferred_time, start_date,
    request_id=None, allow_conflicts=False, confirm_replace=False,
    session_type=None, second_person_name=None, second_person_email=None
):
    """The one place that creates a pack: records the period and schedule,
    inserts every session and creates its Google Calendar event.

    Database rows go in first and the calendar events afterwards; the id of
    every event created is appended to `created_event_ids`, so the caller can
    delete them if anything fails later (before or at commit). Nothing is
    committed here.

    The client keeps ONE active pack: the previous one is replaced from
    `start_date`. Its sessions still to come from that date on are cancelled
    in the database here, and their Google events are listed in
    created["replaced"]["events"] to be deleted AFTER the commit with
    remove_replaced_events(). With sessions to cancel and
    confirm_replace=False nothing is created and a 409 "replaces_pack" with
    the count is raised.
    allow_conflicts: with colliding sessions (client busy, trainer busy or
    outside their hours) and allow_conflicts=False nothing is created and a 409
    with the list is raised; with True ("Crear igualmente") everything is
    created and nothing is silently dropped.

    session_type: individual (default) | dual. A dual pack needs the second person's name and email. The price
    per session and the total come from pricing.py (never from the caller) and are stored on the pack now.

    Returns {"plan_name", "total_sessions", "session_dates", "sessions", "session_type",
    "price_per_session", "total_price", "calendar_failed", "calendar_errors"} where sessions is
    [{"id", "start" (Madrid datetime), "trainer", "number"}]. Sessions whose
    calendar event could not be created are still created (and flagged).
    """
    session_type = pricing.normalize_type(session_type)
    second_person_name, second_person_email = pricing.second_person(session_type, second_person_name, second_person_email)

    cursor.execute("SELECT nome, duration_weeks, duracao_meses FROM plans WHERE id = %s", (plan_id,))
    plan = cursor.fetchone()
    if not plan or not plan[1]:
        raise HTTPException(status_code=404, detail="Plan not found")
    plan_name, weeks, months = plan

    total_sessions = weeks * sessions_per_week
    quote = pricing.pack_quote(cursor, session_type, months, total_sessions)
    session_dates = generate_session_dates(start_date, preferred_days, total_sessions)

    replaced = sessions_to_replace(cursor, user_id, start_date)
    if replaced and not confirm_replace:
        raise replace_error(replacement_summary(replaced))

    conflicts = find_conflicts(
        cursor, user_id=user_id, trainer_id=trainer_id, session_dates=session_dates,
        preferred_time=preferred_time, ignore_session_ids=[item["id"] for item in replaced],
    )
    if conflicts and not allow_conflicts:
        raise conflict_error(conflicts, trainer_name)

    # The new pack takes over: the previous active pack(s) stop being active
    # (their period ends the day before the new start) and their sessions from
    # the start date on are cancelled, keeping their numbers.
    cursor.execute(
        """
        UPDATE user_plans
        SET active = FALSE, status = 'sustituido', replaced_at = NOW(),
            end_date = CASE WHEN end_date IS NOT NULL AND end_date >= %s::date
                            THEN (%s::date - 1) ELSE end_date END
        WHERE user_id = %s AND active
        """,
        (start_date, start_date, user_id),
    )
    if replaced:
        cursor.execute(
            "UPDATE sessions SET status = 'Cancelled', feed_sequence = feed_sequence + 1 WHERE id = ANY(%s::int[])",
            ([item["id"] for item in replaced],),
        )

    # The event of every session is described from the client's profile.
    cursor.execute("SELECT nome, email, telefone FROM users WHERE id = %s", (user_id,))
    profile = cursor.fetchone()
    event_name, event_email, event_phone = profile if profile else (client_name, client_email, None)

    cursor.execute(
        """
        INSERT INTO user_plans
        (user_id, plan_id, active, start_date, end_date, sessions_per_week,
         preferred_days, preferred_time, trainer_id, session_type, second_person_name, second_person_email,
         price_per_session, total_price, status, created_at, duration_months)
        VALUES (%s, %s, TRUE, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'activo', NOW(), %s)
        RETURNING id
        """,
        (user_id, plan_id, session_dates[0], session_dates[-1], sessions_per_week,
         preferred_days, preferred_time, trainer_id, session_type, second_person_name, second_person_email,
         quote["price_per_session"], quote["total_price"], months)
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

    # Every event is made by the one central rule (calendar_sync.sync_sessions_to_google),
    # in parallel but never more than a few at a time. A calendar failure never stops the
    # sessions from existing: it is recorded on each session (calendar_sync_status /
    # calendar_sync_error), shown in the panel, and "Sincronizar con Google" retries it.
    results = calendar_sync.sync_sessions_to_google(cursor, [session_id for session_id, _, _ in pending])
    calendar_errors = []
    for item in results:
        if item["action"] == "failed":
            calendar_errors.append(item["error"])
        elif item["event_id"]:
            created_event_ids.append(item["event_id"])
    sessions = [
        {
            "id": session_id,
            "start": parse_madrid(session_date, str(preferred_time)[:5]),
            "trainer": trainer_name,
            "number": session_number,
        }
        for session_id, session_date, session_number in pending
    ]

    return {
        "pack_id": pack_id,
        "conflicts": conflicts,
        "plan_name": plan_name,
        "session_type": session_type,
        "second_person_name": second_person_name,
        "second_person_email": second_person_email,
        "price_per_session": quote["price_per_session"],
        "total_price": quote["total_price"],
        "total_sessions": total_sessions,
        "session_dates": session_dates,
        "sessions": sessions,
        "calendar_failed": len(calendar_errors),
        "calendar_errors": sorted(set(calendar_errors)),
        "replaced": {
            **replacement_summary(replaced),
            "events": [(item["id"], item["event_id"]) for item in replaced if item["event_id"]],
        },
    }


def remove_replaced_events(created):
    """Deletes from the calendar the events of the sessions a new pack
    cancelled. Call it AFTER the commit (nothing is deleted in Google for a
    pack that did not get saved). A failure never undoes the pack: it is
    recorded on the session and added to created["calendar_failed"] /
    ["calendar_errors"] so the panel warns. Returns `created`."""
    events = (created.get("replaced") or {}).get("events") or []
    if not events:
        return created
    conn = get_connection()
    cursor = conn.cursor()
    try:
        # the replaced sessions are Cancelled in the database: the central rule deletes their events
        for item in calendar_sync.sync_sessions_to_google(cursor, [session_id for session_id, _ in events]):
            if item["action"] == "failed":
                created["calendar_failed"] += 1
                if item["error"] not in created["calendar_errors"]:
                    created["calendar_errors"].append(item["error"])
        conn.commit()
    finally:
        cursor.close()
        conn.close()
    return created


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
        "session_type": created["session_type"],
        "second_person_name": created["second_person_name"],
        "price_per_session": created["price_per_session"],
        "total_price": created["total_price"],
    }
    if to_client:
        summary["calendar_links"] = calendar_feed.links_for_email(client_email)
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
        # The history of packs (nothing is ever deleted): how long the pack is, how it ended, and when.
        #   status: activo | sustituido are written when they happen; finalizado | cancelado are worked out when read
        #   (pack_view.pack_state) because they depend on the sessions and the date.
        cursor.execute("ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE")
        cursor.execute("ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS status TEXT")
        cursor.execute("ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS created_at TIMESTAMP")
        cursor.execute("ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS replaced_at TIMESTAMP")
        cursor.execute("ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS duration_months INTEGER")
        # Older packs: only what the data really says. The duration is the one of their plan; a pack that is no longer
        # active and has a LATER pack was replaced (that was the only way a pack stopped being active). When it was
        # created or replaced is unknown and stays empty.
        cursor.execute(
            "UPDATE user_plans up SET duration_months = p.duracao_meses FROM plans p WHERE p.id = up.plan_id AND up.duration_months IS NULL"
        )
        cursor.execute(
            """
            UPDATE user_plans up SET status = 'sustituido'
            WHERE up.status IS NULL AND NOT up.active
              AND EXISTS (SELECT 1 FROM user_plans later WHERE later.user_id = up.user_id AND later.id > up.id)
            """
        )
        conn.commit()
    finally:
        cursor.close()
        conn.close()

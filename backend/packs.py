"""Creating a pack: the single implementation shared by buying a new pack, approving a client's request and creating
a client from the admin panel.

A client can have SEVERAL active packs at once (for example a 1-month pack and, later, a 3-month one). Creating a pack
never touches the others: their sessions stay as they are and each pack runs, is numbered (x/y, y = the total of THAT pack)
and counts on its own. The start date of a new pack may be any day.

Conflicts: the TRAINER being busy or outside their hours blocks the pack (409 "conflicts") unless the admin creates it
anyway (allow_conflicts). The CLIENT ending up with two sessions at the same time (from different packs) is allowed, but the
admin is warned first, with the list (date, time and the pack the other session belongs to): 409 "client_overlap" until
the admin continues (allow_overlaps).

Each pack has its own period, schedule and numbering, and its sessions carry sessions.user_plan_id (sessions from before
that column existed are matched to a pack by date when they are read, never rewritten).

Database rows go in first and Google Calendar events afterwards; the caller owns the transaction and the list of created
event ids, so everything can be rolled back together.
"""
import traceback
import logging
from datetime import datetime, timedelta

from fastapi import HTTPException

from availability import has_conflict, slot_problem, weekday_name, within_hours
import pack_catalog
import pricing
from database import get_connection
from emails import clean_recipients, parse_extra, send_pack_summary_email
from emails.dates import parse_madrid
import calendar_feed
import calendar_sync
from google_calendar import create_calendar_event, delete_calendar_event, describe_error, http_status

logger = logging.getLogger("thundbalance.packs")

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


def find_conflicts(cursor, *, trainer_id, session_dates, preferred_time):
    """Sessions of a planned pack that collide with the TRAINER. Returns a list of {"date", "time", "kind", "message"};
    kind is one of
      trainer_busy   the trainer already has another session then
      trainer_hours  the trainer does not work at that day / hour
    These block the pack (unless the admin creates it anyway). Nothing is written."""
    time = str(preferred_time)[:5]
    conflicts = []
    for day in session_dates:
        problem = slot_problem(cursor, trainer_id, day, time)
        if problem:
            hours_ok = within_hours(cursor, trainer_id, weekday_name(day), time)
            kind = "trainer_busy" if hours_ok and has_conflict(cursor, trainer_id, day, time) else "trainer_hours"
            conflicts.append({"date": str(day), "time": time, "kind": kind, "message": problem})
    return conflicts


def find_overlaps(cursor, *, user_id, session_dates, preferred_time):
    """Sessions of a planned pack that fall at the same day and hour as a session the CLIENT already has (from another
    pack). Allowed, but the admin is warned: [{"date", "time", "kind": "client_busy", "pack": name(s) of the other pack}].
    Nothing is written."""
    if not user_id:
        return []
    time = str(preferred_time)[:5]
    cursor.execute(
        """
        SELECT s.session_date, COALESCE(string_agg(DISTINCT p.nome, ' + '), '')
        FROM sessions s
        LEFT JOIN user_plans up ON up.id = s.user_plan_id
        LEFT JOIN plans p ON p.id = up.plan_id
        WHERE s.user_id = %s AND s.status = 'Booked' AND s.session_date = ANY(%s::date[])
          AND to_char(s.session_time, 'HH24:MI') = %s
        GROUP BY s.session_date
        """,
        (user_id, list(session_dates), time),
    )
    busy = {str(row[0]): row[1] for row in cursor.fetchall()}
    return [
        {"date": str(day), "time": time, "kind": "client_busy", "pack": busy[str(day)],
         "message": "The client already has a session at that day and time."}
        for day in session_dates if str(day) in busy
    ]


def preview_pack(cursor, *, user_id, catalog_pack_id, trainer_id, sessions_per_week, preferred_days, preferred_time, start_date):
    """What a pack would create, without creating anything: the sessions, the price and the
    conflicts (see find_conflicts). The start date may be any day. `catalog_pack_id` is a catalogue pack."""
    _, days = validate_pack_request(
        cursor, trainer_id=trainer_id, sessions_per_week=sessions_per_week,
        preferred_days=preferred_days, start_date=start_date,
    )
    sale = pack_catalog.sale(cursor, catalog_pack_id, sessions_per_week)
    total = sale["total_sessions"]
    dates = generate_session_dates(start_date, ",".join(days), total)
    quote = {"price_per_session": sale["price_per_session"], "total_price": sale["total_price"]}
    return {
        "session_type": sale["pack"]["session_type"],
        "total_sessions": total,
        "price_per_session": pricing.number(quote["price_per_session"]),
        "total_price": pricing.number(quote["total_price"]),
        "dates": dates,
        "first_date": dates[0],
        "last_date": dates[-1],
        "conflicts": find_conflicts(cursor, trainer_id=trainer_id, session_dates=dates, preferred_time=preferred_time),
        "overlaps": find_overlaps(cursor, user_id=user_id, session_dates=dates, preferred_time=preferred_time),
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


def overlap_error(overlaps):
    """The 409 the panel turns into the warning "the client has two sessions at the same time" with "Continuar igualmente"."""
    return HTTPException(
        status_code=409,
        detail={
            "code": "client_overlap",
            "message": f"{len(overlaps)} session(s) fall at the same time as another session of the client. Continue anyway?",
            "overlaps": overlaps,
        },
    )


def session_type_sent(value):
    """True when the caller named a session type (None or empty means "whatever the pack is")."""
    return value is not None and str(value).strip() != ""


def create_pack(
    cursor, created_event_ids, *, user_id, client_name, client_email, catalog_pack_id, trainer_id,
    trainer_name, sessions_per_week, preferred_days, preferred_time, start_date,
    request_id=None, allow_conflicts=False, allow_overlaps=False,
    session_type=None, second_person_name=None, second_person_email=None, extra_emails=None
):
    """The one place that creates a pack: records the period and schedule,
    inserts every session and creates its Google Calendar event.

    Database rows go in first and the calendar events afterwards; the id of
    every event created is appended to `created_event_ids`, so the caller can
    delete them if anything fails later (before or at commit). Nothing is
    committed here.

    The client's other packs are never touched (they run in parallel, each with its own x/y).
    allow_conflicts: with the TRAINER busy or outside their hours and allow_conflicts=False nothing is created and a 409
    with the list is raised; with True ("Crear igualmente") everything is created and nothing is silently dropped.
    allow_overlaps: the same for the client's own sessions at the same time (409 "client_overlap" with the list, the
    other pack named, until the admin continues). Other packs are never touched.
    catalog_pack_id: the CATALOGUE pack being sold (pack_catalog.py). Its type, weeks and price decide everything: the price per
    session, the total, the weeks and the type are worked out from the catalogue (never from the caller) and COPIED onto
    the client's pack now, so a later edit of the catalogue never changes a pack already sold.
    session_type: when given it must be the pack's own type; a dual pack needs the second person's name and email.

    Returns {"plan_name", "total_sessions", "session_dates", "sessions", "session_type",
    "price_per_session", "total_price", "calendar_failed", "calendar_errors"} where sessions is
    [{"id", "start" (Madrid datetime), "trainer", "number"}]. Sessions whose
    calendar event could not be created are still created (and flagged).
    """
    session_type_arg = session_type
    sale = pack_catalog.sale(cursor, catalog_pack_id, sessions_per_week)
    session_type = sale["pack"]["session_type"]
    if session_type_sent(session_type_arg) and pricing.normalize_type(session_type_arg) != session_type:
        raise HTTPException(status_code=422, detail={
            "code": "invalid_session_type", "field": "session_type",
            "message": "El tipo de sesión no coincide con el pack. / The session type does not match the pack.",
        })
    second_person_name, second_person_email = pricing.second_person(session_type, second_person_name, second_person_email)
    plan_id, plan_name, weeks, months = sale["pack"]["plan_id"], sale["pack"]["name"], sale["weeks"], sale["months"]
    total_sessions = sale["total_sessions"]
    quote = {"price_per_session": sale["price_per_session"], "total_price": sale["total_price"]}
    session_dates = generate_session_dates(start_date, preferred_days, total_sessions)

    conflicts = find_conflicts(cursor, trainer_id=trainer_id, session_dates=session_dates, preferred_time=preferred_time)
    if conflicts and not allow_conflicts:
        raise conflict_error(conflicts, trainer_name)
    overlaps = find_overlaps(cursor, user_id=user_id, session_dates=session_dates, preferred_time=preferred_time)
    if overlaps and not allow_overlaps:
        raise overlap_error(overlaps)

    # The event of every session is described from the client's profile.
    cursor.execute("SELECT nome, email, telefone FROM users WHERE id = %s", (user_id,))
    profile = cursor.fetchone()
    event_name, event_email, event_phone = profile if profile else (client_name, client_email, None)

    cursor.execute(
        """
        INSERT INTO user_plans
        (user_id, plan_id, active, start_date, end_date, sessions_per_week,
         preferred_days, preferred_time, trainer_id, session_type, second_person_name, second_person_email,
         price_per_session, total_price, status, created_at, duration_months, catalog_pack_id, weeks, extra_emails)
        VALUES (%s, %s, TRUE, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'activo', NOW(), %s, %s, %s, %s)
        RETURNING id
        """,
        (user_id, plan_id, session_dates[0], session_dates[-1], sessions_per_week,
         preferred_days, preferred_time, trainer_id, session_type, second_person_name, second_person_email,
         quote["price_per_session"], quote["total_price"], months, catalog_pack_id, weeks,
         list(extra_emails) if extra_emails else None)
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
        "catalog_pack_id": catalog_pack_id,
        "plan_id": plan_id,
        "conflicts": conflicts,
        "overlaps": overlaps,
        "plan_name": plan_name,
        "session_type": session_type,
        "second_person_name": second_person_name,
        "second_person_email": second_person_email,
        "price_per_session": quote["price_per_session"],
        "total_price": quote["total_price"],
        "duration_weeks": weeks,
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


def clean_pack_recipients(extra_recipients, client_email):
    """The extra recipients of the pack email (the client always gets it; these get it in BCC): valid, lower case, no
    duplicates, at most 5. Checked before anything is created, so a typo is reported without side effects."""
    return parse_extra(extra_recipients, client_email)


def email_pack(created, *, client_name, client_email, days, sessions_per_week, trainer_name, to_client, extra):
    """Sends the pack summary after the sessions are saved. A failure never
    undoes them: it is reported in the answer so the panel can warn the admin. NOTHING in here may raise (the pack is
    already saved): any error becomes problem="error" and only its type is logged, never an address or a name."""
    try:
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
            "duration_weeks": created.get("duration_weeks"),
        }
        if to_client:
            summary["calendar_links"] = calendar_feed.links_for_email(client_email)
        result = send_pack_summary_email(summary, to_client=to_client, extra_recipients=extra)
        return {"sent_to": result.sent_to, "failed": result.failed, "problem": result.problem}
    except Exception as error:  # noqa: BLE001
        logger.error("Pack email could not be prepared (%s)", type(error).__name__)
        return {"sent_to": [], "failed": [], "problem": "error"}


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
        # The history of packs (nothing is ever deleted): how long the pack is and when it was created. The state of a pack
        # (activo | finalizado | cancelado) is worked out when read (pack_view.pack_state) from its sessions and the date.
        # `status` and `replaced_at` are only read by older rows: a pack no longer replaces another.
        cursor.execute("ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE")
        cursor.execute("ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS status TEXT")
        cursor.execute("ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS created_at TIMESTAMP")
        cursor.execute("ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS replaced_at TIMESTAMP")
        cursor.execute("ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS duration_months INTEGER")
        # the extra recipients the admin added when the pack was created (BCC of its email); kept for the calendar invitations
        cursor.execute("ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS extra_emails TEXT[]")
        # Older packs: only what the data really says. The duration is the one of their plan.
        cursor.execute(
            "UPDATE user_plans up SET duration_months = p.duracao_meses FROM plans p WHERE p.id = up.plan_id AND up.duration_months IS NULL"
        )
        conn.commit()
    finally:
        cursor.close()
        conn.close()

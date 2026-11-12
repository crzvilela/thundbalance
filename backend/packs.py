"""Creating a pack: the single implementation shared by buying a new pack, approving a client's request and creating
a client from the admin panel.

A client can have SEVERAL active packs at once (for example a 1-month pack and, later, a 3-month one). Creating a pack
never touches the others: their sessions stay as they are and each pack runs, is numbered (x/y, y = the total of THAT pack)
and counts on its own. The start date of a new pack may be any day.

Conflicts: the TRAINER being busy or outside their hours blocks the pack (409 "conflicts") unless the admin creates it
anyway (allow_conflicts). The CLIENT ending up with two sessions at the same time (from different packs) is allowed, but the
admin is warned first, with the list (date, time and the pack the other session belongs to): 409 "client_overlap" until
the admin continues (allow_overlaps).

The schedule of a pack is ONE ENTRY PER TRAINING DAY (weekday, hour and trainer: pack_schedule.py): there is no single hour
for the whole pack. Each session is created at its own day's hour with its own day's trainer.

Each pack has its own period, schedule and numbering, and its sessions carry sessions.user_plan_id (sessions from before
that column existed are matched to a pack by date when they are read, never rewritten).

ORDER OF OPERATIONS (docs/PACK_CREATION_ORDER.md): create_pack only validates and WRITES THE DATABASE ROWS; it never calls
Google. The caller commits and only THEN calls publish_calendar(), which creates the events (and so sends the invitations).
Nothing that can still fail happens after an invitation went out, and a failure while creating the events never deletes the ones
already created: each session records ok / failed and "Sincronizar con Google" repeats what is missing.
"""
import logging
from datetime import datetime

from fastapi import HTTPException

from availability import has_conflict, slot_problem, weekday_name, within_hours
import pack_schedule
import pack_catalog
import pricing
from database import get_connection
from emails import clean_recipients, parse_extra, send_pack_summary_email
from emails.dates import parse_madrid
import calendar_feed
import calendar_sync
from google_calendar import create_calendar_event, delete_calendar_event, describe_error, http_status   # noqa: F401 - the tests replace these two by name

logger = logging.getLogger("thundbalance.packs")

def find_conflicts(cursor, *, slots):
    """Sessions of a planned pack that collide with THEIR trainer. `slots` is [(date, time, trainer_id)] (pack_schedule.slots).
    Returns a list of {"date", "time", "trainer_id", "kind", "message"}; kind is one of
      trainer_busy   the trainer already has another session then
      trainer_hours  the trainer does not work at that day / hour
    These block the pack (unless the admin creates it anyway). Nothing is written."""
    conflicts = []
    for day, stamp, trainer_id in slots:
        time = str(stamp)[:5]
        problem = slot_problem(cursor, trainer_id, day, time)
        if problem:
            hours_ok = within_hours(cursor, trainer_id, weekday_name(day), time)
            kind = "trainer_busy" if hours_ok and has_conflict(cursor, trainer_id, day, time) else "trainer_hours"
            conflicts.append({"date": str(day), "time": time, "trainer_id": trainer_id, "kind": kind, "message": problem})
    return conflicts


def find_overlaps(cursor, *, user_id, slots):
    """Sessions of a planned pack that fall at the same day and hour as a session the CLIENT already has (from another
    pack). Allowed, but the admin is warned: [{"date", "time", "kind": "client_busy", "pack": name(s) of the other pack}].
    Nothing is written."""
    if not user_id or not slots:
        return []
    cursor.execute(
        """
        SELECT s.session_date, to_char(s.session_time, 'HH24:MI'), COALESCE(string_agg(DISTINCT p.nome, ' + '), '')
        FROM sessions s
        LEFT JOIN user_plans up ON up.id = s.user_plan_id
        LEFT JOIN plans p ON p.id = up.plan_id
        WHERE s.user_id = %s AND s.status = 'Booked' AND s.session_date = ANY(%s::date[])
        GROUP BY s.session_date, to_char(s.session_time, 'HH24:MI')
        """,
        (user_id, sorted({day for day, _, _ in slots})),
    )
    busy = {(str(row[0]), row[1]): row[2] for row in cursor.fetchall()}
    return [
        {"date": str(day), "time": str(stamp)[:5], "kind": "client_busy", "pack": busy[(str(day), str(stamp)[:5])],
         "message": "The client already has a session at that day and time."}
        for day, stamp, _ in slots if (str(day), str(stamp)[:5]) in busy
    ]


def trainer_names(cursor, entries):
    """{trainer_id: name} for the trainers of the schedule (404 when one does not exist)."""
    ids = sorted({entry["trainer_id"] for entry in entries if entry["trainer_id"] is not None})
    cursor.execute("SELECT id, nome FROM trainers WHERE id = ANY(%s::int[])", (ids,))
    names = dict(cursor.fetchall())
    if len(names) != len(ids):
        raise HTTPException(status_code=404, detail="Trainer not found")
    return names


def trainers_label(names):
    """"Carles" or "Carles, Marta": the trainers of a pack for the places that show one line."""
    seen = []
    for name in names:
        if name and name not in seen:
            seen.append(name)
    return ", ".join(seen)


def preview_pack(cursor, *, user_id, catalog_pack_id, sessions_per_week, schedule, start_date):
    """What a pack would create, without creating anything: the sessions (each with its hour and trainer), the price and the
    conflicts (see find_conflicts). The start date may be any day. `catalog_pack_id` is a catalogue pack."""
    entries, names = validate_pack_request(cursor, sessions_per_week=sessions_per_week, schedule=schedule, start_date=start_date)
    sale = pack_catalog.sale(cursor, catalog_pack_id, sessions_per_week)
    total = sale["total_sessions"]
    planned = pack_schedule.slots(start_date, entries, total)
    return {
        "session_type": sale["pack"]["session_type"],
        "total_sessions": total,
        "price_per_session": pricing.number(sale["price_per_session"]),
        "total_price": pricing.number(sale["total_price"]),
        "dates": [day for day, _, _ in planned],
        "sessions": [
            {"number": f"{index}/{total}", "date": day, "time": stamp, "trainer_id": trainer_id, "trainer": names.get(trainer_id)}
            for index, (day, stamp, trainer_id) in enumerate(planned, start=1)
        ],
        "first_date": planned[0][0],
        "last_date": planned[-1][0],
        "conflicts": find_conflicts(cursor, slots=planned),
        "overlaps": find_overlaps(cursor, user_id=user_id, slots=planned),
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
    cursor, *, user_id, client_name, client_email, catalog_pack_id,
    sessions_per_week, schedule, start_date,
    request_id=None, allow_conflicts=False, allow_overlaps=False,
    session_type=None, second_person_name=None, second_person_email=None, extra_emails=None,
    calendar_share=False, calendar_extra=()
):
    """The one place that creates a pack: records the period and schedule and inserts every session. DATABASE ONLY: no Google
    Calendar event is created here (the caller commits and then calls publish_calendar).

    `schedule`: one entry per training day, [{"weekday", "time", "trainer_id"}] (pack_schedule.clean). Every session is created at
    the hour and with the trainer of ITS day. Nothing here stores a single hour for the pack.

    Nothing is committed here. The sessions are saved with calendar_sync_status "pending" until publish_calendar runs.

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
    [{"id", "start" (Madrid datetime), "trainer", "number"}]. The calendar_* fields are 0 / [] until publish_calendar fills them.
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
    entries, names = validate_pack_request(cursor, sessions_per_week=sessions_per_week, schedule=schedule, start_date=start_date)
    planned = pack_schedule.slots(start_date, entries, total_sessions)
    session_dates = [day for day, _, _ in planned]
    trainer_name = trainers_label(names[entry["trainer_id"]] for entry in entries)

    conflicts = find_conflicts(cursor, slots=planned)
    if conflicts and not allow_conflicts:
        raise conflict_error(conflicts, trainer_name)
    overlaps = find_overlaps(cursor, user_id=user_id, slots=planned)
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
         preferred_days, preferred_time, trainer_id, schedule, session_type, second_person_name, second_person_email,
         price_per_session, total_price, status, created_at, duration_months, catalog_pack_id, weeks, extra_emails,
         calendar_share, calendar_extra)
        VALUES (%s, %s, TRUE, %s, %s, %s, %s, NULL, %s, %s::jsonb, %s, %s, %s, %s, %s, 'activo', NOW(), %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (user_id, plan_id, session_dates[0], session_dates[-1], sessions_per_week,
         pack_schedule.days_csv(entries), pack_schedule.main_trainer(entries), pack_schedule.dumps(entries),
         session_type, second_person_name, second_person_email,
         quote["price_per_session"], quote["total_price"], months, catalog_pack_id, weeks,
         list(extra_emails) if extra_emails else None,
         bool(calendar_share), ",".join(str(item).strip().lower() for item in (calendar_extra or ()) if str(item).strip()) or None)
    )
    pack_id = cursor.fetchone()[0]

    pending = []
    for index, (session_date, session_time, session_trainer) in enumerate(planned, start=1):
        session_number = f"{index}/{total_sessions}"
        cursor.execute(
            """
            INSERT INTO sessions
            (user_id, trainer_id, session_date, session_time, request_id, session_number, status, user_plan_id, calendar_sync_status)
            VALUES (%s, %s, %s, %s, %s, %s, 'Booked', %s, %s)
            RETURNING id
            """,
            (user_id, session_trainer, session_date, session_time, request_id, session_number, pack_id, calendar_sync.PENDING)
        )
        pending.append((cursor.fetchone()[0], session_date, session_time, session_trainer, session_number))

    sessions = [
        {
            "id": session_id,
            "start": parse_madrid(session_date, str(session_time)[:5]),
            "trainer": names.get(session_trainer),
            "number": session_number,
        }
        for session_id, session_date, session_time, session_trainer, session_number in pending
    ]

    return {
        "pack_id": pack_id,
        "catalog_pack_id": catalog_pack_id,
        "plan_id": plan_id,
        "conflicts": conflicts,
        "overlaps": overlaps,
        "plan_name": plan_name,
        "schedule": entries,
        "trainer_label": trainer_name,
        "session_type": session_type,
        "second_person_name": second_person_name,
        "second_person_email": second_person_email,
        "price_per_session": quote["price_per_session"],
        "total_price": quote["total_price"],
        "duration_weeks": weeks,
        "total_sessions": total_sessions,
        "objective": sale["pack"].get("objective"),
        "benefits": sale["pack"].get("benefits") or [],
        "session_dates": session_dates,
        "sessions": sessions,
        "calendar_failed": 0,
        "calendar_errors": [],
        "calendar_guests_warning": None,
    }


def publish_calendar(created):
    """Creates the Google Calendar events (and so sends the invitations) of a pack that is ALREADY COMMITTED. Call it only after
    the commit. It never raises and never deletes anything: every event is made by the one central rule
    (calendar_sync.sync_sessions_to_google, a few at a time) and each session records ok / failed with the reason; "Sincronizar
    con Google" repeats what is missing. Fills calendar_failed / calendar_errors / calendar_guests_warning of `created` and returns it."""
    ids = [item["id"] for item in created["sessions"]]
    errors, warning = [], None
    try:
        conn = get_connection()
        cursor = conn.cursor()
        try:
            for item in calendar_sync.sync_sessions_to_google(cursor, ids):
                if item["action"] == "failed":
                    errors.append(item["error"])
                warning = warning or item.get("guests_warning")
            conn.commit()
        finally:
            cursor.close()
            conn.close()
    except Exception as error:  # noqa: BLE001 - the pack is saved: this only marks the sessions so the sync can repeat them
        logger.error("calendar events of a new pack could not be written (%s)", type(error).__name__)
        errors.append(describe_error(error))
        _mark_failed(ids, errors[-1])
    created["calendar_failed"] = len(errors)
    created["calendar_errors"] = sorted(set(errors))
    created["calendar_guests_warning"] = warning        # "delegation_missing": the events exist but the client was not invited
    return created


def _mark_failed(session_ids, reason):
    """Best effort: sessions of a committed pack whose event step broke as a whole are marked failed (never raises)."""
    try:
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "UPDATE sessions SET calendar_sync_status = %s, calendar_sync_error = %s WHERE id = ANY(%s::int[]) AND google_event_id IS NULL",
                (calendar_sync.FAILED, str(reason)[:200], list(session_ids)),
            )
            conn.commit()
        finally:
            cursor.close()
            conn.close()
    except Exception as error:  # noqa: BLE001
        logger.error("sessions could not be marked as failed (%s)", type(error).__name__)


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
            "objective": created.get("objective"),
            "benefits": created.get("benefits") or [],
        }
        if to_client:
            summary["calendar_links"] = calendar_feed.links_for_email(client_email)
        result = send_pack_summary_email(summary, to_client=to_client, extra_recipients=extra)
        return {"sent_to": result.sent_to, "failed": result.failed, "problem": result.problem}
    except Exception as error:  # noqa: BLE001
        logger.error("Pack email could not be prepared (%s)", type(error).__name__)
        return {"sent_to": [], "failed": [], "problem": "error"}


def validate_pack_request(cursor, *, sessions_per_week, schedule, start_date):
    """Checks the parts of a pack request that do not depend on the client: sessions per week, the schedule (one entry per
    training day, each with its hour and trainer, as many entries as sessions per week) and a well-formed start date (no
    minimum). Returns (entries, {trainer_id: name})."""
    if not 1 <= sessions_per_week <= 7:
        raise HTTPException(status_code=400, detail="Sessions per week must be between 1 and 7")
    entries = pack_schedule.clean(schedule, sessions_per_week)
    names = trainer_names(cursor, entries)

    # Any day is allowed (today, inside the current pack, or in the past: the
    # panel asks for a confirmation before sending a past date).
    try:
        datetime.strptime(start_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=422, detail="Please choose a valid start date.")

    return entries, names


def ensure_pack_columns():
    """sessions.user_plan_id: which pack a session belongs to (NULL for sessions
    created before this existed; they are matched by date when read)."""
    from database import get_connection
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_plan_id INTEGER")
        pack_schedule.ensure_columns(cursor)
        # the guests of the pack's events (the client and the extra addresses see them in their Google Calendar)
        cursor.execute("ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS calendar_share BOOLEAN NOT NULL DEFAULT FALSE")
        cursor.execute("ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS calendar_extra TEXT")
        # who cancelled a session and when, and who restored it and when (nothing is ever deleted: soft only)
        cursor.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP")
        cursor.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cancelled_by TEXT")
        cursor.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS restored_at TIMESTAMP")
        cursor.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS restored_by TEXT")
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

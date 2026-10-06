"""Admin-only endpoints used by the redesigned admin panel.

Registered from main.py with register_admin_routes(); every route here is
protected by the same require_admin dependency as the other /admin/* routes.
"""

import traceback

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from database import get_connection
from datetime import datetime, timedelta


def age_from_birth_date(birth_date, today=None):
    today = today or datetime.now().date()
    return today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))

from availability import (
    WEEKDAYS, create_trainer, hhmm, save_hours, slot_problem,
    trainer_usage, validate_hours,
)
from google_calendar import create_trial_session_event, delete_calendar_event, list_calendar_events


class PlanPayload(BaseModel):
    nome: str = Field(min_length=1, max_length=80)
    duracao_meses: int = Field(ge=1, le=60)
    duration_weeks: int = Field(ge=1, le=260)
    preco: float = Field(ge=0, le=100000)


class HoursWindow(BaseModel):
    start: str
    end: str


class TrainerHoursPayload(BaseModel):
    hours: dict[str, HoursWindow | None]


class NewTrainerPayload(BaseModel):
    name: str
    specialty: str | None = None
    hours: dict[str, HoursWindow | None]


class TrialApprovePayload(BaseModel):
    trainer_id: int


class TrialRejectPayload(BaseModel):
    reason: str | None = Field(default=None, max_length=300)


def _iso(value):
    return value.isoformat() if value is not None else None


EXPIRING_DAYS = 7


def _pack_status(plan_id, end_date, today=None):
    """none | active | expiring (ends within a week) | expired."""
    if plan_id is None:
        return "none"
    if end_date is None:
        return "active"
    today = today or datetime.now().date()
    if end_date < today:
        return "expired"
    if (end_date - today).days <= EXPIRING_DAYS:
        return "expiring"
    return "active"


def register_admin_routes(app, require_admin):
    admin = [Depends(require_admin)]

    @app.get("/admin/clients", dependencies=admin)
    def admin_clients():
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                SELECT
                    u.id, u.nome, u.email, u.telefone, u.cidade, u.foto,
                    pl.id, pl.nome,
                    COALESCE(s.total, 0), COALESCE(s.done, 0),
                    COALESCE(s.upcoming, 0), s.next_date,
                    COALESCE(pl.end_date, s.last_date),
                    EXISTS (
                        SELECT 1 FROM client_requests cr
                        WHERE cr.user_id = u.id AND LOWER(cr.status) = 'pending'
                    )
                FROM users u
                LEFT JOIN LATERAL (
                    SELECT p.id, p.nome, up.end_date
                    FROM user_plans up JOIN plans p ON p.id = up.plan_id
                    WHERE up.user_id = u.id AND up.active
                    ORDER BY up.id DESC LIMIT 1
                ) pl ON TRUE
                LEFT JOIN LATERAL (
                    SELECT
                        COUNT(*) FILTER (WHERE status <> 'Cancelled') AS total,
                        COUNT(*) FILTER (WHERE status <> 'Cancelled' AND session_date < CURRENT_DATE) AS done,
                        COUNT(*) FILTER (WHERE status <> 'Cancelled' AND session_date >= CURRENT_DATE) AS upcoming,
                        MIN(session_date) FILTER (WHERE status <> 'Cancelled' AND session_date >= CURRENT_DATE) AS next_date,
                        MAX(session_date) FILTER (WHERE status <> 'Cancelled') AS last_date
                    FROM sessions WHERE user_id = u.id
                ) s ON TRUE
                ORDER BY LOWER(u.nome)
                """
            )
            return [
                {
                    "id": r[0], "name": r[1], "email": r[2], "phone": r[3],
                    "city": r[4], "photo": r[5],
                    "plan_id": r[6], "plan": r[7],
                    "total": r[8], "completed": r[9], "upcoming": r[10],
                    "next_session": _iso(r[11]), "pack_end": _iso(r[12]),
                    "pack_status": _pack_status(r[6], r[12]),
                    "has_pending_request": r[13],
                }
                for r in cursor.fetchall()
            ]
        finally:
            cursor.close()
            conn.close()

    @app.get("/admin/clients/{client_id}", dependencies=admin)
    def admin_client_detail(client_id: int):
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                SELECT id, nome, email, telefone, codigo_pais, cidade, morada, cep, foto
                FROM users WHERE id = %s
                """,
                (client_id,),
            )
            user = cursor.fetchone()
            if not user:
                raise HTTPException(status_code=404, detail="Client not found")

            cursor.execute(
                """
                SELECT p.id, p.nome, up.start_date, up.end_date, up.sessions_per_week,
                       up.preferred_days, up.preferred_time, up.trainer_id, t.nome
                FROM user_plans up
                JOIN plans p ON p.id = up.plan_id
                LEFT JOIN trainers t ON t.id = up.trainer_id
                WHERE up.user_id = %s AND up.active
                ORDER BY up.id DESC LIMIT 1
                """,
                (client_id,),
            )
            plan = cursor.fetchone()

            cursor.execute(
                """
                SELECT s.id, s.session_number, s.session_date, s.session_time,
                       t.nome, s.status
                FROM sessions s LEFT JOIN trainers t ON t.id = s.trainer_id
                WHERE s.user_id = %s
                ORDER BY s.session_date, s.session_time
                """,
                (client_id,),
            )
            sessions = [
                {
                    "id": r[0], "number": r[1], "date": _iso(r[2]),
                    "time": str(r[3])[:5] if r[3] else "",
                    "trainer": r[4], "status": r[5],
                }
                for r in cursor.fetchall()
            ]

            pack = None
            if plan:
                # Packs saved before periods were tracked fall back to the span
                # of the client's sessions.
                booked = [s["date"] for s in sessions if s["status"] != "Cancelled"]
                start = plan[2] or (datetime.strptime(min(booked), "%Y-%m-%d").date() if booked else None)
                end = plan[3] or (datetime.strptime(max(booked), "%Y-%m-%d").date() if booked else None)
                in_period = [
                    s for s in sessions
                    if s["status"] != "Cancelled"
                    and (not start or s["date"] >= start.isoformat())
                    and (not end or s["date"] <= end.isoformat())
                ]
                today_iso = datetime.now().date().isoformat()
                pack = {
                    "plan_id": plan[0], "name": plan[1],
                    "start_date": _iso(start), "end_date": _iso(end),
                    "sessions_per_week": plan[4],
                    "preferred_days": plan[5], "preferred_time": plan[6],
                    "trainer_id": plan[7], "trainer": plan[8],
                    "status": _pack_status(plan[0], end),
                    "total": len(in_period),
                    "done": sum(1 for s in in_period if s["date"] < today_iso),
                    "remaining": sum(1 for s in in_period if s["date"] >= today_iso),
                }

            return {
                "id": user[0], "name": user[1], "email": user[2], "phone": user[3],
                "country_code": user[4], "city": user[5], "address": user[6],
                "postal_code": user[7], "photo": user[8],
                "plan": {"id": plan[0], "name": plan[1]} if plan else None,
                "pack": pack,
                "sessions": sessions,
            }
        finally:
            cursor.close()
            conn.close()

    @app.post("/admin/sessions/{session_id}/cancel", dependencies=admin)
    def admin_cancel_session(session_id: int):
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT google_event_id, status FROM sessions WHERE id = %s",
                (session_id,),
            )
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Session not found")
            event_id, status = row
            if str(status).lower() == "cancelled":
                return {"message": "Session already cancelled"}

            if event_id:
                try:
                    delete_calendar_event(event_id)
                except Exception:
                    # The calendar event may already be gone; the session
                    # itself must still be cancelled.
                    traceback.print_exc()

            cursor.execute(
                "UPDATE sessions SET status = 'Cancelled' WHERE id = %s", (session_id,)
            )
            conn.commit()
            return {"message": "Session cancelled"}
        except HTTPException:
            conn.rollback()
            raise
        except Exception as error:
            conn.rollback()
            traceback.print_exc()
            raise HTTPException(
                status_code=500,
                detail=f"Could not cancel the session: {type(error).__name__}: {str(error)[:200]}",
            ) from error
        finally:
            cursor.close()
            conn.close()

    @app.post("/admin/plans", dependencies=admin)
    def admin_create_plan(plan: PlanPayload):
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                INSERT INTO plans (nome, duracao_meses, preco, duration_weeks)
                VALUES (%s, %s, %s, %s) RETURNING id
                """,
                (plan.nome.strip(), plan.duracao_meses, plan.preco, plan.duration_weeks),
            )
            plan_id = cursor.fetchone()[0]
            conn.commit()
            return {"id": plan_id}
        except Exception as error:
            conn.rollback()
            traceback.print_exc()
            raise HTTPException(
                status_code=500,
                detail=f"Could not create the plan: {type(error).__name__}: {str(error)[:200]}",
            ) from error
        finally:
            cursor.close()
            conn.close()

    @app.put("/admin/plans/{plan_id}", dependencies=admin)
    def admin_update_plan(plan_id: int, plan: PlanPayload):
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                UPDATE plans
                SET nome = %s, duracao_meses = %s, preco = %s, duration_weeks = %s
                WHERE id = %s RETURNING id
                """,
                (plan.nome.strip(), plan.duracao_meses, plan.preco, plan.duration_weeks, plan_id),
            )
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="Plan not found")
            conn.commit()
            return {"id": plan_id}
        except HTTPException:
            conn.rollback()
            raise
        except Exception as error:
            conn.rollback()
            traceback.print_exc()
            raise HTTPException(
                status_code=500,
                detail=f"Could not update the plan: {type(error).__name__}: {str(error)[:200]}",
            ) from error
        finally:
            cursor.close()
            conn.close()

    @app.delete("/admin/plans/{plan_id}", dependencies=admin)
    def admin_delete_plan(plan_id: int):
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT 1 FROM user_plans WHERE plan_id = %s LIMIT 1", (plan_id,))
            in_use = cursor.fetchone()
            if not in_use:
                cursor.execute("SELECT 1 FROM client_requests WHERE plan_id = %s LIMIT 1", (plan_id,))
                in_use = cursor.fetchone()
            if in_use:
                raise HTTPException(
                    status_code=409,
                    detail="This plan is used by clients or requests and cannot be deleted.",
                )
            cursor.execute("DELETE FROM plans WHERE id = %s RETURNING id", (plan_id,))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="Plan not found")
            conn.commit()
            return {"id": plan_id}
        except HTTPException:
            conn.rollback()
            raise
        finally:
            cursor.close()
            conn.close()

    @app.get("/admin/trial-sessions", dependencies=admin)
    def admin_trial_sessions():
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                SELECT ts.id, ts.full_name, ts.email, ts.phone, ts.age, ts.goal,
                       ts.experience, ts.session_date, ts.session_time, ts.status,
                       ts.trainer_id, t.nome, ts.rejection_reason, ts.created_at,
                       ts.birth_date
                FROM trial_sessions ts
                LEFT JOIN trainers t ON t.id = ts.trainer_id
                ORDER BY ts.id DESC
                """
            )
            return [
                {
                    "id": r[0], "name": r[1], "email": r[2], "phone": r[3],
                    # Age follows the birth date so it stays current after the request.
                    "age": age_from_birth_date(r[14]) if r[14] else r[4],
                    "birth_date": _iso(r[14]) if r[14] else None,
                    "goal": r[5], "experience": r[6], "date": _iso(r[7]),
                    "time": str(r[8])[:5] if r[8] else "", "status": str(r[9] or "Pending"),
                    "trainer_id": r[10], "trainer": r[11], "reason": r[12],
                    "created_at": _iso(r[13]),
                }
                for r in cursor.fetchall()
            ]
        finally:
            cursor.close()
            conn.close()

    @app.post("/admin/trial-sessions/{trial_id}/approve", dependencies=admin)
    def admin_approve_trial(trial_id: int, data: TrialApprovePayload):
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                SELECT full_name, email, phone, goal, experience, session_date, session_time
                FROM trial_sessions
                WHERE id = %s AND LOWER(status) = 'pending'
                FOR UPDATE
                """,
                (trial_id,),
            )
            trial = cursor.fetchone()
            if not trial:
                raise HTTPException(status_code=404, detail="Pending trial request not found")

            cursor.execute("SELECT nome FROM trainers WHERE id = %s", (data.trainer_id,))
            trainer = cursor.fetchone()
            if not trainer:
                raise HTTPException(status_code=404, detail="Trainer not found")

            problem = slot_problem(
                cursor, data.trainer_id, str(trial[5]), str(trial[6])[:5], ignore_trial_id=trial_id
            )
            if problem:
                raise HTTPException(status_code=409, detail=problem)

            # Nothing is written until the calendar event exists, so a Google
            # failure leaves the request Pending instead of half-approved.
            event_id = create_trial_session_event(
                trial[0], trial[1], trial[2], trial[3], trial[4],
                str(trial[5]), str(trial[6])[:5], trainer[0],
            )
            try:
                cursor.execute(
                    """
                    UPDATE trial_sessions
                    SET status = 'Approved', trainer_id = %s, google_event_id = %s,
                        rejection_reason = NULL
                    WHERE id = %s
                    """,
                    (data.trainer_id, event_id, trial_id),
                )
                conn.commit()
            except Exception:
                conn.rollback()
                try:
                    delete_calendar_event(event_id)
                except Exception:
                    traceback.print_exc()
                raise
            return {"message": "Trial session approved"}
        except HTTPException:
            conn.rollback()
            raise
        except Exception as error:
            conn.rollback()
            traceback.print_exc()
            raise HTTPException(
                status_code=500,
                detail=f"Could not approve the trial session: {type(error).__name__}: {str(error)[:200]}",
            ) from error
        finally:
            cursor.close()
            conn.close()

    @app.post("/admin/trial-sessions/{trial_id}/reject", dependencies=admin)
    def admin_reject_trial(trial_id: int, data: TrialRejectPayload):
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                UPDATE trial_sessions SET status = 'Rejected', rejection_reason = %s
                WHERE id = %s AND LOWER(status) = 'pending' RETURNING id
                """,
                ((data.reason or "").strip() or None, trial_id),
            )
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="Pending trial request not found")
            conn.commit()
            return {"message": "Trial session declined"}
        except HTTPException:
            conn.rollback()
            raise
        finally:
            cursor.close()
            conn.close()

    @app.post("/admin/trial-sessions/{trial_id}/cancel", dependencies=admin)
    def admin_cancel_trial(trial_id: int):
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT google_event_id, status FROM trial_sessions WHERE id = %s", (trial_id,)
            )
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Trial session not found")
            if str(row[1]).lower() != "approved":
                raise HTTPException(status_code=409, detail="Only approved trial sessions can be cancelled")
            if row[0]:
                try:
                    delete_calendar_event(row[0])
                except Exception:
                    traceback.print_exc()
            cursor.execute(
                "UPDATE trial_sessions SET status = 'Cancelled' WHERE id = %s", (trial_id,)
            )
            conn.commit()
            return {"message": "Trial session cancelled"}
        except HTTPException:
            conn.rollback()
            raise
        finally:
            cursor.close()
            conn.close()

    @app.get("/admin/calendar-events", dependencies=admin)
    def admin_calendar_events(start: str, end: str):
        """Live events from the Google Calendar, matched with the database.

        start is inclusive and end exclusive (YYYY-MM-DD). Each event is
        tagged as a client session, a trial session or something else that
        was added by hand in Google Calendar.
        """
        try:
            first = datetime.strptime(start, "%Y-%m-%d")
            last = datetime.strptime(end, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=422, detail="Use dates as YYYY-MM-DD")
        if last <= first or (last - first).days > 62:
            raise HTTPException(status_code=422, detail="Choose a range of up to 62 days")

        # One day of padding on each side: the UTC bounds below are only
        # approximate for Europe/Madrid, and the exact filtering is done by
        # the page using each event's own local time.
        time_min = (first - timedelta(days=1)).strftime("%Y-%m-%dT00:00:00Z")
        time_max = (last + timedelta(days=1)).strftime("%Y-%m-%dT00:00:00Z")

        try:
            raw_events = list_calendar_events(time_min, time_max)
        except Exception as error:
            traceback.print_exc()
            raise HTTPException(
                status_code=502,
                detail=f"Could not read Google Calendar: {type(error).__name__}: {str(error)[:200]}",
            ) from error

        ids = [event["id"] for event in raw_events if event.get("id")]
        sessions, trials = {}, {}
        if ids:
            conn = get_connection()
            cursor = conn.cursor()
            try:
                cursor.execute(
                    """
                    SELECT s.google_event_id, s.id, u.id, u.nome, t.nome, s.status, s.session_number
                    FROM sessions s
                    LEFT JOIN users u ON u.id = s.user_id
                    LEFT JOIN trainers t ON t.id = s.trainer_id
                    WHERE s.google_event_id = ANY(%s)
                    """,
                    (ids,),
                )
                sessions = {row[0]: row for row in cursor.fetchall()}
                cursor.execute(
                    """
                    SELECT ts.google_event_id, ts.id, ts.full_name, t.nome, ts.status
                    FROM trial_sessions ts
                    LEFT JOIN trainers t ON t.id = ts.trainer_id
                    WHERE ts.google_event_id = ANY(%s)
                    """,
                    (ids,),
                )
                trials = {row[0]: row for row in cursor.fetchall()}
            finally:
                cursor.close()
                conn.close()

        result = []
        for event in raw_events:
            start_info = event.get("start", {})
            end_info = event.get("end", {})
            all_day = "dateTime" not in start_info
            item = {
                "id": event.get("id"),
                "title": event.get("summary") or "",
                "description": event.get("description") or "",
                "all_day": all_day,
                # Local wall-clock time in Europe/Madrid, "YYYY-MM-DDTHH:MM".
                "start": (start_info.get("dateTime") or start_info.get("date") or "")[:16],
                "end": (end_info.get("dateTime") or end_info.get("date") or "")[:16],
                "link": event.get("htmlLink"),
                "kind": "other",
            }
            session = sessions.get(event.get("id"))
            trial = trials.get(event.get("id"))
            if session:
                item.update(
                    kind="session", session_id=session[1], client_id=session[2],
                    client=session[3], trainer=session[4], status=session[5],
                    number=session[6],
                )
            elif trial:
                item.update(
                    kind="trial", trial_id=trial[1], client=trial[2],
                    trainer=trial[3], status=trial[4],
                )
            result.append(item)
        return result

    @app.get("/admin/trainer-availability", dependencies=admin)
    def admin_trainer_availability():
        """Active trainers with their weekly hours:
        [{id, name, specialty, hours: {Monday: {start, end} | null, ...}}]"""
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT id, nome, especialidade FROM trainers WHERE active ORDER BY id")
            trainers = cursor.fetchall()
            cursor.execute(
                "SELECT trainer_id, day_of_week, start_time, end_time FROM trainer_availability"
            )
            hours = {}
            for trainer_id, day, start, end in cursor.fetchall():
                entry = hours.setdefault(trainer_id, {})
                current = entry.get(day)
                # More than one row on a day is unusual; show the widest span.
                if current:
                    start = min(hhmm(start), current["start"])
                    end = max(hhmm(end), current["end"])
                entry[day] = {"start": hhmm(start), "end": hhmm(end)}
            return [
                {
                    "id": row[0], "name": row[1], "specialty": row[2],
                    "hours": {day: hours.get(row[0], {}).get(day) for day in WEEKDAYS},
                }
                for row in trainers
            ]
        finally:
            cursor.close()
            conn.close()

    @app.put("/admin/trainers/{trainer_id}/availability", dependencies=admin)
    def admin_set_trainer_availability(trainer_id: int, data: TrainerHoursPayload):
        """Replaces the trainer's weekly hours. A weekday set to null means
        the trainer does not work that day."""
        try:
            validate_hours(data.hours)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error))

        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT 1 FROM trainers WHERE id = %s AND active", (trainer_id,))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="Trainer not found")
            save_hours(cursor, trainer_id, data.hours)
            conn.commit()
            return {"id": trainer_id}
        except HTTPException:
            conn.rollback()
            raise
        except Exception as error:
            conn.rollback()
            traceback.print_exc()
            raise HTTPException(
                status_code=500,
                detail=f"Could not save the hours: {type(error).__name__}: {str(error)[:200]}",
            ) from error
        finally:
            cursor.close()
            conn.close()

    @app.post("/admin/trainers", dependencies=admin)
    def admin_create_trainer(data: NewTrainerPayload):
        """Adds a trainer together with their weekly hours."""
        name = data.name.strip()
        if len(name) < 2 or len(name) > 60:
            raise HTTPException(status_code=422, detail="Enter the trainer's name (2 to 60 characters).")
        try:
            validate_hours(data.hours)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error))
        if not any(window is not None for window in data.hours.values()):
            raise HTTPException(status_code=422, detail="Choose at least one working day.")

        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT 1 FROM trainers WHERE active AND LOWER(nome) = LOWER(%s)", (name,))
            if cursor.fetchone():
                raise HTTPException(status_code=409, detail=f"There is already a trainer named {name}.")
            trainer_id = create_trainer(cursor, name, (data.specialty or "").strip()[:80] or None)
            save_hours(cursor, trainer_id, data.hours)
            conn.commit()
            return {"id": trainer_id}
        except HTTPException:
            conn.rollback()
            raise
        except Exception as error:
            conn.rollback()
            traceback.print_exc()
            raise HTTPException(
                status_code=500,
                detail=f"Could not create the trainer: {type(error).__name__}: {str(error)[:200]}",
            ) from error
        finally:
            cursor.close()
            conn.close()

    @app.delete("/admin/trainers/{trainer_id}", dependencies=admin)
    def admin_remove_trainer(trainer_id: int):
        """Removes a trainer from the site.

        - With upcoming sessions or approved trials: refused (those clients
          would be left without a trainer).
        - With only past history: archived (hidden everywhere, history kept).
        - With no history at all: deleted for good.
        """
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT nome FROM trainers WHERE id = %s AND active", (trainer_id,))
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Trainer not found")

            has_history, upcoming = trainer_usage(cursor, trainer_id)
            if upcoming:
                raise HTTPException(
                    status_code=409,
                    detail=f"{row[0]} still has {upcoming} upcoming session(s). Cancel or move them first.",
                )

            if has_history:
                cursor.execute("UPDATE trainers SET active = FALSE WHERE id = %s", (trainer_id,))
                outcome = "archived"
            else:
                cursor.execute("DELETE FROM trainer_availability WHERE trainer_id = %s", (trainer_id,))
                cursor.execute("DELETE FROM trainers WHERE id = %s", (trainer_id,))
                outcome = "deleted"
            conn.commit()
            return {"id": trainer_id, "outcome": outcome}
        except HTTPException:
            conn.rollback()
            raise
        finally:
            cursor.close()
            conn.close()

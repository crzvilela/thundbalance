"""A client's packs and which sessions belong to each (read only).

A client can have several active packs at the same time. New sessions carry
sessions.user_plan_id; sessions from before that column existed have none and
are matched to the pack whose period contains their date (the pack that started
last wins when periods overlap). Nothing is ever rewritten here.
"""
from datetime import date


def user_packs(cursor, user_id, today=None):
    """(packs, assignment).

    packs: list of dicts, oldest first: id, plan_id, name, active, start_date,
    end_date, sessions_per_week, preferred_days, preferred_time, trainer_id,
    trainer, session_type, second_person_name / _email, price_per_session, total_price (what was
    stored when the pack was created; empty for packs from before prices), total, done, remaining (non-cancelled sessions of that pack) and
    `shown`: the pack is active, or it still has sessions to come (a pack from a
    renewal made before packs could run in parallel).
    assignment: {session_id: pack_id or None}.
    """
    today = today or date.today()
    cursor.execute(
        """
        SELECT up.id, up.plan_id, p.nome, up.active, up.start_date, up.end_date,
               up.sessions_per_week, up.preferred_days, up.preferred_time, up.trainer_id, t.nome,
               up.session_type, up.second_person_name, up.second_person_email, up.price_per_session, up.total_price,
               up.status, up.created_at, up.replaced_at, COALESCE(up.duration_months, p.duracao_meses)
        FROM user_plans up
        JOIN plans p ON p.id = up.plan_id
        LEFT JOIN trainers t ON t.id = up.trainer_id
        WHERE up.user_id = %s
        ORDER BY up.id
        """,
        (user_id,),
    )
    packs = [
        {
            "id": r[0], "plan_id": r[1], "name": r[2], "active": bool(r[3]),
            "start_date": r[4], "end_date": r[5], "sessions_per_week": r[6],
            "preferred_days": r[7], "preferred_time": r[8], "trainer_id": r[9], "trainer": r[10],
            "session_type": r[11] or "individual", "second_person_name": r[12], "second_person_email": r[13],
            "price_per_session": r[14], "total_price": r[15],
            "stored_status": r[16], "created_at": r[17], "replaced_at": r[18], "duration_months": r[19],
            "total": 0, "done": 0, "remaining": 0, "_dates": [],
        }
        for r in cursor.fetchall()
    ]
    by_id = {pack["id"]: pack for pack in packs}

    cursor.execute(
        "SELECT id, session_date, status, user_plan_id FROM sessions WHERE user_id = %s",
        (user_id,),
    )
    assignment = {}
    only_undated = packs[0] if len(packs) == 1 and not packs[0]["start_date"] else None
    for session_id, day, status, plan_id in cursor.fetchall():
        if plan_id in by_id:
            owner = plan_id
        else:
            matching = [
                p for p in packs
                if p["start_date"] and p["start_date"] <= day and (p["end_date"] is None or day <= p["end_date"])
            ]
            if matching:
                owner = max(matching, key=lambda p: (p["start_date"], p["id"]))["id"]
            elif only_undated:
                owner = only_undated["id"]
            else:
                owner = None
        assignment[session_id] = owner
        if owner is not None and status != "Cancelled":
            pack = by_id[owner]
            pack["total"] += 1
            pack["_dates"].append(day)
            if day < today:
                pack["done"] += 1
            else:
                pack["remaining"] += 1

    for pack in packs:
        dates = pack.pop("_dates")
        # packs saved before periods were tracked fall back to the span of their sessions
        pack["start_date"] = pack["start_date"] or (min(dates) if dates else None)
        pack["end_date"] = pack["end_date"] or (max(dates) if dates else None)
        pack["shown"] = pack["active"] or pack["remaining"] > 0
    return packs, assignment


# ---------------------------------------------------------------- "has an active pack"
# ONE definition of "active account", the one the dashboard and the panel use for a pack that is
# "shown": the pack is active (user_plans.active) or it still has sessions to come.
def active_pack_sql(user_column="u.id"):
    """A SQL condition (no parameters) true for the users that have an active pack."""
    return (
        f"EXISTS (SELECT 1 FROM user_plans up WHERE up.user_id = {user_column} AND (up.active OR EXISTS ("
        "SELECT 1 FROM sessions s WHERE s.user_plan_id = up.id AND s.status <> 'Cancelled' AND s.session_date >= CURRENT_DATE)))"
    )


def has_active_pack(cursor, user_id):
    cursor.execute(f"SELECT {active_pack_sql('%s')}", (user_id,))
    return bool(cursor.fetchone()[0])


# ---------------------------------------------------------------- the history of a client's packs
def pack_state(stored, active, planned, done, remaining, end_date, today):
    """activo | finalizado | sustituido | cancelado.
    sustituido (and cancelado, if ever stored) are written when they happen. The others come from the sessions:
    with sessions still to come the pack is activo; if every session was cancelled and none took place it is
    cancelado; otherwise it ran its course (finalizado)."""
    if stored in ("sustituido", "cancelado"):
        return stored
    if remaining > 0:
        return "activo"
    if planned > 0 and done == 0:
        return "cancelado"
    if active and planned == 0 and (end_date is None or end_date >= today):
        return "activo"
    return "finalizado"


def pack_history(cursor, user_id, today=None):
    """Every pack the client has ever had, newest first (by start date), each with its sessions. Nothing is hidden or
    deleted. `planned` counts every session of the pack (cancelled ones too), `used` the ones that took place,
    `cancelled` the cancelled ones. Values an old pack never stored stay None."""
    today = today or date.today()
    packs, assignment = user_packs(cursor, user_id, today)
    cursor.execute(
        """
        SELECT s.id, s.session_number, s.session_date, s.session_time, s.status, t.nome
        FROM sessions s LEFT JOIN trainers t ON t.id = s.trainer_id
        WHERE s.user_id = %s ORDER BY s.session_date, s.session_time, s.id
        """,
        (user_id,),
    )
    by_pack = {}
    for session_id, number, day, moment, status, trainer in cursor.fetchall():
        by_pack.setdefault(assignment.get(session_id), []).append({
            "id": session_id, "number": number, "date": day, "time": str(moment)[:5] if moment else "",
            "status": status, "trainer": trainer,
        })
    history = []
    for pack in packs:
        sessions = by_pack.get(pack["id"], [])
        history.append({
            **{key: pack[key] for key in (
                "id", "plan_id", "name", "active", "start_date", "end_date", "sessions_per_week", "trainer",
                "session_type", "second_person_name", "second_person_email", "price_per_session", "total_price",
                "created_at", "replaced_at", "duration_months",
            )},
            "planned": len(sessions), "used": pack["done"], "remaining": pack["remaining"],
            "cancelled": sum(1 for item in sessions if item["status"] == "Cancelled"),
            "status": pack_state(pack["stored_status"], pack["active"], len(sessions), pack["done"], pack["remaining"], pack["end_date"], today),
            "sessions": sessions,
        })
    history.sort(key=lambda item: (item["start_date"] or date.min, item["id"]), reverse=True)
    return history

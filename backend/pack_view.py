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
    trainer, total, done, remaining (non-cancelled sessions of that pack) and
    `shown`: the pack is active, or it still has sessions to come (a pack from a
    renewal made before packs could run in parallel).
    assignment: {session_id: pack_id or None}.
    """
    today = today or date.today()
    cursor.execute(
        """
        SELECT up.id, up.plan_id, p.nome, up.active, up.start_date, up.end_date,
               up.sessions_per_week, up.preferred_days, up.preferred_time, up.trainer_id, t.nome
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

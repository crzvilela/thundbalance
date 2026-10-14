"""Real end-to-end check of "Añadir cliente", run BY YOU on purpose.

    python smoke_create_client.py tu.correo+prueba@gmail.com
    python smoke_create_client.py tu.correo+prueba@gmail.com --with-pack

It creates ONE test client through the same code the admin panel uses, in the
database and Firebase project this machine is configured for, then removes
exactly what it created: the Firebase account, the sessions, the pack, the
profile row and any Google Calendar events. The welcome email (with the
generated password) goes to the address you give, so use your own.

Needs FIREBASE_CREDENTIALS_PATH (and DATABASE_URL if you target production).
The password is never printed.
"""
import sys
from datetime import date, timedelta

import client_accounts
import firebase_accounts as accounts
import main
from availability import WEEKDAYS, trainers_for_slot, weekly_start_times
from database import get_connection
from google_calendar import delete_calendar_event


def pick_pack(cursor):
    """A plan + trainer + weekday/time that really fits the current availability."""
    cursor.execute("SELECT id, nome FROM plans WHERE duration_weeks IS NOT NULL ORDER BY duration_weeks, id LIMIT 1")
    plan = cursor.fetchone()
    if not plan:
        raise SystemExit("There is no plan with duration_weeks to test a pack with.")
    start = date.today() + timedelta(days=8)
    schedule = weekly_start_times(cursor)
    for offset in range(14):
        day = start + timedelta(days=offset)
        times = schedule.get(WEEKDAYS[day.weekday()]) or []
        for time in times:
            trainers = trainers_for_slot(cursor, day.isoformat(), time)
            if trainers:
                return plan, trainers[0], WEEKDAYS[day.weekday()], time, day.isoformat()
    raise SystemExit("Could not find a free slot in the next two weeks.")


def main_script():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    with_pack = "--with-pack" in sys.argv
    if len(args) != 1 or "@" not in args[0]:
        print(__doc__)
        return 2
    email = args[0].strip().lower()

    ready, reason = accounts.status()
    print(f"Firebase Admin ready: {ready} ({reason})")
    if not ready:
        return 1
    conn = get_connection()
    print(f"Database host: {conn.get_dsn_parameters().get('host')}")
    print(f"Test client email: {email}   pack: {'yes' if with_pack else 'no'}")
    if input("This creates a REAL test account and removes it afterwards. Type SI to continue: ").strip() != "SI":
        return 1

    create = next(r.endpoint for r in main.app.routes
                  if getattr(r, "path", None) == "/admin/clients" and "POST" in r.methods)
    cur = conn.cursor()
    pack = None
    if with_pack:
        plan, (trainer_id, trainer_name), weekday, time, start = pick_pack(cur)
        print(f"Pack: {plan[1]}, {weekday} {time} with {trainer_name}, starting {start}")
        pack = client_accounts.ClientPack(plan_id=plan[0], sessions_per_week=1, preferred_days=weekday,
                                          preferred_time=time, trainer_id=trainer_id, start_date=start)
    conn.close()

    user_id = None
    try:
        result = create(client_accounts.CreateClient(name="PRUEBA ThundBalance (borrar)", email=email, pack=pack))
        user_id = result["id"]
        print(f"Created client id={user_id}; welcome email sent: {result['email']['sent']}"
              f"{'' if result['email']['sent'] else ' (' + result['email']['problem'] + ')'}")
        if result["pack"]:
            print(f"Pack sessions created: {result['pack']['total_sessions']}")
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT firebase_uid, must_change_password FROM users WHERE id = %s", (user_id,))
        uid, must_change = cur.fetchone()
        conn.close()
        print(f"Postgres row: firebase_uid set={bool(uid)}, must_change_password={must_change}")
        from firebase_admin import auth
        record = auth.get_user_by_email(email)
        print(f"Firebase account exists: {record.uid == uid}, email_verified={record.email_verified}")
    finally:
        if user_id is None:
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("SELECT id FROM users WHERE LOWER(email) = %s AND nome = 'PRUEBA ThundBalance (borrar)'", (email,))
            row = cur.fetchone()
            conn.close()
            user_id = row[0] if row else None
        if user_id is not None:
            cleanup(user_id, email)
    return 0


def cleanup(user_id, email):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT firebase_uid FROM users WHERE id = %s AND nome = 'PRUEBA ThundBalance (borrar)'", (user_id,))
    row = cur.fetchone()
    if not row:
        conn.close()
        print("Cleanup skipped: that row is not the test client.")
        return
    uid = row[0]
    cur.execute("SELECT google_event_id FROM sessions WHERE user_id = %s AND google_event_id IS NOT NULL", (user_id,))
    events = [r[0] for r in cur.fetchall()]
    removed_events = 0
    for event_id in events:
        try:
            delete_calendar_event(event_id)
            removed_events += 1
        except Exception as error:  # noqa: BLE001
            print(f"  could not delete calendar event: {type(error).__name__}")
    cur.execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))
    sessions = cur.rowcount
    cur.execute("DELETE FROM user_plans WHERE user_id = %s", (user_id,))
    plans = cur.rowcount
    cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
    conn.commit()
    conn.close()
    firebase_removed = accounts.delete_login(uid) if uid else False
    print("Cleanup done: "
          f"Firebase account removed={firebase_removed}, calendar events removed={removed_events}/{len(events)}, "
          f"sessions={sessions}, packs={plans}, profile row=1")


if __name__ == "__main__":
    sys.exit(main_script())

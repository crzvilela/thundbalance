"""The backend of the accessibility audit: the real app, on the LOCAL database, that accepts the test tokens of the login stub.

    cd backend && ENV=development python ../tests/a11y/backend_server.py        (port 8000)

It seeds one client (a pack, sessions, a trial) with the e-mail of the stub and removes it when it stops with --clean. Never run it
against a real database: it refuses unless the database is local.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "backend"))
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "backend"))

import firebase_accounts  # noqa: E402
import main  # noqa: E402
import testsafety  # noqa: E402
from database import get_connection  # noqa: E402

testsafety.require_local_database()
ISS = f"https://securetoken.google.com/{main.FIREBASE_PROJECT_ID}"
CLIENT_EMAIL = "a11y-client@example.test"
TOKENS = {
    "test-admin": {"iss": ISS, "email": main.ADMIN_EMAIL, "sub": "uid-a11y-admin", "email_verified": True},
    "test-client": {"iss": ISS, "email": CLIENT_EMAIL, "sub": "uid-a11y-client", "email_verified": True},
}


def seed():
    from datetime import date, timedelta
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = %s)", (CLIENT_EMAIL,))
    cur.execute("DELETE FROM user_plans WHERE user_id IN (SELECT id FROM users WHERE email = %s)", (CLIENT_EMAIL,))
    cur.execute("DELETE FROM users WHERE email = %s", (CLIENT_EMAIL,))
    cur.execute("INSERT INTO users (nome, email, firebase_uid, telefone) VALUES ('Ana Auditoria', %s, 'uid-a11y-client', '+34600000000') RETURNING id", (CLIENT_EMAIL,))
    user = cur.fetchone()[0]
    cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 1")
    trainer = cur.fetchone()[0]
    cur.execute("SELECT id FROM plans ORDER BY id LIMIT 1")
    plan = cur.fetchone()[0]
    cur.execute("INSERT INTO user_plans (user_id, plan_id, active, trainer_id, sessions_per_week, start_date, end_date) VALUES (%s, %s, TRUE, %s, 2, CURRENT_DATE, CURRENT_DATE + 28) RETURNING id", (user, plan, trainer))
    pack = cur.fetchone()[0]
    for index in range(4):
        cur.execute(
            "INSERT INTO sessions (user_id, trainer_id, session_date, session_time, status, session_number, user_plan_id) VALUES (%s, %s, %s, '10:00', 'Booked', %s, %s)",
            (user, trainer, date.today() + timedelta(days=3 + index * 3), f"{index + 1}/4", pack))
    conn.commit()
    conn.close()


def clean():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = %s)", (CLIENT_EMAIL,))
    cur.execute("DELETE FROM user_plans WHERE user_id IN (SELECT id FROM users WHERE email = %s)", (CLIENT_EMAIL,))
    cur.execute("DELETE FROM inbox_recipients WHERE user_id IN (SELECT id FROM users WHERE email = %s)", (CLIENT_EMAIL,))
    cur.execute("DELETE FROM users WHERE email = %s", (CLIENT_EMAIL,))
    conn.commit()
    conn.close()


if __name__ == "__main__":
    if "--clean" in sys.argv:
        clean()
        print("cleaned")
        sys.exit(0)
    main.id_token.verify_firebase_token = lambda token, *a, **k: TOKENS[token]
    firebase_accounts.init_firebase_admin = lambda: (False, "audit")          # no revocation check against the real Firebase
    seed()
    import uvicorn
    uvicorn.run(main.app, host="127.0.0.1", port=8000, log_level="warning")

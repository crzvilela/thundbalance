"""Clears the test data so the site starts as if it launches tomorrow.

DELETES (irreversible, so a JSON backup is written first):
  clients (users) except the admin, their pack assignments, sessions,
  training requests, trial sessions, and the Google Calendar events created
  for sessions and trial sessions.

KEEPS: plans, trainers and their working hours, landing page content,
training videos, app settings, the admin's own row, and the Firebase accounts
(login e-mails/passwords, admin included) - this script never touches Firebase.

Usage (from the backend folder):
  1. Point it at the database. For the Render database use its EXTERNAL
     connection URL (Render > the Postgres > Connections):
       PowerShell:  $env:DATABASE_URL = "postgresql://..."
  2. Look first (changes nothing):      python reset_test_data.py
  3. Then really delete:                python reset_test_data.py --apply
     (it shows the database and calendar, and asks you to type RESET)

Options:
  --keep-calendar   do not delete Google Calendar events
  --admin-email X   admin row to keep (default: ADMIN_EMAIL or david@admin.es)
"""
import argparse
import json
import os
import sys
from datetime import datetime
from urllib.parse import urlparse

import psycopg2
from psycopg2.extras import RealDictCursor

# Child tables first, so foreign keys never block a delete.
CLEAR_TABLES = ["sessions", "client_requests", "user_plans", "trial_sessions"]
KEEP_TABLES = ["plans", "trainers", "trainer_availability", "landing_page_content", "training_videos", "app_settings"]


def describe_database():
    url = os.getenv("DATABASE_URL", "")
    if not url:
        return "localhost / thundbalance (local development database)"
    parsed = urlparse(url)
    return f"{parsed.hostname}{':' + str(parsed.port) if parsed.port else ''} / {parsed.path.lstrip('/')}"


def connect():
    from database import get_connection
    return get_connection()


def table_exists(cursor, name):
    cursor.execute("SELECT to_regclass(%s) IS NOT NULL", (f"public.{name}",))
    return cursor.fetchone()[0]


def column_exists(cursor, table, column):
    cursor.execute(
        "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = %s AND column_name = %s",
        (table, column),
    )
    return cursor.fetchone() is not None


def count(cursor, name, where="", params=()):
    if not table_exists(cursor, name):
        return None
    cursor.execute(f"SELECT COUNT(*) FROM {name} {where}", params)
    return cursor.fetchone()[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="really delete (default is a dry run)")
    parser.add_argument("--keep-calendar", action="store_true")
    parser.add_argument("--admin-email", default=os.getenv("ADMIN_EMAIL", "david@admin.es"))
    args = parser.parse_args()
    admin = args.admin_email.strip().lower()

    conn = connect()
    cursor = conn.cursor()
    plain = conn.cursor(cursor_factory=RealDictCursor)

    print(f"\nDatabase : {describe_database()}")
    print(f"Admin row kept (by e-mail): {admin}")
    print("\nWill be DELETED:")
    users_where = "WHERE LOWER(email) <> %s"
    for table in CLEAR_TABLES:
        print(f"  {table:<18} {count(cursor, table)} rows")
    print(f"  {'users':<18} {count(cursor, 'users', users_where, (admin,))} rows (everyone except the admin)")

    cursor.execute("SELECT COUNT(*) FROM users WHERE LOWER(email) = %s", (admin,))
    admin_rows = cursor.fetchone()[0]
    print(f"\nAdmin rows found in users: {admin_rows} (kept)")
    print("\nWill be KEPT:")
    for table in KEEP_TABLES:
        print(f"  {table:<22} {count(cursor, table)} rows")

    events = []
    if not args.keep_calendar:
        for table in ("sessions", "trial_sessions"):
            if table_exists(cursor, table) and column_exists(cursor, table, "google_event_id"):
                cursor.execute(f"SELECT google_event_id FROM {table} WHERE google_event_id IS NOT NULL")
                events += [row[0] for row in cursor.fetchall()]
        events = sorted(set(events))
        from google_calendar import CALENDAR_ID
        print(f"\nGoogle Calendar events to delete: {len(events)}")
        print(f"Calendar: {CALENDAR_ID}")
    else:
        print("\nGoogle Calendar: untouched (--keep-calendar)")

    if not args.apply:
        print("\nDRY RUN: nothing was changed. Run again with --apply to delete.")
        return

    if input("\nThis cannot be undone (a backup file is written first). Type RESET to continue: ").strip() != "RESET":
        print("Cancelled.")
        return

    # 1) Backup of everything about to be removed.
    backup = {"created_at": datetime.now().isoformat(), "database": describe_database(), "tables": {}}
    for table in ["users"] + CLEAR_TABLES:
        if table_exists(cursor, table):
            plain.execute(f"SELECT * FROM {table}")
            backup["tables"][table] = plain.fetchall()
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), f"backup_before_reset_{datetime.now():%Y%m%d_%H%M%S}.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(backup, handle, ensure_ascii=False, indent=1, default=str)
    print(f"Backup written: {path}")

    # 2) Calendar events (a missing event is fine: it is already gone).
    if events:
        from google_calendar import delete_calendar_event
        removed = failed = 0
        for event_id in events:
            try:
                delete_calendar_event(event_id)
                removed += 1
            except Exception as error:  # noqa: BLE001
                text = str(error)
                if "404" in text or "410" in text or "deleted" in text.lower():
                    removed += 1
                else:
                    failed += 1
                    print(f"  could not delete event {event_id}: {text[:120]}")
        print(f"Calendar events removed: {removed}, failed: {failed}")
        if failed and input("Some events failed. Continue with the database anyway? (y/N) ").strip().lower() != "y":
            print("Stopped before touching the database.")
            return

    # 3) Database, in one transaction.
    try:
        for table in CLEAR_TABLES:
            if table_exists(cursor, table):
                cursor.execute(f"DELETE FROM {table}")
        cursor.execute("DELETE FROM users WHERE LOWER(email) <> %s", (admin,))
        for table in CLEAR_TABLES:
            if table_exists(cursor, table):
                cursor.execute("SELECT pg_get_serial_sequence(%s, 'id')", (table,))
                sequence = cursor.fetchone()[0]
                if sequence:
                    cursor.execute("SELECT setval(%s, 1, false)", (sequence,))
        conn.commit()
    except Exception:
        conn.rollback()
        print("Database error: nothing was deleted from the database.")
        raise

    print("\nDone. Remaining:")
    for table in CLEAR_TABLES:
        print(f"  {table:<18} {count(cursor, table)}")
    print(f"  {'users':<18} {count(cursor, 'users')} (admin only)")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("Cancelled.")

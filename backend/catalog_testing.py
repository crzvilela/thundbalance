"""Catalogue packs for the tests: the older tests build their own `plans` row (2 or 3 weeks long) and sell packs from it.
`make_pair` makes the catalogue packs (individual and dual, 1 to 7 sessions per week, 65 and 80 EUR per session) that stand
for such a plan, `drop` removes the ones of the test plans. Nothing here is used by the app."""
import plans_schema  # noqa: F401  (the tests import it too; keeps the import order the same)

PRICES = {"individual": 65, "dual": 80}


def make_pair(cursor, plan_id, options=(1, 2, 3, 4, 5, 6, 7)):
    """{"individual": id, "dual": id} of two new catalogue packs that sell `plan_id` (same name and weeks)."""
    cursor.execute("SELECT nome, duration_weeks FROM plans WHERE id = %s", (plan_id,))
    name, weeks = cursor.fetchone()
    ids = {}
    for session_type, price in PRICES.items():
        cursor.execute(
            """
            INSERT INTO pack_catalog (name, session_type, weeks, sessions_per_week_options, price_per_session, plan_id, sort_order)
            VALUES (%s, %s, %s, %s, %s, %s, 9000) RETURNING id
            """,
            (name, session_type, weeks, list(options), price, plan_id),
        )
        ids[session_type] = cursor.fetchone()[0]
    return ids


def drop(cursor):
    """Removes the catalogue packs made for the test plans (their name starts with TEST)."""
    cursor.execute("DELETE FROM pack_catalog WHERE name LIKE 'TEST%%'")

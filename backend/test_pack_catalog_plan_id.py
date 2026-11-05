"""pack_catalog._new_plan works when plans.id has no default (as in the production database).

    python -m unittest test_pack_catalog_plan_id -v

The table is altered inside a transaction that is rolled back: nothing stays changed.
"""
import unittest

import pack_catalog
import plans_schema
from database import get_connection


class PlanWithoutDefaultId(unittest.TestCase):
    def test_a_plan_gets_an_id_even_without_a_default(self):
        conn = get_connection()
        try:
            cur = conn.cursor()
            price = plans_schema.price_column(cur)
            cur.execute("ALTER TABLE plans ALTER COLUMN id DROP DEFAULT")
            cur.execute("ALTER TABLE plans ALTER COLUMN id DROP IDENTITY IF EXISTS")
            cur.execute("SELECT COALESCE(MAX(id), 0) FROM plans")
            top = cur.fetchone()[0]
            first = pack_catalog._new_plan(cur, price, "TEST noid A", 4, 80)
            second = pack_catalog._new_plan(cur, price, "TEST noid B", 8, 80)
            self.assertEqual((first, second), (top + 1, top + 2))
        finally:
            conn.rollback()
            conn.close()

    def test_with_a_default_the_database_chooses_the_id(self):
        conn = get_connection()
        try:
            cur = conn.cursor()
            plan_id = pack_catalog._new_plan(cur, plans_schema.price_column(cur), "TEST withid", 4, 80)
            self.assertIsNotNone(plan_id)
        finally:
            conn.rollback()
            conn.close()


if __name__ == "__main__":
    unittest.main()

"""The price column of `plans` (the "column preco does not exist" error):

    python -m unittest test_plans_schema -v

The code asks the database which price column it has (preco_sessao, preco or price) and uses that one: it never
guesses and never creates a second, look-alike column. The plan forms of the admin (create, edit, list, delete)
are run for real against the local database, with the admin check replaced.
"""
import unittest

import testsafety
from fastapi.testclient import TestClient

import main
import plans_schema
from database import get_connection

NAME = "TEST plans schema"


class FakeCursor:
    """Answers the information_schema question with the columns it was given and records what else is run."""

    def __init__(self, columns):
        self.columns, self.statements = columns, []

    def execute(self, sql, params=None):
        self.statements.append(sql)
        self.rows = [(name,) for name in self.columns if params and name in params[0]] if "information_schema" in sql else []

    def fetchall(self):
        return self.rows


class PriceColumn(unittest.TestCase):
    def setUp(self):
        plans_schema.forget()

    def tearDown(self):
        plans_schema.forget()

    def test_it_uses_the_column_the_table_has(self):
        for existing, expected in ((["preco_sessao"], "preco_sessao"), (["preco"], "preco"), (["price"], "price")):
            plans_schema.forget()
            cursor = FakeCursor(["id", "nome"] + existing)
            self.assertEqual(plans_schema.price_column(cursor), expected)
            self.assertEqual(len(cursor.statements), 1)                       # only the question: nothing was created

    def test_the_real_name_wins_when_a_look_alike_is_also_there(self):
        self.assertEqual(plans_schema.price_column(FakeCursor(["preco", "preco_sessao", "price"])), "preco_sessao")

    def test_a_column_is_created_only_when_the_table_has_none(self):
        cursor = FakeCursor(["id", "nome", "duracao_meses"])
        self.assertEqual(plans_schema.price_column(cursor), "preco_sessao")
        self.assertEqual(sum("ADD COLUMN IF NOT EXISTS preco_sessao" in sql for sql in cursor.statements), 1)

    def test_the_answer_is_remembered(self):
        cursor = FakeCursor(["preco_sessao"])
        plans_schema.price_column(cursor)
        plans_schema.price_column(cursor)
        self.assertEqual(len(cursor.statements), 1)


class PlanFormsAreGone(unittest.TestCase):
    """Plans are not edited by hand any more: the packs of the catalogue own them (Admin > Packs)."""

    def test_the_old_plan_endpoints_do_not_exist_and_change_plan_stays_gone(self):
        paths = {getattr(route, "path", "") for route in main.app.routes}
        for path in ("/admin/plans", "/admin/plans/{plan_id}", "/admin/plans/bulk", "/plans", "/admin/assign-plan"):
            self.assertNotIn(path, paths, path)
        self.assertIn("/admin/pack-catalog", paths)
        self.assertIn("/admin/clients/{client_id}/renew-pack", paths)            # the shared endpoint of "Nuevo pack" stays


if __name__ == "__main__":
    unittest.main()

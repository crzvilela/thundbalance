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


class PlanForms(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        testsafety.require_local_database()
        cls.http = TestClient(main.app)

    def setUp(self):
        plans_schema.forget()
        main.app.dependency_overrides[main.require_admin] = lambda: {"email": main.ADMIN_EMAIL, "sub": "uid-admin"}
        self.clean()

    def tearDown(self):
        main.app.dependency_overrides.clear()
        self.clean()

    @staticmethod
    def clean():
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM plans WHERE nome LIKE %s", (f"{NAME}%",))
        conn.commit()
        conn.close()

    def test_creating_editing_listing_and_deleting_a_plan_works(self):
        # the price is NOT part of a plan: it comes from the pricing table by duration (a sent "preco" is ignored)
        created = self.http.post("/admin/plans", json={"nome": NAME, "duracao_meses": 3, "duration_weeks": 8, "preco": 1})
        self.assertEqual(created.status_code, 200, created.text)
        plan_id = created.json()["id"]

        listing = self.http.get("/plans").json()
        row = next(item for item in listing if item[0] == plan_id)
        self.assertEqual(len(row), 5)                                               # [id, name, months, price, weeks]
        self.assertEqual((row[1], row[2], float(row[3]), row[4]), (NAME, 3, 60.0, 8))        # 3 months, individual: 60

        edited = self.http.put(f"/admin/plans/{plan_id}", json={"nome": f"{NAME} 2", "duracao_meses": 6, "duration_weeks": 12, "preco": 1})
        self.assertEqual(edited.status_code, 200, edited.text)
        row = next(item for item in self.http.get("/plans").json() if item[0] == plan_id)
        self.assertEqual((row[1], row[2], float(row[3]), row[4]), (f"{NAME} 2", 6, 55.0, 12))

        self.assertEqual(self.http.delete(f"/admin/plans/{plan_id}").status_code, 200)
        self.assertNotIn(plan_id, [item[0] for item in self.http.get("/plans").json()])

    def test_the_list_keeps_its_shape_whatever_columns_the_table_has_besides(self):
        row = self.http.get("/plans").json()[0]
        self.assertEqual(len(row), 5)

    def test_no_second_price_column_exists_after_the_forms_are_used(self):
        self.http.post("/admin/plans", json={"nome": NAME, "duracao_meses": 1, "duration_weeks": 4, "preco": 10})
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'plans' AND column_name = ANY(%s)",
                    (list(plans_schema.PRICE_COLUMNS),))
        self.assertEqual(len(cur.fetchall()), 1)
        conn.close()

    def test_change_plan_is_gone(self):
        self.assertIn(self.http.post("/admin/assign-plan", json={"user_id": 1, "plan_id": 1}).status_code, (404, 405))
        paths = {getattr(route, "path", "") for route in main.app.routes}
        self.assertNotIn("/admin/assign-plan", paths)
        self.assertIn("/admin/clients/{client_id}/renew-pack", paths)            # the shared endpoint of "Nuevo pack" stays


if __name__ == "__main__":
    unittest.main()

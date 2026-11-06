"""The editable catalogue of packs (Admin > Packs):

    python -m unittest test_pack_catalog -v

The six first packs come from what existed before (idempotent), the admin creates / edits / archives packs, the site and the
selectors read only the packs on sale, the server works every price out from the catalogue, and a pack that was already sold
keeps its own price, weeks, type and name whatever happens to the catalogue afterwards. Google is faked; the local database
is used and cleaned up.
"""
import unittest
from datetime import date, timedelta

import pack_schedule
import testsafety
from fastapi import HTTPException
from fastapi.testclient import TestClient

import google_fakes
import main
import pack_catalog
import pricing
from database import get_connection

DOMAIN = "@test-catalog.example"
NAME = "TEST catalog Pack 8 semanas Individual"


def weekday_after(offset):
    day = date.today() + timedelta(days=offset)
    while day.weekday() > 4:
        day += timedelta(days=1)
    return day


class Catalog(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        testsafety.require_local_database()
        for name in ("ensure_trial_session_fields", "ensure_session_pack_column", "ensure_calendar_sync_columns",
                     "ensure_client_lifecycle_columns", "ensure_client_workflow_fields"):
            getattr(main, name)()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 1")
        cls.trainer_id = cur.fetchone()[0]
        conn.close()

    @classmethod
    def cleanup(cls):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        ids = [r[0] for r in cur.fetchall()]
        if ids:
            cur.execute("DELETE FROM sessions WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM user_plans WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM client_requests WHERE user_id = ANY(%s)", (ids,))
            cur.execute("DELETE FROM users WHERE id = ANY(%s)", (ids,))
        cur.execute("DELETE FROM pack_catalog WHERE name LIKE 'TEST catalog%'")
        cur.execute("DELETE FROM plans WHERE nome LIKE 'TEST catalog%'")
        cur.execute("UPDATE pricing SET price = 40 WHERE kind = 'trial' AND session_type = 'individual'")
        cur.execute("UPDATE pricing SET price = 50 WHERE kind = 'trial' AND session_type = 'dual'")
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        cls.cleanup()

    def setUp(self):
        self.cleanup()
        self.google = google_fakes.FakeGoogle().install()
        main.app.dependency_overrides[main.require_admin] = lambda: {"email": main.ADMIN_EMAIL, "sub": "uid-admin"}
        self.http = TestClient(main.app)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO users (nome, email) VALUES ('Henrique Catalogo', %s) RETURNING id", (f"hc{DOMAIN}",))
        self.user_id = cur.fetchone()[0]
        conn.commit()
        conn.close()

    def tearDown(self):
        self.google.uninstall()
        main.app.dependency_overrides.clear()
        self.cleanup()

    # ----- helpers
    def body(self, **changes):
        base = {"name": NAME, "session_type": "individual", "weeks": 8, "sessions_per_week_options": [2],
                "price_per_session": 62.5, "price_per_pack": 960}
        base.update(changes)
        return base

    def create(self, **changes):
        response = self.http.post("/admin/pack-catalog", json=self.body(**changes))
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def sell(self, pack_id, per_week=2, session_type=None, **extra):
        for route in main.app.routes:
            if getattr(route, "path", None) == "/admin/clients/{client_id}/renew-pack" and "POST" in route.methods:
                return route.endpoint(self.user_id, main.NewPack(
                    pack_id=pack_id, sessions_per_week=per_week, schedule=pack_schedule.uniform(["Monday", "Wednesday", "Friday", "Tuesday"][:per_week], "09:00", self.trainer_id), start_date=weekday_after(10).isoformat(), email_extra=[], email_client=False,
                    allow_conflicts=True, allow_overlaps=True, session_type=session_type, **extra))

    def sold_row(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT session_type, price_per_session, total_price, weeks, catalog_pack_id, plan_id FROM user_plans "
                    "WHERE user_id = %s ORDER BY id DESC LIMIT 1", (self.user_id,))
        row = cur.fetchone()
        conn.close()
        return row

    def public(self):
        return {item["name"]: item for item in TestClient(main.app).get("/pricing").json()["packs"]}

    # ----- what existed before
    def test_the_first_six_packs_come_from_the_old_plans_and_prices_and_the_seed_runs_once(self):
        main.ensure_client_workflow_fields()
        main.ensure_client_workflow_fields()                                   # the next start of the server
        packs = [p for p in TestClient(main.app).get("/pricing").json()["packs"] if not p["name"].startswith("TEST")]
        seeded = {(p["session_type"], p["weeks"]): p["price_per_session"] for p in packs[:6]}
        self.assertEqual(seeded, {("individual", 4): 65, ("individual", 12): 60, ("individual", 24): 55,
                                  ("dual", 4): 80, ("dual", 12): 75, ("dual", 24): 70})
        self.assertEqual(len([p for p in packs if p["weeks"] in (4, 12, 24)]), 6)       # not seeded twice
        self.assertEqual(packs[0]["sessions_per_week_options"], [1, 2, 3, 4, 5])
        self.assertEqual(packs[0]["months"], 1)

    # ----- the admin screen
    def test_creating_a_pack_puts_it_on_the_site_and_the_list_says_how_many_were_sold(self):
        pack = self.create()
        self.assertEqual((pack["weeks"], pack["months"], pack["sessions_per_week_options"], pack["price_per_pack"]), (8, 2, [2], 960))
        self.assertIn(NAME, self.public())                                    # the client can choose it
        listing = self.http.get("/admin/pack-catalog").json()
        mine = next(item for item in listing["packs"] if item["id"] == pack["id"])
        self.assertEqual((mine["sold"], mine["active"]), (0, True))
        self.assertEqual(listing["trial"], {"individual": 40, "dual": 50})

    def test_with_several_options_the_client_chooses_and_the_pack_price_is_not_kept(self):
        pack = self.create(sessions_per_week_options=[1, 2, 3], price_per_pack=999)
        self.assertIsNone(pack["price_per_pack"])
        result = self.sell(pack["id"], per_week=3)                            # 8 weeks x 3 = 24 sessions at 62.50
        self.assertEqual((result["total_sessions"], result["price_per_session"], result["total_price"]), (24, 62.5, 1500))

    def test_with_one_option_the_pack_price_wins_and_without_it_the_total_is_worked_out(self):
        overridden = self.create(price_per_pack=960)                          # 8 x 2 x 62.50 would be 1000
        self.assertEqual(self.sell(overridden["id"])["total_price"], 960)
        self.assertEqual(self.sold_row()[:4], ("individual", 62.5, 960, 8))
        suggested = self.create(name=f"{NAME} 2", price_per_pack=None)
        self.assertEqual(self.sell(suggested["id"])["total_price"], 1000)

    def test_a_price_or_a_total_sent_by_the_browser_is_never_used(self):
        pack = self.create(sessions_per_week_options=[1, 2])
        response = self.http.post(f"/admin/clients/{self.user_id}/renew-pack", json={
            "pack_id": pack["id"], "sessions_per_week": 1,
            "schedule": [{"weekday": "Monday", "time": "09:00", "trainer_id": self.trainer_id}], "start_date": weekday_after(10).isoformat(), "email_extra": [], "email_client": False,
            "allow_conflicts": True, "allow_overlaps": True, "price_per_session": 1, "total_price": 1, "price": 1,
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["price_per_session"], 62.5)
        self.assertEqual(self.sold_row()[1:3], (62.5, 500))

    def test_the_values_are_checked_and_a_pack_that_does_not_offer_that_many_sessions_is_refused(self):
        bad = (
            ({"name": ""}, "invalid_name"), ({"weeks": 0}, "invalid_weeks"), ({"weeks": "x"}, "invalid_weeks"),
            ({"sessions_per_week_options": []}, "invalid_sessions_per_week_options"),
            ({"sessions_per_week_options": [8]}, "invalid_sessions_per_week_options"),
            ({"price_per_session": -1}, "invalid_price_per_session"), ({"price_per_session": 10.999}, "invalid_price_per_session"),
            ({"price_per_session": None}, "invalid_price_per_session"), ({"session_type": "trio"}, "invalid_session_type"),
        )
        for changes, code in bad:
            response = self.http.post("/admin/pack-catalog", json=self.body(**changes))
            self.assertEqual(response.status_code, 422, (changes, response.text))
            self.assertEqual(response.json()["detail"]["code"], code, changes)
        pack = self.create(sessions_per_week_options=[1, 2])
        with self.assertRaises(HTTPException) as error:
            self.sell(pack["id"], per_week=3)
        self.assertEqual(error.exception.detail["code"], "invalid_sessions_per_week")

    # ----- the packs already sold keep what they were sold with
    def test_changing_the_prices_of_a_pack_does_not_change_the_packs_already_sold(self):
        pack = self.create(sessions_per_week_options=[1, 2])
        self.sell(pack["id"], per_week=2)
        before = self.sold_row()
        self.assertEqual(before[:5], ("individual", 62.5, 1000, 8, pack["id"]))
        edited = self.http.put(f"/admin/pack-catalog/{pack['id']}", json=self.body(
            sessions_per_week_options=[1, 2], price_per_session=99, name="TEST catalog renamed", weeks=12))
        self.assertEqual(edited.status_code, 200, edited.text)
        self.assertEqual(edited.json()["price_per_session"], 99)
        self.assertEqual(self.sold_row(), before)                              # price, total, weeks, type, plan: all as sold
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT nome, duration_weeks FROM plans WHERE id = %s", (before[5],))
        self.assertEqual(cur.fetchone(), (NAME, 8))                            # the name and weeks it was sold with
        cur.execute("SELECT plan_id FROM pack_catalog WHERE id = %s", (pack["id"],))
        self.assertNotEqual(cur.fetchone()[0], before[5])                       # new sales use a new plans row
        conn.close()
        self.cleanup_packs()
        self.sell(pack["id"], per_week=1)                                      # the new price applies to NEW sales only
        self.assertEqual(self.sold_row()[1:4], (99, 1188, 12))

    def test_a_pack_nobody_used_is_edited_in_place(self):
        pack = self.create()
        before = pack["plan_id"]
        edited = self.http.put(f"/admin/pack-catalog/{pack['id']}", json=self.body(name="TEST catalog other", weeks=6)).json()
        self.assertEqual(edited["plan_id"], before)

    def cleanup_packs(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM sessions WHERE user_id = %s", (self.user_id,))
        cur.execute("DELETE FROM user_plans WHERE user_id = %s", (self.user_id,))
        conn.commit()
        conn.close()

    # ----- soft delete
    def test_archiving_takes_a_pack_off_the_site_and_the_selectors_but_sold_packs_keep_working(self):
        pack = self.create(sessions_per_week_options=[1, 2])
        self.sell(pack["id"], per_week=1)
        archived = self.http.post(f"/admin/pack-catalog/{pack['id']}/archive").json()
        self.assertFalse(archived["active"])
        self.assertIsNotNone(archived["archived_at"])
        self.assertNotIn(NAME, self.public())                                  # gone from the site and the selectors
        listing = self.http.get("/admin/pack-catalog").json()["packs"]
        self.assertIn(pack["id"], [item["id"] for item in listing])            # still in the admin list: never deleted
        self.assertEqual(self.sold_row()[4], pack["id"])                       # the pack sold is untouched
        with self.assertRaises(HTTPException) as error:                        # and nobody can buy it any more
            self.sell(pack["id"], per_week=1)
        self.assertEqual(error.exception.detail["code"], "pack_archived")
        restored = self.http.post(f"/admin/pack-catalog/{pack['id']}/restore").json()
        self.assertTrue(restored["active"])
        self.assertIsNone(restored["archived_at"])
        self.assertIn(NAME, self.public())

    def test_a_pack_has_no_delete_endpoint(self):
        pack = self.create()
        self.assertIn(self.http.delete(f"/admin/pack-catalog/{pack['id']}").status_code, (404, 405))

    # ----- requests
    def test_a_client_request_names_a_pack_on_sale_and_an_old_request_maps_to_its_catalogue_pack(self):
        from unittest import mock
        pack = self.create(sessions_per_week_options=[1, 2, 3])
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("UPDATE users SET firebase_uid = 'uid-catalog' WHERE id = %s", (self.user_id,))
        conn.commit()
        conn.close()
        with mock.patch.object(main, "require_client", lambda authorization=None: {"sub": "uid-catalog", "email": f"hc{DOMAIN}"}):
            create = next(r.endpoint for r in main.app.routes if getattr(r, "path", None) == "/client-requests" and "POST" in r.methods)
            with self.assertRaises(HTTPException) as error:                    # the pack does not offer 4 a week
                create(main.ClientRequestCreate(pack_id=pack["id"], sessions_per_week=4, schedule=pack_schedule.uniform("Monday,Wednesday,Friday,Tuesday", "09:00", None)), "Bearer x")
            self.assertEqual(error.exception.detail["code"], "invalid_sessions_per_week")
            with self.assertRaises(HTTPException) as error:                    # a dual request for an individual pack
                create(main.ClientRequestCreate(pack_id=pack["id"], sessions_per_week=2, schedule=pack_schedule.uniform("Monday,Wednesday", "09:00", None),
                                                session_type="dual", second_person_name="Beatriz Prueba",
                                                second_person_email=f"b{DOMAIN}"), "Bearer x")
            self.assertEqual(error.exception.detail["code"], "invalid_session_type")
            create(main.ClientRequestCreate(pack_id=pack["id"], sessions_per_week=2, schedule=pack_schedule.uniform("Monday,Wednesday", "09:00", None)), "Bearer x")
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT catalog_pack_id, plan_id FROM client_requests WHERE user_id = %s", (self.user_id,))
        self.assertEqual(cur.fetchone(), (pack["id"], pack["plan_id"]))
        # an old request only knows its plan (individual plans 1..3 are the first catalogue packs)
        cur.execute("SELECT plan_id FROM pack_catalog WHERE session_type = 'individual' AND weeks = 12 ORDER BY id LIMIT 1")
        plan = cur.fetchone()[0]
        mapped = pack_catalog.pack_for_request(cur, plan, "individual")
        self.assertEqual(pack_catalog.get(cur, mapped)["weeks"], 12)
        dual = pack_catalog.pack_for_request(cur, plan, "dual")                # a dual request made on the individual plan
        self.assertEqual(pack_catalog.get(cur, dual)["session_type"], "dual")
        conn.close()

    # ----- trial prices
    def test_the_trial_prices_are_edited_here_and_the_trial_form_reads_them(self):
        saved = self.http.put("/admin/trial-prices", json={"individual": 45, "dual": 55.5})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json(), {"individual": 45, "dual": 55.5})
        self.assertEqual(TestClient(main.app).get("/pricing").json()["trial"], {"individual": 45, "dual": 55.5})
        conn = get_connection()
        cur = conn.cursor()
        self.assertEqual(float(pricing.trial_price(cur, "dual")), 55.5)         # what a new trial booking is charged
        conn.close()
        self.assertEqual(self.http.put("/admin/trial-prices", json={"individual": -1, "dual": 50}).status_code, 422)
        self.assertEqual(TestClient(main.app).get("/pricing").json()["trial"]["individual"], 45)

    # ----- who can use it
    def test_only_an_admin_can_use_the_admin_endpoints(self):
        main.app.dependency_overrides.clear()
        anonymous = TestClient(main.app)
        for method, path, body in (
            ("get", "/admin/pack-catalog", None), ("post", "/admin/pack-catalog", self.body()),
            ("put", "/admin/pack-catalog/1", self.body()), ("post", "/admin/pack-catalog/1/archive", None),
            ("post", "/admin/pack-catalog/1/restore", None), ("put", "/admin/trial-prices", {"individual": 1, "dual": 1}),
        ):
            response = getattr(anonymous, method)(path, **({"json": body} if body is not None else {}))
            self.assertEqual(response.status_code, 401, (path, response.status_code))
        self.assertEqual(anonymous.get("/pricing").status_code, 200)             # the public prices stay public


if __name__ == "__main__":
    unittest.main()

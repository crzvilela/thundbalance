"""The admin panel configuration (docs/ADMIN_UI_SETTINGS.md): permissions, validation, protections, versions, reset.

    python -m unittest test_admin_ui_settings -v

The local database is used and the row is removed afterwards. require_admin is replaced in the tests that need an admin.
"""
import unittest
from unittest import mock

from fastapi.testclient import TestClient

import admin_ui_settings as ui
import main
from database import get_connection

URL = "/admin/ui-settings"


def valid(**changes):
    body = {
        "menu": [{"key": "requests", "label": "Pedidos"}, {"key": "clients"}, {"key": "videos", "hidden": True}],
        "overview": [{"key": "week", "title": "Esta semana"}, {"key": "quick", "hidden": True}],
        "pages": {"trials": {"title": "Pruebas", "subtitle": "Las sesiones de prueba"}},
        "version": 0,
    }
    body.update(changes)
    return body


class Settings(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ui.ensure_table()
        cls.client = TestClient(main.app)

    def setUp(self):
        self.wipe()
        main.app.dependency_overrides[main.require_admin] = lambda: {"email": main.ADMIN_EMAIL}

    def tearDown(self):
        main.app.dependency_overrides.pop(main.require_admin, None)
        self.wipe()

    @staticmethod
    def wipe():
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM admin_ui_settings WHERE key = %s", (ui.PANEL_KEY,))
        conn.commit()
        conn.close()

    def put(self, body):
        return self.client.put(URL, json=body)

    def code(self, answer):
        return answer.json()["detail"]["code"]

    # ----- who can use it
    def test_only_the_admin_can_read_write_or_reset(self):
        main.app.dependency_overrides.pop(main.require_admin, None)
        for method in ("get", "put", "delete"):
            kwargs = {"json": valid()} if method == "put" else {}
            self.assertEqual(getattr(self.client, method)(URL, **kwargs).status_code, 401, method)                         # no login
            self.assertEqual(getattr(self.client, method)(URL, headers={"Authorization": "Bearer not-a-token"}, **kwargs).status_code, 401, method)
        self.assertEqual(self.client.get(URL).status_code, 401)

    def test_every_route_depends_on_require_admin(self):
        for route in main.app.routes:
            if getattr(route, "path", None) == URL:
                self.assertIn(main.require_admin, [dependency.call for dependency in route.dependant.dependencies], route.methods)

    # ----- reading
    def test_without_a_saved_configuration_the_answer_is_empty(self):
        answer = self.client.get(URL)
        self.assertEqual((answer.status_code, answer.json()), (200, {}))

    def test_a_saved_configuration_is_returned_with_its_version(self):
        saved = self.put(valid())
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["version"], 1)
        self.assertEqual(self.client.get(URL).json(), saved.json())
        self.assertEqual(saved.json()["menu"][0], {"key": "requests", "label": "Pedidos"})
        self.assertEqual(saved.json()["menu"][2], {"key": "videos", "hidden": True})

    # ----- validation
    def test_unknown_and_repeated_keys_are_refused(self):
        self.assertEqual(self.code(self.put(valid(menu=[{"key": "secret-page"}]))), "unknown_key")
        self.assertEqual(self.code(self.put(valid(overview=[{"key": "nope"}]))), "unknown_key")
        self.assertEqual(self.code(self.put(valid(pages={"nope": {"title": "x"}}))), "unknown_key")
        self.assertEqual(self.code(self.put(valid(menu=[{"key": "clients"}, {"key": "clients"}]))), "duplicate_key")
        self.assertEqual(self.code(self.put(valid(menu=[{"key": "clients", "color": "red"}]))), "unknown_field")     # nothing else is stored
        self.assertEqual(self.code(self.put({**valid(), "script": "x"})), "unknown_field")

    def test_html_control_characters_and_long_texts_are_refused(self):
        for text in ("<b>x</b>", "a>b", "<script>"):
            self.assertEqual(self.code(self.put(valid(menu=[{"key": "requests", "label": text}]))), "html_not_allowed", text)
        self.assertEqual(self.code(self.put(valid(menu=[{"key": "requests", "label": "a\nb"}]))), "control_characters")
        self.assertEqual(self.code(self.put(valid(menu=[{"key": "requests", "label": "a\x00b"}]))), "control_characters")
        self.assertEqual(self.code(self.put(valid(menu=[{"key": "requests", "label": "x" * 31}]))), "text_too_long")
        self.assertEqual(self.put(valid(menu=[{"key": "requests", "label": "x" * 30}])).status_code, 200)               # 30 is the limit
        self.assertEqual(self.code(self.put(valid(overview=[{"key": "week", "title": "x" * 31}]))), "text_too_long")
        self.assertEqual(self.code(self.put(valid(pages={"trials": {"subtitle": "x" * 121}}))), "text_too_long")
        self.assertEqual(self.code(self.put(valid(pages={"trials": {"title": "x" * 31}}))), "text_too_long")
        self.assertEqual(self.code(self.put(valid(menu=[{"key": "requests", "label": 5}]))), "invalid_text")
        self.assertEqual(self.code(self.put(valid(menu=[{"key": "requests", "hidden": "yes"}]))), "invalid_format")
        self.assertEqual(self.put([1, 2]).status_code, 422)                                   # not an object at all

    def test_texts_are_trimmed_and_empty_ones_are_dropped(self):
        saved = self.put(valid(menu=[{"key": "requests", "label": "  Mis   pedidos  "}, {"key": "clients", "label": "   "}],
                               pages={"trials": {"title": "  ", "subtitle": ""}})).json()
        self.assertEqual(saved["menu"], [{"key": "requests", "label": "Mis pedidos"}, {"key": "clients"}])
        self.assertEqual(saved["pages"], {})

    def test_the_size_is_limited(self):
        many = [{"key": key, "label": "é" * 30} for key in ui.MENU_KEYS]
        pages = {key: {"title": "é" * 30, "subtitle": "é" * 120} for key in ui.PAGE_KEYS}
        overview = [{"key": key, "title": "é" * 30} for key in ui.OVERVIEW_KEYS]
        answer = self.put(valid(menu=many, pages=pages, overview=overview))
        self.assertIn(answer.status_code, (200, 422))              # the full registry with the longest texts still fits or says too_large
        if answer.status_code == 422:
            self.assertEqual(self.code(answer), "too_large")
        self.assertEqual(self.code(self.put(valid(menu=[{"key": "clients"}] * 60))), "invalid_format")                 # a long list is refused up front

    # ----- protections
    def test_the_overview_and_the_customise_access_cannot_be_hidden(self):
        self.assertEqual(self.code(self.put(valid(menu=[{"key": "overview", "hidden": True}]))), "protected_item")
        self.assertEqual(self.code(self.put(valid(menu=[{"key": "customize", "hidden": True}]))), "protected_item")
        self.assertEqual(self.put(valid(menu=[{"key": "customize", "label": "Mi panel"}])).status_code, 200)         # renaming it is allowed

    def test_at_least_three_menu_areas_stay_visible(self):
        areas = [key for key in ui.MENU_KEYS if key not in ui.PROTECTED_MENU_KEYS]
        hide = lambda keys: [{"key": key, "hidden": True} for key in keys]           # noqa: E731
        # 12 areas: Overview + 11 others. Hiding 9 of the 11 leaves 3 (Overview and two) visible.
        self.assertEqual(self.put(valid(menu=hide(areas[:9]))).status_code, 200)
        self.wipe()
        answer = self.put(valid(menu=hide(areas[:10])))
        self.assertEqual((answer.status_code, self.code(answer)), (422, "too_few_visible"))
        self.assertEqual(answer.json()["detail"]["minimum"], 3)

    # ----- versions
    def test_a_stale_version_is_refused_with_409(self):
        first = self.put(valid()).json()
        self.assertEqual(first["version"], 1)
        stale = self.put(valid(version=0))
        self.assertEqual((stale.status_code, self.code(stale)), (409, "version_conflict"))
        self.assertEqual(stale.json()["detail"]["current_version"], 1)
        second = self.put(valid(version=1, menu=[{"key": "clients", "label": "Mis clientes"}]))
        self.assertEqual((second.status_code, second.json()["version"]), (200, 2))
        self.assertEqual(self.put(valid(version=5)).status_code, 409)                  # a version from the future is stale too
        self.assertEqual(self.put({**valid(), "version": "1"}).status_code, 422)       # not a number
        body = valid()
        del body["version"]
        self.assertEqual(self.code(self.put(body)), "invalid_version")

    def test_a_version_sent_when_nothing_is_saved_must_be_zero(self):
        self.assertEqual(self.put(valid(version=3)).status_code, 409)
        self.assertEqual(self.put(valid(version=0)).status_code, 200)

    # ----- reset
    def test_delete_restores_the_original_panel(self):
        self.put(valid())
        answer = self.client.delete(URL)
        self.assertEqual((answer.status_code, answer.json()), (200, {"deleted": True}))
        self.assertEqual(self.client.get(URL).json(), {})
        self.assertEqual(self.client.delete(URL).json(), {"deleted": False})           # repeating it is harmless
        self.assertEqual(self.put(valid(version=0)).json()["version"], 1)              # the numbering starts again

    def test_the_table_is_created_idempotently(self):
        ui.ensure_table()
        ui.ensure_table()


    # ----- blocks (whole parts of a page: order and visibility)
    def blocks(self, **pages):
        return valid(blocks=pages)

    def test_blocks_are_saved_and_come_back_as_they_were_sent(self):
        body = self.blocks(
            plans={"main": [{"key": "trial_prices"}, {"key": "on_sale"}, {"key": "archived", "hidden": True}]},
            overview={"business": [{"key": "biz_nopack"}, {"key": "biz_stats", "hidden": True}]})
        saved = self.put(body)
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["blocks"]["plans"]["main"][2], {"key": "archived", "hidden": True})
        self.assertEqual(self.client.get(URL).json()["blocks"], saved.json()["blocks"])

    def test_a_configuration_without_blocks_still_works_and_mixes_with_blocks_later(self):
        first = self.put(valid())                                                     # an "old" configuration: no blocks
        self.assertEqual((first.status_code, first.json()["blocks"]), (200, {}))
        second = self.put(valid(version=1, blocks={"calendar": {"main": [{"key": "legend", "hidden": True}]}}))
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["menu"], first.json()["menu"])                 # what was there before is kept
        self.assertEqual(second.json()["blocks"]["calendar"]["main"], [{"key": "legend", "hidden": True}])

    def test_unknown_pages_groups_and_blocks_are_refused(self):
        self.assertEqual(self.code(self.put(self.blocks(ghost={"main": []}))), "unknown_page")
        self.assertEqual(self.code(self.put(self.blocks(plans={"side": [{"key": "on_sale"}]}))), "unknown_group")
        self.assertEqual(self.code(self.put(self.blocks(plans={"main": [{"key": "secret"}]}))), "unknown_key")
        self.assertEqual(self.code(self.put(self.blocks(plans={"main": [{"key": "filters"}]}))), "unknown_key")       # a block of another page
        self.assertEqual(self.code(self.put(self.blocks(plans={"main": [{"key": "on_sale", "color": "red"}]}))), "unknown_field")
        self.assertEqual(self.code(self.put(self.blocks(plans={"main": [{"key": "on_sale", "hidden": "yes"}]}))), "invalid_format")
        self.assertEqual(self.code(self.put(self.blocks(plans="main"))), "invalid_format")
        self.assertEqual(self.code(self.put(valid(blocks=[1]))), "invalid_format")

    def test_a_block_can_only_be_in_its_own_group(self):
        groups = {**ui.BLOCK_GROUPS, "plans": {"main": ("on_sale", "archived"), "side": ("trial_prices",)}}
        with mock.patch.object(ui, "BLOCK_GROUPS", groups):
            self.assertEqual(self.put(self.blocks(plans={"side": [{"key": "trial_prices"}]})).status_code, 200)
            self.wipe()
            answer = self.put(self.blocks(plans={"side": [{"key": "on_sale"}]}))                       # a block of "main" sent in "side"
            self.assertEqual((answer.status_code, self.code(answer)), (422, "wrong_group"))

    def test_duplicates_are_refused(self):
        self.assertEqual(self.code(self.put(self.blocks(plans={"main": [{"key": "archived"}, {"key": "archived"}]}))), "duplicate_key")

    def test_a_protected_block_cannot_be_hidden_but_can_be_moved(self):
        for page, group, key in (("plans", "main", "on_sale"), ("calendar", "main", "calendar"), ("trainers", "main", "list"),
                                 ("trainers", "main", "access"), ("schedule", "main", "tabs"), ("schedule", "main", "list")):
            answer = self.put(self.blocks(**{page: {group: [{"key": key, "hidden": True}]}}))
            self.assertEqual((answer.status_code, self.code(answer)), (422, "protected_block"), (page, key))
        self.assertEqual(self.put(self.blocks(plans={"main": [{"key": "archived"}, {"key": "on_sale"}]})).status_code, 200)     # moved, not hidden

    def test_a_page_never_ends_up_without_a_visible_block(self):
        every = [{"key": key, "hidden": True} for key in ui.BLOCK_GROUPS["overview"]["business"]]
        answer = self.put(self.blocks(overview={"business": every}))
        self.assertEqual((answer.status_code, self.code(answer)), (422, "page_empty"))
        self.assertEqual(self.put(self.blocks(overview={"business": every[:3]})).status_code, 200)                  # one left (not mentioned = visible)
        self.wipe()
        self.assertEqual(self.put(self.blocks(overview={"business": every[:3] + [{"key": "biz_nopack"}]})).status_code, 200)

    def test_the_registry_has_protected_blocks_only_inside_real_groups(self):
        for page, keys in ui.PROTECTED_BLOCKS.items():
            for key in keys:
                self.assertTrue(any(key in names for names in ui.BLOCK_GROUPS[page].values()), (page, key))

    def test_a_stale_version_with_blocks_is_still_a_409(self):
        self.put(self.blocks(plans={"main": [{"key": "archived"}]}))
        stale = self.put(valid(version=0, blocks={"plans": {"main": [{"key": "trial_prices"}]}}))
        self.assertEqual((stale.status_code, self.code(stale)), (409, "version_conflict"))

    def test_the_size_limit_is_32_kb(self):
        self.assertEqual(ui.MAX_BYTES, 32 * 1024)


    # ----- texts inside the pages
    def texts(self, **entries):
        return valid(texts={key.replace("__", "."): value for key, value in entries.items()})

    def test_texts_are_saved_and_the_empty_ones_dropped(self):
        saved = self.put(valid(texts={"requests.approve": "  Aceptar ", "clients.add_client": "Nuevo cliente", "videos.add": "  "}))
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["texts"], {"requests.approve": "Aceptar", "clients.add_client": "Nuevo cliente"})
        self.assertEqual(self.client.get(URL).json()["texts"], saved.json()["texts"])

    def test_a_text_that_is_not_in_the_closed_list_is_refused(self):
        for key in ("ghost.nothing", "requests.load_error", "requests.status_pending", "overview.week_sub", "", "requests"):
            self.assertEqual(self.code(self.put(valid(texts={key: "x"}))), "unknown_key", key)
        self.assertEqual(self.code(self.put(valid(texts=["requests.approve"]))), "invalid_format")
        self.assertEqual(self.code(self.put(valid(texts="x"))), "invalid_format")

    def test_texts_have_no_html_no_control_characters_and_their_own_limit(self):
        self.assertEqual(self.code(self.put(valid(texts={"requests.approve": "<b>x</b>"}))), "html_not_allowed")
        self.assertEqual(self.code(self.put(valid(texts={"requests.approve": "a>b"}))), "html_not_allowed")
        self.assertEqual(self.code(self.put(valid(texts={"requests.approve": "a\nb"}))), "control_characters")
        self.assertEqual(self.code(self.put(valid(texts={"requests.approve": 5}))), "invalid_text")
        self.assertEqual(self.put(valid(texts={"requests.approve": "x" * 40})).status_code, 200)
        self.assertEqual(self.code(self.put(valid(texts={"requests.approve": "x" * 41}))), "text_too_long")
        self.wipe()
        self.assertEqual(self.put(valid(texts={"overview.pending_empty": "x" * 60})).status_code, 200)               # an empty-list message: 60
        self.assertEqual(self.code(self.put(valid(texts={"overview.pending_empty": "x" * 61}))), "text_too_long")
        self.assertEqual(self.code(self.put(valid(texts={"clients.empty_none": "x" * 61}))), "text_too_long")

    def test_the_closed_list_never_holds_errors_states_or_confirmations(self):
        for key in ui.TEXT_LIMITS:
            self.assertNotRegex(key, r"load_error|action_error|[._]status_|_err|failed|(^|_)confirm($|_)", key)
        self.assertTrue(set(ui.TEXT_LIMITS.values()) <= {40, 60})
        for key, limit in ui.TEXT_LIMITS.items():
            if limit == 60:
                self.assertRegex(key, r"empty", key)

    def test_the_backend_and_the_frontend_lists_are_the_same(self):
        import os
        import re
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "admin", "uiTexts.js")
        frontend = {key: int(limit) for key, limit in re.findall(r"key: '([a-z-]+\.[a-z_]+)'.*?max: (\d+)", open(path, encoding="utf-8").read())}
        self.assertEqual(frontend, dict(ui.TEXT_LIMITS))

    def test_texts_mix_with_an_older_configuration_and_keep_the_version_check(self):
        first = self.put(valid())                                                       # no texts yet
        self.assertEqual(first.json()["texts"], {})
        second = self.put(valid(version=1, texts={"trials.approve": "Aceptar"}, blocks={"calendar": {"main": [{"key": "legend", "hidden": True}]}}))
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["menu"], first.json()["menu"])
        self.assertEqual((second.json()["texts"], second.json()["blocks"]["calendar"]["main"]), ({"trials.approve": "Aceptar"}, [{"key": "legend", "hidden": True}]))
        stale = self.put(valid(version=1, texts={"trials.approve": "Otro"}))
        self.assertEqual((stale.status_code, self.code(stale)), (409, "version_conflict"))

    def test_the_whole_configuration_may_be_32_kb_with_every_text_at_its_limit(self):
        full = {key: "é" * limit for key, limit in ui.TEXT_LIMITS.items()}
        answer = self.put(valid(texts=full))
        self.assertEqual(answer.status_code, 200, answer.text[:200])                       # about 165 texts: well inside 32 KB


if __name__ == "__main__":
    unittest.main()

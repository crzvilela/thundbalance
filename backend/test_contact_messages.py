"""Contact messages: the public form stores them, the panel archives and deletes them.

    python -m unittest test_contact_messages -v

Uses the local database; the rows it creates are removed.
"""
import unittest
from unittest import mock

from fastapi import HTTPException
from fastapi.testclient import TestClient

import contact_messages as cm
import main
from database import get_connection

DOMAIN = "@test-contact.example"


def route(path, method):
    for item in main.app.routes:
        if getattr(item, "path", None) == path and method in getattr(item, "methods", ()):
            return item
    raise LookupError(path)


class Contact(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cm.ensure_contact_table()
        cls.client = TestClient(main.app)

    def setUp(self):
        self.cleanup()
        cm._recent_by_ip.clear()
        self.sent = []
        patcher = mock.patch.object(cm, "send_email_async", lambda *args, **kwargs: self.sent.append((args, kwargs)))
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        self.cleanup()
        cm._recent_by_ip.clear()

    @staticmethod
    def cleanup():
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM contact_messages WHERE email LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM contact_message_audit WHERE admin_email LIKE %s", (f"%{DOMAIN}",))
        conn.commit()
        conn.close()

    def post(self, key="ana", message="Hola, quiero informacion de las clases.", **extra):
        body = {"name": "Ana Ruiz", "email": f"{key}{DOMAIN}", "message": message, "language": "es", **extra}
        return self.client.post("/contact-messages", json=body)

    def add(self, key, message="mensaje de prueba", **extra):
        response = self.post(key, message, **extra)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["id"]

    def rows(self, ids):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id, read_at, archived_at FROM contact_messages WHERE id = ANY(%s) ORDER BY id", (list(ids),))
        found = cur.fetchall()
        conn.close()
        return found

    def mine(self, **kwargs):
        listing = cm.list_messages(**kwargs)
        return [item for item in listing["items"] if item["email"].endswith(DOMAIN)]

    # ----- the public form
    def test_a_message_is_stored_with_phone_and_subject_and_the_studio_is_emailed(self):
        message_id = self.add("ana", "Hola <b>equipo</b> & gracias", phone=" +34 600 111 222 ", subject="  Clases   de prueba ")
        item = cm.get_message(message_id)
        self.assertEqual((item["name"], item["email"], item["language"], item["read"], item["archived"]),
                         ("Ana Ruiz", f"ana{DOMAIN}", "es", False, False))
        self.assertEqual((item["phone"], item["subject"]), ("+34 600 111 222", "Clases de prueba"))
        self.assertEqual(item["message"], "Hola <b>equipo</b> & gracias")          # kept as typed: the panel escapes when drawing
        self.assertEqual(len(self.sent), 1)
        self.assertIn("Nuevo mensaje de contacto", self.sent[0][0][1])             # Spanish, to the studio
        self.assertEqual(self.sent[0][0][0], ["pt@thundbalance.com"])               # only pt@ (the default team address)
        self.assertEqual(self.sent[0][1]["reply_to"], f"ana{DOMAIN}")               # answering goes to who wrote

    def test_an_email_failure_does_not_stop_saving(self):
        with mock.patch.object(cm, "send_email_async", side_effect=RuntimeError("down")):
            message_id = self.add("bia")
        self.assertEqual(cm.get_message(message_id)["email"], f"bia{DOMAIN}")

    def test_bots_bad_emails_and_short_messages_are_refused_and_limits_apply(self):
        self.assertEqual(self.post("bot", website="http://spam.example").json(), {"ok": True})     # honeypot: nothing stored
        self.assertEqual(self.mine(), [])
        self.assertEqual(self.client.post("/contact-messages", json={"name": "Ana", "email": "bad", "message": "hola hola"}).status_code, 422)
        self.assertEqual(self.post("short", "hi").status_code, 422)
        long_one = self.add("long", "x" * 5000)
        self.assertEqual(len(cm.get_message(long_one)["message"]), 3000)
        for _ in range(cm.PER_EMAIL_LIMIT - 1):
            self.add("loop")
        self.add("loop")
        self.assertEqual(self.post("loop").status_code, 429)                                       # per e-mail
        cm._recent_by_ip.clear()
        cm._recent_by_ip["testclient"].extend([9e18] * cm.PER_IP_LIMIT)
        self.assertEqual(self.post("other").status_code, 429)                                      # per IP

    # ----- inbox, archive, counts
    def test_archived_messages_leave_the_inbox_and_the_counts_and_come_back(self):
        first, second, third = self.add("one"), self.add("two"), self.add("three")
        before = cm.counts()
        cm.apply("archive", [first, second])
        after = cm.counts()
        self.assertEqual((after["inbox"], after["unread"], after["archived"]),
                         (before["inbox"] - 2, before["unread"] - 2, before["archived"] + 2))
        self.assertEqual([item["id"] for item in self.mine()], [third])
        self.assertEqual(sorted(item["id"] for item in self.mine(archived=True)), [first, second])
        cm.apply("unarchive", [first])
        self.assertEqual(sorted(item["id"] for item in self.mine()), [first, third])
        self.assertEqual(cm.counts()["archived"], before["archived"] + 1)

    def test_archive_and_read_are_idempotent_and_keep_the_first_time(self):
        message_id = self.add("idem")
        cm.apply("archive", [message_id])
        first_time = self.rows([message_id])[0][2]
        self.assertIsNotNone(first_time)
        self.assertEqual(cm.apply("archive", [message_id])["ok"], True)
        self.assertEqual(self.rows([message_id])[0][2], first_time)
        cm.apply("read", [message_id])
        read_time = self.rows([message_id])[0][1]
        cm.apply("read", [message_id])
        self.assertEqual(self.rows([message_id])[0][1], read_time)
        cm.apply("unread", [message_id])
        self.assertIsNone(self.rows([message_id])[0][1])
        self.assertEqual(cm.apply("unarchive", [message_id, 99999999])["matched"], 1)             # a missing id is not an error

    def test_search_by_name_email_subject_or_text_and_wildcards_are_literal(self):
        wanted = self.add("zeta", "Quiero pilates el martes", subject="Horarios")
        self.add("eta", "otra cosa")
        for term in ("zeta@", "PILATES", "horarios", "Ana Ruiz"):
            self.assertIn(wanted, [item["id"] for item in self.mine(q=term)], term)
        self.assertEqual(self.mine(q="pilates")[0]["id"], wanted)
        self.assertEqual(len(self.mine(q="pilates")), 1)
        self.assertEqual(cm.list_messages(q="%")["total"], 0)
        page = cm.list_messages(limit=1, offset=0)
        self.assertEqual(len(page["items"]), 1)

    # ----- deleting
    def test_deleting_is_final_idempotent_and_leaves_an_audit_without_personal_data(self):
        ids = [self.add(key) for key in ("d1", "d2", "d3")]
        result = cm.apply("delete", ids[:2], f"boss{DOMAIN}")
        self.assertEqual(result["matched"], 2)
        self.assertEqual([row[0] for row in self.rows(ids)], [ids[2]])
        self.assertEqual(cm.apply("delete", ids[:2], f"boss{DOMAIN}")["matched"], 0)               # already gone: no error
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'contact_message_audit' ORDER BY 1")
        columns = [row[0] for row in cur.fetchall()]
        cur.execute("SELECT action, amount, admin_email FROM contact_message_audit WHERE admin_email = %s", (f"boss{DOMAIN}",))
        audit = cur.fetchall()
        conn.close()
        self.assertEqual(columns, ["action", "admin_email", "amount", "created_at", "id"])          # who, how many, when
        self.assertEqual(audit, [("delete", 2, f"boss{DOMAIN}")])                                  # the repeat wrote nothing

    def test_bulk_validation(self):
        for action, ids in (("archive", []), ("delete", list(range(1, cm.MAX_BULK + 2))), ("explode", [1])):
            with self.assertRaises(HTTPException) as caught:
                cm.apply(action, ids)
            self.assertEqual(caught.exception.status_code, 422)
        with self.assertRaises(HTTPException) as caught:
            cm.get_message(99999999)
        self.assertEqual(caught.exception.status_code, 404)

    def test_the_http_routes_do_the_same_and_need_an_admin(self):
        message_id = self.add("http")
        admin = {"email": f"boss{DOMAIN}"}
        main.app.dependency_overrides[main.require_admin] = lambda: admin
        try:
            self.assertEqual(self.client.get("/admin/contact-messages/count").json()["unread"] >= 1, True)
            self.assertEqual(self.client.post(f"/admin/contact-messages/{message_id}/archive").json()["matched"], 1)
            self.assertTrue(self.client.get(f"/admin/contact-messages/{message_id}").json()["archived"])
            self.assertEqual(self.client.post("/admin/contact-messages/bulk", json={"action": "unarchive", "ids": [message_id]}).status_code, 200)
            self.assertEqual(self.client.post("/admin/contact-messages/99999999/archive").status_code, 404)
            self.assertEqual(self.client.delete(f"/admin/contact-messages/{message_id}").json()["matched"], 1)
            self.assertEqual(self.client.delete(f"/admin/contact-messages/{message_id}").json()["matched"], 0)   # again: fine
        finally:
            main.app.dependency_overrides.clear()
        # without the admin token every route is refused
        for method, path in (("get", "/admin/contact-messages"), ("get", "/admin/contact-messages/count"),
                             ("get", f"/admin/contact-messages/{message_id}"), ("post", f"/admin/contact-messages/{message_id}/read"),
                             ("post", f"/admin/contact-messages/{message_id}/archive"), ("post", "/admin/contact-messages/bulk"),
                             ("delete", f"/admin/contact-messages/{message_id}")):
            kwargs = {"json": {"action": "delete", "ids": [1]}} if path.endswith("bulk") else {}
            self.assertEqual(getattr(self.client, method)(path, **kwargs).status_code, 401, path)

    def test_every_admin_route_is_guarded(self):
        guarded = 0
        for item in main.app.routes:
            path = getattr(item, "path", "")
            if path.startswith("/admin/contact-messages"):
                guarded += 1
                calls = {dependency.call for dependency in item.dependant.dependencies}
                self.assertIn(main.require_admin, calls, path)
        self.assertGreaterEqual(guarded, 8)


if __name__ == "__main__":
    unittest.main()

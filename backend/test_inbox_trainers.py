"""Messages for several audiences, and trainers in the inbox:

    python -m unittest test_inbox_trainers -v

Real HTTP calls (FastAPI TestClient); the Firebase token check is replaced by a fake;
the local database is used and cleaned up.
"""
import unittest

import plans_schema
from datetime import date, timedelta

import testsafety
from fastapi.testclient import TestClient

import availability
import inbox
import main
import trainer_area
from database import get_connection

DOMAIN = "@test-inbox-trainers.example"
ISS = f"https://securetoken.google.com/{main.FIREBASE_PROJECT_ID}"
ADMIN = main.ADMIN_EMAIL


def claims(email, uid, verified=True):
    return {"iss": ISS, "email": email, "sub": uid, "email_verified": verified}


class InboxTrainers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        testsafety.require_local_database()
        main.ensure_client_lifecycle_columns()
        main.ensure_calendar_sync_columns()
        main.ensure_calendar_feed_columns()
        main.ensure_session_pack_column()
        main.ensure_trainer_area()
        inbox.ensure_tables()
        cls.http = TestClient(main.app)
        cls.cleanup()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(f"INSERT INTO plans (nome, {plans_schema.price_column(cur)}, duracao_meses, duration_weeks) VALUES ('TEST inbox trainers', 0, 1, 1) RETURNING id")
        cls.plan_id = cur.fetchone()[0]
        cls.t1 = availability.create_trainer(cur, "TEST IT Uno")
        cls.t2 = availability.create_trainer(cur, "TEST IT Dos")

        def user(name, email, uid):
            cur.execute("INSERT INTO users (nome, email, firebase_uid) VALUES (%s, %s, %s) RETURNING id", (name, email, uid))
            return cur.fetchone()[0]

        cls.ana = user("Ana Prueba", f"ana{DOMAIN}", "uid-ana")                       # client with an active pack
        cls.bia = user("Bia Prueba", f"bia{DOMAIN}", "uid-bia")                       # client with no pack
        cls.tr1 = user("Uno Entrenador", f"uno{DOMAIN}", "uid-t1")                    # trainer with a profile
        cur.execute("INSERT INTO user_plans (user_id, plan_id, active, start_date, end_date) VALUES (%s, %s, TRUE, %s, %s)",
                    (cls.ana, cls.plan_id, date.today(), date.today() + timedelta(days=30)))
        conn.commit()
        conn.close()

    @classmethod
    def cleanup(cls):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE nome LIKE 'TEST IT %'")
        trainers = [r[0] for r in cur.fetchall()]
        cur.execute("SELECT id FROM inbox_messages WHERE title LIKE 'TESTIT %'")
        messages = [r[0] for r in cur.fetchall()]
        cur.execute("DELETE FROM inbox_recipients WHERE message_id = ANY(%s) OR recipient_email LIKE %s", (messages, f"%{DOMAIN}"))
        cur.execute("DELETE FROM inbox_messages WHERE id = ANY(%s)", (messages,))
        cur.execute("DELETE FROM trainer_access_log WHERE email LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM trainer_access WHERE email LIKE %s OR trainer_id = ANY(%s)", (f"%{DOMAIN}", trainers))
        cur.execute("SELECT id FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        users = [r[0] for r in cur.fetchall()]
        cur.execute("DELETE FROM user_plans WHERE user_id = ANY(%s)", (users,))
        cur.execute("DELETE FROM users WHERE id = ANY(%s)", (users,))
        cur.execute("DELETE FROM trainers WHERE id = ANY(%s)", (trainers,))
        cur.execute("DELETE FROM plans WHERE nome = 'TEST inbox trainers'")
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        cls.cleanup()

    def setUp(self):
        self.tokens = {
            "admin": claims(ADMIN, "uid-admin"),
            "ana": claims(f"ana{DOMAIN}", "uid-ana"),
            "bia": claims(f"bia{DOMAIN}", "uid-bia"),
            "trainer1": claims(f"uno{DOMAIN}", "uid-t1"),
            "trainer2": claims(f"dos{DOMAIN}", "uid-t2"),          # a trainer who never signed in on the site (no profile row)
        }
        self._verify = main.id_token.verify_firebase_token
        main.id_token.verify_firebase_token = lambda token, *a, **k: self.tokens[token]
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM inbox_messages WHERE title LIKE 'TESTIT %'")
        ids = [r[0] for r in cur.fetchall()]
        cur.execute("DELETE FROM inbox_recipients WHERE message_id = ANY(%s)", (ids,))
        cur.execute("DELETE FROM inbox_messages WHERE id = ANY(%s)", (ids,))
        cur.execute("DELETE FROM trainer_access WHERE email LIKE %s", (f"%{DOMAIN}",))
        conn.commit()
        conn.close()
        trainer_area.forget()
        inbox._hits.clear()
        self.counter = 0

    def tearDown(self):
        main.id_token.verify_firebase_token = self._verify
        trainer_area.forget()

    def call(self, method, path, who=None, **kwargs):
        headers = {"Authorization": f"Bearer {who}"} if who else {}
        return self.http.request(method, path, headers=headers, **kwargs)

    def grant(self, trainer_id, email, uid):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO trainer_access (trainer_id, firebase_uid, email, granted_by) VALUES (%s, %s, %s, 'test')", (trainer_id, uid, email))
        conn.commit()
        conn.close()
        trainer_area.forget()

    def revoke(self, trainer_id):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("UPDATE trainer_access SET revoked_at = NOW() WHERE trainer_id = %s AND revoked_at IS NULL", (trainer_id,))
        conn.commit()
        conn.close()
        trainer_area.forget()

    def send(self, audiences, title, **extra):
        self.counter += 1
        body = {"audiences": audiences, "main_lang": "es", "title": f"TESTIT {title}", "body": "Cuerpo", "idempotency_key": f"tit-{title}-{self.counter}-{id(self)}", **extra}
        response = self.call("POST", "/admin/messages", "admin", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def titles(self, who):
        response = self.call("GET", "/inbox", who, params={"lang": "es"})
        self.assertEqual(response.status_code, 200, response.text)
        return {item["title"].replace("TESTIT ", "") for item in response.json()["items"] if item["title"].startswith("TESTIT ")}

    # ---------------------------------------------------------------- audiences
    def test_trainers_only_reaches_active_trainers_and_nobody_else(self):
        self.grant(self.t1, f"uno{DOMAIN}", "uid-t1")
        sent = self.send(["trainers"], "solo-entrenadores")
        self.assertEqual(sent["recipients"], 1)
        self.assertEqual(self.titles("trainer1"), {"solo-entrenadores"})
        self.assertEqual(self.titles("ana"), set())
        self.assertEqual(self.titles("bia"), set())

    def test_all_clients_alone_does_not_reach_trainers_and_active_pack_neither(self):
        self.grant(self.t1, f"uno{DOMAIN}", "uid-t1")
        self.send(["all"], "todos")
        self.send(["active_pack"], "con-pack")
        self.assertEqual(self.titles("trainer1"), set())            # a trainer has a profile row, and is still not a client
        self.assertEqual(self.titles("ana"), {"todos", "con-pack"})
        self.assertEqual(self.titles("bia"), {"todos"})
        # before the access was given the same person was a client
        self.revoke(self.t1)
        later = self.send(["all"], "despues")
        self.assertGreater(later["recipients"], 0)
        self.assertIn("despues", self.titles("trainer1"))            # revoked: a client again, for new messages

    def test_several_audiences_combine_without_duplicates(self):
        self.grant(self.t1, f"uno{DOMAIN}", "uid-t1")
        sent = self.send(["all", "trainers", "active_pack"], "combinado")
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT recipient_email, COUNT(*) FROM inbox_recipients WHERE message_id = %s GROUP BY recipient_email HAVING COUNT(*) > 1", (sent["id"],))
        self.assertEqual(cur.fetchall(), [])                          # one row per person
        conn.close()
        for who in ("trainer1", "ana", "bia"):
            self.assertEqual(self.titles(who), {"combinado"}, who)
        preview = self.call("POST", "/admin/messages/preview", "admin", json={"audiences": ["all", "trainers", "active_pack"]}).json()
        self.assertEqual(preview["count"], sent["recipients"])
        only = self.call("POST", "/admin/messages/preview", "admin", json={"audiences": ["trainers"]}).json()
        self.assertEqual(only["count"], 1)
        # one person falling in two rules is counted once: the trainer by "trainers" and by "user"
        both = self.send(["trainers", "user"], "doble", email=f"uno{DOMAIN}")
        self.assertEqual(both["recipients"], 1)

    def test_revoking_hides_what_arrived_through_the_trainers_rule(self):
        self.grant(self.t1, f"uno{DOMAIN}", "uid-t1")
        self.send(["trainers"], "para-entrenadores")
        self.assertEqual(self.titles("trainer1"), {"para-entrenadores"})
        self.revoke(self.t1)
        self.assertEqual(self.titles("trainer1"), set())
        count = self.call("GET", "/inbox/unread-count", "trainer1").json()["unread"]
        self.assertEqual(count, 0)
        self.grant(self.t1, f"uno{DOMAIN}", "uid-t1")                # given again: visible again
        self.assertEqual(self.titles("trainer1"), {"para-entrenadores"})

    def test_the_user_audience_can_target_one_trainer_for_future_automatic_messages(self):
        self.grant(self.t2, f"dos{DOMAIN}", "uid-t2")                # an active trainer with no profile on the site
        sent = self.send(["user"], "directo-entrenador", email=f"dos{DOMAIN}")
        self.assertEqual(sent["recipients"], 1)
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT user_id, recipient_email, source FROM inbox_recipients WHERE message_id = %s", (sent["id"],))
        self.assertEqual(cur.fetchall(), [(None, f"dos{DOMAIN}", None)])      # waits by e-mail, direct (not the trainers rule)
        conn.close()
        self.assertEqual(self.call("GET", "/inbox", "trainer2").json()["total"], 0)        # no profile yet: empty, not an error
        self.assertEqual(self.call("GET", "/inbox/unread-count", "trainer2").json(), {"unread": 0})
        # an email that is neither a client nor an active trainer is still refused
        bad = self.call("POST", "/admin/messages", "admin", json={"audiences": ["user"], "email": f"nadie{DOMAIN}", "main_lang": "es", "title": "TESTIT x", "body": "b"})
        self.assertEqual((bad.status_code, bad.json()["detail"]["code"]), (422, "no_such_client"))

    def test_audience_problems(self):
        for audiences in ([], ["nope"], ["all", "nope"]):
            response = self.call("POST", "/admin/messages", "admin", json={"audiences": audiences, "main_lang": "es", "title": "TESTIT x", "body": "b"})
            self.assertEqual(response.status_code, 422, audiences)
        none = self.call("POST", "/admin/messages", "admin", json={"audiences": ["trainers"], "main_lang": "es", "title": "TESTIT sin", "body": "b"})
        self.assertEqual((none.status_code, none.json()["detail"]["code"]), (409, "no_recipients"))    # nobody has access yet

    # -------------------------------------------------------- old messages and lists
    def test_old_messages_keep_reading_and_the_list_shows_audiences(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO inbox_messages (kind, type, title, body, main_lang, audience, visible_from) "
            "VALUES ('admin', 'broadcast', 'TESTIT antiguo', 'b', 'es', 'all', NOW() - INTERVAL '1 day') RETURNING id")
        old_id = cur.fetchone()[0]                                                           # no `audiences`, like before this change
        cur.execute("INSERT INTO inbox_recipients (message_id, user_id, recipient_email) VALUES (%s, %s, %s)", (old_id, self.bia, f"bia{DOMAIN}"))
        conn.commit()
        conn.close()
        self.assertEqual(self.titles("bia"), {"antiguo"})
        self.grant(self.t1, f"uno{DOMAIN}", "uid-t1")
        self.send(["all", "trainers"], "nuevo")
        listing = self.call("GET", "/admin/messages", "admin", params={"q": "TESTIT"}).json()["items"]
        by_title = {item["title"].replace("TESTIT ", ""): item for item in listing}
        self.assertEqual(by_title["antiguo"]["audiences"], ["all"])
        self.assertEqual(by_title["nuevo"]["audiences"], ["all", "trainers"])
        detail = self.call("GET", f"/admin/messages/{old_id}", "admin").json()
        self.assertEqual(detail["audiences"], ["all"])

    # ----------------------------------------------- trainers use the same inbox
    def test_a_trainer_reads_and_archives_but_does_not_delete(self):
        self.grant(self.t1, f"uno{DOMAIN}", "uid-t1")
        self.send(["trainers"], "leer")
        listing = self.call("GET", "/inbox", "trainer1", params={"lang": "es"}).json()
        item = next(i for i in listing["items"] if i["title"] == "TESTIT leer")
        self.assertEqual(self.call("GET", "/inbox/unread-count", "trainer1").json()["unread"], 1)
        self.assertEqual(self.call("POST", f"/inbox/{item['id']}/read", "trainer1").status_code, 200)
        self.assertEqual(self.call("GET", "/inbox/unread-count", "trainer1").json()["unread"], 0)
        self.assertEqual(self.call("POST", f"/inbox/{item['id']}/archive", "trainer1").status_code, 200)
        self.assertEqual(self.call("GET", "/inbox", "trainer1", params={"filter": "archived"}).json()["total"], 1)
        self.assertEqual(self.call("POST", f"/inbox/{item['id']}/unarchive", "trainer1").status_code, 200)
        self.assertEqual(self.call("DELETE", f"/inbox/{item['id']}", "trainer1").status_code, 410)       # nobody deletes
        self.assertEqual(self.call("POST", "/inbox/read-all", "trainer1").status_code, 200)
        self.assertEqual(self.call("POST", "/inbox/archive-read", "trainer1").status_code, 200)
        # and they still can not use the client area
        self.assertEqual(self.call("GET", "/client/workflow", "trainer1").status_code, 403)
        # another person's message is not theirs
        other = self.send(["all"], "de-clientes")
        self.assertEqual(self.call("POST", f"/inbox/{other['id']}/archive", "trainer1").status_code, 404)

    def test_the_admin_endpoints_stay_closed_to_trainers(self):
        self.grant(self.t1, f"uno{DOMAIN}", "uid-t1")
        self.assertEqual(self.call("GET", "/admin/messages", "trainer1").status_code, 403)
        self.assertEqual(self.call("POST", "/admin/messages", "trainer1", json={"audiences": ["all"], "title": "x", "body": "y"}).status_code, 403)


if __name__ == "__main__":
    unittest.main()

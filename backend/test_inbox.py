"""The client's inbox (admin messages + automatic messages), against the LOCAL database.

    python -m unittest test_inbox -v

Google Calendar and e-mails are replaced by fakes; every row it creates is removed.
"""
import unittest
from datetime import date, datetime, timedelta
from unittest import mock

from fastapi import HTTPException
from fastapi.testclient import TestClient

import inbox
import main
import mailer
import reschedule_requests as rr
import trial_confirmation as tc
import trial_notifications
from database import get_connection
from emails.dates import now_madrid

DOMAIN = "@test-inbox.example"
ADMIN = f"boss{DOMAIN}"


class Sent:
    def result(self, timeout=None):
        from emails.transport import EmailResult
        return EmailResult(True)


def claims_of(key, verified=True):
    return {"sub": f"uid-{key}-inbox", "email": f"{key}{DOMAIN}", "email_verified": verified}


class Payload:
    """What MessagePayload carries (the route builds the real model; the functions only read attributes)."""
    def __init__(self, **values):
        self.audience = "all"
        self.email = None
        self.main_lang = "es"
        self.title = "Aviso"
        self.body = "Texto del aviso"
        self.translations = None
        self.action_label = None
        self.action_target = None
        self.visible_from = None
        self.expires_at = None
        self.idempotency_key = None
        self.__dict__.update(values)


def code_of(caught):
    return caught.exception.detail["code"]


class Inbox(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.ensure_trial_session_fields()
        main.ensure_email_log_table()
        main.ensure_client_lifecycle_columns()
        main.ensure_calendar_sync_columns()
        rr.ensure_tables()
        inbox.ensure_tables()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM trainers WHERE active ORDER BY id LIMIT 1")
        cls.trainer_id = cur.fetchone()[0]
        cur.execute("SELECT id FROM plans ORDER BY id LIMIT 1")
        cls.plan_id = cur.fetchone()[0]
        conn.close()
        cls.client = TestClient(main.app)

    def setUp(self):
        self.cleanup()
        inbox._hits.clear()
        inbox.configure(ADMIN)
        self.mails, self.events = [], []
        self._patches = [
            mock.patch.object(mailer, "send_trial_approved", lambda *a, **k: (self.mails.append("approved"), Sent())[1]),
            mock.patch.object(mailer, "send_trial_confirmed", lambda *a, **k: (self.mails.append("client_confirmed"), Sent())[1]),
            mock.patch.object(trial_notifications, "notify_trial_confirmed", lambda trial, ok=True: self.mails.append("staff_confirmed")),
            mock.patch.object(trial_notifications, "notify_trial_declined", lambda trial: self.mails.append("staff_declined")),
            mock.patch.object(tc, "create_trial_session_event", lambda *a, **k: (self.events.append(1), "evt")[1]),
            mock.patch.object(tc, "update_trial_session_event", lambda *a, **k: None),
            mock.patch.object(tc, "delete_calendar_event", lambda *a, **k: None),
        ]
        for patcher in self._patches:
            patcher.start()
        self.ana = self.user("ana", "Ana Ruiz")

    def tearDown(self):
        for patcher in self._patches:
            patcher.stop()
        main.app.dependency_overrides.clear()
        self.cleanup()

    @classmethod
    def cleanup(cls):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM inbox_messages WHERE created_by LIKE %s OR id IN "
                    "(SELECT message_id FROM inbox_recipients WHERE recipient_email LIKE %s)", (f"%{DOMAIN}", f"%{DOMAIN}"))
        cur.execute("DELETE FROM inbox_audit WHERE admin_email LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM reschedule_requests WHERE user_id IN (SELECT id FROM users WHERE email LIKE %s)", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE %s)", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM user_plans WHERE user_id IN (SELECT id FROM users WHERE email LIKE %s)", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        conn.commit()
        conn.close()

    # ----- helpers
    def sql(self, query, params=()):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(query, params)
        rows = cur.fetchall() if cur.description else None
        conn.commit()
        conn.close()
        return rows

    def user(self, key, name, archived=False):
        return self.sql("INSERT INTO users (firebase_uid, nome, email, archived_at) VALUES (%s, %s, %s, %s) RETURNING id",
                        (f"uid-{key}-inbox", name, f"{key}{DOMAIN}", datetime.now() if archived else None))[0][0]

    def pack(self, user_id, active=True):
        return self.sql("INSERT INTO user_plans (user_id, plan_id, active) VALUES (%s, %s, %s) RETURNING id", (user_id, self.plan_id, active))[0][0]

    def trial(self, key="ana", days=14, status="Pending", hour="10:00"):
        day = date.today() + timedelta(days=days)
        while day.weekday() > 4:
            day += timedelta(days=1)
        return self.sql(
            "INSERT INTO trial_sessions (full_name, email, phone, goal, experience, session_date, session_time, status) "
            "VALUES ('Ana Prueba', %s, '600', 'Lose weight', 'Beginner', %s, %s, %s) RETURNING id",
            (f"{key}{DOMAIN}", day, hour, status))[0][0]

    def token_of(self, trial_id):
        return self.sql("SELECT confirmation_token FROM trial_sessions WHERE id = %s", (trial_id,))[0][0]

    def items(self, key="ana", user_id=None, lang="en", **kwargs):
        user_id = user_id or self.ana
        return inbox.list_inbox(user_id, claims_of(key), lang, **kwargs)

    def titles(self, key="ana", **kwargs):
        return [item["title"] for item in self.items(key, **kwargs)["items"]]

    def action_state(self, item, action_type):
        return [action["state"] for action in item["actions"] if action["type"] == action_type][0]

    def mine(self, kind="system"):
        return [item for item in self.items()["items"] if item["kind"] == kind]

    # ----- the studio's messages: who receives them
    def test_audiences_all_active_pack_and_one_person_without_archived_or_admin(self):
        bia = self.user("bia", "Bia Torres")
        cara = self.user("cara", "Cara Gil")
        old = self.user("old", "Old Client", archived=True)
        boss = self.user("boss", "The Boss")
        self.pack(self.ana)
        self.pack(old)
        self.pack(boss)
        self.pack(cara, active=False)                                           # a pack that is not active
        sent_all = inbox.send_admin_message(Payload(audience="all", idempotency_key="all-1"), ADMIN)
        sent_active = inbox.send_admin_message(Payload(audience="active_pack", title="Solo packs", idempotency_key="act-1"), ADMIN)
        sent_user = inbox.send_admin_message(Payload(audience="user", email=f"BIA{DOMAIN}", title="Hola Bia", idempotency_key="usr-1"), ADMIN)

        def who(message_id):
            return {row[0] for row in self.sql("SELECT recipient_email FROM inbox_recipients WHERE message_id = %s", (message_id,))}

        everyone = who(sent_all["id"])
        self.assertTrue({f"ana{DOMAIN}", f"bia{DOMAIN}", f"cara{DOMAIN}"} <= everyone)
        self.assertNotIn(f"old{DOMAIN}", everyone)                               # archived: never
        self.assertNotIn(ADMIN, everyone)                                        # the admin account: never
        self.assertEqual(who(sent_active["id"]) & {f"ana{DOMAIN}", f"bia{DOMAIN}", f"cara{DOMAIN}", f"old{DOMAIN}", ADMIN}, {f"ana{DOMAIN}"})
        self.assertEqual(who(sent_user["id"]), {f"bia{DOMAIN}"})
        self.assertEqual(sent_user["recipients"], 1)
        self.assertEqual(inbox.preview("user", f"bia{DOMAIN}")["count"], 1)
        self.assertEqual(inbox.preview("user", f"old{DOMAIN}"), {"count": 0, "found": True, "archived": True})
        self.assertEqual(inbox.preview("user", f"nobody{DOMAIN}")["found"], False)
        self.assertGreaterEqual(inbox.preview("all")["count"], 3)
        self.assertLess(inbox.preview("active_pack")["count"], inbox.preview("all")["count"] + 1)
        for email, kind in ((f"old{DOMAIN}", "client_archived"), (f"nobody{DOMAIN}", "no_such_client")):
            with self.assertRaises(HTTPException) as caught:
                inbox.send_admin_message(Payload(audience="user", email=email), ADMIN)
            self.assertEqual(code_of(caught), kind)
        self.assertEqual(self.titles("bia", user_id=bia)[:2], ["Hola Bia", "Aviso"])
        self.assertEqual(self.titles("ana")[:1], ["Solo packs"])                 # the newest first
        self.assertEqual(self.titles("boss", user_id=boss), [])                    # the admin account got nothing

    def test_has_active_pack_is_one_definition(self):
        import pack_view
        conn = get_connection()
        cur = conn.cursor()
        self.assertFalse(pack_view.has_active_pack(cur, self.ana))
        self.pack(self.ana)
        self.assertTrue(pack_view.has_active_pack(cur, self.ana))
        conn.close()

    def test_the_same_idempotency_key_sends_once(self):
        first = inbox.send_admin_message(Payload(idempotency_key="same-key"), ADMIN)
        second = inbox.send_admin_message(Payload(idempotency_key="same-key"), ADMIN)
        self.assertEqual((first["id"], first["repeated"], second["id"], second["repeated"]), (first["id"], False, first["id"], True))
        self.assertEqual(self.sql("SELECT COUNT(*) FROM inbox_messages WHERE idempotency_key = 'same-key'")[0][0], 1)

    # ----- validation of what the studio writes
    def test_what_the_studio_may_write(self):
        def refused(code, **values):
            with self.assertRaises(HTTPException) as caught:
                inbox.send_admin_message(Payload(audience="user", email=f"ana{DOMAIN}", **values), ADMIN)
            self.assertEqual(code_of(caught), code, values)

        refused("too_long", title="x" * (inbox.TITLE_MAX + 1))
        refused("too_long", body="x" * (inbox.BODY_MAX + 1))
        refused("required", title="  ")
        refused("html_not_allowed", body="hola <script>alert(1)</script>")
        refused("html_not_allowed", title="<b>negrita</b>")
        refused("html_not_allowed", translations={"en": {"title": "x", "body": "<img src=x>"}})
        refused("invalid_language", translations={"fr": {"title": "x"}})
        refused("invalid_language", main_lang="xx")
        refused("button_incomplete", action_label="Ir")
        refused("button_incomplete", action_target="/my-sessions")
        for bad in ("javascript:alert(1)", "data:text/html;base64,AAAA", "//evil.example/x", "/admin/clients", "ftp://x.example/a", "vbscript:x", "/my-sessions evil"):
            refused("invalid_target", action_label="Ir", action_target=bad)
        now = now_madrid().replace(tzinfo=None)
        refused("date_in_past", visible_from=(now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M"))
        refused("date_too_far", visible_from=(now + timedelta(days=400)).strftime("%Y-%m-%dT%H:%M"))
        refused("invalid_date", visible_from="mañana")
        soon = (now + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M")
        refused("expiry_before_start", visible_from=soon, expires_at=(now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M"))
        for good in ("/my-sessions", "/profile?x=1", "https://thundbalance.com/offer", "http://example.org/a?b=c"):
            sent = inbox.send_admin_message(Payload(audience="user", email=f"ana{DOMAIN}", action_label="Ver", action_target=good), ADMIN)
            self.assertEqual(sent["recipients"], 1)

    # ----- when it appears and disappears
    def test_a_scheduled_message_appears_only_after_visible_from_and_an_expired_one_goes(self):
        soon = (now_madrid().replace(tzinfo=None) + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M")
        sent = inbox.send_admin_message(Payload(audience="user", email=f"ana{DOMAIN}", title="Programado", visible_from=soon), ADMIN)
        self.assertEqual(sent["status"], "scheduled")
        self.assertNotIn("Programado", self.titles())                              # not yet
        self.assertEqual(inbox.unread_count(self.ana, claims_of("ana"))["unread"], 0)
        self.assertEqual(inbox.list_admin()["items"][0]["status"], "scheduled")
        self.sql("UPDATE inbox_messages SET visible_from = %s WHERE id = %s", (datetime.now() - timedelta(days=2), sent["id"]))   # its time came
        self.assertIn("Programado", self.titles())
        self.assertEqual(inbox.unread_count(self.ana, claims_of("ana"))["unread"], 1)
        self.sql("UPDATE inbox_messages SET expires_at = %s WHERE id = %s", (datetime.now() - timedelta(days=1), sent["id"]))      # and it expired
        self.assertNotIn("Programado", self.titles())
        self.assertEqual(inbox.unread_count(self.ana, claims_of("ana"))["unread"], 0)
        self.assertEqual(inbox.get_admin(sent["id"])["status"], "expired")

    # ----- the language it is drawn in
    def test_texts_are_drawn_in_the_requested_language(self):
        inbox.send_admin_message(Payload(audience="user", email=f"ana{DOMAIN}", main_lang="es", title="Hola", body="Cuerpo",
                                         translations={"en": {"title": "Hello", "body": "Body"}, "ca": {"title": "Hola ca"}}), ADMIN)
        by_lang = {lang: self.items(lang=lang)["items"][0] for lang in ("en", "es", "ca", "xx")}
        self.assertEqual((by_lang["en"]["title"], by_lang["en"]["body"]), ("Hello", "Body"))
        self.assertEqual((by_lang["es"]["title"], by_lang["es"]["body"]), ("Hola", "Cuerpo"))
        self.assertEqual((by_lang["ca"]["title"], by_lang["ca"]["body"]), ("Hola ca", "Cuerpo"))       # each part falls back by itself
        self.assertEqual(by_lang["xx"]["title"], "Hello")                                              # unknown language: English
        trial_id = self.trial()
        tc.approve_trial(trial_id, self.trial_trainer())
        titles = {lang: [i for i in self.items(lang=lang)["items"] if i["type"] == "trial_approved"][0] for lang in ("en", "es", "ca")}
        self.assertEqual(titles["es"]["title"], "Tu sesión de prueba ha sido aprobada")
        self.assertEqual(titles["en"]["title"], "Your trial session has been approved")
        self.assertEqual(titles["ca"]["title"], "La teva sessió de prova ha estat aprovada")
        self.assertEqual([action["label"] for action in titles["es"]["actions"]], ["Confirmar", "No puedo asistir"])
        self.assertEqual([action["label"] for action in titles["en"]["actions"]], ["Confirm", "I can't come"])

    def trial_trainer(self):
        return self.trainer_id

    # ----- automatic messages: trial
    def test_approving_a_trial_puts_the_message_in_the_inbox_with_two_buttons_and_the_email_still_goes(self):
        trial_id = self.trial()
        answer = tc.approve_trial(trial_id, self.trainer_id)
        self.assertTrue(answer["email"]["sent"])
        self.assertEqual(self.mails, ["approved"])                                 # the e-mail is exactly as before
        approved = [i for i in self.items()["items"] if i["type"] == "trial_approved"]
        self.assertEqual(len(approved), 1)
        self.assertEqual([(a["type"], a["state"]) for a in approved[0]["actions"]], [("trial_confirm", "available"), ("trial_decline", "available")])
        self.assertFalse(approved[0]["can_archive"])
        inbox.on_trial_approved(trial_id, f"ana{DOMAIN}", date.today(), "10:00")    # the same step twice: nothing new
        self.assertEqual(len([i for i in self.items()["items"] if i["type"] == "trial_approved"]), 1)

    def test_confirming_by_email_makes_the_button_in_the_inbox_done(self):
        trial_id = self.trial()
        tc.approve_trial(trial_id, self.trainer_id)
        token = self.token_of(trial_id)
        item = [i for i in self.items()["items"] if i["type"] == "trial_approved"][0]
        self.assertEqual(self.action_state(item, "trial_confirm"), "available")
        self.assertEqual(tc.answer_trial(token, "confirmed")["outcome"], "confirmed")       # the e-mail page
        item = [i for i in self.items()["items"] if i["type"] == "trial_approved"][0]
        self.assertEqual((self.action_state(item, "trial_confirm"), self.action_state(item, "trial_decline")), ("done", "done"))
        self.assertEqual([action["result"] for action in item["actions"]], ["confirmed", "confirmed"])     # WHAT was answered, from the real session
        self.assertTrue(item["can_archive"])
        self.assertIn("Your trial session is confirmed", self.titles())            # and the confirmation message exists, once
        tc.answer_trial(token, "confirmed")
        self.assertEqual(self.titles().count("Your trial session is confirmed"), 1)
        # pressing the same thing in the inbox changes nothing and repeats nothing
        recipient_id = item["id"]
        mails_before = list(self.mails)
        self.assertEqual(inbox.do_action(self.ana, claims_of("ana"), recipient_id, "trial_confirm")["outcome"], "already_confirmed")
        self.assertEqual(self.mails, mails_before)

    def test_confirming_from_the_inbox_uses_the_same_rules_and_needs_the_booking_email(self):
        trial_id = self.trial()
        tc.approve_trial(trial_id, self.trainer_id)
        item = [i for i in self.items()["items"] if i["type"] == "trial_approved"][0]
        # a signed-in person whose verified e-mail is NOT the booking's: refused, nothing changes
        other = self.user("eve", "Eve")
        self.sql("UPDATE inbox_recipients SET user_id = %s WHERE id = %s", (other, item["id"]))
        with self.assertRaises(HTTPException) as caught:
            inbox.do_action(other, claims_of("eve"), item["id"], "trial_confirm")
        self.assertEqual((caught.exception.status_code, code_of(caught)), (403, "use_booking_email"))
        self.assertIn("Inicia sesión con el email de la reserva", caught.exception.detail["message"])
        self.assertEqual(self.sql("SELECT status FROM trial_sessions WHERE id = %s", (trial_id,))[0][0], "Approved")
        # the right e-mail but NOT verified: refused too
        self.sql("UPDATE inbox_recipients SET user_id = %s WHERE id = %s", (self.ana, item["id"]))
        with self.assertRaises(HTTPException) as caught:
            inbox.do_action(self.ana, claims_of("ana", verified=False), item["id"], "trial_confirm")
        self.assertEqual(code_of(caught), "use_booking_email")
        # the right verified e-mail confirms: same function as the e-mail page (calendar event only now, e-mails, one message)
        result = inbox.do_action(self.ana, claims_of("ana"), item["id"], "trial_confirm", "es")
        self.assertEqual(result["outcome"], "confirmed")
        self.assertEqual(self.sql("SELECT status FROM trial_sessions WHERE id = %s", (trial_id,))[0][0], "Confirmed")
        self.assertEqual((len(self.events), "client_confirmed" in self.mails, "staff_confirmed" in self.mails), (1, True, True))
        self.assertEqual(self.action_state(result["item"], "trial_confirm"), "done")
        self.assertTrue(result["item"]["read"])
        self.assertEqual(result["item"]["actions"][0]["label"], "Confirmar")

    def test_declining_from_the_inbox_and_the_expired_state(self):
        trial_id = self.trial()
        tc.approve_trial(trial_id, self.trainer_id)
        item = [i for i in self.items()["items"] if i["type"] == "trial_approved"][0]
        self.assertEqual([action["result"] for action in item["actions"]], [None, None])                    # nothing answered yet
        self.assertEqual(inbox.do_action(self.ana, claims_of("ana"), item["id"], "trial_decline")["outcome"], "declined")
        again = [i for i in self.items()["items"] if i["type"] == "trial_approved"][0]
        self.assertEqual([action["result"] for action in again["actions"]], ["declined", "declined"])      # also on a later visit
        self.assertIn("We have noted that you can't come", self.titles())
        # a session that already happened: the buttons are expired
        late = self.trial(days=14)
        tc.approve_trial(late, self.trainer_id)
        self.sql("UPDATE trial_sessions SET session_date = CURRENT_DATE - 2 WHERE id = %s", (late,))
        item = [i for i in self.items()["items"] if i["type"] == "trial_approved" and i["actions"][0]["state"] == "expired"]
        self.assertEqual(len(item), 1)
        self.assertTrue(item[0]["can_archive"])

    def test_a_failure_writing_the_message_never_breaks_the_approval(self):
        trial_id = self.trial()
        with mock.patch.object(inbox, "ensure_tables_once", side_effect=RuntimeError("db down")):
            answer = tc.approve_trial(trial_id, self.trainer_id)
        self.assertTrue(answer["email"]["sent"])
        self.assertEqual(self.sql("SELECT status FROM trial_sessions WHERE id = %s", (trial_id,))[0][0], "Approved")
        self.assertEqual(self.sql("SELECT COUNT(*) FROM inbox_messages WHERE dedupe_key = %s", (f"trial_approved:trial_id{trial_id}",))[0][0], 0)
        with mock.patch.object(inbox, "get_connection", side_effect=RuntimeError("db down")):
            self.assertIsNone(inbox.create_system_message("trial_confirmed", email=f"ana{DOMAIN}", refs={"trial_id": trial_id}))
        self.assertIsNone(inbox.create_system_message("not_a_type", email=f"ana{DOMAIN}"))

    # ----- someone with no account yet
    def test_a_trial_without_an_account_is_linked_only_by_a_verified_email(self):
        trial_id = self.trial("newbie")
        tc.approve_trial(trial_id, self.trainer_id)
        waiting = self.sql("SELECT user_id, recipient_email FROM inbox_recipients WHERE recipient_email = %s", (f"newbie{DOMAIN}",))
        self.assertEqual(waiting, [(None, f"newbie{DOMAIN}")])
        newbie = self.user("newbie", "Newbie")                                       # signs up later with the same e-mail
        self.assertEqual(inbox.list_inbox(newbie, claims_of("newbie", verified=False))["total"], 0)       # not verified: nothing
        self.assertEqual(inbox.unread_count(newbie, claims_of("newbie", verified=False))["unread"], 0)
        self.assertEqual(self.sql("SELECT user_id FROM inbox_recipients WHERE recipient_email = %s", (f"newbie{DOMAIN}",)), [(None,)])
        self.assertEqual(inbox.unread_count(newbie, claims_of("newbie"))["unread"], 1)           # verified: linked
        self.assertEqual(self.sql("SELECT user_id FROM inbox_recipients WHERE recipient_email = %s", (f"newbie{DOMAIN}",)), [(newbie,)])
        listing = inbox.list_inbox(newbie, claims_of("newbie"))
        self.assertEqual([i["type"] for i in listing["items"]], ["trial_approved"])
        # somebody else with another e-mail never gets it, even with a verified account
        eve = self.user("eve", "Eve")
        self.assertEqual(inbox.list_inbox(eve, claims_of("eve"))["total"], 0)
        # a message written for the address before the account existed does not reach a later sign-up of the broadcast
        sent = inbox.send_admin_message(Payload(audience="all", idempotency_key="late-1"), ADMIN)
        late = self.user("late", "Late")
        self.assertNotIn(sent["id"], [row[0] for row in self.sql("SELECT message_id FROM inbox_recipients WHERE user_id = %s", (late,))])

    def test_archived_clients_never_receive_automatic_messages_either(self):
        gone = self.user("gone", "Gone", archived=True)
        self.assertIsNone(inbox.create_system_message("trial_confirmed", user_id=gone, refs={"trial_id": 1}, params={"session_at": "2026-10-21 18:00"}))
        self.assertIsNone(inbox.create_system_message("trial_confirmed", email=f"gone{DOMAIN}", refs={"trial_id": 2}, params={"session_at": "2026-10-21 18:00"}))
        self.assertEqual(self.sql("SELECT COUNT(*) FROM inbox_recipients WHERE recipient_email = %s", (f"gone{DOMAIN}",))[0][0], 0)

    # ----- reading, reading all, deleting
    def test_read_unread_count_filter_pagination_and_ownership(self):
        for index in range(5):
            inbox.send_admin_message(Payload(audience="user", email=f"ana{DOMAIN}", title=f"Mensaje {index}"), ADMIN)
        bia = self.user("bia", "Bia")
        inbox.send_admin_message(Payload(audience="user", email=f"bia{DOMAIN}", title="De Bia"), ADMIN)
        self.assertEqual(inbox.unread_count(self.ana, claims_of("ana")), {"unread": 5})
        page = self.items(size=2)
        self.assertEqual((len(page["items"]), page["total"], page["pages"], page["unread"]), (2, 5, 3, 5))
        self.assertEqual(page["items"][0]["title"], "Mensaje 4")                      # the newest first
        self.assertEqual(self.items(size=1000)["items"].__len__(), 5)                  # the page size is capped, never huge
        first = page["items"][0]["id"]
        inbox.mark_read(self.ana, first)
        inbox.mark_read(self.ana, first)                                               # idempotent
        self.assertEqual(self.items(filter_="unread")["total"], 4)
        with self.assertRaises(HTTPException) as caught:
            inbox.mark_read(bia, first)                                                # somebody else's message
        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(inbox.mark_all_read(self.ana)["updated"], 4)
        self.assertEqual(inbox.unread_count(self.ana, claims_of("ana"))["unread"], 0)
        self.assertEqual(inbox.unread_count(bia, claims_of("bia"))["unread"], 1)

    def test_the_client_archives_only_when_no_action_waits_for_an_answer(self):
        plain = inbox.send_admin_message(Payload(audience="user", email=f"ana{DOMAIN}", action_label="Ver", action_target="/my-sessions"), ADMIN)
        trial_id = self.trial()
        tc.approve_trial(trial_id, self.trainer_id)
        items = {i["type"]: i for i in self.items()["items"]}
        self.assertTrue(items["direct"]["can_archive"])                                # a plain link does not block
        with self.assertRaises(HTTPException) as caught:
            inbox.archive_own(self.ana, items["trial_approved"]["id"])
        self.assertEqual((caught.exception.status_code, code_of(caught)), (409, "action_pending"))
        self.assertEqual(inbox.archive_own(self.ana, items["direct"]["id"]), {"ok": True})
        self.assertEqual(inbox.archive_own(self.ana, items["direct"]["id"]), {"ok": True})   # twice: fine
        self.assertNotIn("direct", [i["type"] for i in self.items()["items"]])
        tc.answer_trial(self.token_of(trial_id), "declined")                           # done, by whatever channel
        self.assertEqual(inbox.archive_own(self.ana, items["trial_approved"]["id"]), {"ok": True})
        # the studio still sees the message it sent, and NOTHING was deleted from the database
        self.assertEqual(inbox.get_admin(plain["id"])["recipients"], 1)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM inbox_recipients WHERE user_id = %s", (self.ana,))[0][0] >= 2, True)

    def test_archived_messages_leave_the_inbox_the_numbers_and_read_all_and_come_back(self):
        ids = [inbox.send_admin_message(Payload(audience="user", email=f"ana{DOMAIN}", title=f"Mensaje {n}"), ADMIN)["id"] for n in range(4)]
        first, second, third, fourth = [[i for i in self.items(size=50)["items"] if i["title"] == f"Mensaje {n}"][0]["id"] for n in range(4)]
        self.assertEqual(inbox.unread_count(self.ana, claims_of("ana")), {"unread": 4})
        inbox.archive_own(self.ana, first)                                             # archiving also reads it
        page = self.items(size=50)
        self.assertEqual((page["counts"], page["unread"]), ({"inbox": 3, "unread": 3, "archived": 1}, 3))
        self.assertNotIn("Mensaje 0", [i["title"] for i in page["items"]])             # "all" does NOT include the archived
        self.assertEqual(self.titles(filter_="unread").count("Mensaje 0"), 0)
        archived = self.items(filter_="archived")
        self.assertEqual([(i["title"], i["archived"], i["read"]) for i in archived["items"]], [("Mensaje 0", True, True)])
        self.assertEqual(inbox.unread_count(self.ana, claims_of("ana"))["unread"], 3)
        self.assertEqual(inbox.mark_all_read(self.ana)["updated"], 3)                  # read-all leaves the archived ones alone
        self.assertEqual(self.sql("SELECT COUNT(*) FROM inbox_recipients WHERE id = %s AND read_at IS NOT NULL", (first,))[0][0], 1)
        self.sql("UPDATE inbox_recipients SET read_at = NULL WHERE id = %s", (first,))   # an archived message that is unread...
        self.assertEqual(inbox.mark_all_read(self.ana)["updated"], 0)                   # ...stays as it was
        # back to the inbox, twice is fine
        self.assertEqual(inbox.unarchive_own(self.ana, first), {"ok": True})
        self.assertEqual(inbox.unarchive_own(self.ana, first), {"ok": True})
        self.assertEqual(self.items()["counts"]["archived"], 0)
        self.assertIn("Mensaje 0", self.titles(size=50))
        # "archive the read ones": every read message without an answer waiting, not the unread ones
        self.sql("UPDATE inbox_recipients SET read_at = NULL WHERE id = %s", (fourth,))
        self.assertEqual(inbox.archive_read(self.ana), {"ok": True, "archived": 2})     # the two that are read (Mensaje 1 and 2)
        self.assertEqual([i["title"] for i in self.items()["items"]], ["Mensaje 3", "Mensaje 0"])   # the unread ones stay
        self.assertEqual(inbox.archive_read(self.ana)["archived"], 0)                   # nothing left to archive
        self.assertEqual(sorted(i["id"] for i in self.items(filter_="archived")["items"]), sorted([second, third]))

    def test_archive_read_leaves_the_messages_that_wait_for_an_answer(self):
        trial_id = self.trial()
        tc.approve_trial(trial_id, self.trainer_id)
        inbox.send_admin_message(Payload(audience="user", email=f"ana{DOMAIN}", title="Informativo"), ADMIN)
        inbox.mark_all_read(self.ana)                                                  # both read now
        self.assertEqual(inbox.archive_read(self.ana)["archived"], 1)                  # only the informative one
        left = [i for i in self.items()["items"] if i["type"] == "trial_approved"]
        self.assertEqual((len(left), left[0]["actions"][0]["state"]), (1, "available"))

    def test_a_client_can_not_archive_or_bring_back_the_messages_of_another(self):
        bia = self.user("bia", "Bia")
        inbox.send_admin_message(Payload(audience="user", email=f"ana{DOMAIN}", title="De Ana"), ADMIN)
        mine = self.items()["items"][0]["id"]
        for action in (inbox.archive_own, inbox.unarchive_own):
            with self.assertRaises(HTTPException) as caught:
                action(bia, mine)
            self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(self.items()["counts"]["inbox"], 1)

    def test_the_old_deleted_rows_become_archived_and_the_migration_can_run_again(self):
        sent = inbox.send_admin_message(Payload(audience="user", email=f"ana{DOMAIN}", title="Borrado antes"), ADMIN)["id"]
        other = inbox.send_admin_message(Payload(audience="user", email=f"ana{DOMAIN}", title="Eliminado por el estudio"), ADMIN)["id"]
        moment = datetime.now() - timedelta(days=3)
        self.sql("UPDATE inbox_recipients SET deleted_at = %s WHERE message_id = %s", (moment, sent))       # how the old code "deleted"
        self.sql("UPDATE inbox_messages SET deleted_at = %s WHERE id = %s", (moment, other))
        inbox.ensure_tables()
        inbox.ensure_tables()                                                                            # twice: nothing changes
        mine = self.sql("SELECT archived_at FROM inbox_recipients WHERE message_id = %s", (sent,))
        self.assertEqual(mine, [(moment,)])                                                              # archived at the same moment
        self.assertEqual(self.sql("SELECT archived_at FROM inbox_messages WHERE id = %s", (other,)), [(moment,)])
        self.assertEqual(self.items()["counts"], {"inbox": 0, "unread": 0, "archived": 1})              # the client's copy is in their archive
        self.assertEqual(self.titles(filter_="archived"), ["Borrado antes"])
        self.assertIn(other, [i["id"] for i in inbox.list_admin(size=100, archived=True)["items"]])      # the studio's, in "Archived"
        self.assertEqual(self.sql("SELECT COUNT(*) FROM inbox_messages WHERE id = ANY(%s)", ([sent, other],))[0][0], 2)   # nothing was removed

    # ----- reschedule proposals
    def test_a_counter_proposal_message_has_live_buttons_and_the_client_answers_from_the_inbox(self):
        day = date.today() + timedelta(days=20)
        session_id = self.sql("INSERT INTO sessions (user_id, trainer_id, session_date, session_time, status, session_number) "
                              "VALUES (%s, %s, %s, '10:00', 'Booked', '3/8') RETURNING id", (self.ana, self.trainer_id, day))[0][0]
        request_id = self.sql(
            "INSERT INTO reschedule_requests (session_id, user_id, original_date, original_time, requested_date, requested_time, "
            "status, counter_date, counter_time, token, lang, admin_note) VALUES (%s, %s, %s, '10:00', %s, '11:00', 'counter_proposed', %s, '12:00', %s, 'es', 'No puedo a esa hora') RETURNING id",
            (session_id, self.ana, day, day, day + timedelta(days=1), f"token-{session_id}-" + "x" * 30))[0][0]
        rr._inbox("reschedule_counter", request_id)
        rr._inbox("reschedule_counter", request_id)                                    # the same step twice: one message
        item = [i for i in self.items(lang="es")["items"] if i["type"] == "reschedule_counter"]
        self.assertEqual(len(item), 1)
        item = item[0]
        self.assertEqual(item["title"], "Propuesta de nueva fecha")
        self.assertIn("3/8", item["body"])
        self.assertIn("No puedo a esa hora", item["body"])
        self.assertEqual([(a["type"], a["state"]) for a in item["actions"]], [("reschedule_accept", "available"), ("reschedule_reject", "available")])
        self.assertFalse(item["can_archive"])
        self.assertEqual(inbox.do_action(self.ana, claims_of("ana"), item["id"], "reschedule_reject")["outcome"], "declined")
        again = [i for i in self.items()["items"] if i["type"] == "reschedule_counter"][0]
        self.assertEqual((self.action_state(again, "reschedule_accept"), self.action_state(again, "reschedule_reject")), ("done", "done"))
        self.assertTrue(again["can_archive"])
        self.assertEqual([action["result"] for action in again["actions"]], ["declined", "declined"])
        # only the owner of the session can answer
        stranger = self.user("eve", "Eve")
        with self.assertRaises(HTTPException) as caught:
            inbox.do_action(stranger, claims_of("eve"), item["id"], "reschedule_accept")
        self.assertEqual(caught.exception.status_code, 404)

    def test_the_other_automatic_messages_are_drawn(self):
        facts = {"number": "2/8", "old_at": "2026-10-21 18:00", "new_at": "2026-10-23 09:00", "note": "Cerrado ese día"}
        for kind, refs in (("reschedule_approved", {"request_id": 9001}), ("reschedule_rejected", {"request_id": 9002}),
                           ("session_cancelled", {"session_id": 9003}), ("session_rescheduled", {"session_id": 9004}),
                           ("pack_approved", {"pack_id": 9005})):
            params = dict(facts, plan_name="Pack 12")
            self.assertTrue(inbox.create_system_message(kind, user_id=self.ana, refs=refs, params=params), kind)
        shown = {i["type"]: i for i in self.items(lang="ca")["items"]}
        self.assertEqual(shown["reschedule_approved"]["title"], "El teu canvi de data ha estat aprovat")
        self.assertIn("Cerrado ese día", shown["reschedule_rejected"]["body"])
        self.assertIn("dimecres", shown["reschedule_approved"]["body"])                # 21 October 2026, in Catalan
        self.assertEqual(shown["session_cancelled"]["actions"], [])
        self.assertEqual(shown["pack_approved"]["actions"][0]["target"], "/my-sessions")
        self.assertEqual(shown["pack_approved"]["actions"][0]["label"], "Veure sessions")
        self.assertIn("Pack 12", shown["pack_approved"]["body"])
        moved = inbox.create_system_message("session_rescheduled", user_id=self.ana, refs={"session_id": 9004}, state="2026-10-25 10:00", params=facts)
        self.assertTrue(moved)                                                         # another new date: another message

    # ----- the studio cancels or moves a session
    def test_the_studio_cancelling_or_moving_a_session_writes_a_message_but_the_client_cancelling_does_not(self):
        import google_fakes
        google = google_fakes.FakeGoogle().install()
        self.addCleanup(google.uninstall)
        day = date.today() + timedelta(days=21)
        while day.weekday() > 4:
            day += timedelta(days=1)

        def new_session(number, hour):
            return self.sql("INSERT INTO sessions (user_id, trainer_id, session_date, session_time, status, session_number) "
                            "VALUES (%s, %s, %s, %s, 'Booked', %s) RETURNING id", (self.ana, self.trainer_id, day, hour, number))[0][0]

        mine, theirs, moved = new_session("1/8", "07:00"), new_session("2/8", "08:00"), new_session("3/8", "09:00")
        main.cancel_session(mine, claims=claims_of("ana"))                       # the client cancels their own: no message
        self.assertEqual([i for i in self.items()["items"] if i["type"] == "session_cancelled"], [])
        admin_claims = {"sub": "uid-boss", "email": main.ADMIN_EMAIL}
        main.cancel_session(theirs, claims=admin_claims)                          # the studio cancels: a message, once
        main.cancel_session(theirs, claims=admin_claims)
        cancelled = [i for i in self.items(lang="es")["items"] if i["type"] == "session_cancelled"]
        self.assertEqual(len(cancelled), 1)
        self.assertIn("2/8", cancelled[0]["body"])
        self.assertEqual(cancelled[0]["title"], "Sesión cancelada")
        # the studio moves a session directly: a message with the new date
        later = day + timedelta(days=1)
        while later.weekday() > 4:
            later += timedelta(days=1)
        with mock.patch.object(rr.notify, "session_moved", lambda ctx: None):
            rr.admin_reschedule(moved, later.isoformat(), "11:00", None, ADMIN)
        shown = [i for i in self.items(lang="en")["items"] if i["type"] == "session_rescheduled"]
        self.assertEqual(len(shown), 1)
        self.assertIn("3/8", shown[0]["body"])
        self.assertIn("11:00", shown[0]["body"])

    def test_the_buttons_text_can_be_translated_and_falls_back_on_the_written_one(self):
        inbox.send_admin_message(Payload(
            audience="user", email=f"ana{DOMAIN}", main_lang="es", action_label="Ver sesiones", action_target="/my-sessions",
            translations={"en": {"title": "Hello", "action_label": "View sessions"}, "ca": {"action_label": "Veure sessions"}}), ADMIN)
        labels = {lang: self.items(lang=lang)["items"][0]["actions"][0]["label"] for lang in ("en", "es", "ca", "xx")}
        self.assertEqual(labels, {"en": "View sessions", "es": "Ver sesiones", "ca": "Veure sessions", "xx": "View sessions"})
        # a translation with only the button text is kept; the title and text fall back
        ca = self.items(lang="ca")["items"][0]
        self.assertEqual((ca["title"], ca["actions"][0]["target"]), ("Aviso", "/my-sessions"))
        for bad, code in (("x" * (inbox.LABEL_MAX + 1), "too_long"), ("<b>Ver</b>", "html_not_allowed")):
            with self.assertRaises(HTTPException) as caught:
                inbox.send_admin_message(Payload(audience="user", email=f"ana{DOMAIN}", action_label="Ver", action_target="/profile",
                                                 translations={"en": {"action_label": bad}}), ADMIN)
            self.assertEqual(code_of(caught), code)
        # without a button a translated button text means nothing and is not stored
        sent = inbox.send_admin_message(Payload(audience="user", email=f"ana{DOMAIN}", title="Sin boton", translations={"en": {"action_label": "Go"}}), ADMIN)
        self.assertEqual(inbox.get_admin(sent["id"])["translations"], {})
        self.assertEqual([i for i in self.items()["items"] if i["title"] == "Sin boton"][0]["actions"], [])

    def test_the_history_searches_and_filters_in_the_server_and_names_the_person(self):
        bia = self.user("bia", "Bia")
        one = inbox.send_admin_message(Payload(audience="user", email=f"bia{DOMAIN}", title="Cierre de Navidad"), ADMIN)["id"]
        two = inbox.send_admin_message(Payload(audience="user", email=f"ana{DOMAIN}", title="Oferta 100% real"), ADMIN)["id"]
        soon = (now_madrid().replace(tzinfo=None) + timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M")
        three = inbox.send_admin_message(Payload(audience="user", email=f"ana{DOMAIN}", title="Programado de Navidad", visible_from=soon), ADMIN)["id"]
        four = inbox.send_admin_message(Payload(audience="user", email=f"ana{DOMAIN}", title="Vieja noticia"), ADMIN)["id"]
        self.sql("UPDATE inbox_messages SET expires_at = %s WHERE id = %s", (datetime.now() - timedelta(days=1), four))
        mine = {one, two, three, four}

        def ids(**kwargs):
            return [item["id"] for item in inbox.list_admin(size=100, **kwargs)["items"] if item["id"] in mine]

        self.assertEqual(sorted(ids(q="navidad")), sorted([one, three]))                  # the title, any capitals
        self.assertEqual(ids(q="100%"), [two])                                            # % is literal
        self.assertEqual(ids(q="_"), [])                                                  # so is _
        self.assertEqual(ids(status="scheduled"), [three])
        self.assertEqual(ids(status="expired"), [four])
        self.assertEqual(sorted(ids(status="sent")), sorted([one, two]))
        self.assertEqual(ids(q="navidad", status="scheduled"), [three])
        self.assertEqual(inbox.list_admin(status="expired", q="vieja")["total"], 1)       # total follows the filters
        page = inbox.list_admin(page=1, size=1, q="navidad")
        self.assertEqual((len(page["items"]), page["total"] >= 2, page["pages"] >= 2), (1, True, True))
        with self.assertRaises(HTTPException) as caught:
            inbox.list_admin(status="nonsense")
        self.assertEqual(code_of(caught), "invalid_status")
        by_id = {item["id"]: item for item in inbox.list_admin(size=100)["items"]}
        self.assertEqual(by_id[one]["person"], f"bia{DOMAIN}")                            # who it went to, in the list
        broadcast = inbox.send_admin_message(Payload(audience="all", title="Para todos", idempotency_key="hist-person"), ADMIN)["id"]
        self.assertIsNone({item["id"]: item for item in inbox.list_admin(size=100)["items"]}[broadcast]["person"])   # never for a general one
        self.assertEqual(bia and inbox.get_admin(one)["people"][0]["read_at"], None)       # not read yet: no date

    def test_http_history_accepts_q_and_status(self):
        main.app.dependency_overrides[main.require_admin] = lambda: {"email": ADMIN, "sub": "uid-boss"}
        inbox.send_admin_message(Payload(audience="user", email=f"ana{DOMAIN}", title="Zebra unica"), ADMIN)
        found = self.client.get("/admin/messages", params={"q": "zebra unica", "status": "sent"}).json()
        self.assertEqual([item["title"] for item in found["items"]], ["Zebra unica"])
        self.assertEqual(self.client.get("/admin/messages", params={"status": "bogus"}).status_code, 422)

    # ----- the studio's history
    def test_history_and_detail_of_the_studios_messages_only(self):
        broadcast = inbox.send_admin_message(Payload(audience="all", title="Para todos", idempotency_key="hist-all"), ADMIN)
        direct = inbox.send_admin_message(Payload(audience="user", email=f"ana{DOMAIN}", title="Solo Ana", idempotency_key="hist-one"), ADMIN)
        tc.approve_trial(self.trial(), self.trainer_id)                                # an automatic message exists too
        inbox.mark_read(self.ana, [i for i in self.items()["items"] if i["title"] == "Solo Ana"][0]["id"])
        listing = inbox.list_admin(size=100)
        self.assertEqual({i["title"] for i in listing["items"]} & {"Para todos", "Solo Ana", "Your trial session has been approved"}, {"Para todos", "Solo Ana"})
        by_id = {i["id"]: i for i in listing["items"]}
        self.assertEqual((by_id[direct["id"]]["recipients"], by_id[direct["id"]]["read"], by_id[direct["id"]]["status"]), (1, 1, "sent"))
        self.assertGreaterEqual(by_id[broadcast["id"]]["recipients"], 1)
        detail = inbox.get_admin(direct["id"])
        self.assertEqual([(p["email"], p["read"], p["archived_by_client"], bool(p["read_at"])) for p in detail["people"]], [(f"ana{DOMAIN}", True, False, True)])   # who read, and when: one person only
        self.assertNotIn("people", inbox.get_admin(broadcast["id"]))                  # the others: only counts
        self.assertEqual((detail["archived"], detail["archived_by"]), (False, None))

    def test_the_studio_archives_a_message_for_everybody_and_can_restore_it(self):
        bia = self.user("bia", "Bia")
        sent = inbox.send_admin_message(Payload(audience="all", title="Para todos los clientes", idempotency_key="arch-all"), ADMIN)["id"]
        self.assertIn("Para todos los clientes", self.titles())
        self.assertIn("Para todos los clientes", self.titles("bia", user_id=bia))
        inbox.archive_own(self.ana, [i for i in self.items()["items"] if i["title"] == "Para todos los clientes"][0]["id"])   # one client had archived it too
        unread_before = inbox.unread_count(bia, claims_of("bia"))["unread"]
        self.assertEqual(inbox.archive_admin(sent, ADMIN), {"ok": True})
        self.assertEqual(inbox.archive_admin(sent, ADMIN), {"ok": True})                 # twice: fine
        # gone from everybody: inbox, archive and numbers
        self.assertNotIn("Para todos los clientes", self.titles())
        self.assertNotIn("Para todos los clientes", self.titles(filter_="archived"))
        self.assertNotIn("Para todos los clientes", self.titles("bia", user_id=bia))
        self.assertEqual(inbox.unread_count(bia, claims_of("bia"))["unread"], unread_before - 1)
        self.assertEqual(self.items("bia", user_id=bia)["counts"]["inbox"], 0)
        # kept in the studio's history, under "Archived", with everything it had
        self.assertNotIn(sent, [i["id"] for i in inbox.list_admin(size=100)["items"]])
        archived = inbox.list_admin(size=100, archived=True)
        self.assertIn(sent, [i["id"] for i in archived["items"]])
        self.assertGreaterEqual(archived["counts"]["archived"], 1)
        detail = inbox.get_admin(sent)
        self.assertEqual((detail["archived"], detail["archived_by"], detail["title"]), (True, ADMIN, "Para todos los clientes"))
        self.assertGreaterEqual(detail["recipients"], 2)
        # restored: back for everybody who had it, each client's own archive state untouched
        self.assertEqual(inbox.restore_admin(sent, ADMIN), {"ok": True})
        self.assertEqual(inbox.restore_admin(sent, ADMIN), {"ok": True})
        self.assertIn("Para todos los clientes", self.titles("bia", user_id=bia))
        self.assertNotIn("Para todos los clientes", self.titles())                       # Ana had archived it herself
        self.assertIn("Para todos los clientes", self.titles(filter_="archived"))
        self.assertIn(sent, [i["id"] for i in inbox.list_admin(size=100)["items"]])
        # one audit row for each real change (who, which message, when): nothing personal
        audit = self.sql("SELECT action, message_id, admin_email FROM inbox_audit WHERE admin_email = %s ORDER BY id", (ADMIN,))
        self.assertEqual(audit, [("archive", sent, ADMIN), ("restore", sent, ADMIN)])
        columns = [row[0] for row in self.sql("SELECT column_name FROM information_schema.columns WHERE table_name = 'inbox_audit' ORDER BY 1")]
        self.assertEqual(columns, ["action", "admin_email", "created_at", "id", "message_id"])
        for action in (inbox.archive_admin, inbox.restore_admin):
            with self.assertRaises(HTTPException) as caught:
                action(99999999, ADMIN)
            self.assertEqual(caught.exception.status_code, 404)
        auto = self.sql("SELECT id FROM inbox_messages WHERE kind = 'system' ORDER BY id DESC LIMIT 1")[0][0]
        with self.assertRaises(HTTPException):
            inbox.archive_admin(auto, ADMIN)                                              # automatic messages are not the studio's
        self.assertEqual(self.sql("SELECT COUNT(*) FROM inbox_messages WHERE id = %s", (sent,))[0][0], 1)   # nothing was deleted

    def test_the_history_tabs_search_and_filter_inside_the_archive_too(self):
        one = inbox.send_admin_message(Payload(audience="user", email=f"ana{DOMAIN}", title="Cierre archivable"), ADMIN)["id"]
        two = inbox.send_admin_message(Payload(audience="user", email=f"ana{DOMAIN}", title="Cierre que sigue"), ADMIN)["id"]
        inbox.archive_admin(one, ADMIN)
        sent_tab = [i["id"] for i in inbox.list_admin(size=100, q="cierre")["items"]]
        archive_tab = [i["id"] for i in inbox.list_admin(size=100, q="cierre", archived=True)["items"]]
        self.assertEqual(([two] if two in sent_tab else []) + [x for x in sent_tab if x == one], [two])
        self.assertEqual([x for x in archive_tab if x in (one, two)], [one])
        self.assertEqual(inbox.list_admin(archived=True, status="sent", q="archivable")["total"], 1)

    # ----- HTTP
    def test_http_flow_and_every_route_is_guarded(self):
        main.app.dependency_overrides[main.require_client] = lambda: claims_of("ana")
        main.app.dependency_overrides[main.require_admin] = lambda: {"email": ADMIN, "sub": "uid-boss"}
        sent = self.client.post("/admin/messages", json={
            "audience": "user", "email": f"ana{DOMAIN}", "main_lang": "es", "title": "Hola", "body": "Cuerpo",
            "action_label": "Ver", "action_target": "/my-sessions", "idempotency_key": "http-1"})
        self.assertEqual(sent.status_code, 200, sent.text)
        self.assertEqual(self.client.post("/admin/messages", json={"audience": "all", "title": "x", "body": "<b>"}).status_code, 422)
        self.assertEqual(self.client.post("/admin/messages/preview", json={"audience": "user", "email": f"ana{DOMAIN}"}).json()["count"], 1)
        self.assertEqual(self.client.get("/inbox/unread-count").json(), {"unread": 1})
        listing = self.client.get("/inbox?lang=es&filter=unread").json()
        self.assertEqual((listing["total"], listing["items"][0]["title"], listing["items"][0]["actions"][0]["target"]), (1, "Hola", "/my-sessions"))
        recipient = listing["items"][0]["id"]
        self.assertEqual(self.client.post(f"/inbox/{recipient}/read").status_code, 200)
        self.assertEqual(self.client.post("/inbox/read-all").json()["updated"], 0)
        self.assertEqual(self.client.get(f"/admin/messages/{sent.json()['id']}").json()["read"], 1)
        self.assertEqual(self.client.get("/admin/messages").status_code, 200)
        self.assertEqual(self.client.post(f"/inbox/{recipient}/actions/link").status_code, 404)   # a link is not an action
        # nobody deletes any more: the old routes answer 410 with a clear message, and archiving takes their place
        gone = self.client.delete(f"/inbox/{recipient}")
        self.assertEqual((gone.status_code, gone.json()["detail"]["code"]), (410, "gone"))
        self.assertEqual(self.client.delete(f"/admin/messages/{sent.json()['id']}").status_code, 410)
        self.assertEqual(self.client.post(f"/inbox/{recipient}/archive").status_code, 200)
        self.assertEqual(self.client.get("/inbox/unread-count").json(), {"unread": 0})
        self.assertEqual(self.client.get("/inbox?filter=archived").json()["total"], 1)
        self.assertEqual(self.client.get("/inbox").json()["total"], 0)
        self.assertEqual(self.client.post(f"/inbox/{recipient}/unarchive").status_code, 200)
        self.assertEqual(self.client.post("/inbox/archive-read").json()["archived"], 1)
        self.assertEqual(self.client.post(f"/admin/messages/{sent.json()['id']}/archive").status_code, 200)
        self.assertEqual(self.client.get("/admin/messages", params={"archived": "true"}).json()["counts"]["archived"] >= 1, True)
        self.assertEqual(self.client.get("/inbox?filter=archived").json()["total"], 0)           # hidden from the client too
        self.assertEqual(self.client.post(f"/admin/messages/{sent.json()['id']}/restore").status_code, 200)
        self.assertEqual(self.client.get("/inbox?filter=archived").json()["total"], 1)
        main.app.dependency_overrides.clear()
        for method, path in (("get", "/inbox"), ("get", "/inbox/unread-count"), ("post", "/inbox/read-all"), ("post", "/inbox/1/read"),
                             ("post", "/inbox/1/archive"), ("post", "/inbox/1/unarchive"), ("post", "/inbox/archive-read"),
                             ("delete", "/inbox/1"), ("post", "/inbox/1/actions/trial_confirm"), ("get", "/admin/messages"),
                             ("get", "/admin/messages/1"), ("delete", "/admin/messages/1"), ("post", "/admin/messages/1/archive"),
                             ("post", "/admin/messages/1/restore"), ("post", "/admin/messages/preview"),
                             ("post", "/admin/messages")):
            kwargs = {"json": {"audience": "all", "title": "t", "body": "b"}} if method == "post" and path.startswith("/admin/messages") else {}
            self.assertEqual(getattr(self.client, method)(path, **kwargs).status_code, 401, path)
        for item in main.app.routes:
            path = getattr(item, "path", "")
            calls = {dependency.call for dependency in getattr(getattr(item, "dependant", None), "dependencies", [])}
            if path.startswith("/inbox"):
                self.assertIn(main.require_client, calls, path)
            if path.startswith("/admin/messages"):
                self.assertIn(main.require_admin, calls, path)

    def test_too_many_requests_are_limited(self):
        main.app.dependency_overrides[main.require_client] = lambda: claims_of("ana")
        limit = inbox.RATE["count"][0]
        codes = [self.client.get("/inbox/unread-count").status_code for _ in range(limit + 2)]
        self.assertEqual((codes[0], codes[limit - 1], codes[limit]), (200, 200, 429))


if __name__ == "__main__":
    unittest.main()

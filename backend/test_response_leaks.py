"""No answer of the API carries more than it needs:  python -m unittest test_response_leaks -v

Two clients (Ana and Bea) and a trainer get data full of recognisable values (sentinels). Every route a client, the public, the inbox
or a trainer can call is then called as Ana (or without a login) and the answers are searched:
  - no key that must never leave the server (uids, tokens, hashes, internal notes, Google ids, audit fields, file paths...);
  - no value that belongs to Bea (her e-mail, phone, address, tax id, uid, tokens, Google event) anywhere in what Ana receives;
  - nothing of the trainers' contact data in the public lists.
Set DUMP_KEYS=1 to print the keys every route returns (the inventory of docs/API_RESPONSES.md). Uses the local database; the rows are removed.
"""
import json
import os
import unittest
from datetime import date, timedelta
from unittest import mock

from fastapi.testclient import TestClient

import challenge
import main
import testsafety
from database import get_connection

DOMAIN = "@test-leaks.example"
ISS = f"https://securetoken.google.com/{main.FIREBASE_PROJECT_ID}"

# Keys no answer to a client, the public or a trainer may ever contain (whatever the value). The few routes that must hand a person
# a link or token of THEIR OWN are listed in OWN_TOKENS below, route by route.
FORBIDDEN_KEYS = {
    "firebase_uid", "uid", "google_event_id", "calendar_sync_status", "calendar_sync_error", "calendar_error", "feed_sequence",
    "admin_note", "admin_notes", "internal_note", "notes", "password", "password_hash", "hash", "idempotency_key", "dedupe_key",
    "created_by", "decided_by", "granted_by", "cancelled_by", "restored_by", "archived_by", "cancel_source", "cancel_prev_status",
    "calendar_feed_token", "confirmation_token", "file_path", "path", "revoked_at", "tax_id_type_internal", "recipient_email",
    "consent_version_internal", "extra_emails", "calendar_extra", "calendar_share",
}
# `admin_note` of a client's reschedule request is the studio's answer written FOR the client (the e-mail carries it too): it is
# declared in response_models.RescheduleRequestOut with that comment, and it is the only route where it may appear.
ALLOWED_KEYS = {"/me/reschedule-requests": {"admin_note"}, "/me/reschedule-requests/{id}": {"admin_note"}}
# route -> the token-like keys it may carry because the person asked for exactly that
OWN_TOKENS = {
    "/me/calendar-feed": {"url", "token", "webcal"},
    "public /landing-page/content": {"url"},          # the site's own content: image and video addresses
    "/reschedule-response/{token}": set(),
    "/trial-sessions/confirmation/{token}": set(),
}
LINK_KEYS = {"token", "url", "webcal"}


def keys_of(value, prefix=""):
    """Every key of a JSON value, with its path (lists are walked through)."""
    found = set()
    if isinstance(value, dict):
        for key, inner in value.items():
            found.add((prefix + "." + key).lstrip("."))
            found |= keys_of(inner, prefix + "." + key)
    elif isinstance(value, list):
        for inner in value:
            found |= keys_of(inner, prefix + "[]")
    return found


class Leaks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        testsafety.require_local_database()
        main.ensure_trial_session_fields()
        main.ensure_session_pack_column()
        main.ensure_calendar_sync_columns()
        main.ensure_client_lifecycle_columns()
        cls.client = TestClient(main.app)
        cls.client.__enter__()            # runs the start-up hooks: the tables every route reads are created

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)

    def setUp(self):
        self.cleanup()
        self.addCleanup(self.cleanup)
        patcher = mock.patch.object(challenge, "_enforced", False)
        patcher.start()
        self.addCleanup(patcher.stop)
        original = main.id_token.verify_firebase_token
        main.id_token.verify_firebase_token = lambda token, *a, **k: {
            "iss": ISS, "email": f"{token}{DOMAIN}", "sub": f"uid-{token}-leak", "email_verified": True}
        self.addCleanup(setattr, main.id_token, "verify_firebase_token", original)
        self.seed()

    @staticmethod
    def cleanup():
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM users WHERE email LIKE %s", (f"%{DOMAIN}",))
        ids = [row[0] for row in cur.fetchall()]
        if ids:
            for table in ("inbox_recipients", "reschedule_requests", "sessions", "client_requests", "user_plans"):
                try:
                    cur.execute(f"DELETE FROM {table} WHERE user_id = ANY(%s)", (ids,))
                except Exception:  # noqa: BLE001  (a table the local database does not have yet)
                    conn.rollback()
            cur.execute("DELETE FROM users WHERE id = ANY(%s)", (ids,))
        cur.execute("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        cur.execute("DELETE FROM trainer_access WHERE email LIKE %s", (f"%{DOMAIN}",))
        conn.commit()
        conn.close()

    # ------------------------------------------------------------------------------------------------------------ the data
    def seed(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id, nome FROM trainers WHERE active ORDER BY id LIMIT 1")
        self.trainer_id, self.trainer_name = cur.fetchone()
        cur.execute("SELECT id FROM plans ORDER BY id LIMIT 1")
        plan_id = cur.fetchone()[0]
        self.people = {}
        for key, phone, street, tax in (("a", "+34611000111", "Calle Sentinel-A 1", "TAXA0001"), ("b", "+34622000222", "Calle Sentinel-B 2", "TAXB0002")):
            cur.execute(
                "INSERT INTO users (firebase_uid, nome, email, telefone, codigo_pais, cidade, morada, cep, tax_id_type, tax_id, country, calendar_feed_token) "
                "VALUES (%s,%s,%s,%s,'+34','Barcelona',%s,'08001','NIF',%s,'ES',%s) RETURNING id",
                (f"uid-{key}-leak", f"Persona {key.upper()}", f"{key}{DOMAIN}", phone, street, tax, f"feedtoken-{key}-leak"))
            user_id = cur.fetchone()[0]
            day = date.today() + timedelta(days=10 if key == "a" else 11)
            cur.execute("INSERT INTO user_plans (user_id, plan_id, active, start_date, sessions_per_week, extra_emails) VALUES (%s,%s,TRUE,%s,2,%s) RETURNING id",
                        (user_id, plan_id, date.today(), [f"cc-{key}@extra-leak.example"]))
            user_plan = cur.fetchone()[0]
            cur.execute("INSERT INTO sessions (user_id, trainer_id, session_date, session_time, status, session_number, google_event_id, user_plan_id) "
                        "VALUES (%s,%s,%s,'10:00','Scheduled','1/8',%s,%s) RETURNING id", (user_id, self.trainer_id, day, f"gevent-{key}-leak", user_plan))
            session_id = cur.fetchone()[0]
            cur.execute("INSERT INTO reschedule_requests (session_id, user_id, original_date, original_time, requested_date, requested_time, client_note, status, "
                        "admin_note, token) VALUES (%s,%s,%s,'10:00',%s,'11:00',%s,'pending',%s,%s) RETURNING id",
                        (session_id, user_id, day, day + timedelta(days=1), f"nota-{key}", f"studio-answer-{key}", f"rrtoken-{key}-leak-0123456789abcdef"))
            request_id = cur.fetchone()[0]
            cur.execute(
                "INSERT INTO trial_sessions (full_name, email, phone, age, goal, experience, session_date, session_time, status, trainer_id, "
                "confirmation_token, google_event_id) VALUES (%s,%s,%s,30,'strength','beginner',%s,'09:00','Approved',%s,%s,%s) RETURNING id",
                (f"Persona {key.upper()}", f"{key}{DOMAIN}", phone, date.today() + timedelta(days=20), self.trainer_id, f"trialtoken-{key}-leak-0123456789abcdef", f"gtrial-{key}-leak"))
            trial_id = cur.fetchone()[0]
            self.people[key] = {"id": user_id, "email": f"{key}{DOMAIN}", "phone": phone, "street": street, "tax": tax, "uid": f"uid-{key}-leak",
                                "session": session_id, "request": request_id, "trial": trial_id}
        cur.execute("INSERT INTO trainer_access (trainer_id, firebase_uid, email, granted_by) VALUES (%s,%s,%s,%s)",
                    (self.trainer_id, "uid-coach-leak", f"coach{DOMAIN}", "admin-secret"))
        conn.commit()
        conn.close()
        import inbox
        for key in ("a", "b"):
            inbox.create_system_message("session_cancelled", user_id=self.people[key]["id"], refs={"session_id": self.people[key]["session"]},
                                        params={"number": "1/8", "old_at": "x"})

    # ---------------------------------------------------------------------------------------------------------------- calls
    def routes_for(self, who):
        me = self.people[who]
        day = (date.today() + timedelta(days=10)).isoformat()
        return [
            ("/users/email/{email}", f"/users/email/{me['email']}"), ("/sessions/user/{user_id}", f"/sessions/user/{me['id']}"),
            ("/profile/{user_id}", f"/profile/{me['id']}"), ("/client/trial", "/client/trial"), ("/client/workflow", "/client/workflow"),
            ("/me/roles", "/me/roles"), ("/me/reschedule-requests", "/me/reschedule-requests"),
            ("/me/reschedule-requests/{id}", f"/me/reschedule-requests/{me['request']}"), ("/me/calendar-feed", "/me/calendar-feed"),
            ("/me/deletion-request", "/me/deletion-request"), ("/inbox", "/inbox"), ("/inbox/unread-count", "/inbox/unread-count"),
            ("/pack-availability", "/pack-availability"), ("/available-trainers", f"/available-trainers?time=10:00&date={day}"),
            ("/available-trainers/{day}/{time}", "/available-trainers/Monday/10:00"), ("/schedule", "/schedule"), ("/schedule/{date}", f"/schedule/{day}"),
            ("/trainer/{id}/available-times/{date}", f"/trainer/{self.trainer_id}/available-times/{day}"),
        ]

    PUBLIC = [
        ("/", "/"), ("/pricing", "/pricing"), ("/trainers", "/trainers"), ("/features", "/features"), ("/landing-page/content", "/landing-page/content"),
        ("/training-videos", "/training-videos"), ("/legal", "/legal"), ("/health/ready", "/health/ready"),
        ("/available-trainers", "/available-trainers?time=10:00&weekday=Monday"),
        ("/schedule", "/schedule"),
    ]

    def get(self, path, token=None):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self.client.get(path, headers=headers)

    def collect(self):
        """{route: parsed JSON} for everything Ana (a), a trainer (coach) and an anonymous visitor can read; plus the link routes."""
        found = {}
        for template, path in self.routes_for("a"):
            answer = self.get(path, "a")
            if answer.headers.get("content-type", "").startswith("application/json"):
                found[template] = (answer.status_code, answer.json())
        for template, path in self.PUBLIC:
            answer = self.get(path)
            if answer.headers.get("content-type", "").startswith("application/json"):
                found["public " + template] = (answer.status_code, answer.json())
        week = f"from={date.today().isoformat()}&to={(date.today() + timedelta(days=30)).isoformat()}"
        for path in ("/trainer-area/me/summary", f"/trainer-area/me/sessions?{week}", f"/trainer-area/me/free-slots?{week}"):
            answer = self.get(path, "coach")
            found["trainer " + path] = (answer.status_code, answer.json())
        # the person who holds the link of THEIR OWN request / trial (no login)
        a = self.people["a"]
        for template, path in (("/reschedule-response/{token}", "/reschedule-response/rrtoken-a-leak-0123456789abcdef"),
                               ("/trial-sessions/confirmation/{token}", "/trial-sessions/confirmation/trialtoken-a-leak-0123456789abcdef")):
            answer = self.get(path)
            found[template] = (answer.status_code, answer.json())
        return found

    # ---------------------------------------------------------------------------------------------------------------- tests
    def test_inventory_and_forbidden_keys(self):
        everything = self.collect()
        if os.getenv("DUMP_KEYS"):
            for route, (status, body) in sorted(everything.items()):
                print(f"\n{route}  [{status}]")
                for key in sorted(keys_of(body)):
                    print("   ", key)
        problems = []
        for route, (status, body) in everything.items():
            self.assertNotEqual(status, 500, route)
            allowed = OWN_TOKENS.get(route, set())
            for key in keys_of(body):
                leaf = key.split(".")[-1].replace("[]", "")
                if (leaf in FORBIDDEN_KEYS and leaf not in ALLOWED_KEYS.get(route, set())) or (leaf in LINK_KEYS and leaf not in allowed):
                    problems.append(f"{route}: {key}")
        self.assertEqual(problems, [], "keys that must not be in an answer:\n" + "\n".join(problems))

    def test_a_client_never_receives_anything_of_another_client(self):
        everything = self.collect()
        b = self.people["b"]
        secrets_of_b = [b["email"], b["phone"], b["street"], b["tax"], b["uid"], f"feedtoken-b-leak", "rrtoken-b-leak-0123456789abcdef", "trialtoken-b-leak-0123456789abcdef",
                        "gevent-b-leak", "gtrial-b-leak", "studio-answer-b", "nota-b", "Persona B", "cc-b@extra-leak.example"]
        leaked = [f"{route}: {secret}" for route, (_, body) in everything.items() if not route.startswith("trainer")
                  for secret in secrets_of_b if secret in json.dumps(body, ensure_ascii=False, default=str)]
        self.assertEqual(leaked, [], "values of another client in an answer:\n" + "\n".join(leaked))

    def test_a_client_only_gets_their_own_secrets_where_they_need_them(self):
        a = self.people["a"]
        mine = json.dumps({route: body for route, (_, body) in self.collect().items() if not route.startswith(("public", "trainer"))}, default=str)
        for secret in ("gevent-a-leak", "gtrial-a-leak", a["uid"], "cc-a@extra-leak.example"):
            self.assertNotIn(secret, mine, f"{secret} must not reach the client even when it is their own")

    def test_the_lists_of_trainers_and_hours_carry_no_contact_data(self):
        everything = self.collect()
        for route in ("public /trainers", "public /available-trainers", "public /schedule", "/available-trainers", "/pack-availability",
                      "/available-trainers/{day}/{time}", "/trainer/{id}/available-times/{date}", "/schedule/{date}"):
            text = json.dumps(everything[route][1], default=str).lower()
            for word in ("@", "email", "phone", "telefone", "tax_id", "firebase", "token", "persona a", "persona b", "leak"):
                self.assertNotIn(word, text, f"{route} carries '{word}'")

    def test_the_trainer_sees_their_clients_by_a_display_name_and_nothing_else_of_theirs(self):
        sessions = self.collect()[next(key for key in self.collect() if key.startswith("trainer /trainer-area/me/sessions"))][1]
        self.assertTrue(sessions)
        text = json.dumps(sessions).lower()
        for word in ("@", "+34", "leak", "morada", "tax"):
            self.assertNotIn(word, text)

    def test_another_client_cannot_read_what_is_not_theirs(self):
        b = self.people["b"]
        for path in (f"/profile/{b['id']}", f"/sessions/user/{b['id']}", f"/users/email/{b['email']}", f"/me/reschedule-requests/{b['request']}"):
            answer = self.get(path, "a")
            self.assertIn(answer.status_code, (403, 404), path)
            self.assertNotIn("Persona B", answer.text)


# ------------------------------------------------------------------------------------------------------------ the safety net itself
class Declared(unittest.TestCase):
    """The response models drop every field that is not declared, and every route that answers a client, the inbox, a trainer or the
    public has one (or is listed here with the reason it has none)."""

    def test_an_undeclared_field_never_leaves_the_server(self):
        from fastapi import FastAPI
        import response_models as out
        app = FastAPI()

        @app.get("/probe", response_model=out.ProfileOut)
        def probe():
            return {"id": 1, "nome": "Ana", "firebase_uid": "uid-secret", "token": "tok-secret", "google_event_id": "ev-secret", "admin_notes": "x"}

        body = TestClient(app).get("/probe").json()
        self.assertEqual(body["nome"], "Ana")
        for leaked in ("firebase_uid", "token", "google_event_id", "admin_notes"):
            self.assertNotIn(leaked, body)

    # route -> why it answers without a model (a list of lists, a cached public catalogue, a file, an admin-only route...)
    NO_MODEL = {
        "/": "a fixed text", "/health/ready": "a fixed status", "/pricing": "public catalogue built field by field (pack_catalog.public_catalog)",
        "/trainers": "list of [id, name, speciality]", "/schedule": "weekday -> hours", "/schedule/{session_date}": "hours of a day",
        "/sessions/user/{user_id}": "list of rows of the client's own sessions (select list fixed in the route)",
        "/pack-availability": "weekday -> hours -> trainer id and name", "/available-trainers/{day}/{time}": "trainer id and name",
        "/trainer/{trainer_id}/available-times/{session_date}": "list of hours", "/landing-page/content": "the site's published content (CMS)",
        "/legal": "company data and legal texts the pages show (legal.public_view)", "/me/deletion-request": "own status only",
        "/me/calendar-feed": "the person's own feed link", "/me/export": "the person's own data (GDPR)", "/me/export.html": "the person's own data (GDPR)",
        "/me/sessions.ics": "a calendar file", "/me/sessions/{session_id}/ics": "a calendar file", "/uploads/{name}": "a stored image",
        "/calendar/feed/{filename}": "a calendar file (the feed of the person who holds the link)", "/health": "a fixed status",
    }

    def test_every_route_a_client_the_inbox_a_trainer_or_the_public_can_read_has_a_model(self):
        missing = []
        for item in main.app.routes:
            methods = getattr(item, "methods", None) or ()
            path = getattr(item, "path", "")
            if "GET" not in methods or path.startswith(("/admin", "/openapi", "/docs", "/redoc")):
                continue
            dependencies = [dependency.call for dependency in item.dependant.dependencies]
            if main.require_admin in dependencies or any(getattr(call, "__name__", "") == "require_admin" for call in dependencies):
                continue
            if getattr(item, "response_model", None) is None and path not in self.NO_MODEL:
                missing.append(path)
        self.assertEqual(missing, [], "these routes answer without a response model; give them one (response_models.py) or list them in NO_MODEL with the reason:\n" + "\n".join(missing))


if __name__ == "__main__":
    unittest.main()

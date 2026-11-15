"""Legal data and consent (legal.py, and the consent boxes of the trial, contact and pack forms):

    python -m unittest test_legal -v

The company data starts empty and is only filled in by the admin; the public endpoint shows the public fields; only the admin changes anything;
nothing with HTML is stored in the company data; a form is refused without the consent box and stores only the version and the date.
"""
import unittest
from datetime import date, timedelta
from unittest import mock

import testsafety
from fastapi.testclient import TestClient

import contact_messages as cm
import data_retention
import legal
import main
from database import get_connection

DOMAIN = "@test-legal.example"
CONSENT = {"privacy_consent": True, "consent_version": "2026-11-15"}


def sql(query, args=()):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(query, args or None)
    rows = cur.fetchall() if cur.description else []
    conn.commit()
    conn.close()
    return rows


def slot():
    day = date.today() + timedelta(days=21)
    while day.weekday() > 4:
        day += timedelta(days=1)
    return day.isoformat()


class LegalBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        testsafety.require_local_database()
        main.ensure_client_workflow_fields()
        cm.ensure_contact_table()
        legal.ensure_schema()
        cls.http = TestClient(main.app)

    def setUp(self):
        main.app.dependency_overrides.clear()
        self.addCleanup(main.app.dependency_overrides.clear)
        sql("UPDATE legal_settings SET holder = '', tax_id = '', address = '', email = '', phone = '', registry = '', dpo_name = '', "
            "retention_contact_days = NULL, retention_trial_days = NULL, retention_email_log_days = NULL, last_review = NULL, reviewed = FALSE WHERE id = 1")
        sql("DELETE FROM legal_documents")
        sql("DELETE FROM contact_messages WHERE email LIKE %s", (f"%{DOMAIN}",))
        sql("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))
        legal._public_limit.hits.clear()
        cm._limit.clear()
        main._trial_hits.clear()

    def tearDown(self):
        sql("DELETE FROM contact_messages WHERE email LIKE %s", (f"%{DOMAIN}",))
        sql("DELETE FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))

    def as_admin(self):
        main.app.dependency_overrides[main.require_admin] = lambda: {"email": main.ADMIN_EMAIL, "sub": "uid-admin"}


FULL = {"holder": "Estudio Prueba S.L.", "tax_id": "B00000000", "address": "Calle Falsa 1, Barcelona", "email": "legal@test-legal.example",
        "phone": "+34 600 000 000", "registry": "", "dpo_name": "", "reviewed": True}


class CompanyData(LegalBase):
    def test_nothing_is_invented_the_data_starts_empty(self):
        view = self.http.get("/legal").json()
        for name in ("holder", "tax_id", "address", "email", "phone", "registry", "dpo_name"):
            self.assertEqual(view["settings"][name], "", name)
        self.assertEqual(view["documents"], {})

    def test_the_public_answer_has_the_public_fields_only(self):
        self.as_admin()
        self.assertEqual(self.http.put("/admin/legal/settings", json=FULL).status_code, 200)
        main.app.dependency_overrides.clear()
        public = self.http.get("/legal").json()["settings"]
        self.assertEqual(public["holder"], "Estudio Prueba S.L.")
        self.assertNotIn("reviewed", public)                    # the state of the review is for the admin
        self.assertNotIn("updated_at", public)
        self.assertEqual(public["retention_contact_days"], data_retention.settings()["contact_days"])      # the real default of the daily job

    def test_only_the_admin_changes_the_company_data_and_the_texts(self):
        for method, path, body in (("put", "/admin/legal/settings", FULL), ("put", "/admin/legal/documents/privacy/es", {"body": "x"}),
                                   ("delete", "/admin/legal/documents/privacy/es", None), ("get", "/admin/legal", None), ("get", "/admin/legal/status", None)):
            answer = getattr(self.http, method)(path, **({"json": body} if body is not None else {}))
            self.assertIn(answer.status_code, (401, 403), path)
        self.assertEqual(self.http.get("/legal").json()["settings"]["holder"], "")

    def test_html_is_refused_and_the_size_and_fields_are_checked(self):
        self.as_admin()
        for field in ("holder", "address", "registry", "dpo_name"):
            answer = self.http.put("/admin/legal/settings", json={**FULL, field: "<script>alert(1)</script>"})
            self.assertEqual(answer.status_code, 422, field)
            self.assertEqual(answer.json()["detail"]["code"], "no_html")
        self.assertEqual(self.http.put("/admin/legal/settings", json={**FULL, "holder": "x" * 151}).status_code, 422)
        self.assertEqual(self.http.put("/admin/legal/settings", json={**FULL, "email": "not-an-email"}).status_code, 422)
        self.assertEqual(self.http.put("/admin/legal/settings", json={**FULL, "retention_contact_days": 0}).status_code, 422)
        self.assertEqual(self.http.put("/admin/legal/settings", json={**FULL, "retention_contact_days": 99999}).status_code, 422)
        self.assertEqual(self.http.put("/admin/legal/settings", json={**FULL, "last_review": "yesterday"}).status_code, 422)
        self.assertEqual(self.http.put("/admin/legal/settings", json={**FULL, "unknown": 1}).status_code, 422)         # no extra field
        self.assertEqual(self.http.get("/legal").json()["settings"]["holder"], "")                                   # nothing was stored

    def test_the_reminder_stays_until_the_data_is_complete_and_the_texts_are_reviewed(self):
        self.as_admin()
        status = self.http.get("/admin/legal/status").json()
        self.assertTrue(status["needs_attention"])
        self.assertEqual(set(status["missing"]), {"holder", "tax_id", "address", "email"})
        self.http.put("/admin/legal/settings", json={**FULL, "reviewed": False})
        self.assertTrue(self.http.get("/admin/legal/status").json()["needs_attention"])           # complete but not reviewed
        self.http.put("/admin/legal/settings", json=FULL)
        status = self.http.get("/admin/legal/status").json()
        self.assertFalse(status["needs_attention"])
        self.assertEqual(status["missing"], [])

    def test_the_retention_shown_is_what_the_admin_typed_or_what_the_job_uses(self):
        self.as_admin()
        self.http.put("/admin/legal/settings", json={**FULL, "retention_contact_days": 90})
        view = self.http.get("/admin/legal").json()
        self.assertEqual(view["settings"]["retention_contact_days"], 90)
        self.assertEqual(view["settings"]["retention_contact_days_custom"], 90)
        self.assertEqual(view["settings"]["retention_trial_days"], data_retention.settings()["trial_days"])
        self.assertIsNone(view["settings"]["retention_trial_days_custom"])


class Documents(LegalBase):
    def test_an_edited_text_is_public_a_script_in_it_is_just_text_and_the_model_comes_back(self):
        self.as_admin()
        evil = "## Titulo\n<script>alert(1)</script>"
        self.assertEqual(self.http.put("/admin/legal/documents/privacy/es", json={"body": evil}).status_code, 200)
        main.app.dependency_overrides.clear()
        public = self.http.get("/legal").json()["documents"]
        self.assertEqual(public["privacy"]["es"]["body"], evil)                  # stored as typed: the site draws it as text (legalRender.test.js)
        self.assertTrue(public["privacy"]["es"]["updated_at"])
        self.assertNotIn("en", public["privacy"])                                # the other languages keep their model
        self.as_admin()
        self.assertEqual(self.http.delete("/admin/legal/documents/privacy/es").status_code, 200)
        self.assertEqual(self.http.get("/legal").json()["documents"], {})        # restored: no edited text is left

    def test_unknown_documents_empty_and_oversized_texts_are_refused(self):
        self.as_admin()
        self.assertEqual(self.http.put("/admin/legal/documents/secret/es", json={"body": "x"}).status_code, 404)
        self.assertEqual(self.http.put("/admin/legal/documents/privacy/fr", json={"body": "x"}).status_code, 404)
        self.assertEqual(self.http.put("/admin/legal/documents/privacy/es", json={"body": "   "}).status_code, 422)
        self.assertEqual(self.http.put("/admin/legal/documents/privacy/es", json={"body": "x" * 40001}).status_code, 422)
        self.assertEqual(self.http.put("/admin/legal/documents/privacy/es", json={"body": "x", "extra": 1}).status_code, 422)
        self.assertEqual(self.http.delete("/admin/legal/documents/nothing/es").status_code, 404)

    def test_the_public_answer_is_limited_per_connection(self):
        legal._public_limit.limit = 3
        self.addCleanup(setattr, legal._public_limit, "limit", 120)
        codes = [self.http.get("/legal").status_code for _ in range(5)]
        self.assertEqual(codes, [200, 200, 200, 429, 429])


class ConsentOfTheForms(LegalBase):
    def contact(self, **extra):
        body = {"name": "Ana Ruiz", "email": f"ana{DOMAIN}", "message": "Hola, quiero informacion de las clases.", "language": "es", **extra}
        return self.http.post("/contact-messages", json=body)

    def trial(self, goals=("Lose weight",), **extra):
        with mock.patch.object(main, "notify_trial_requested"), mock.patch.object(main.mailer, "send_trial_received"):
            return self.http.post("/trial-sessions", json={
                "full_name": "Ana García", "email": f"trial{DOMAIN}", "phone": "600123456", "goals": list(goals), "experience": "Beginner",
                "session_date": slot(), "session_time": "10:00", "lang": "es", **extra})

    def test_the_contact_form_is_refused_without_the_box_and_in_the_language_of_the_visitor(self):
        for extra in ({}, {"privacy_consent": False, "consent_version": "x"}):
            answer = self.contact(**extra)
            self.assertEqual(answer.status_code, 422, extra)
            self.assertEqual(answer.json()["detail"]["code"], "consent_required")
        self.assertEqual(self.contact(privacy_consent="yes", consent_version="x").status_code, 422)      # only a real true counts
        self.assertIn("Política de privacidad", self.contact().json()["detail"]["message"])
        self.assertEqual(sql("SELECT COUNT(*) FROM contact_messages WHERE email LIKE %s", (f"%{DOMAIN}",))[0][0], 0)

    def test_the_contact_form_stores_only_the_version_and_the_date(self):
        self.assertEqual(self.contact(**CONSENT).status_code, 200)
        row = sql("SELECT consent_version, consent_at IS NOT NULL FROM contact_messages WHERE email LIKE %s", (f"%{DOMAIN}",))[0]
        self.assertEqual(row, ("2026-11-15", True))
        for bad in ("", "x" * 40, "<b>", "a b"):
            self.assertEqual(self.contact(privacy_consent=True, consent_version=bad).status_code, 422, bad)

    def test_the_trial_form_is_refused_without_the_box_and_stores_the_proof_with_it(self):
        self.assertEqual(self.trial().status_code, 422)
        self.assertEqual(self.trial(privacy_consent=False, consent_version="x").json()["detail"]["code"], "consent_required")
        self.assertEqual(sql("SELECT COUNT(*) FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))[0][0], 0)
        answer = self.trial(**CONSENT)
        self.assertEqual(answer.status_code, 200, answer.text)
        row = sql("SELECT consent_version, consent_at IS NOT NULL, health_consent_at FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))[0]
        self.assertEqual(row, ("2026-11-15", True, None))                       # no health goal: no health consent is recorded

    def test_the_rehabilitation_goal_needs_its_own_explicit_consent(self):
        goal = ("Rehabilitation/injury recovery",)
        refused = self.trial(goals=goal, **CONSENT)
        self.assertEqual((refused.status_code, refused.json()["detail"]["code"]), (422, "health_consent_required"))
        self.assertEqual(self.trial(goals=goal, health_consent=False, **CONSENT).status_code, 422)
        self.assertEqual(sql("SELECT COUNT(*) FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))[0][0], 0)
        self.assertEqual(self.trial(goals=goal, health_consent=True, **CONSENT).status_code, 200)
        self.assertTrue(sql("SELECT health_consent_at IS NOT NULL FROM trial_sessions WHERE email LIKE %s", (f"%{DOMAIN}",))[0][0])

    def test_the_consents_of_an_account_keep_the_type_the_version_and_the_date_and_go_with_the_account(self):
        uid = "uid-legal-test"
        sql("DELETE FROM users WHERE firebase_uid = %s", (uid,))
        user_id = sql("INSERT INTO users (firebase_uid, nome, email) VALUES (%s, 'Legal Test', %s) RETURNING id", (uid, f"acct{DOMAIN}"))[0][0]
        try:
            conn = get_connection()
            cur = conn.cursor()
            legal.record_consents(cur, user_id, ("privacy", "terms", "nonsense"), "2026-11-15")
            conn.commit()
            conn.close()
            rows = sql("SELECT consent_type, version, created_at IS NOT NULL FROM consents WHERE user_id = %s ORDER BY consent_type", (user_id,))
            self.assertEqual(rows, [("privacy", "2026-11-15", True), ("terms", "2026-11-15", True)])           # an unknown type is ignored
            columns = {row[0] for row in sql("SELECT column_name FROM information_schema.columns WHERE table_name = 'consents'")}
            self.assertEqual(columns, {"id", "user_id", "consent_type", "version", "created_at"})              # no address, no browser data
        finally:
            sql("DELETE FROM users WHERE id = %s", (user_id,))
        self.assertEqual(sql("SELECT COUNT(*) FROM consents WHERE user_id = %s", (user_id,))[0][0], 0)        # deleting the account deletes them

    def test_a_pack_request_needs_the_box_too(self):
        with self.assertRaises(main.HTTPException) as caught:
            legal.require_consent(None, None)
        self.assertEqual(caught.exception.detail["code"], "consent_required")
        self.assertEqual(legal.require_consent(True, "2026-11-15"), "2026-11-15")


if __name__ == "__main__":
    unittest.main()

"""Every e-mail a CLIENT receives is written in ONE language, the client's:

    python -m unittest test_client_emails -v

Part 1 (no database): every client e-mail is built in en / es / ca; subject, title, body, buttons, notices, footer, dates,
plain text and <html lang> are in that language only, no text is missing in any dictionary, and no subject or button holds
two languages ("ES / EN"). Part 2: the language each sender picks (the booking's own, else the client's profile, else
English) with send_email replaced by a recorder, so nothing is sent. The team's e-mails stay Spanish.
"""
import logging
import os
import re
import unittest
import warnings
from datetime import datetime
from unittest import mock

import client_lang
import mailer
import reschedule_notifications as notifications
from emails import texts
from emails.pack_emails import build_pack_email
from emails.reschedule_emails import (
    client_reschedule_approved, client_reschedule_counter, client_reschedule_rejected, client_session_moved,
    staff_counter_answer, staff_reschedule_requested,
)
from emails.samples import sample_all_components
from emails.transport import EmailResult
from emails.trial_emails import (
    client_trial_approved, client_trial_cancelled, client_trial_confirmed, client_trial_received,
    staff_trial_confirmed, staff_trial_declined, staff_trial_requested,
)
from emails.welcome_emails import build_staff_client_created, build_welcome_email

os.environ["CLIENT_CALENDAR_ENABLED"] = "true"      # these tests look at the calendar parts of the emails

LANGUAGES = ("en", "es", "ca")
START = datetime(2026, 10, 12, 9, 0)           # a Monday
PACK = {
    "client_name": "Ana", "client_email": "ana@example.com", "plan_name": "Plan", "sessions_per_week": 2,
    "days": ["Monday", "Wednesday"], "trainer": "Carles",
    "calendar_links": {"google": "https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fx", "https": "https://example.com/f.ics"},
    "sessions": [{"id": 1, "start": START, "trainer": "Carles", "number": "1/2"},
                 {"id": 2, "start": datetime(2026, 10, 14, 9), "trainer": "Carles", "number": "2/2"}],
}
RESCHEDULE = {
    "id": 7, "client_name": "Ana", "client_email": "ana@example.com", "number": "3/8", "trainer": "Matilda",
    "original_date": "2026-11-16", "original_time": "10:00", "requested_date": "2026-11-18", "requested_time": "11:00",
    "session_date": "2026-11-18", "session_time": "11:00", "counter_date": "2026-11-19", "counter_time": "12:00",
    "client_note": "x", "admin_note": "y", "token": "t" * 43,
}

# words that show which language a piece of an e-mail is in
WORDS = {"en": ("Hi Ana", "Monday", "October"), "es": ("Hola Ana", "Lunes", "octubre"), "ca": ("Hola Ana", "Dilluns", "octubre")}


def client_emails(lang):
    """name -> (subject, html, text) of every e-mail a client can receive, in `lang`."""
    ctx = {**RESCHEDULE, "lang": lang}
    return {
        "components": sample_all_components(lang),
        "pack_summary": build_pack_email(PACK, lang=lang),
        "welcome": build_welcome_email("Ana", "ana@example.com", "Pw-123-xyz", None, lang)[:3],
        "welcome_with_pack": build_welcome_email("Ana", "ana@example.com", "Pw-123-xyz", PACK, lang)[:3],
        "trial_received": client_trial_received("Ana", START, lang),
        "trial_approved": client_trial_approved("Ana", START, "Carles", "TOKEN", lang),
        "trial_confirmed": client_trial_confirmed("Ana", START, "Carles", 5, lang)[:3],
        "trial_cancelled": client_trial_cancelled("Ana", START, lang, 5, "Carles")[:3],
        "reschedule_approved": client_reschedule_approved(ctx),
        "reschedule_rejected": client_reschedule_rejected(ctx),
        "reschedule_counter": client_reschedule_counter(ctx),
        "session_moved": client_session_moved(ctx),
    }


def plain(html):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))


def button_labels(html):
    return [re.sub(r"<[^>]+>", "", label).strip() for label in re.findall(r"<a [^>]*>(.*?)</a>", html, re.S)
            if "mailto:" not in label]


class Collector:
    """Records the texts an e-mail asks for and the ones a language lacks."""
    def __init__(self):
        self.used, self.missing = set(), []

    def __enter__(self):
        texts.USED_HOOK = self.used.add
        texts.MISSING_HOOK = lambda key, lang: self.missing.append((key, lang))
        return self

    def __exit__(self, *exc):
        texts.USED_HOOK = None
        texts.MISSING_HOOK = None


class OneLanguage(unittest.TestCase):
    def test_every_client_email_is_written_in_one_language(self):
        for lang in LANGUAGES:
            with Collector() as seen:
                built = client_emails(lang)
            self.assertEqual(seen.missing, [], lang)                 # nothing fell back on another language
            for name, (subject, html, text) in built.items():
                where = (lang, name)
                self.assertIn(f'<html lang="{lang}"', html, where)
                self.assertIn(f'<meta http-equiv="Content-Language" content="{lang}">', html, where)
                self.assertNotIn(" / ", subject, where)               # no "ES / EN" subject
                for label in button_labels(html):
                    self.assertNotIn(" / ", label, where)             # nor button
                for other in LANGUAGES:
                    if other == lang:
                        continue
                    # the other languages' own words for the title/sentences never appear here
                    other_subject = {k: v for k, v in client_emails(other).items()}[name][0]
                    if other_subject != subject:
                        self.assertNotIn(other_subject, plain(html), where)
                        self.assertNotIn(other_subject, text, where)

    def test_the_weekday_month_and_dates_follow_the_language(self):
        pack = {lang: client_emails(lang)["pack_summary"][1] for lang in LANGUAGES}
        self.assertIn("Monday, 12 October 2026", plain(pack["en"]))
        self.assertIn("Lunes, 12 de octubre de 2026", plain(pack["es"]))
        self.assertIn("Dilluns, 12 d&#x27;octubre de 2026", pack["ca"].replace("d'octubre", "d&#x27;octubre"))
        self.assertIn("Dimecres", pack["ca"])
        self.assertNotIn("Wednesday", pack["ca"] + pack["es"])
        self.assertNotIn("Miércoles", pack["ca"] + pack["en"])
        self.assertNotIn("Dimecres", pack["es"] + pack["en"])

    def test_the_catalan_client_gets_catalan_everywhere(self):
        built = client_emails("ca")
        self.assertEqual(built["pack_summary"][0], "El teu pack d'entrenament")
        self.assertEqual(built["welcome"][0], "El teu perfil a ThundBalance")
        self.assertIn("Iniciar sessió", built["welcome"][1])
        self.assertIn("Per canviar la teva contrasenya", built["welcome"][1])
        self.assertIn("Afegir al meu Google Calendar", built["pack_summary"][1])
        self.assertIn("Acceptar la data nova", built["reschedule_counter"][1])
        for name, (subject, html, text) in built.items():
            for word in ("Hi Ana", "Your ", "Log in", "Inicia sesión"):
                self.assertNotIn(word, html, name)

    def test_plain_text_is_in_the_same_language(self):
        for lang in LANGUAGES:
            built = client_emails(lang)
            self.assertIn(texts.tr(lang, "pack_intro"), built["pack_summary"][2])
            self.assertIn(texts.tr(lang, "welcome_password_note"), built["welcome"][2])

    def test_a_missing_language_means_english_never_two_languages(self):
        for value in (None, "", "fr", "EN-gb"):
            subject, html, _ = client_trial_received("Ana", START, value)
            self.assertEqual(subject, "We received your request", repr(value))
            self.assertIn('<html lang="en"', html)
        self.assertEqual(build_pack_email(PACK)[0], "Your training pack")
        self.assertEqual(build_welcome_email("Ana", "a@b.co", "pw", None)[0], "Your ThundBalance profile")

    def test_the_team_emails_are_spanish_only(self):
        trial = {"full_name": "Ana", "email": "a@b.co", "phone": "1", "age": 30, "birth_date": "1995-03-02", "goal": "x",
                 "experience": "y", "session_date": "2026-10-12", "session_time": "09:00", "trainer": "Carles"}
        team = [
            staff_trial_requested(trial), staff_trial_confirmed(trial), staff_trial_declined(trial),
            build_pack_email(PACK, team_subject=True), build_staff_client_created("Ana", "a@b.co", PACK),
            staff_reschedule_requested(RESCHEDULE), staff_counter_answer(RESCHEDULE, True),
        ]
        for subject, html, text in team:
            self.assertIn('<html lang="es"', html)
            self.assertNotIn(" / ", subject)
            for word in ("Hi ", "Your ", "Log in", "Open the panel"):
                self.assertNotIn(word, html)
        self.assertEqual(build_pack_email(PACK, team_subject=True)[0], "Tu pack de entrenamiento — Ana")


class Dictionaries(unittest.TestCase):
    # texts only the team reads (Spanish only on purpose)
    STAFF_ONLY = {
        "lbl_birth", "lbl_date", "lbl_email", "lbl_experience", "lbl_goals", "lbl_name", "lbl_phone", "lbl_time", "years",
        "rs_lbl_client", "rs_lbl_note", "rs_lbl_original", "rs_lbl_proposed", "rs_lbl_requested", "rs_lbl_session",
    }

    def is_staff(self, key):
        return key.startswith(("staff_", "rs_staff_")) or key in self.STAFF_ONLY

    def test_no_client_text_is_missing_in_any_language(self):
        every_key = set(texts.TEXTS_ES) | set(texts.TEXTS_EN) | set(texts.TEXTS_CA)
        for key in sorted(k for k in every_key if not self.is_staff(k)):
            for lang in LANGUAGES:
                self.assertIn(key, texts.TEXTS[lang], f"text '{key}' is missing in {lang}")

    def test_every_text_a_client_email_asks_for_exists_in_the_three_languages(self):
        with Collector() as seen:
            for lang in LANGUAGES:
                client_emails(lang)
        self.assertTrue(seen.used)
        self.assertEqual(seen.missing, [])
        for key in seen.used:
            for lang in LANGUAGES:
                self.assertIn(key, texts.TEXTS[lang], f"{key} / {lang}")

    def test_placeholders_match_between_languages(self):
        names = lambda text: sorted(re.findall(r"\{(\w+)\}", text))
        for key, text in texts.TEXTS_EN.items():
            for lang in ("es", "ca"):
                if key in texts.TEXTS[lang]:
                    self.assertEqual(names(text), names(texts.TEXTS[lang][key]), f"{key} / {lang}")

    def test_identical_translations_only_warn(self):
        for key in sorted(texts.TEXTS_EN):
            if self.is_staff(key) or key in ("place_value",):     # the studio's address is the same in every language
                continue
            same = [lang for lang in ("es", "ca") if texts.TEXTS[lang].get(key) == texts.TEXTS_EN[key]]
            if same and len(texts.TEXTS_EN[key]) > 12:               # short words (a place, "Plan") may legitimately match
                warnings.warn(f"text '{key}' is identical in English and {', '.join(same)}")

    def test_a_missing_key_falls_back_on_english_and_warns_without_personal_data(self):
        saved = texts.TEXTS_CA.pop("pack_intro")
        records = []
        handler = logging.Handler()
        handler.emit = lambda record: records.append(record.getMessage())
        logging.getLogger("thundbalance.emails").addHandler(handler)
        try:
            subject, html, text = build_pack_email({**PACK, "client_name": "Secret Name"}, lang="ca")
        finally:
            texts.TEXTS_CA["pack_intro"] = saved
            logging.getLogger("thundbalance.emails").removeHandler(handler)
        self.assertIn(texts.TEXTS_EN["pack_intro"], html)
        warning = next(line for line in records if "pack_intro" in line)
        self.assertIn("lang=ca", warning)
        self.assertNotIn("Secret Name", " ".join(records))
        self.assertNotIn("ana@example.com", " ".join(records))


class Recorder:
    """send_email replaced by a recorder: nothing leaves the machine."""
    def __init__(self):
        self.sent = []

    def __call__(self, to, subject, html, text, reply_to=None, attachments=None, cc=None, extra=None, kind="", lang="", reference=None):
        self.sent.append({"to": to, "subject": subject, "html": html, "text": text, "kind": kind, "lang": lang})
        return EmailResult(True)

    def to(self, address):
        return [m for m in self.sent if address == m["to"] or (not isinstance(m["to"], str) and address in m["to"])]


class WhichLanguage(unittest.TestCase):
    """booking's language -> client's profile -> English, in every sender."""
    def setUp(self):
        self.recorder = Recorder()
        self.profile = {}                                             # email -> users.lang
        patches = [
            mock.patch("emails.transport.send_email", self.recorder),
            mock.patch("client_lang.stored_lang", lambda user_id=None, email=None: self.profile.get(email)),
            mock.patch.dict("os.environ", {"TRIAL_EMAIL_WEBHOOK_URL": "http://127.0.0.1:9/exec"}),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def settle(self):
        from emails.transport import _pool
        _pool.submit(lambda: None).result(timeout=30)
        _pool.submit(lambda: None).result(timeout=30)

    def mail(self, address):
        self.settle()
        return self.recorder.to(address)

    def test_profile_language_catalan_means_every_email_in_catalan(self):
        self.profile["ca@x.co"] = "ca"
        mailer.send_trial_received("ca@x.co", "Ana", "2026-10-12", "09:00")
        mailer.send_trial_approved("ca@x.co", "Ana", "2026-10-12", "09:00", "Carles", "TOKEN")
        mailer.send_trial_confirmed("ca@x.co", "Ana", "2026-10-12", "09:00", "Carles", 5)
        mailer.send_trial_cancelled("ca@x.co", "Ana", "2026-10-12", "09:00")
        ctx = {**RESCHEDULE, "client_email": "ca@x.co", "lang": None}
        for send in (notifications.client_approved, notifications.client_rejected, notifications.client_counter, notifications.session_moved):
            notifications.wait(send(dict(ctx)))
        sent = self.mail("ca@x.co")
        self.assertEqual(len(sent), 8)
        for message in sent:
            self.assertEqual(message["lang"], "ca", message["kind"])
            self.assertIn('<html lang="ca"', message["html"], message["kind"])
            self.assertNotIn(" / ", message["subject"])
            self.assertNotIn("Your ", message["html"])

    def test_no_language_anywhere_means_english(self):
        mailer.send_trial_received("none@x.co", "Ana", "2026-10-12", "09:00")
        notifications.wait(notifications.client_approved({**RESCHEDULE, "client_email": "none@x.co", "lang": None}))
        sent = self.mail("none@x.co")
        self.assertEqual({m["lang"] for m in sent}, {"en"})
        self.assertTrue(all('<html lang="en"' in m["html"] and " / " not in m["subject"] for m in sent))

    def test_the_booking_language_wins_over_the_profile(self):
        self.profile["mix@x.co"] = "ca"
        mailer.send_trial_received("mix@x.co", "Ana", "2026-10-12", "09:00", lang="es")
        notifications.wait(notifications.client_counter({**RESCHEDULE, "client_email": "mix@x.co", "lang": "es"}))
        sent = self.mail("mix@x.co")
        self.assertEqual({m["lang"] for m in sent}, {"es"})
        self.assertIn("Hemos recibido tu solicitud", sent[0]["subject"] + sent[1]["subject"])

    def test_the_admin_panel_language_is_never_used(self):
        # nothing in the senders reads a panel language: only booking / profile / English
        self.assertEqual(client_lang.resolve_client_lang(booking_lang=None, email="unknown@x.co"), "en")

    def test_the_team_copy_of_a_reschedule_stays_spanish(self):
        notifications.wait(notifications.staff_requested({**RESCHEDULE, "lang": "ca"}))
        sent = self.mail("pt@thundbalance.com")
        self.assertTrue(sent)
        self.assertEqual({m["lang"] for m in sent}, {"es"})


if __name__ == "__main__":
    unittest.main()

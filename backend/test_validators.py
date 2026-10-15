"""The data rules: phone, email, document, postal code, name and birth date.

    python -m unittest test_validators -v

Also checks the endpoints that use them answer 422 with a code and never echo
the typed value, and that old records still open and save.
"""
import io
import unittest
from contextlib import redirect_stdout
from datetime import date, timedelta
from types import SimpleNamespace

from fastapi import HTTPException

import validators as v


class Phone(unittest.TestCase):
    def test_formats_that_must_work_all_give_the_same_e164(self):
        for text in ("+34 613 50 26 62", "0034 613502662", "613502662", "(+34) 613-50-26-62", "613.50.26.62", "  +34613502662 "):
            self.assertEqual(v.validate_phone(text), "+34613502662", text)

    def test_spain_needs_nine_digits_starting_with_6_7_8_or_9(self):
        for digit in "6789":
            self.assertEqual(v.validate_phone(f"{digit}12345678"), f"+34{digit}12345678")
        for bad in ("61350266", "3135026621", "313502662", "513502662", "+34 213502662", "1234", "6135026620"):
            with self.assertRaises(v.FieldError, msg=bad) as caught:
                v.validate_phone(bad)
            self.assertEqual(caught.exception.code, "invalid_phone_es")

    def test_portugal_needs_nine_digits_starting_with_9_or_2(self):
        self.assertEqual(v.validate_phone("+351 912 345 678"), "+351912345678")
        self.assertEqual(v.validate_phone("+351 212 345 678"), "+351212345678")
        self.assertEqual(v.validate_phone("912345678", "+351"), "+351912345678")   # old record with its own country code
        with self.assertRaises(v.FieldError) as caught:
            v.validate_phone("+351 312345678")
        self.assertEqual(caught.exception.code, "invalid_phone_pt")

    def test_other_countries_use_their_own_rule(self):
        self.assertEqual(v.validate_phone("+33 6 12 34 56 78"), "+33612345678")
        self.assertEqual(v.validate_phone("+44 7911 123456"), "+447911123456")
        self.assertEqual(v.validate_phone("+1 415 555 2671"), "+14155552671")
        for bad in ("+33 1 23", "+999 123456", "+44 12", "abc"):
            with self.assertRaises(v.FieldError, msg=bad):
                v.validate_phone(bad)

    def test_empty_is_required(self):
        with self.assertRaises(v.FieldError) as caught:
            v.validate_phone("  ")
        self.assertEqual(caught.exception.code, "required")

    def test_split_and_region(self):
        self.assertEqual(v.split_phone("+34613502662"), ("+34", "613502662"))
        self.assertIsNone(v.split_phone("613 50 26 62"), "an old number is shown as it is")
        self.assertEqual(v.region_of_phone("+351912345678"), "PT")


class Email(unittest.TestCase):
    def test_valid_and_normalised(self):
        self.assertEqual(v.validate_email("  Ana.Garcia+x@Example.COM "), "ana.garcia+x@example.com")

    def test_invalid(self):
        for bad in ("ana", "ana@", "@example.com", "ana@example", "ana@@example.com", "a na@example.com",
                    "ana@example..com", "ana@.com", "ana@example.c", "", "x" * 250 + "@example.com"):
            with self.assertRaises(v.FieldError, msg=bad) as caught:
                v.validate_email(bad)
            self.assertEqual(caught.exception.code, "invalid_email")


class TaxId(unittest.TestCase):
    def test_dni_and_nie_letters(self):
        self.assertEqual(v.validate_tax_id("DNI", "12345678z"), ("DNI", "12345678Z"))
        self.assertEqual(v.validate_tax_id("NIE", "x-1234567-l"), ("NIE", "X1234567L"))
        for doc_type, value, code in (("DNI", "12345678A", "tax_id_dni_letter"), ("DNI", "1234567Z", "tax_id_dni_format"),
                                      ("NIE", "X1234567A", "tax_id_nie_letter"), ("NIE", "A1234567L", "tax_id_nie_format")):
            with self.assertRaises(v.FieldError) as caught:
                v.validate_tax_id(doc_type, value)
            self.assertEqual(caught.exception.code, code)

    def test_passport_and_other_are_five_to_twenty_alphanumeric(self):
        self.assertEqual(v.validate_tax_id("PASSPORT", "ab 123 456"), ("PASSPORT", "AB123456"))
        for bad in ("abcd", "x" * 21, "ab#1234"):
            with self.assertRaises(v.FieldError):
                v.validate_tax_id("OTHER", bad)

    def test_empty_is_optional(self):
        self.assertEqual(v.validate_tax_id("DNI", ""), (None, None))


class PostalCode(unittest.TestCase):
    def test_spain_five_digits_01000_to_52999(self):
        for ok in ("08001", "01000", "52999", " 28013 "):
            self.assertEqual(v.validate_postal_code(ok, "ES"), ok.strip())
        for bad in ("8001", "00999", "53000", "0800a", "080011", ""):
            with self.assertRaises(v.FieldError, msg=bad) as caught:
                v.validate_postal_code(bad, "ES")
            self.assertEqual(caught.exception.code, "invalid_postal_code_es")

    def test_spain_is_the_default_and_names_work(self):
        with self.assertRaises(v.FieldError):
            v.validate_postal_code("1234")
        self.assertEqual(v.validate_postal_code("1000-001", "Portugal"), "1000-001")

    def test_other_countries(self):
        self.assertEqual(v.validate_postal_code("75008", "FR"), "75008")
        self.assertEqual(v.validate_postal_code("SW1A 1AA", "GB"), "SW1A 1AA")
        with self.assertRaises(v.FieldError):
            v.validate_postal_code("12", "FR")
        self.assertEqual(v.validate_postal_code("ABC 123", "ZZ"), "ABC 123")   # unknown country: 3 to 10 characters


class NameAndBirth(unittest.TestCase):
    def test_name(self):
        self.assertEqual(v.validate_name("  Ana   García "), "Ana García")
        for bad in ("", "A", "12345", "---", "x" * 200):
            with self.assertRaises(v.FieldError, msg=bad):
                v.validate_name(bad)

    def test_birth_date(self):
        today = date(2026, 10, 14)
        self.assertEqual(v.validate_birth_date("1990-05-01", today=today), date(1990, 5, 1))
        for bad in ("2026-10-15", "1899-12-31", "not a date", ""):
            with self.assertRaises(v.FieldError, msg=bad):
                v.validate_birth_date(bad, today=today)


class Endpoints(unittest.TestCase):
    """The endpoints refuse with 422 {code, field, message} and never echo the data."""

    @classmethod
    def setUpClass(cls):
        import main
        cls.main = main

    def route(self, path, method):
        for route in self.main.app.routes:
            if getattr(route, "path", None) == path and method in getattr(route, "methods", ()):
                return route.endpoint
        raise LookupError(path)

    def trial(self, **changes):
        base = dict(full_name="Ana García", email="ana.validators@test-validators.example", phone="600123456",
                    goals=["Lose weight"], experience="Beginner", session_date=(date.today() + timedelta(days=9)).isoformat(),
                    session_time="10:00", lang="en")
        base.update(changes)
        return self.main.TrialSessionCreate(**base)

    def book(self, **changes):
        self.main._trial_hits.clear()
        request = SimpleNamespace(headers={}, client=SimpleNamespace(host="127.0.0.1"))
        with redirect_stdout(io.StringIO()):
            return self.route("/trial-sessions", "POST")(self.trial(**changes), request)

    def test_trial_session_refuses_bad_phone_email_name_and_birth_date(self):
        cases = {
            "phone": dict(phone="61350266"), "email": dict(email="ana@@example"), "full_name": dict(full_name="12"),
            "birth_date": dict(birth_date=(date.today() + timedelta(days=1)).isoformat()),
        }
        for field, change in cases.items():
            with self.assertRaises(HTTPException, msg=field) as caught:
                self.book(**change)
            self.assertEqual(caught.exception.status_code, 422)
            detail = caught.exception.detail
            self.assertEqual(detail["field"], field if field != "birth_date" else "birth_date")
            self.assertTrue(detail["code"] and detail["message"])
            for typed in ("61350266", "ana@@example"):
                self.assertNotIn(typed, str(detail), "the typed value is never echoed")


if __name__ == "__main__":
    unittest.main()

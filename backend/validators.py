"""The rules for the data people type: phone, email, identity document, postal
code, name and birth date. The backend is the one that decides; the site checks
the same rules first (src/utils/validators.js) so people see the answer before
sending.

Personal data never goes into a log or into an error: every function answers
with a short code and a fixed message, never with the text that was typed.

    FieldError(code, field)   -> http_error(error) is the 422 the endpoints return:
    {"code": "invalid_phone_es", "field": "phone", "message": "<es> / <en>"}
"""
import re
from datetime import date, datetime

import phonenumbers
from fastapi import HTTPException

import tax_id as tax_id_module

MESSAGES = {
    "required": "Campo obligatorio. / Required field.",
    "invalid_name": "Introduce un nombre válido (mínimo 2 caracteres, no solo números). / Enter a valid name (at least 2 characters, not only digits).",
    "invalid_email": "Introduce un email válido, por ejemplo nombre@dominio.com. / Enter a valid email, for example name@domain.com.",
    "invalid_phone": "Introduce un teléfono válido para el país elegido. / Enter a valid phone number for the chosen country.",
    "invalid_phone_es": "Introduce un teléfono español válido (9 dígitos que empiezan por 6, 7, 8 o 9). / Enter a valid Spanish phone number (9 digits starting with 6, 7, 8 or 9).",
    "invalid_phone_pt": "Introduce un teléfono portugués válido (9 dígitos que empiezan por 9 o 2). / Enter a valid Portuguese phone number (9 digits starting with 9 or 2).",
    "invalid_postal_code": "Introduce un código postal válido. / Enter a valid postal code.",
    "invalid_postal_code_es": "El código postal español tiene 5 dígitos (de 01000 a 52999). / A Spanish postal code has 5 digits (01000 to 52999).",
    "invalid_birth_date": "Introduce una fecha de nacimiento válida (no futura y posterior a 1900). / Enter a valid date of birth (not in the future, after 1900).",
}
# the document keeps the messages of tax_id.py
for _code, _message in tax_id_module.MESSAGES.items():
    MESSAGES[f"tax_id_{_code}"] = _message


class FieldError(ValueError):
    """.code is a key of MESSAGES, .field the form field it belongs to."""

    def __init__(self, code, field):
        super().__init__(code)
        self.code = code
        self.field = field

    @property
    def message(self):
        return MESSAGES.get(self.code, MESSAGES["required"])


def http_error(error):
    """The 422 for an endpoint. Carries the code, the field and a fixed message."""
    return HTTPException(
        status_code=422,
        detail={"code": error.code, "field": error.field, "message": error.message},
    )


def _text(value):
    return " ".join(str(value if value is not None else "").split())


# ----------------------------------------------------------------------- name
def validate_name(value, field="name", limit=120):
    text = _text(value)
    if len(text) < 2 or len(text) > limit or not any(char.isalpha() for char in text):
        raise FieldError("invalid_name", field)
    return text


# ---------------------------------------------------------------------- email
_EMAIL = re.compile(
    r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?"
    r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$"
)


def normalize_email(value):
    """Trimmed and lower case. Does not validate."""
    return str(value if value is not None else "").strip().lower()


def validate_email(value, field="email"):
    text = normalize_email(value)
    local, _, domain = text.partition("@")
    if (
        not text or len(text) > 254 or len(local) > 64 or " " in text or ".." in text
        or not _EMAIL.match(text) or not re.search(r"\.[a-z]{2,}$", domain)
    ):
        raise FieldError("invalid_email", field)
    return text


# ---------------------------------------------------------------------- phone
_SEPARATORS = re.compile(r"[\s().\-]")


def _digits(value):
    return re.sub(r"\D", "", str(value or ""))


def normalize_phone_text(value, country_code=None):
    """Text with the international prefix: "0034 613 50 26 62" -> "+34613502662".
    A number without one gets `country_code` (for example "+351", from the old
    separate field) or Spain's +34."""
    text = _SEPARATORS.sub("", str(value or ""))
    if text.startswith("00"):
        text = "+" + text[2:]
    if text and not text.startswith("+"):
        code = _digits(country_code) or "34"
        text = f"+{code}{text}"
    return text


def validate_phone(value, country_code=None, field="phone"):
    """E.164 ("+34613502662") or FieldError. Spain: 9 digits starting with
    6, 7, 8 or 9. Portugal: 9 digits starting with 9 or 2. Any other country:
    the rule of the country itself (libphonenumber)."""
    text = normalize_phone_text(value, country_code)
    if not text:
        raise FieldError("required", field)
    try:
        number = phonenumbers.parse(text, None)
    except phonenumbers.NumberParseException:
        raise FieldError("invalid_phone", field) from None
    national = str(number.national_number)
    if number.country_code == 34:
        if not re.fullmatch(r"[6-9]\d{8}", national):
            raise FieldError("invalid_phone_es", field)
    elif number.country_code == 351:
        if not re.fullmatch(r"[92]\d{8}", national):
            raise FieldError("invalid_phone_pt", field)
    elif not phonenumbers.is_valid_number(number):
        raise FieldError("invalid_phone", field)
    return phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.E164)


def region_of_phone(e164):
    """ISO country of a stored E.164 number ("ES" for +34...), or None."""
    parts = split_phone(e164)
    if not parts:
        return None
    try:
        return phonenumbers.region_code_for_country_code(int(parts[0][1:])) or None
    except ValueError:
        return None


def split_phone(e164):
    """("+34", "613502662") for a stored E.164 value, None for an old number
    that has no international prefix (shown as it is)."""
    text = str(e164 or "")
    if not text.startswith("+"):
        return None
    try:
        number = phonenumbers.parse(text, None)
    except phonenumbers.NumberParseException:
        return None
    return f"+{number.country_code}", str(number.national_number)


# ---------------------------------------------------------------- postal code
_COUNTRY_NAMES = {
    "spain": "ES", "españa": "ES", "espanha": "ES", "espanya": "ES",
    "portugal": "PT", "france": "FR", "francia": "FR", "frança": "FR", "andorra": "AD",
    "italy": "IT", "italia": "IT", "itália": "IT", "germany": "DE", "alemania": "DE", "alemanha": "DE",
    "united kingdom": "GB", "reino unido": "GB", "uk": "GB",
    "united states": "US", "estados unidos": "US", "usa": "US",
}
_POSTAL = {
    "PT": r"\d{4}-?\d{3}", "FR": r"\d{5}", "AD": r"AD\d{3}", "IT": r"\d{5}", "DE": r"\d{5}",
    "NL": r"\d{4} ?[A-Z]{2}", "BE": r"\d{4}", "IE": r"[A-Z0-9]{3} ?[A-Z0-9]{4}",
    "US": r"\d{5}(-\d{4})?", "CA": r"[A-Z]\d[A-Z] ?\d[A-Z]\d", "MX": r"\d{5}", "AR": r"([A-Z]\d{4}[A-Z]{3}|\d{4})",
    "CO": r"\d{6}", "BR": r"\d{5}-?\d{3}", "MA": r"\d{5}",
    "GB": r"[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}",
}


def country_code_of(value):
    """ISO alpha-2 from a code or a common name; "ES" when empty; None if unknown."""
    text = _text(value)
    if not text:
        return "ES"
    if len(text) == 2 and text.isalpha():
        return text.upper()
    return _COUNTRY_NAMES.get(text.lower())


def validate_postal_code(value, country=None, field="postal_code"):
    text = _text(value).upper()
    code = country_code_of(country)
    if code == "ES":
        if not re.fullmatch(r"\d{5}", text) or not 1000 <= int(text) <= 52999:
            raise FieldError("invalid_postal_code_es", field)
        return text
    pattern = _POSTAL.get(code)
    if pattern and not re.fullmatch(pattern, text):
        raise FieldError("invalid_postal_code", field)
    if not pattern and not re.fullmatch(r"[A-Z0-9][A-Z0-9 -]{1,8}[A-Z0-9]", text):   # 3 to 10 characters
        raise FieldError("invalid_postal_code", field)
    return text


# ----------------------------------------------------------------- birth date
def validate_birth_date(value, field="birth_date", today=None):
    today = today or date.today()
    if isinstance(value, datetime):
        value = value.date()
    if not isinstance(value, date):
        try:
            value = datetime.strptime(str(value or "")[:10], "%Y-%m-%d").date()
        except ValueError:
            raise FieldError("invalid_birth_date", field) from None
    if value > today or value < date(1900, 1, 1):
        raise FieldError("invalid_birth_date", field)
    return value


# ---------------------------------------------------------------- tax id
def validate_tax_id(doc_type, value, field="tax_id"):
    """("DNI", "12345678Z"), or (None, None) when empty (optional). FieldError otherwise."""
    try:
        return tax_id_module.clean(doc_type, value)
    except tax_id_module.TaxIdError as error:
        raise FieldError(f"tax_id_{error.code}", field) from None

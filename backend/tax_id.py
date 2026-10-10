"""Identity document of a client (DNI, NIE, passport, other): normalise,
validate and mask.

Fiscal data is sensitive personal data. Nothing in this module logs a value or
puts one in an error: validation answers with a short code (and a fixed
message), never with the text that was typed.
"""
import re

TYPES = ("DNI", "NIE", "PASSPORT", "OTHER")
DEFAULT_TYPE = "DNI"

_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE"          # DNI / NIE control letter, number % 23
_DNI = re.compile(r"^\d{8}[A-Z]$")
_NIE = re.compile(r"^[XYZ]\d{7}[A-Z]$")
_NIE_PREFIX = {"X": "0", "Y": "1", "Z": "2"}

# code -> fixed bilingual message (the site's own pages map the same codes to EN/ES/CA)
MESSAGES = {
    "type": "Tipo de documento no válido. / Invalid document type.",
    "dni_format": "El DNI debe tener 8 números y una letra. / The DNI must have 8 digits and a letter.",
    "dni_letter": "La letra del DNI no es correcta. / The DNI letter is not correct.",
    "nie_format": "El NIE debe empezar por X, Y o Z, seguido de 7 números y una letra. / The NIE must start with X, Y or Z, followed by 7 digits and a letter.",
    "nie_letter": "La letra del NIE no es correcta. / The NIE letter is not correct.",
    "other_format": "El documento debe tener entre 4 y 20 caracteres (letras y números). / The document must be 4 to 20 characters (letters and digits).",
}


class TaxIdError(ValueError):
    """Invalid document. .code is one of MESSAGES; the typed value is never kept."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code

    @property
    def message(self):
        return MESSAGES[self.code]


def normalize(value):
    """Upper case, without spaces, dots or hyphens."""
    return re.sub(r"[\s.\-]", "", str(value or "")).upper()


def _control_letter(digits):
    return _LETTERS[int(digits) % 23]


def validate(doc_type, value):
    """(type, normalised value) or raises TaxIdError. An empty value is not
    validated here: callers treat "no document" as optional."""
    doc_type = str(doc_type or DEFAULT_TYPE).strip().upper()
    if doc_type not in TYPES:
        raise TaxIdError("type")
    text = normalize(value)

    if doc_type == "DNI":
        if not _DNI.match(text):
            raise TaxIdError("dni_format")
        if _control_letter(text[:8]) != text[8]:
            raise TaxIdError("dni_letter")
    elif doc_type == "NIE":
        if not _NIE.match(text):
            raise TaxIdError("nie_format")
        if _control_letter(_NIE_PREFIX[text[0]] + text[1:8]) != text[8]:
            raise TaxIdError("nie_letter")
    else:  # passport / other: reasonable length and characters, no checksum
        if not 4 <= len(text) <= 20 or not text.isalnum():
            raise TaxIdError("other_format")
    return doc_type, text


def check_type(doc_type):
    """Normalised type code, or TaxIdError("type") for an unknown one."""
    code = str(doc_type or DEFAULT_TYPE).strip().upper()
    if code not in TYPES:
        raise TaxIdError("type")
    return code


def clean(doc_type, value):
    """For endpoints: ("DNI", "12345678Z") for a valid value, (None, None) for an
    empty one. Raises TaxIdError otherwise."""
    if not normalize(value):
        return None, None
    return validate(doc_type, value)


def mask(value):
    """••••123A: the last four characters only (never the whole document)."""
    text = str(value or "")
    if not text:
        return None
    return "••••" + (text[-4:] if len(text) > 4 else "")

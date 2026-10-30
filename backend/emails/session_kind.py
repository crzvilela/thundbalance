"""The rows of an email that say WHAT KIND of session it is: type (Individual | Dual), the second person of a dual
session and the price. One place, so a pack email, a trial email and the team's copies all say it the same way.

    kind_rows("es", {"session_type": "dual", "second_person_name": "Ana", "price_per_session": 75, "total_price": 900},
              total=True)
    -> [("Tipo", "Dual"), ("Segunda persona", "Ana"), ("Precio por sesión", "€75"), ("Total del pack", "€900")]

Nothing is ever sent to the second person: only their name is shown (and, in the team's copy, their email).
"""
import pricing

from .texts import tr


def kind_rows(lang, data, staff=False, total=False):
    """Rows (label, value) from a dict with session_type, second_person_name, second_person_email, price_per_session and
    total_price. Empty when `data` is empty (a caller that has no details); values that are missing are left out, so
    a pack from before prices only shows its type. staff: the team's copy, which also gets the second person's email."""
    if not data:
        return []
    dual = str(data.get("session_type") or "").lower() == "dual"
    rows = [(tr(lang, "lbl_type"), tr(lang, "type_dual" if dual else "type_individual"))]
    if dual and data.get("second_person_name"):
        rows.append((tr(lang, "lbl_second_person"), data["second_person_name"]))
    if dual and staff and data.get("second_person_email"):
        rows.append((tr(lang, "lbl_second_email"), data["second_person_email"]))
    if data.get("price_per_session") is not None:
        rows.append((tr(lang, "lbl_price_session"), pricing.money(data["price_per_session"])))
    if total and data.get("total_price") is not None:
        rows.append((tr(lang, "lbl_price_total"), pricing.money(data["total_price"])))
    return rows

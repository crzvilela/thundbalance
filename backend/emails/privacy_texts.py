"""Texts of the emails about a request to delete an account (merged into emails/texts.py).

To the studio: Spanish only. To the client: ONE language per email (en | es | ca)."""

ES = {
    "staff_pv_subject": "Solicitud de eliminación de cuenta · {name}",
    "staff_pv_title": "Solicitud de eliminación de cuenta",
    "staff_pv_body": "Un cliente ha pedido que se elimine su cuenta y todos sus datos. No se ha borrado nada: revisa la solicitud en el panel (Overview, Solicitudes de eliminación) y apruébala o recházala.",
    "staff_pv_lbl_client": "Cliente", "staff_pv_lbl_date": "Fecha",
}
EN = {
    "pv_client_subject": "We received your request to delete your account",
    "pv_client_title": "Request received",
    "pv_client_body": "We have received your request to delete your ThundBalance account and your data. We will review it and confirm it shortly. Nothing has been deleted yet, and you can keep using your account until then.",
    "pv_client_note": "If you did not make this request, write to us right away.",
}
CA = {
    "pv_client_subject": "Hem rebut la teva sol·licitud d'eliminar el compte",
    "pv_client_title": "Sol·licitud rebuda",
    "pv_client_body": "Hem rebut la teva sol·licitud d'eliminar el teu compte de ThundBalance i les teves dades. La revisarem i te la confirmarem aviat. De moment no s'ha esborrat res, i pots continuar fent servir el teu compte.",
    "pv_client_note": "Si no has fet aquesta sol·licitud, escriu-nos de seguida.",
}
# the client texts in Spanish live in ES too (one dictionary per language)
ES.update({
    "pv_client_subject": "Hemos recibido tu solicitud de eliminar la cuenta",
    "pv_client_title": "Solicitud recibida",
    "pv_client_body": "Hemos recibido tu solicitud de eliminar tu cuenta de ThundBalance y tus datos. La revisaremos y te la confirmaremos en breve. Por ahora no se ha borrado nada y puedes seguir usando tu cuenta.",
    "pv_client_note": "Si no has hecho esta solicitud, escríbenos enseguida.",
})

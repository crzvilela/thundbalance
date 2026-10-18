"""Texts of the reschedule-request emails (merged into emails/texts.py).

To the studio: Spanish only. To the client: ONE language per email (en | es | ca)."""

ES = {
    # ---- to the studio (info@): Spanish only
    "rs_staff_req_subject": "Solicitud de cambio de fecha · {name} ({number})",
    "rs_staff_req_title": "Solicitud de cambio de fecha",
    "rs_staff_req_manage": "Revisa la solicitud en el panel: puedes aprobarla, rechazarla o proponer otra fecha.",
    "rs_staff_button": "Abrir en el panel",
    "rs_lbl_client": "Cliente", "rs_lbl_session": "Sesión", "rs_lbl_original": "Fecha actual",
    "rs_lbl_requested": "Fecha solicitada", "rs_lbl_note": "Motivo del cliente",
    "rs_staff_acc_subject": "El cliente ha aceptado la nueva fecha · {name} ({number})",
    "rs_staff_acc_title": "Nueva fecha aceptada",
    "rs_staff_acc_note": "La sesión se ha movido a la fecha propuesta.",
    "rs_staff_dec_subject": "El cliente ha rechazado la nueva fecha · {name} ({number})",
    "rs_staff_dec_title": "Nueva fecha rechazada",
    "rs_staff_dec_note": "La sesión se mantiene en la fecha original.",
    "rs_lbl_proposed": "Fecha propuesta",
    # ---- to the client
    "rs_ok_subject": "Tu sesión ha cambiado de fecha", "rs_ok_title": "Cambio aprobado",
    "rs_ok_body": "Hemos aprobado tu solicitud: tu sesión se ha movido a la nueva fecha y hora.",
    "rs_lbl_new": "Nueva fecha", "rs_lbl_old": "Fecha anterior",
    "rs_no_subject": "Sobre tu solicitud de cambio de fecha", "rs_no_title": "No hemos podido cambiar tu sesión",
    "rs_no_body": "Tu sesión se mantiene en su fecha original. Si lo necesitas, contacta con el estudio.",
    "rs_lbl_reason": "Motivo",
    "rs_counter_subject": "Te proponemos otra fecha para tu sesión", "rs_counter_title": "Propuesta de nueva fecha",
    "rs_counter_body": "No podemos mover tu sesión a la fecha que pediste, pero te proponemos esta otra. Tu sesión no cambia hasta que aceptes.",
    "rs_counter_accept": "Aceptar la nueva fecha", "rs_counter_decline": "Rechazar y mantener la fecha original",
    "rs_counter_note": "Esta propuesta caduca 8 horas antes de la sesión original.",
    "rs_moved_subject": "El estudio ha movido tu sesión", "rs_moved_title": "Tu sesión ha cambiado de fecha",
    "rs_moved_body": "El estudio ha cambiado la fecha de tu sesión. Estos son los nuevos datos.",
}

EN = {
    "rs_ok_subject": "Your session has a new date", "rs_ok_title": "Change approved",
    "rs_ok_body": "We approved your request: your session has been moved to the new date and time.",
    "rs_lbl_new": "New date", "rs_lbl_old": "Previous date",
    "rs_no_subject": "About your change request", "rs_no_title": "We could not change your session",
    "rs_no_body": "Your session stays on its original date. If you need anything, contact the studio.",
    "rs_lbl_reason": "Reason",
    "rs_counter_subject": "We suggest another date for your session", "rs_counter_title": "Proposal for a new date",
    "rs_counter_body": "We cannot move your session to the date you asked for, but we suggest this one instead. Your session does not change until you accept.",
    "rs_counter_accept": "Accept the new date", "rs_counter_decline": "Decline and keep the original date",
    "rs_counter_note": "This proposal expires 8 hours before the original session.",
    "rs_moved_subject": "The studio moved your session", "rs_moved_title": "Your session has a new date",
    "rs_moved_body": "The studio changed the date of your session. These are the new details.",
}

CA = {
    "rs_ok_subject": "La teva sessió té una data nova", "rs_ok_title": "Canvi aprovat",
    "rs_ok_body": "Hem aprovat la teva sol·licitud: la teva sessió s'ha mogut a la nova data i hora.",
    "rs_lbl_new": "Data nova", "rs_lbl_old": "Data anterior",
    "rs_no_subject": "Sobre la teva sol·licitud de canvi", "rs_no_title": "No hem pogut canviar la teva sessió",
    "rs_no_body": "La teva sessió es manté en la data original. Si ho necessites, contacta amb l'estudi.",
    "rs_lbl_reason": "Motiu",
    "rs_counter_subject": "Et proposem una altra data per a la teva sessió", "rs_counter_title": "Proposta de data nova",
    "rs_counter_body": "No podem moure la teva sessió a la data que vas demanar, però et proposem aquesta altra. La teva sessió no canvia fins que acceptis.",
    "rs_counter_accept": "Acceptar la data nova", "rs_counter_decline": "Rebutjar i mantenir la data original",
    "rs_counter_note": "Aquesta proposta caduca 8 hores abans de la sessió original.",
    "rs_moved_subject": "L'estudi ha mogut la teva sessió", "rs_moved_title": "La teva sessió té una data nova",
    "rs_moved_body": "L'estudi ha canviat la data de la teva sessió. Aquestes són les dades noves.",
}

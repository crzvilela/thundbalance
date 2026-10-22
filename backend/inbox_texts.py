"""Texts of the client's inbox for the AUTOMATIC messages, in English, Spanish and Catalan.

The message row stores only a type and its params; the words are chosen when it is READ, in the
language the client's page asks for. Placeholders: {name} comes from params; every param whose name
ends in _at ("2026-10-21 18:00") is written as a date in the reader's language; {note_text} is the
studio's note with its introduction (empty when there is no note).

Everything here is plain text: the pages draw it escaped.
"""

TITLES_BODIES = {
    "en": {
        "trial_approved": ("Your trial session has been approved",
                           "Your trial session on {session_at} is approved. Please confirm that you will come, or tell us if you can't make it."),
        "trial_confirmed": ("Your trial session is confirmed", "We expect you on {session_at}. See you soon!"),
        "trial_declined": ("We have noted that you can't come",
                           "We have recorded that you will not attend your trial session on {session_at}. If you change your mind, you can request a new one."),
        "pack_approved": ("Your pack has been approved",
                          "Your {plan_name} pack is ready. Check your sessions in My sessions."),
        "reschedule_approved": ("Your date change was approved", "Your session {number} moved from {old_at} to {new_at}."),
        "reschedule_rejected": ("Your date change was not possible", "Your session {number} stays on {old_at}.{note_text}"),
        "reschedule_counter": ("New date proposed",
                               "The studio proposes to move your session {number} from {old_at} to {new_at}. Do you accept?{deadline_text}{note_text}"),
        "session_cancelled": ("Session cancelled", "The studio has cancelled your session {number} on {old_at}."),
        "session_rescheduled": ("Session moved", "The studio moved your session {number} from {old_at} to {new_at}."),
    },
    "es": {
        "trial_approved": ("Tu sesión de prueba ha sido aprobada",
                           "Tu sesión de prueba del {session_at} está aprobada. Confirma que vendrás o avísanos si no puedes asistir."),
        "trial_confirmed": ("Tu sesión de prueba está confirmada", "Te esperamos el {session_at}. ¡Hasta pronto!"),
        "trial_declined": ("Hemos anotado que no vas a venir",
                           "Hemos registrado que no asistirás a tu sesión de prueba del {session_at}. Si cambias de idea, puedes solicitar otra."),
        "pack_approved": ("Tu pack ha sido aprobado",
                          "Tu pack {plan_name} está listo. Consulta tus sesiones en Mis sesiones."),
        "reschedule_approved": ("Tu cambio de fecha ha sido aprobado", "Tu sesión {number} pasa del {old_at} al {new_at}."),
        "reschedule_rejected": ("Tu cambio de fecha no ha sido posible", "Tu sesión {number} se mantiene el {old_at}.{note_text}"),
        "reschedule_counter": ("Propuesta de nueva fecha",
                               "El estudio propone mover tu sesión {number} del {old_at} al {new_at}. ¿Aceptas?{deadline_text}{note_text}"),
        "session_cancelled": ("Sesión cancelada", "El estudio ha cancelado tu sesión {number} del {old_at}."),
        "session_rescheduled": ("Sesión cambiada de fecha", "El estudio ha movido tu sesión {number} del {old_at} al {new_at}."),
    },
    "ca": {
        "trial_approved": ("La teva sessió de prova ha estat aprovada",
                           "La teva sessió de prova del {session_at} està aprovada. Confirma que vindràs o avisa'ns si no hi pots assistir."),
        "trial_confirmed": ("La teva sessió de prova està confirmada", "T'esperem el {session_at}. Fins aviat!"),
        "trial_declined": ("Hem anotat que no vindràs",
                           "Hem registrat que no assistiràs a la teva sessió de prova del {session_at}. Si canvies d'idea, en pots sol·licitar una altra."),
        "pack_approved": ("El teu pack ha estat aprovat",
                          "El teu pack {plan_name} és a punt. Consulta les teves sessions a Les meves sessions."),
        "reschedule_approved": ("El teu canvi de data ha estat aprovat", "La teva sessió {number} passa del {old_at} al {new_at}."),
        "reschedule_rejected": ("El teu canvi de data no ha estat possible", "La teva sessió {number} es manté el {old_at}.{note_text}"),
        "reschedule_counter": ("Proposta de nova data",
                               "L'estudi proposa moure la teva sessió {number} del {old_at} al {new_at}. Ho acceptes?{deadline_text}{note_text}"),
        "session_cancelled": ("Sessió cancel·lada", "L'estudi ha cancel·lat la teva sessió {number} del {old_at}."),
        "session_rescheduled": ("Sessió canviada de data", "L'estudi ha mogut la teva sessió {number} del {old_at} al {new_at}."),
    },
}

# the time the client has to answer a proposal (the studio's notice rule; written when the message is read)
DEADLINE_INTRO = {"en": " Please answer before {when}.", "es": " Responde antes del {when}.", "ca": " Respon abans del {when}."}

NOTE_INTRO = {"en": " Note from the studio: “{note}”", "es": " Nota del estudio: «{note}»", "ca": " Nota de l'estudi: «{note}»"}

# the buttons of the automatic messages
ACTION_LABELS = {
    "en": {"trial_confirm": "Confirm", "trial_decline": "I can't come", "reschedule_accept": "Accept",
           "reschedule_reject": "Decline", "view_sessions": "View sessions"},
    "es": {"trial_confirm": "Confirmar", "trial_decline": "No puedo asistir", "reschedule_accept": "Aceptar",
           "reschedule_reject": "Rechazar", "view_sessions": "Ver sesiones"},
    "ca": {"trial_confirm": "Confirma", "trial_decline": "No hi puc assistir", "reschedule_accept": "Accepta",
           "reschedule_reject": "Rebutja", "view_sessions": "Veure sessions"},
}

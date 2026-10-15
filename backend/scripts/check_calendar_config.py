"""Comprueba que el calendario configurado funciona de verdad:

    python scripts/check_calendar_config.py

1. muestra el ID del calendario enmascarado (solo los 6 últimos caracteres);
2. crea un evento de prueba en ese calendario;
3. lo lee de vuelta;
4. lo borra;
5. imprime OK.

Usa GOOGLE_CALENDAR_ID (la MISMA variable que usa el servidor) y las
credenciales de GOOGLE_CREDENTIALS_JSON o backend/credentials.json.
No toca ningún otro evento: el de prueba lleva una marca propia y se borra
siempre, incluso si la lectura falla. Código de salida 0 = OK, 1 = fallo.
"""
import os
import sys
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import event_format  # noqa: E402
import google_calendar as gc  # noqa: E402

CAUSES = {
    404: "404 = ID del calendario incorrecto, o el calendario NO está compartido con la cuenta de servicio.",
    403: (
        '403 = falta el permiso "Hacer cambios en eventos". La cuenta de servicio tiene que estar en '
        "Configuración del calendario > Compartir con personas concretas, con el email client_email de "
        "credentials.json y ese permiso."
    ),
    401: "401 = las credenciales de la cuenta de servicio fueron rechazadas (¿clave revocada o JSON incompleto?).",
}


def fail(message):
    print(f"FALLO: {message}")
    sys.exit(1)


def main():
    try:
        calendar_id = gc.get_calendar_id()
    except gc.CalendarNotConfigured as error:
        fail(f"calendario NO configurado: {error}.")
    print(f"Calendario (ID enmascarado): {gc.mask_calendar_id(calendar_id)}")

    try:
        service = gc.get_calendar_service()
    except Exception as error:  # noqa: BLE001 - no credentials / invalid JSON
        fail(f"no se pudieron cargar las credenciales ({type(error).__name__}): {str(error)[:200]}")

    day = (date.today() + timedelta(days=1)).isoformat()
    start, end = event_format.event_times(day, "03:00")
    body = {
        "summary": "ThundBalance - prueba de configuración (se borra sola)",
        "start": start,
        "end": end,
        "extendedProperties": {"private": {event_format.APP_PROPERTY: event_format.APP_VALUE, "kind": "config-check"}},
    }

    event_id = None
    try:
        created = service.events().insert(calendarId=calendar_id, body=body).execute()
        event_id = created["id"]
        print("1/3 Evento de prueba creado.")

        read_back = service.events().get(calendarId=calendar_id, eventId=event_id).execute()
        if read_back.get("summary") != body["summary"]:
            raise RuntimeError("el evento leído de vuelta no coincide con el creado")
        print("2/3 Evento leído de vuelta.")
    except Exception as error:  # noqa: BLE001
        status = gc.http_status(error)
        cause = CAUSES.get(int(status)) if status else None
        print(f"FALLO: {gc.describe_error(error)}")
        print(cause or f"Error inesperado ({type(error).__name__}).")
        cleanup(service, calendar_id, event_id)
        sys.exit(1)

    if not cleanup(service, calendar_id, event_id):
        fail("el evento de prueba se creó pero NO se pudo borrar; bórralo a mano (título: «prueba de configuración»).")
    print("3/3 Evento de prueba borrado.")
    print("OK")


def cleanup(service, calendar_id, event_id):
    if not event_id:
        return True
    try:
        service.events().delete(calendarId=calendar_id, eventId=event_id).execute()
        return True
    except Exception as error:  # noqa: BLE001
        return gc.http_status(error) in (404, 410)


if __name__ == "__main__":
    main()

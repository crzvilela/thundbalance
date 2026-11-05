# Clientes como invitados en Google Calendar

El cliente recibe las sesiones en SU Google Calendar como invitado. El calendario principal sigue siendo el de
pt@thundbalance.com (ID en `GOOGLE_CALENDAR_ID`), zona Europe/Madrid. Los botones y feeds del cliente siguen
desactivados (`CLIENT_CALENDAR_ENABLED=false`): esto no los reactiva.

## Delegación de dominio (lo hace el jefe, fuera del código)

1. Google Cloud: en la cuenta de servicio, copiar el **Client ID** (numérico).
2. Admin Console de Workspace → Seguridad → Acceso y control de datos → Controles de API → Delegación de todo el
   dominio → Añadir: Client ID + ámbito `https://www.googleapis.com/auth/calendar`.
3. Sin reiniciar: el servidor vuelve a comprobar la delegación cada 5 minutos.

## Variables de entorno

| Variable | Defecto | Qué hace |
|---|---|---|
| `GOOGLE_IMPERSONATE_EMAIL` | `pt@thundbalance.com` | Usuario como el que actúa la cuenta de servicio. |
| `SEND_CALENDAR_INVITE_EMAILS` | `none` | `none` → `sendUpdates=none` (Google no envía correos); `all` → envía invitación/actualización. |

## Comportamiento

- Invitados = email del cliente + los correos extra de la caja de destinatarios (nunca pt@ ni el calendario).
  Se guardan con el pack / la trial (`calendar_share`, `calendar_extra`) y se reutilizan al reprogramar,
  cancelar (se borra el evento), restaurar (se recrea con los mismos invitados) y confirmar la trial.
- Casilla «Compartir en Google Calendar con el cliente»: activada por defecto al aprobar una trial, aprobar una
  solicitud o crear/renovar un pack. Desactivada = sin invitados.
- Invitados sin poderes: `guestsCanSeeOtherGuests`, `guestsCanModify` y `guestsCanInviteOthers` = false.
- Sin delegación (`unauthorized_client`): los eventos se crean SIN invitados; solo se registra el tipo de error y el
  admin ve «Delegación de dominio no configurada: no se pudo invitar al cliente».
- Packs grandes: tolerancia a fallos por sesión (se sigue y se anota la sesión fallida), reintentos con backoff
  (429/5xx) y una pausa corta tras cada evento con invitados.
- Ningún dato de otros clientes va en la descripción del evento.

## Probar con un Gmail real

1. Con la delegación activa, aprobar una trial con un Gmail de prueba (casilla marcada): el evento
   «Trial (Pendiente) - Nombre» aparece en ese calendario; al confirmar el cliente pasa a «Trial - Nombre».
2. Crear un pack de varias sesiones: aparecen todas, sin decenas de correos (`SEND_CALENDAR_INVITE_EMAILS=none`).
3. Reprogramar, cancelar y restaurar una sesión: el calendario del Gmail lo refleja.
4. Con el Gmail: no se ven otros invitados y no se puede editar el evento.
5. Sin delegación: todo funciona sin invitados y el admin ve el aviso.

Tests: `cd backend && python -m unittest test_calendar_guests test_google_sync -v`.

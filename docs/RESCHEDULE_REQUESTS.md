# Solicitudes de cambio de fecha

El cliente ya no mueve una sesión por sí mismo: hace **una solicitud por sesión** y el estudio la aprueba, la rechaza o propone otra fecha.

Código: `backend/reschedule_requests.py` (reglas y endpoints), `backend/reschedule_notifications.py` y `backend/emails/reschedule_*.py` (emails), `src/pages/MySessions.jsx` + `src/components/sessions/` (página del cliente), `src/pages/RescheduleResponse.jsx` (página pública de la contrapropuesta).

## Reglas (fáciles de cambiar: son constantes del código)
- `MAX_RESCHEDULE_REQUESTS_PER_SESSION = 1`: cuántas solicitudes puede hacer un cliente, EN TOTAL, para una sesión. Se cuenta por código. No hay índice único total: cambiar el número no necesita migración. La página lo lee de `GET /me/reschedule-requests` (`max_per_session`).
- `features.RESCHEDULE_MIN_HOURS_BEFORE` (24 por defecto; variable de entorno `RESCHEDULE_MIN_HOURS_BEFORE`): solo se puede pedir hasta esas horas antes de la sesión (hora de Europe/Madrid, en horas REALES: el cambio de hora no la desplaza). La contrapropuesta caduca también esas horas antes (se guarda `counter_late` si el estudio la envió dentro del plazo y lo confirmó: entonces el cliente puede responder hasta que empiece la sesión). Es el ÚNICO sitio del número: la web lo lee de `GET /features` (`reschedule_min_hours_before`) y `GET /me/reschedule-requests` (`notice_hours`), y los textos usan `{hours}`; las contrapropuestas muestran el plazo (`counter_deadline`) en la web, el email y la bandeja.
- `NOTE_MAX = 300`: longitud máxima de las notas.
- Mientras haya una solicitud abierta (`pending` o `counter_proposed`) no puede haber otra: índice único parcial por `session_id`.
- Rechazada, caducada o con contrapropuesta rechazada, la solicitud sigue contando para el límite. No hay "retirar solicitud".
- El estudio puede mover una sesión directamente (`POST /admin/sessions/{id}/reschedule`): no cuenta para el límite del cliente y cierra la solicitud abierta (`approved` si movió a la fecha pedida o propuesta, `expired` si no).

## Estados
`pending` → `approved` | `rejected` | `counter_proposed` → `accepted` | `declined`; y `expired` (el pedido caduca cuando empieza la sesión; la contrapropuesta, el plazo antes de la sesión). La caducidad se aplica al listar y al decidir, sin procesos en segundo plano. Los estados finales no cambian y repetir una decisión no repite emails.

## Endpoints
- Cliente (token de Firebase; solo sus sesiones): `POST /me/sessions/{id}/reschedule-request`, `GET /me/reschedule-requests`, `GET /me/reschedule-requests/{id}`, `POST /me/reschedule-requests/{id}/accept|decline`.
- Públicos por token (solo responder a la contrapropuesta; abrir el enlace no decide nada): `GET /reschedule-response/{token}`, `POST .../accept|decline`.
- Admin (token de Firebase + rol de admin): `GET /admin/reschedule-requests?status=&trainer_id=&email=&limit=&offset=`, `GET /admin/reschedule-requests/count`, `POST /admin/reschedule-requests/{id}/approve|reject|counter|resend-email`, `POST /admin/sessions/{id}/reschedule`.
- `PUT /sessions/{id}` ya no reagenda para clientes (403 `use_reschedule_request`).

## The panel: Schedule (`/admin/schedule`)

The studio manages the requests in the panel's **Schedule** page (`src/admin/pages/Schedule.jsx`,
`ScheduleCard.jsx`, `ScheduleDialogs.jsx`, helpers in `scheduleRequests.js`).

- **Menu badge**: `GET /admin/reschedule-requests/count` -> `{pending, counter_proposed, open}`; the badge shows
  `open`. It reloads when the page opens and after every action.
- **Tabs** (counts come from `counts` in the list response, for the same email/trainer filters):
  Pendientes = `pending`; Contrapropuestas = `counter_proposed`; Aprobados = `approved` + `accepted`;
  Rechazados = `rejected` + `declined`; Caducados = `expired`; Todos.
- **List**: `GET /admin/reschedule-requests?status=a,b&email=&trainer_ids=1,2&limit=&offset=&request_id=`.
  Open requests first, the closest session first; the closed ones after, the latest decision first.
  Each open request has `conflict` (text) when the requested/proposed hour is no longer free: the card warns,
  the decision is still taken by the server (approve answers 409 `slot_unavailable`, the request stays pending).
  Each item also has `color`, `session_date/time`, `decided_by`, `sync_status/sync_error`.
- **Actions**: approve (confirmation), decline (optional note, 300 characters), propose another hour (date + the
  trainer's free hours from `/trainer/{id}/available-times/{date}` + optional note). A request somebody else
  already decided answers 409 `closed`: the page says so and refreshes. If the Google update failed, the card
  shows the warning with "Sincronizar con Google" (`POST /admin/sessions/{id}/sync-calendar`); if an email
  failed, the card shows "Reenviar email" (`POST /admin/reschedule-requests/{id}/resend-email`).
- **URL**: `?tab=&q=&trainers=1,3&page=&request=12`. The studio's email links to `/admin/schedule?request=<id>`:
  that opens the request's tab and highlights its card. The calendar's session detail shows "Cambio pendiente de
  aprobación" with a link to it (`changeRequestId` / `changeRequestStatus` in the event's `extendedProps`).

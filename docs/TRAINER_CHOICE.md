# Elegir entrenador (trial, pack, cambio de fecha)

Los tres pedidos del cliente permiten elegir entrenador. Las reglas de disponibilidad NO se repiten: todo sale de
`backend/availability.py` (`slot_problem`: entrenador activo, horario de trabajo, sesión reservada, trial aprobada, confirmada o
**pendiente con entrenador**). `backend/trainer_choice.py` solo le pregunta a esa función por cada entrenador activo de la tabla `trainers`.

## Endpoint público

`GET /available-trainers?date=YYYY-MM-DD&time=HH:MM[&exclude_session_id=N]` → `[{"id", "name"}]` (solo id y nombre; 60 peticiones/minuto por conexión, 429 después).
`GET /available-trainers?weekday=Monday&time=HH:MM` → los que trabajan ese día y hora (pack semanal: solo horario, no choques de un día).

## Qué hace cada flujo

| Flujo | Campo | Qué guarda | Si el entrenador deja de estar libre |
|---|---|---|---|
| Sesión de prueba (`POST /trial-sessions`) | `trainer_id` opcional | `trial_sessions.trainer_id` (mantiene la hora ocupada mientras está pendiente) | 409 `trainer_unavailable` + `alternatives`; no se guarda nada |
| Pack (`POST /client-requests`) | `trainer_id` opcional | `client_requests.trainer_id` | 409 si no trabaja a esa hora en **cada** día elegido |
| Cambio de fecha (`POST /me/sessions/{id}/reschedule-request`) | `trainer_id` opcional | `reschedule_requests.requested_trainer_id` | 409 `trainer_unavailable` + `alternatives`; al aprobar, la sesión pasa al nuevo entrenador (y su evento de Google) |

El admin ve el entrenador pedido en la solicitud, en la sesión de prueba pendiente y en la tarjeta del cambio de fecha; el formulario de
aprobación lo trae ya elegido y el que se aprueba queda guardado como entrenador final.

## Página

`src/components/forms/TrainerChoice.jsx`: lista opcional "Sin preferencia + entrenadores"; si el elegido no está libre a esa hora muestra
"{Nombre} no está disponible a esa hora" y la lista de los libres; si no hay ninguno, "No hay entrenadores disponibles a esa hora, elige otra hora".
Textos `tc_*` en `src/i18n/pageText.js` (EN/ES/CA).

# Sincronización con Google Calendar

## Qué calendario se usa

- **Una sola variable**: `GOOGLE_CALENDAR_ID`, leída en un único sitio (`backend/google_calendar.py`, `get_calendar_id()`). No hay ningún ID en el código, el frontend ni los scripts. Sin variable (o vacía, o con el valor `primary`) el servidor NO escribe en ningún calendario: lo registra en el arranque y en cada sesión afectada.
- **Valor**: para el calendario principal del estudio es el propio email, `pt@thundbalance.com`. Se usa tal cual (solo se recortan espacios/comillas); no se valida el formato `@group.calendar.google.com`.
- **Nunca `primary`**: para una cuenta de servicio `primary` es SU calendario, no el de pt@. El calendario de pt@ tiene que estar compartido con el `client_email` de `credentials.json` con el permiso **"Hacer cambios en eventos"** (Configuración del calendario > Compartir con personas concretas).
- **Credenciales**: `GOOGLE_CREDENTIALS_JSON` (Render) o `backend/credentials.json` (local).
- **Local y Render deben usar el mismo ID**; si no, las sesiones creadas desde uno quedan en un calendario que el otro no muestra.
- **Arranque**: una línea `Calendar: OK (…últimos 6 caracteres)` o `Calendar: NÃO configurado (motivo)`. `GET /admin/calendar-status` devuelve `{configured, calendar (enmascarado), reason}`.
- **Comprobación**: `python scripts/check_calendar_config.py` (desde `backend/`). Muestra el ID enmascarado, crea un evento de prueba, lo lee, lo borra e imprime `OK`. Causas probables de un fallo: **404** = ID erróneo o calendario no compartido con la cuenta de servicio; **403** = falta el permiso "Hacer cambios en eventos".
- **Diagnóstico (solo lectura)**: `python scripts/check_calendar_sync.py [--client Henrique] [--days 120]`. Para comparar producción, define `DATABASE_URL` y `GOOGLE_CALENDAR_ID` de Render en tu PowerShell antes de ejecutarlo.

## Qué ve el calendario

Todo título y descripción sale de una sola función (`backend/event_format.py`), usada al crear un pack, aprobar un pedido, crear un cliente con pack, confirmar una trial, mover una sesión y sincronizar.

- **Sesión de pack**: `Nombre Apellido x/n`, por ejemplo `David Madrenas 2/8` (primer nombre + ÚLTIMO apellido; sin "PT"; un solo nombre se usa tal cual). `x/n` se fija al crear el pack (`sessions.session_number`): cancelar una sesión NO renumera las demás.
- **Trial session**: `Trial Session - Nombre Apellido`.
- **Descripción** (líneas simples): Cliente (nombre completo), Email, Teléfono, Día, Horario, Entrenador, Pack (nombre y sesión x/n). Sin documento fiscal ni dirección. En las trials se añaden Objetivos y Experiencia.
- **Marca**: todo evento creado por la app lleva la propiedad privada `app=thundbalance` (y `thundbalance_session_id` / `thundbalance_trial_id`). Una limpieza futura puede listarlos con `privateExtendedProperty=app=thundbalance`. `DELETE /admin/clear-calendar` solo borra eventos con esa marca.

## Sesiones y sincronización

- **Eventos sin duplicados**: cada evento tiene un id determinista (`tb` + clave de esta base de datos + id de la sesión; en trials `tb` + clave + `t` + id). Crearlo dos veces devuelve el mismo evento; un 409 cuenta como "ya existe".
- **Estado por sesión**: `sessions.calendar_sync_status` (ok | failed | pending | NULL = desconocido) y `calendar_sync_error`. Un fallo del calendario nunca impide crear, mover o cancelar la sesión: queda registrado y se ve en la ficha del cliente (icono de aviso).
- **Botón "Sincronizar con calendario"** (ficha del cliente): crea los eventos que faltan de las sesiones futuras y reescribe título y descripción de los futuros al formato actual. Muestra cuántos creó, actualizó y fallaron. Pulsarlo dos veces no cambia nada la segunda vez.

## Trial sessions

- **Aprobar en el panel NO crea evento**: crea el token, envía el email y reserva la hora en la base de datos (`approved` y `confirmed` bloquean la hora en la disponibilidad del formulario).
- **El evento se crea cuando el cliente CONFIRMA** (`Trial Session - Nombre Apellido`) y se guarda `google_event_id`. Confirmar dos veces no duplica.
- **Si el cliente declina después de confirmar**, el evento se borra. Desde el email se puede abrir el enlace con `?action=decline`.
- **Si Google falla** al confirmar, la confirmación se mantiene, el error queda en `calendar_error` y el panel muestra el aviso con el botón "Crear evento en el calendario".

## Un solo pack activo por cliente

- Un pack nuevo sustituye al anterior desde la fecha de inicio elegida (cualquier día). Las sesiones **aún por venir** (hoy o más tarde) del cliente desde esa fecha se cancelan y sus eventos se borran; las ya pasadas no se tocan. El pack anterior queda inactivo y su periodo termina el día anterior.
- Antes de hacerlo el panel muestra cuántas sesiones se cancelarán (`POST /admin/packs/preview` devuelve `replaces`) y pide confirmación; sin `confirm_replace=true` el servidor responde 409 `replaces_pack` y no cambia nada.
- Los eventos se borran después de guardar (commit): si el borrado falla, el pack se crea igual y el fallo queda registrado en la sesión cancelada.
- La fecha de inicio es libre (hoy, dentro del pack actual o pasada; en el panel la pasada pide confirmación).
- Cada sesión nueva guarda su pack (`sessions.user_plan_id`). Las sesiones antiguas no se tocan: se asocian al pack cuyo periodo contiene su fecha al leerlas.
- Antes de crear, el modal pide `POST /admin/packs/preview` y lista las sesiones que chocan (cliente ocupado, entrenador ocupado o fuera de horario). Las sesiones que se van a sustituir no cuentan como choque. Se puede "Crear igualmente" (envía `allow_conflicts`).


## Google Calendar del estudio: una sola regla (`calendar_sync.sync_session_to_google`)
La app manda; Google solo se escribe, nunca se lee para decidir nada. Dado el estado ACTUAL de una sesión en la base de datos, `sync_sessions_to_google` crea, actualiza o borra su evento y guarda el resultado en `calendar_sync_status` (`ok` | `failed`) y `calendar_sync_error` (sin datos personales). Todos los caminos graban primero y llaman después: nuevo pack, aprobar solicitud, "Asignar plan", "Nuevo cliente", reagendar, cancelar, archivar con cancelación y los botones "Sincronizar con Google". Si Google falla, la operación de la app queda hecha y el panel avisa.
- Los eventos llevan un id determinista y la propiedad privada `app=thundbalance`; nunca llevan invitados (`attendees`).
- Las peticiones a Google usan un cliente autenticado que se reutiliza (uno por hilo), con timeout de 8 s, y los packs grandes envían como máximo 4 a la vez.
- Trial session: el evento se crea cuando el CLIENTE confirma (no al pedirla ni al aprobarla) y se borra si se declina o el admin la cancela.
- `DELETE /admin/clear-calendar` exige el token del admin y `{"confirm": "CLEAR CALENDAR"}` y borra solo los eventos con `app=thundbalance`.

## Calendario del cliente: `CLIENT_CALENDAR_ENABLED` (por defecto desactivado)
Variable de entorno del backend (`true`, `1`, `yes` u `on` para activarla). Desactivada:
- `/calendar/feed/{token}.ics`, `/me/calendar-feed`, `/me/calendar-feed/regenerate`, `/me/sessions.ics`, `/me/sessions/{id}/ics` y `/admin/clients/{id}/calendar-feed` responden 404;
- los emails de pack, bienvenida y confirmación de trial no llevan el .ics, ni el botón "Añadir a Google Calendar", ni el enlace de suscripción, ni las frases que hablan de ello;
- "Mis sesiones", el panel del cliente y la confirmación de trial no muestran nada de calendario;
- el admin no ve el estado "Calendario del cliente" ni el botón "Copiar enlace del calendario".
El frontend lo pregunta una vez a `GET /features`. El código sigue en su sitio: activar la variable lo devuelve todo.

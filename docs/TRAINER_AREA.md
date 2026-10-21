# Área de entrenadores (backend)

Código: `backend/trainer_area.py`. Tests: `backend/test_trainer_area.py`.

## Quién es entrenador
- Un rol nuevo, de solo lectura, que el admin asigna a un email (tabla `trainer_access`).
- El `trainer_id` **nunca** viene del cliente: sale de la tabla, por el email (y el uid si se guardó) del token de Firebase.
- Solo vale con `email_verified = true`. Cada petición consulta la tabla, así que revocar es inmediato (soft: se rellena `revoked_at`, nunca se borra).
- Un entrenador no hereda nada de cliente: `require_client` lo rechaza con 403 (`trainer_account`). El admin no cambia.

## Tablas (se crean al arrancar, idempotente)
- `trainer_access` (id, trainer_id, firebase_uid, email, granted_by, granted_at, revoked_at). Índices únicos parciales (`revoked_at IS NULL`): un acceso activo por entrenador y uno por email.
- `trainer_access_log` (id, action `grant|revoke`, trainer_id, email, admin_uid, created_at).

## Endpoints
| Quién | Endpoint |
|---|---|
| Cualquier usuario con sesión | `GET /me/roles` → `{is_admin, is_trainer, trainer_id, trainer_name}` |
| Entrenador | `GET /trainer-area/me/summary?period=today\|week\|month\|custom&from=&to=` |
| Entrenador | `GET /trainer-area/me/sessions?from=&to=` |
| Entrenador | `GET /trainer-area/me/free-slots?from=&to=` |
| Admin | `GET /admin/trainers/{id}/panel/summary`, `/sessions`, `/free-slots` (mismos parámetros) |
| Admin | `GET /admin/trainer-access`, `POST /admin/trainer-access/check`, `POST /admin/trainer-access` (`confirm: true`), `DELETE /admin/trainer-access/{trainer_id}` |

Fechas: `from <= to`, máximo 366 días, 422 si no. Día, semana (empieza el lunes) y mes en Europe/Madrid.

## Qué ve el entrenador
Solo sus sesiones: `{session_id, client_display_name ("Nombre Apellido"), session_number ("3/12"), pack_name, date, time, status booked|completed|cancelled, is_trial}`. Incluye las pruebas **confirmadas**. Nunca email, teléfono, dirección, documento ni id interno del cliente.

## Dar acceso (`check` y `grant`)
`can_grant = false` con `reason`: `no_account`, `is_admin`, `already_assigned_to_other_trainer`, `already_granted`, `trainer_has_access`, `is_client_with_activity` (pack activo o sesiones futuras) o `email_not_verified`. El servidor repite todas las comprobaciones en `POST /admin/trainer-access`, que además exige `confirm: true`.

## Notas
- `sessions_rescheduled` cuenta las sesiones con la marca `rescheduled` (la web guarda un sí/no, no un historial de cambios).
- Los colores de evento de Google (`event_format.trainer_color_id`) salen ahora de `trainers.color`; el mapa por nombre queda solo como reserva.

## Mensajes (bandeja) y entrenadores
- Un mensaje puede tener **varias audiencias**: `all` (clientes), `active_pack` (clientes con pack activo), `trainers` (entrenadores con acceso activo) y `user` (una persona por email: un cliente o un entrenador activo; es el mecanismo para futuros mensajes automáticos a un entrenador concreto). Se guardan en `inbox_messages.audiences` (JSON); los mensajes antiguos solo tienen la columna `audience` y se leen como lista de uno.
- Una persona que entra por varias reglas recibe **un solo** mensaje (se deduplica por email).
- Los entrenadores **no son clientes**: `all` y `active_pack` los excluyen.
- Lo que llegó solo por la regla `trainers` (`inbox_recipients.source = 'trainers'`) deja de verse en cuanto se retira el acceso (y vuelve si se da de nuevo).
- Los entrenadores leen y archivan en la **misma bandeja** (`/inbox`, `/inbox/unread-count`, `/inbox/{id}/read|archive|unarchive`, `read-all`, `archive-read`); borrar sigue respondiendo 410 para todos. Un entrenador sin perfil en la web (nunca inició sesión) ve una bandeja vacía hasta que lo tenga.
- Admin: `Entrenadores > Acceso al área de entrenadores` (`src/admin/TrainerAccess.jsx`): Definir acceso → Verificar → Confirmar; Retirar acceso (con confirmación); «Ver panel» desactivado («Próximamente») hasta que exista `/admin/trainers/{id}/panel` (`TRAINER_PANEL_ROUTE_READY` en `src/admin/trainerAccessHelpers.js`).

## Frontend (menú, rutas y panel)
- `src/roles/`: `RolesProvider` llama a `GET /me/roles` tras el login (y lo olvida al salir); `useRoles()` da `{ status, roles, isTrainer }`. `TrainerRoute` protege `/trainer`; `NotForTrainers` manda a `/trainer` a un entrenador que abra `/dashboard`, `/my-sessions`, `/trial-session` o `/training-request`. Un no-entrenador que abre `/trainer` va al inicio.
- Menú de entrenador (Navbar): Inicio, Perfil, Panel de entrenador, Consejos de entrenamiento, idioma, buzón con contador y el círculo del perfil. En la home no ve el botón de «reservar sesión de prueba» ni la sección de precios.
- **El nombre del menú es una sola clave**: `'trainer.menuLabel'` en `src/i18n/trainerText.js` (EN «Trainer panel», ES «Panel de entrenador», CA «Panell d'entrenador»).
- `src/trainer/`: el panel (`TrainerPanel`: período Hoy/Semana/Mes/Rango + pestañas Insights, Calendario, Lista) no sabe quién lo mira. Recibe un `source` (`trainerSource(fetcher, base)`): el entrenador usa `/trainer-area/me` y el admin `/admin/trainers/{id}/panel` (ruta `/admin/trainers/:trainerId/panel`, con la franja «Vista de solo lectura…» y «Volver»). El calendario reutiliza la configuración y los colores del calendario del admin.
- `/me/roles` devuelve también `trainer_color`; el perfil (`/users/email`, `/profile`, foto) y la bandeja aceptan la cuenta de un entrenador (`require_account`); packs, reservas y solicitudes siguen cerradas para él (403).

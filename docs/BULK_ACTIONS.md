# Acciones en masa del panel admin

Seleccionar varias filas y actuar de una vez. Cada acción en masa llama a **la misma función** que la acción individual
(`backend/bulk_actions.py: run_each`), así que tiene exactamente los mismos efectos (eventos de Google Calendar, emails,
auditoría, protecciones). Un error en un elemento no impide los demás.

`POST /admin/<tipo>/bulk` · `{"action": "...", "ids": [...]}` · solo admin · máximo 200 ids ·
respuesta `{"total", "done", "failed", "results": [{"id", "ok", "error"?}]}`.

| Lista (página) | Endpoint | Acciones | Función reutilizada |
|---|---|---|---|
| Clientes | `/admin/clients/bulk` | `archive` (opc. `cancel_future_sessions` + `confirm_cancel`), `unarchive`, `delete` (exige `confirm_word` = `ELIMINAR`) | `archive_client`, `unarchive_client`, `delete_client` |
| Sesiones (ficha del cliente) | `/admin/sessions/bulk` | `cancel` | `admin_cancel_session` |
| Sesiones de prueba | `/admin/trial-sessions/bulk` | `cancel` | `admin_cancel_trial` |
| Solicitudes | `/admin/client-requests/bulk` | `archive`, `unarchive` | `set_request_archived` |
| Mensajes enviados | `/admin/messages/bulk` | `archive`, `restore` (nunca se borran) | `archive_admin`, `restore_admin` |
| Planes | `/admin/plans/bulk` | `delete` | `admin_delete_plan` |
| Entrenadores | `/admin/trainers/bulk` | `remove` | `admin_remove_trainer` |
| Vídeos | `/admin/training-videos/bulk` | `delete` | `delete_training_video` |
| Mensajes de contacto | `/admin/contact-messages/bulk` (ya existía) | `read`, `unread`, `archive`, `unarchive`, `delete` | una sola transacción |

Frontend: `src/admin/BulkBar.jsx` (casilla de fila, "Seleccionar todo", barra fija inferior, confirmación y resultado) y
`src/admin/bulk.js` (selección). Los textos están en `adminText.js` (`bk_*`, ES/EN).

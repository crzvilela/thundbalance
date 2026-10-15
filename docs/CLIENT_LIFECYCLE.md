# Archivar y eliminar clientes

Código: `backend/client_lifecycle.py`, `src/admin/ClientLifecycleDialogs.jsx`, menú "···" de la ficha y de la lista en `src/admin/pages/Clients.jsx`.

## Seguridad
- Los tres endpoints (`POST /admin/clients/{id}/archive`, `/unarchive`, `/delete`) usan `require_admin`: el ID token de Firebase se verifica en el servidor y el email debe ser el del admin (`ADMIN_EMAIL`).
- Se rechaza (403 `protected_account`) archivar o eliminar la cuenta del admin o la cuenta de quien llama (mismo email o mismo uid de Firebase).
- Nada de datos personales en logs ni en la auditoría.

## Archivar (reversible)
- `users.archived_at` (se crea al arrancar con `ADD COLUMN IF NOT EXISTS`).
- Se desactiva la cuenta de Firebase (`disabled = True`) y se revocan sus refresh tokens; al desarchivar se reactiva. Si Firebase falla no se cambia nada y se puede repetir.
- Opción "Cancelar también sus sesiones futuras" (desmarcada por defecto): muestra cuántas y pide una segunda confirmación (`confirm_cancel`; sin ella el servidor responde 409 `confirm_cancel` con el número). Se cancelan las sesiones `Booked` de hoy en adelante y se borran sus eventos de Google Calendar. Si el borrado de algún evento falla, el archivo se mantiene, se avisa y volver a archivar lo reintenta.
- Los archivados salen de `GET /admin/clients` (la lista normal), de `/admin/stats`, `/admin/users` y `/users`. `GET /admin/clients?archived=only` devuelve solo los archivados (pestaña "Archivados" con contador).
- Desarchivar no recrea sesiones canceladas.

## Eliminar (irreversible)
- Hace falta `confirm_data = true` y el nombre completo exacto (sin distinguir mayúsculas ni espacios repetidos). El servidor lo comprueba además del botón.
- Orden: 1) eventos de Google Calendar (sesiones y sesiones de prueba, pasados y futuros) → 2) base de datos: sesiones, packs, solicitudes, sesiones de prueba y `email_log` del cliente → 3) usuario de Firebase → 4) perfil (y su foto).
- Si un paso externo falla se para y se responde 502 `delete_incomplete` con la lista de pasos hechos y pendientes. Repetir continúa donde se quedó: "evento no existe" (Google 404/410) y "usuario no existe" (Firebase) cuentan como éxito. El perfil es lo último que se borra, por eso la acción se puede repetir.
- Los eventos sin `google_event_id` guardado se buscan por su id determinista.

## Auditoría
Tabla `admin_audit_log` (`at`, `admin_uid`, `action`, `client_id`, `outcome`, `detail`). Sin nombre, email ni documento.

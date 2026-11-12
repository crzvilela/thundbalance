# Apagado de clientes y retención de datos

**Qué borra «Eliminar definitivamente» un cliente** (`client_erasure.py`, `client_lifecycle.py`): los eventos de Google Calendar, y en
una sola transacción de la base de datos sus sesiones, solicitudes, solicitudes de cambio, sesiones de prueba y mensajes de contacto con su
email (sin distinguir mayúsculas), sus filas del buzón y los mensajes `system` que se quedan sin destinatarios, el registro de emails, todas
sus fotos (base de datos y disco); después la cuenta de Firebase y, lo último, el perfil. **Se anonimiza y se conserva** (contabilidad): los
packs (`user_plans`) sin cliente, segunda persona, emails extra ni direcciones del calendario compartido; y su dirección se vacía donde
aparece dentro de registros de otras personas (segunda persona, destinatarios extra), sin borrar esos registros. **Se queda**:
`admin_audit_log` (uid del admin, id numérico y resultado, sin datos personales). Si el calendario o Firebase no responden, el borrado se
detiene, deja una marca en `client_erasure_pending` (paso y TIPO del error, nada personal), responde 502 `delete_incomplete` y se puede
repetir; el trabajo diario también lo repite. Antes de confirmar, el admin ve una lista de cantidades (`GET /admin/clients/{id}/erasure-preview`).
No se pueden borrar desde el código: los emails ya enviados que quedan en el Gmail del estudio y las copias de seguridad de Neon (hasta que
caduque su periodo de restauración).

**Retención (apagada por defecto)** (`data_retention.py`): con `RETENTION_ENABLED=true` un trabajo diario (hilo en segundo plano, como la
reconciliación del calendario) borra los mensajes de contacto con más de `RETENTION_CONTACT_DAYS` días (365), las solicitudes de prueba
rechazadas, canceladas o sin respuesta con más de `RETENTION_TRIAL_DAYS` (365) —nunca las abiertas (aprobadas/confirmadas) ni las de un
cliente que existe y no está archivado— y el registro de emails con más de `RETENTION_EMAIL_LOG_DAYS` (180). Solo se registran cantidades.
`RETENTION_JOB=off` apaga el trabajo entero. Con o sin retención, cada día se repiten los borrados de clientes que se quedaron a medias y se
eliminan las direcciones IP de los límites de peticiones con más de un día. Para probarlo: `cd backend && python -m unittest
test_client_erasure test_data_retention -v`.

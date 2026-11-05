# Sesiones canceladas: ver y restaurar

- **Calendario admin:** el botón **"Canceladas"** (apagado por defecto) añade las sesiones canceladas (y las pruebas canceladas): en gris, tachadas y con la etiqueta "Cancelada". No existen en Google.
- **Al pulsar una cancelada:** cliente, entrenador, x/y, fecha, hora, quién la canceló y cuándo, y el botón **"Restaurar sesión"**.
- **Ficha del cliente > Sesiones:** las canceladas salen en su sitio ("Sesión 2/12 · Cancelada") con **"Restaurar"**.

`POST /admin/sessions/{id}/restore` (admin) `{date?, time?, trainer_id?, confirm_client_overlap?}`:

- solo si está cancelada; si ya no lo está responde `{"restored": false, "already": true}` y no cambia nada (idempotente);
- usa el día, la hora y el entrenador originales (el número x/y no cambia). 409 `past` si ya pasó, 409 `trainer_unavailable` (con `alternatives`) si el entrenador no está libre (mismas reglas que cualquier reserva, pruebas pendientes con entrenador incluidas), 409 `client_busy` si el cliente ya tiene otra sesión a esa hora (se puede confirmar);
- el panel deja elegir OTRA fecha, hora y entrenador (solo los libres) y vuelve a pedirlo;
- al restaurar: `Booked`, evento de Google recreado por `calendar_sync.sync_session_to_google`, mensaje en el buzón del cliente en su idioma (sin email).

Columnas nuevas de `sessions` (idempotentes al arrancar): `cancelled_at`, `cancelled_by`, `restored_at`, `restored_by`. Nunca se borra la fila.

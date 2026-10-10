# Sincronización con Google Calendar

- **Qué calendario usa el servidor**: la línea de arranque `Google Calendar: …xxxxxx@group.calendar.google.com (origen: …)` y `GET /admin/calendar-status`. Si dice "constante por defecto", la variable `GOOGLE_CALENDAR_ID` NO está definida y se usa el calendario por defecto del código. **Local y Render deben usar el mismo ID** (defínelo en las dos); si no, las sesiones creadas desde uno quedan en un calendario que el otro no muestra.
- **Diagnóstico (solo lectura)**: `python scripts/check_calendar_sync.py [--client Henrique] [--days 120]`. Para comparar producción, define `DATABASE_URL` y `GOOGLE_CALENDAR_ID` de Render en tu PowerShell antes de ejecutarlo.
- **Eventos sin duplicados**: cada evento tiene un id determinista (`tb` + clave de esta base de datos + id de la sesión). Crearlo dos veces devuelve el mismo evento.
- **Estado por sesión**: `sessions.calendar_sync_status` (ok | failed | pending | NULL = desconocido) y `calendar_sync_error`. Un fallo del calendario nunca impide crear, mover o cancelar la sesión: queda registrado y se ve en la ficha del cliente (icono de aviso).
- **Botón "Sincronizar con calendario"** (ficha del cliente): crea solo los eventos que faltan de las sesiones futuras y reintenta los movimientos fallidos. Se puede pulsar las veces que haga falta.

## Packs en paralelo

- Un cliente puede tener varios packs activos a la vez (por ejemplo 1 sesión por semana y, desde otra fecha, otro de 2 por semana). Crear un pack nuevo NO cierra, desactiva ni borra los anteriores.
- La fecha de inicio es libre (hoy, dentro del pack actual o pasada; en el panel la pasada pide confirmación). La sugerencia es el día siguiente a la última sesión del pack más reciente.
- Cada sesión nueva guarda su pack (`sessions.user_plan_id`). Las sesiones antiguas no se tocan: se asocian al pack cuyo periodo contiene su fecha al leerlas.
- Antes de crear, el modal pide `POST /admin/packs/preview` y lista las sesiones que chocan (cliente ocupado, entrenador ocupado o fuera de horario). Se puede "Crear igualmente" (envía `allow_conflicts`).

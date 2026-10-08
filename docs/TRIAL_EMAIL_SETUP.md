# Aviso por e-mail de sesiones de prueba

Cuando alguien reserva una sesión de prueba, el backend avisa a `info@thundbalance.com`.
El envío usa un Google Apps Script (funciona en Render gratis y no necesita acceso a la cuenta de info@).

1. Entra en https://script.google.com con la cuenta Google creada para el sitio → **Nuevo proyecto**.
2. Pega el contenido de `docs/trial-email.gs` (usa GmailApp: la primera vez ejecuta una función de prueba para autorizar el permiso de Gmail). Cambia `SECRET` por una clave larga inventada por ti.
3. **Implementar → Nueva implementación → Tipo: Aplicación web.**
   Ejecutar como: **Yo**. Quién tiene acceso: **Cualquier persona**. Acepta los permisos (enviar correo).
4. Copia la URL que termina en `/exec`.
5. En Render → servicio del backend → **Environment**, añade:
   - `TRIAL_EMAIL_WEBHOOK_URL` = la URL `/exec`
   - `TRIAL_EMAIL_WEBHOOK_SECRET` = la misma clave del paso 2
   - (opcional) `TRIAL_NOTIFY_TO` = otro destinatario; por defecto `info@thundbalance.com`
6. Guarda y redeploya. Pide al jefe que marque el remitente como seguro para que no vaya a spam.

Si las variables no están definidas, no se envía nada y las reservas funcionan igual.

## Actualizar el script (emails nuevos con logo, HTML y adjuntos)

El script `docs/trial-email.gs` ahora entiende dos formatos: el nuevo (asunto, HTML, adjuntos; lo usan todos los emails del backend) y el antiguo (aviso en texto plano). **Hazlo ANTES de desplegar el backend nuevo**, o los emails a clientes saldrían con el formato antiguo:

1. script.google.com → abre el proyecto existente → sustituye el código por el de `docs/trial-email.gs` (conserva tu `SECRET`).
2. **Implementar → Gestionar implementaciones → editar (lápiz) → Versión: Nueva versión → Implementar.** La URL `/exec` no cambia.
3. No hay variables nuevas en Render. Opcional: `SITE_URL` (p. ej. `https://thundbalance.vercel.app`) para los enlaces y el logo de los emails.
4. Prueba: `python send_test_email.py tu@correo.com` desde la carpeta `backend` con `TRIAL_EMAIL_WEBHOOK_URL` y `TRIAL_EMAIL_WEBHOOK_SECRET` definidas en tu terminal.

## Emails al renovar o asignar un pack

Al renovar un pack (y al aprobar una solicitud de entrenamiento) el panel envía un email con el resumen y un `.ics` con todas las sesiones, usando el mismo script de Google. En el modal, "Enviar confirmación a" viene con las direcciones del equipo, que se pueden quitar o ampliar (máximo 10 extra). Para cambiar las direcciones por defecto, en Render define `TEAM_EMAILS` (separadas por comas), por ejemplo `info@thundbalance.com,pt@thundbalance.com`.

## Clientes creados desde el panel (Firebase Admin)

"Añadir cliente" crea la cuenta de acceso en Firebase con una contraseña temporal generada por el servidor, que solo se envía por email (nunca se guarda en Postgres, ni se muestra en el panel, ni se escribe en los logs). Necesita la clave de servicio de Firebase:

- Render: Secret File en `/etc/secrets/firebase-service-account.json` y la variable de entorno `FIREBASE_CREDENTIALS_PATH` con esa ruta.
- Local: `FIREBASE_CREDENTIALS_PATH` apuntando a un fichero **fuera del repositorio** (por ejemplo `C:\Segredos\firebase-service-account.json`).

Sin esa variable el panel responde "La creación de cuentas no está configurada en el servidor". La columna `users.must_change_password` se crea sola al arrancar el servidor.

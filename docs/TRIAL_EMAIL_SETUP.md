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

# Aviso por e-mail de sesiones de prueba

Cuando alguien reserva una sesión de prueba, el backend avisa a `pt@thundbalance.com`.
El envío usa un Google Apps Script (funciona en Render gratis y no necesita acceso a la cuenta de pt@).

1. Entra en https://script.google.com con la cuenta Google creada para el sitio → **Nuevo proyecto**.
2. Pega el contenido de `docs/trial-email.gs` (usa GmailApp: la primera vez ejecuta una función de prueba para autorizar el permiso de Gmail). Cambia `SECRET` por una clave larga inventada por ti.
3. **Implementar → Nueva implementación → Tipo: Aplicación web.**
   Ejecutar como: **Yo**. Quién tiene acceso: **Cualquier persona**. Acepta los permisos (enviar correo).
4. Copia la URL que termina en `/exec`.
5. En Render → servicio del backend → **Environment**, añade:
   - `TRIAL_EMAIL_WEBHOOK_URL` = la URL `/exec`
   - `TRIAL_EMAIL_WEBHOOK_SECRET` = la misma clave del paso 2
   - (opcional) `TEAM_NOTIFICATION_EMAILS` = quién recibe el aviso de «Nueva solicitud de Trial Session» (direcciones separadas por comas, un solo correo con todas en «Para»); por defecto solo `pt@thundbalance.com` (`info@` ya no se usa). Rige TODOS los avisos internos. Una dirección inválida se ignora y, si ninguna es válida, se usa la de por defecto. Las variables antiguas `TRIAL_NOTIFY_TO`, `CONTACT_NOTIFY_TO` y `TEAM_EMAILS` ya no hacen falta.
6. Guarda y redeploya. Pide al jefe que marque el remitente como seguro para que no vaya a spam.

Si las variables no están definidas, no se envía nada y las reservas funcionan igual.

## Actualizar el script (emails nuevos con logo, HTML y adjuntos)

El script `docs/trial-email.gs` ahora entiende dos formatos: el nuevo (asunto, HTML, adjuntos; lo usan todos los emails del backend) y el antiguo (aviso en texto plano). **Hazlo ANTES de desplegar el backend nuevo**, o los emails a clientes saldrían con el formato antiguo:

1. script.google.com → abre el proyecto existente → sustituye el código por el de `docs/trial-email.gs` (conserva tu `SECRET`).
2. **Implementar → Gestionar implementaciones → editar (lápiz) → Versión: Nueva versión → Implementar.** La URL `/exec` no cambia.
3. No hay variables nuevas en Render. Opcional: `FRONTEND_URL` (por defecto `https://thundbalance.vercel.app`; `SITE_URL`, el nombre anterior, sigue funcionando) para los enlaces y el logo de los emails. El logo es el PNG `public/email-logo.png` (600 px, blanco sobre transparente, mostrado a 200 px) en `{FRONTEND_URL}/email-logo.png`; una dirección que no sea https pública (localhost, relativa, `data:`) se ignora. Para comprobarlo tras el deploy: `python scripts/check_email_logo.py` (desde `backend/`).
4. Prueba: `python send_test_email.py tu@correo.com` desde la carpeta `backend` con `TRIAL_EMAIL_WEBHOOK_URL` y `TRIAL_EMAIL_WEBHOOK_SECRET` definidas en tu terminal.

## Emails al renovar o asignar un pack

Al renovar un pack (y al aprobar una solicitud de entrenamiento) el panel envía un email con el resumen y un `.ics` con todas las sesiones, usando el mismo script de Google. En el modal, "Enviar confirmación a" viene con las direcciones del equipo, que se pueden quitar o ampliar (máximo 10 extra). Para cambiar las direcciones por defecto, en Render define `TEAM_NOTIFICATION_EMAILS` (separadas por comas).

## Clientes creados desde el panel (Firebase Admin)

"Añadir cliente" crea la cuenta de acceso en Firebase con una contraseña temporal generada por el servidor, que solo se envía por email (nunca se guarda en Postgres, ni se muestra en el panel, ni se escribe en los logs). Necesita la clave de servicio de Firebase:

- Render: Secret File en `/etc/secrets/firebase-service-account.json` y la variable de entorno `FIREBASE_CREDENTIALS_PATH` con esa ruta.
- Local: `FIREBASE_CREDENTIALS_PATH` apuntando a un fichero **fuera del repositorio** (por ejemplo `C:\Segredos\firebase-service-account.json`).

Sin esa variable el panel responde "La creación de cuentas no está configurada en el servidor". La columna `users.must_change_password` se crea sola al arrancar el servidor.

### Diagnóstico de "La creación de cuentas no está configurada" (503)

- Al arrancar, el servidor escribe una línea: `Firebase Admin: OK` o `Firebase Admin: NÃO inicializado (motivo: variável em falta | ficheiro não encontrado | JSON inválido | pacote em falta)`.
- `GET /admin/firebase-status` (solo admin) devuelve `{"firebase_admin_ready": true|false, "reason": "..."}`.
- El mensaje 503 del panel lleva el motivo entre corchetes.
- Local (PowerShell, en la misma ventana donde arrancas uvicorn):
  `$env:FIREBASE_CREDENTIALS_PATH = "C:\Segredos\firebase-service-account.json"; python -m uvicorn main:app --reload`
- Render: Secret File `firebase-service-account.json` (queda en `/etc/secrets/firebase-service-account.json`) y variable `FIREBASE_CREDENTIALS_PATH=/etc/secrets/firebase-service-account.json`.

## Registro de emails y evento provisional (sesiones de prueba)

- Cada email que envía el servidor deja una fila en la tabla `email_log` (tipo, referencia, destinatario, estado `enviado` | `falhou`, error corto). Sin contenido ni secretos. En el panel, cada sesión de prueba muestra "Email de aprobación: enviado ✓ (fecha) / falló ✗ (motivo)" y, mientras espera al cliente, el botón "Reenviar email de aprobación" (mismo enlace; máximo 1 por minuto).
- Al aprobar se crea ya el evento `[Pendiente] Trial Session · Nombre` en el calendario. Al confirmar el cliente es el mismo evento (`Trial Session · Nombre`); si declina, se borra. Si falla, la aprobación se mantiene y el panel ofrece "Crear evento en el calendario" (no duplica).
- Para ver por qué no salió un email: buscar en los logs de Render las líneas `Email not sent:` / `Email service ...` o consultar `SELECT * FROM email_log ORDER BY id DESC LIMIT 20;`.

## Datos de facturación de los clientes

- Columnas nuevas en `users`: `tax_id_type`, `tax_id`, `country` (creadas solas al arrancar). La dirección de facturación son las columnas que ya existían (`morada`, `cidade`, `cep`).
- Validación (`backend/tax_id.py`, igual en el frontend): DNI = 8 dígitos + letra (módulo 23); NIE = X/Y/Z + 7 dígitos + letra; Pasaporte/Otro = 4 a 20 letras o números. Se normaliza a mayúsculas sin espacios, puntos ni guiones.
- Las listas devuelven solo el documento enmascarado (`••••678Z`). El documento completo solo lo ven el admin (ficha del cliente) y el propio cliente (Perfil).
- El documento y la dirección no se envían nunca por email, ni a logs, ni en respuestas de error.

## Envío desde el dominio (Gmail API, `pt@thundbalance.com`)

Los emails pueden salir de `pt@thundbalance.com` por la Gmail API (HTTPS, funciona en Render gratis) con la **misma cuenta de servicio del Google Calendar** y delegación de todo el dominio. Así pasan SPF, DKIM y DMARC del dominio y no caen en spam.

**Lo que hace el jefe (una vez, fuera del código):**
1. En Google Cloud, activar la **Gmail API** del proyecto de la cuenta de servicio.
2. En la consola de administración de Google Workspace → Seguridad → Acceso y control de datos → Controles de API → **Delegación de todo el dominio**: en el cliente de la cuenta de servicio, los ámbitos deben ser `https://www.googleapis.com/auth/calendar` **y** `https://www.googleapis.com/auth/gmail.send`.
3. Comprobar que `pt@thundbalance.com` es un buzón real y que SPF/DKIM (y DMARC) del dominio están activos.

**Variables del servidor (Render):**

| Variable | Valor | Para qué |
|---|---|---|
| `MAIL_PROVIDER` | `gmail_api` o `legacy` (por defecto `legacy`) | Con `gmail_api` TODOS los emails (clientes y equipo) salen por la Gmail API |
| `MAIL_FROM_EMAIL` | `pt@thundbalance.com` | Remitente y usuario al que suplanta la delegación |
| `MAIL_FROM_NAME` | `ThundBalance` | Nombre visible del remitente |
| `MAIL_REPLY_TO` | `pt@thundbalance.com` | Dirección de respuesta |

Las credenciales del método antiguo (`TRIAL_EMAIL_WEBHOOK_URL`, `TRIAL_EMAIL_WEBHOOK_SECRET`) **no se borran**: son la alternativa.

**Si la delegación aún no está activa:** cada email sale por el método antiguo, el log solo guarda el tipo de error (nunca destinatario, nombre ni cuerpo) y el panel muestra el aviso «Envío por dominio no configurado». Las reservas, packs y aprobaciones nunca se bloquean por un fallo de envío. Tras un rechazo, la delegación no se vuelve a consultar durante 5 minutos.

**Cómo validar:**
1. En el panel de admin (barra lateral) pulsar **Enviar email de prueba** (máx. 5 por hora) a un Gmail. La respuesta indica el método usado y si hubo fallback.
2. En Gmail abrir el mensaje → ⋮ → **Mostrar original** y comprobar que **SPF, DKIM y DMARC = PASS**, y que el remitente es `ThundBalance <pt@thundbalance.com>`.
3. Revisar acentos, ñ y ç en el asunto y el cuerpo, y que el Bcc funciona (acciones del panel con destinatarios extra).
4. Si todo está bien, dejar `MAIL_PROVIDER=gmail_api` en Render (volver a `legacy` revierte sin tocar código).

# Seguridad, legal y contenido externo

## API (backend/web_safety.py)
- Cabeceras de seguridad en todas las respuestas; `/uploads/*` con CSP `sandbox` (nada se ejecuta).
- `/docs` y `/openapi.json` apagados. Para verlos en local: `ENABLE_API_DOCS=1`.
- CORS: solo métodos y cabeceras usados (`Authorization`, `Content-Type`).
- Límite por IP en los enlaces con token (`/trial-sessions/confirmation/*`, `/reschedule-response/*`): `TOKEN_RATE_LIMIT` (40 por 5 min).
- Imágenes: se comprueban los primeros bytes (jpg, png, webp, gif; **sin svg**) y se guardan en la tabla `uploaded_files`
  (el disco de Render se borra en cada deploy). Los vídeos subidos siguen en disco: usa YouTube/Vimeo para los permanentes.
  Las imágenes antiguas que ya se perdieron hay que volver a subirlas.
- IP del cliente (`web_safety.get_client_ip`): la usan TODOS los límites. Detrás del proxy de Render se usa la entrada de `X-Forwarded-For`
  que añadió el proxy (la última con `TRUSTED_PROXY_HOPS=1`, nunca la primera, que puede falsificar el cliente). Si Cloudflare + Render
  añaden dos entradas, pon `TRUSTED_PROXY_HOPS=2`. En el log aparece una línea (solo un número, nunca una IP) con cuántas entradas llegan.
- Límites configurables (variables de entorno, valores por defecto entre paréntesis): `TRIAL_IP_LIMIT` (5) y `TRIAL_IP_WINDOW_SECONDS` (3600);
  `TRIAL_EMAIL_LIMIT` (3) y `TRIAL_EMAIL_WINDOW_SECONDS` (86400), por email normalizado y guardado como hash; `CONTACT_IP_LIMIT` (5),
  `CONTACT_EMAIL_LIMIT` (3), `CONTACT_WINDOW_SECONDS` (3600); `AVAILABILITY_RATE_LIMIT` (60 por minuto); `TOKEN_RATE_LIMIT` (40) y
  `TOKEN_RATE_WINDOW_SECONDS` (300). Pasado el límite: 429 con el mismo texto genérico (no dice si el email existe).
- CORS (`web_safety.cors_origins`): en producción solo `https://thundbalance.vercel.app` y lo que ponga `CORS_ORIGINS` (el dominio propio, separado
  por comas); nunca `*`, y localhost/127.0.0.1 solo si `ENV` o `ENVIRONMENT` es `development` (en tu ordenador, no en Render).
- Vídeos subidos: el contenido real (primeros bytes) debe ser MP4/MOV/WebM y coincidir con la extensión y el Content-Type (415 si no); el
  nombre guardado lo genera el servidor (uuid + extensión validada). Tamaño máximo: 300 MB.
- Errores: define `SENTRY_DSN` (y opcional `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`) en Render. Sin PII.

## Frontend
- `vercel.json`: cabeceras + CSP obligatoria mínima + `Content-Security-Policy-Report-Only` completa. Mira la consola
  del navegador en producción; cuando no haya avisos, cambia la clave a `Content-Security-Policy`.
- Páginas `/privacy`, `/cookies`, `/legal-notice` (EN/ES/CA) y aviso de consentimiento. Reseñas de Google, mapas y vídeos
  externos solo se cargan al aceptar. **Completa `LEGAL.holder` y `LEGAL.taxId` en `src/legal/legalText.js`
  y haz revisar los textos por un profesional.**
- `public/robots.txt` y `sitemap.xml` usan `thundbalance.vercel.app`: cámbialo al dominio definitivo.

## Copias de seguridad (Neon)
1. Neon → Project → Settings → Storage: comprueba el periodo de restauración (point-in-time).
2. Prueba un restauro creando una *branch* desde un momento pasado y arrancando el backend contra ella.
3. Guarda una copia periódica fuera de Neon: `pg_dump "$DATABASE_URL" -Fc -f backup.dump` y guárdala cifrada, no en el repo.

## Auditoría de dependencias (2026-11-06)
- Backend: `pip-audit` encontró 37 avisos en 8 paquetes (anyio, certifi, cryptography, httplib2, pyasn1, python-multipart,
  starlette, urllib3). Subidos en `requirements.txt`; instalación limpia y tests OK; `pip-audit` sin avisos.
  Repetir de vez en cuando: `pip install pip-audit` y `pip-audit -r backend/requirements.txt --no-deps --disable-pip`.
- Frontend: `npm audit fix` (sin cambios incompatibles) bajó de 20 a 8 avisos. Quedan 2 que no se arreglan sin romper nada:
  `@grpc/grpc-js` (dentro de Firestore, que la web no usa; el arreglo sería bajar Firebase a la v9) y `minimatch` (solo en ESLint,
  herramienta de desarrollo; no llega al navegador).
- Límites de peticiones (`trial`, `contact`, `token`): ahora en la tabla `rate_limit_hits`, sobreviven a los reinicios de Render.
  Si la base de datos falla, el límite sigue en memoria.

# Seguridad, legal y contenido externo

## API (backend/web_safety.py)
- Cabeceras de seguridad en todas las respuestas; `/uploads/*` con CSP `sandbox` (nada se ejecuta).
- `/docs` y `/openapi.json` apagados. Para verlos en local: `ENABLE_API_DOCS=1`.
- CORS: solo métodos y cabeceras usados (`Authorization`, `Content-Type`).
- Límite por IP en los enlaces con token (`/trial-sessions/confirmation/*`, `/reschedule-response/*`): `TOKEN_RATE_LIMIT` (40 por 5 min).
- Imágenes: se comprueban los primeros bytes (jpg, png, webp, gif; **sin svg**) y se guardan en la tabla `uploaded_files`
  (el disco de Render se borra en cada deploy). Los vídeos subidos siguen en disco: usa YouTube/Vimeo para los permanentes.
  Las imágenes antiguas que ya se perdieron hay que volver a subirlas.
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

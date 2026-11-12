# Content-Security-Policy y fotos de perfil

**Política** (`vercel.json`, se aplica a todo el sitio): `script-src` ya **no** admite `'unsafe-inline'` ni `'unsafe-eval'` (el HTML solo
tiene el módulo de `/assets` y un bloque JSON-LD, que son datos); solo `'self'` y los sitios que la página carga de verdad (Firebase Auth /
Google `apis.google.com`, Google Maps, Elfsight y `www.gstatic.com`). `img-src` ya **no** admite «cualquier https»: `'self' data: blob:`, nuestra
API (`/uploads`), `ui-avatars.com` y Google / Elfsight (`*.googleusercontent.com`, `*.ggpht.com`, `*.googleapis.com`, `*.gstatic.com`,
`*.elfsightcdn.com`, `*.elfsight.com`). `media-src` solo admite el sitio y nuestra API. `style-src` conserva `'unsafe-inline'` (React y Tailwind
usan `style=""`; no se puede autorizar por hash). Si algo deja de cargarse, **añade ese dominio a la lista**, no reabras `'unsafe-inline'`.
`tests/csp-server.mjs` sirve un build con las cabeceras reales y `tests/csp-pages.spec.mjs` (Playwright, opcional) falla si hay una violación;
`src/csp.test.js` impide reabrir la política por error (`node --test`).

**Fotos de perfil** (`photo_urls.py`): `POST /users` solo guarda `users.foto` si es un archivo de nuestro `/uploads` o una foto de Google
(`https://lh3.googleusercontent.com/...`); cualquier otra dirección se ignora (el registro no falla) y al arrancar se vacían las antiguas que
no cumplan (nunca las de `/uploads`). El panel y el área del cliente enseñan las iniciales si la foto no carga.

**Antes de desplegar**, comprueba que en producción no haya imágenes o vídeos de otros dominios: `SELECT DISTINCT split_part(split_part(video_url,
'//',2),'/',1) FROM training_videos;` y mira los hosts de las imágenes del contenido publicado de la landing
(`SELECT content FROM landing_page_content WHERE version='published'`). **Sin verificar**: Google Maps (necesita `VITE_GOOGLE_MAPS_API_KEY`) y las
páginas que exigen login (cliente, admin, editor).

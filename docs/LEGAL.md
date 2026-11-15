# Legal: qué tiene que hacer el negocio

Esta guía es corta a propósito. Los textos de la web son **modelos** que describen lo que la web hace de verdad. **No sustituyen a un abogado**: alguien con criterio legal debe revisarlos antes de darlos por buenos.

## 1. Qué tiene que rellenar o decidir el negocio

1. **Datos de la empresa** (Admin > Textos legales): razón social, NIF/CIF, dirección y correo de contacto. Teléfono, Registro Mercantil y delegado de protección de datos son opcionales. Si un dato está vacío, esa línea **no aparece en la página pública** (solo la ve el administrador, marcada). La web no inventa ningún dato.
2. **Revisar los textos**: privacidad, aviso legal, términos, cancelaciones y cookies, en español, inglés y catalán. Los textos tienen marcas `[[REVIEW: ...]]` donde el negocio debe decidir algo (plazo de validez de los packs, cuándo se devuelve el dinero, derecho de desistimiento de 14 días, responsabilidad e impuestos). Esas líneas **no se ven en la web pública** hasta que se sustituyan por el texto definitivo; el administrador las ve resaltadas.
3. Cuando todo esté revisado: marcar **«Los textos están revisados»** y poner la fecha de la última revisión. El aviso del Resumen desaparece.
4. **Derechos de imagen**: confirmar que se tienen los derechos de todas las fotos, vídeos y textos de la web (y el permiso de las personas que aparecen).
5. **Reseñas reales**: las reseñas y las valoraciones deben ser de clientes reales. No inventar ni retocar.
6. **Contratos de encargado del tratamiento** (acuerdos de tratamiento de datos) con los proveedores que tratan datos de clientes: **Google** (Workspace, Calendar, Gmail, Firebase), **Render** y **Vercel**. Se aceptan en la consola de cada proveedor. Comprobar también las garantías de transferencia internacional (Marco de Privacidad de Datos UE-EE. UU. o cláusulas tipo).
7. **Plazos de conservación**: la web muestra los plazos de `RETENTION_*`, pero la limpieza solo se ejecuta si `RETENTION_ENABLED=true` en Render. Si no se activa, los textos dicen algo que no se cumple: activarla o cambiar el texto.

## 2. Qué hace la web (para que los textos digan la verdad)

* **Consentimiento**: la sesión de prueba, el contacto, el registro y los pedidos de pack llevan una casilla **sin marcar** «He leído y acepto la Política de privacidad». Sin marcarla no se envía. Se guarda **solo la versión del texto (su fecha) y la fecha de aceptación**: nada de IP ni datos del navegador. Está en `trial_sessions` y `contact_messages` (`consent_version`, `consent_at`) y en la tabla `consents` (cuentas y pedidos de pack).
* **Datos de salud**: el objetivo «Rehabilitación / recuperación de lesión» dice algo sobre la salud. Si se elige, hay una segunda casilla de consentimiento explícito (`health_consent_at`). Los campos de texto libre avisan de no escribir datos de salud.
* **Entrar con Google**: no tiene casilla; la pantalla muestra un aviso con los enlaces. Si el negocio quiere una prueba de consentimiento también ahí, hay que pedirla en un paso después del primer acceso.
* **Cookies**: banner con «Aceptar todo», «Rechazar todo» y «Configurar», con el mismo peso visual. Solo hay dos categorías: *necesarias* (idioma, elección, sesión) y *contenido externo* (reseñas de Google/Elfsight, mapa y vídeos de YouTube, Vimeo e Instagram), que **no se carga hasta que se acepta**. La elección se guarda en el navegador con versión y fecha; se cambia desde «Configurar cookies» en el pie. No hay analítica ni publicidad.
* **Tipografías**: se sirven desde la propia web (`@fontsource`); no se pide nada a Google Fonts. El avatar sin foto se dibuja con las iniciales en el navegador; el nombre no sale a ningún tercero.
* **Mensajes comerciales**: la web **no envía ninguno**. Los correos son de servicio (sesiones, packs, solicitudes). Si algún día se quiere enviar publicidad, hará falta una casilla propia y opcional.

## 3. Cómo responder a una petición de derechos

El plazo es **un mes** desde que llega.

| Petición | Qué hacer |
|---|---|
| **Acceso / portabilidad** («quiero mis datos») | El cliente los descarga solo en su área, «Mis datos». Si escribe por correo: Admin > Clientes > **Exportar datos** y se le envía. |
| **Supresión** («borrad mi cuenta») | El cliente la pide en «Mis datos»: llega a Admin una **solicitud de eliminación**. Se revisa y se **aprueba**; se borran sus datos. Si escribe por correo, el administrador la crea desde Clientes. |
| **Rectificación** | El cliente edita su perfil; si no puede, se corrige desde Admin > Clientes. |
| **Oposición / limitación / retirar consentimiento** | Se atiende por correo; para el contenido externo basta «Configurar cookies». |

Guarda un registro mínimo de cada petición y de la respuesta (fecha y tipo), **sin copiar los datos del cliente**. Detalles en `DATA_EXPORT_AND_DELETION.md` y `DATA_RETENTION.md`.

## 4. Si hay una brecha de seguridad

Una brecha es cualquier acceso, pérdida o difusión no autorizada de datos personales (una clave filtrada, una cuenta robada, un correo enviado a quien no debía).

1. **Contener**: cambiar claves y contraseñas afectadas, revocar accesos, apagar lo que haga falta.
2. **Anotar** de inmediato: qué pasó, cuándo se detectó, qué datos y cuántas personas, qué se hizo. **Sin copiar los datos** en la nota.
3. Si hay riesgo para las personas, **avisar a la AEPD en un máximo de 72 horas** desde que se conoce (sede.aepd.gob.es, «Brechas de datos personales»). Si el riesgo es alto, **avisar también a los afectados**.
4. Aunque no se avise, guardar la nota: la AEPD puede pedirla.
5. Revisar «Estado del sistema» y los registros del servidor; **no** guardar datos personales en los registros.

## 5. Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Datos de la empresa y textos editables | Admin > Textos legales (`/admin/legal`) |
| Textos modelo (ES/EN/CA) | `src/legal/legalModels.js` |
| Cómo se dibujan los textos (solo párrafos, títulos y listas, todo escapado) | `src/legal/legalRender.js` |
| Datos y consentimientos en la base de datos | `backend/legal.py` (`legal_settings`, `legal_documents`, `consents`) |
| Banner y elección de cookies | `src/components/ConsentBanner.jsx`, `src/utils/consent.js` |

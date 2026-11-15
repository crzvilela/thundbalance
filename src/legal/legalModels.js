// MODEL texts of the five legal documents, in Spanish, English and Catalan. They describe what the site really does (docs/LEGAL.md
// lists where each statement comes from). The studio can edit any of them in Admin > Textos legales; "Restaurar modelo" brings these back.
//
// Format (see legalRender.js): "## Title", "- item", paragraphs, {{company datum}} and [[REVIEW: what the owner must decide]].
// A line with an empty datum or a [[...]] mark is hidden from the public and shown to the admin with a marker.
// These are models, NOT legal advice: the owner must have them reviewed before relying on them.

export const DOCS = ['privacy', 'legal', 'terms', 'cancellations', 'cookies']

export const MODELS = {
  // ---------------------------------------------------------------------------------------------------------- privacy
  privacy: {
    es: `## Responsable del tratamiento
{{holder}}
NIF/CIF: {{tax_id}}
Dirección: {{address}}
Correo de contacto: {{email}}
Teléfono: {{phone}}
Registro: {{registry}}
Delegado de protección de datos: {{dpo_name}}

## Qué datos tratamos y para qué
- Cuenta de cliente: nombre, correo, teléfono, foto de perfil (opcional), datos de facturación (dirección, código postal, NIF), sesiones, packs y mensajes. Para prestarte el servicio contratado.
- Sesión de prueba: nombre, correo, teléfono, edad o fecha de nacimiento, objetivos y experiencia, y los datos de una segunda persona si la sesión es dual. Para responderte y organizar la sesión.
- Formulario de contacto: nombre, correo, teléfono (opcional) y tu mensaje. Para responderte.
- Solicitudes de pack y de cambio de horario: horarios elegidos y las notas que escribas. Para gestionar tu entrenamiento.
- Datos de salud: si eliges el objetivo «Rehabilitación / recuperación de lesión» tratamos un dato sobre tu salud. Solo lo hacemos con tu consentimiento explícito. Te pedimos que no incluyas datos de salud en los campos de texto libre si no es necesario.

## Base jurídica
- Ejecución del servicio o de las medidas precontractuales que solicitas (cuenta, sesión de prueba, packs).
- Interés legítimo en responder tus mensajes y mantener el servicio seguro.
- Obligación legal para la facturación y la conservación fiscal.
- Tu consentimiento para los datos de salud y para el contenido externo (mapas, reseñas y vídeos de terceros). Puedes retirarlo en cualquier momento.

## Con quién compartimos tus datos
Solo con el equipo del estudio y el entrenador que te asignamos. Para prestar el servicio usamos estos proveedores, que tratan datos por encargo nuestro:
- Google Workspace, Google Calendar y Gmail: correo del estudio, calendario de sesiones y envío de avisos.
- Firebase Authentication y Google Cloud: inicio de sesión y verificación del correo.
- Render: alojamiento del servidor y de la base de datos.
- Vercel: alojamiento del sitio web.
No vendemos tus datos ni los cedemos para publicidad.

## Transferencias internacionales
Algunos proveedores (Google, Render, Vercel) pueden tratar datos fuera del Espacio Económico Europeo, por ejemplo en Estados Unidos. Lo hacen con garantías adecuadas: decisión de adecuación (Marco de Privacidad de Datos UE-EE. UU.) o cláusulas contractuales tipo.
[[REVIEW: confirmar con cada proveedor el acuerdo de encargado del tratamiento y las garantías de transferencia]]

## Cuánto tiempo conservamos los datos
- Mientras seas cliente, y después durante los plazos que exigen las normas fiscales y de consumo.
- Mensajes de contacto: {{retention_contact}} días.
- Solicitudes de sesión de prueba rechazadas, canceladas o sin respuesta: {{retention_trial}} días.
- Registro de correos enviados: {{retention_email_log}} días.
- Cuando dejan de ser necesarios, los datos se eliminan.

## Tus derechos y cómo ejercerlos
Puedes pedir acceso, rectificación, supresión, limitación, portabilidad y oposición, y retirar tu consentimiento.
- Desde tu área de cliente, en «Mis datos», puedes descargar tus datos y solicitar la eliminación de tu cuenta.
- También puedes escribir a {{email}}.
Respondemos en el plazo máximo de un mes.

## Reclamaciones
Si crees que no tratamos tus datos correctamente, puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).

## Comunicaciones comerciales
No enviamos comunicaciones comerciales ni publicidad sin tu consentimiento propio y separado. Los correos que recibes se refieren a tus sesiones, packs y solicitudes.`,

    en: `## Data controller
{{holder}}
Tax ID: {{tax_id}}
Address: {{address}}
Contact e-mail: {{email}}
Phone: {{phone}}
Registry: {{registry}}
Data protection officer: {{dpo_name}}

## What data we process and why
- Client account: name, e-mail, phone, profile photo (optional), billing details (address, postal code, tax ID), sessions, packs and messages. To provide the service you contracted.
- Trial session: name, e-mail, phone, age or date of birth, goals and experience, and the details of a second person for a dual session. To answer you and organise the session.
- Contact form: name, e-mail, phone (optional) and your message. To answer you.
- Pack and schedule-change requests: the schedules you choose and the notes you write. To manage your training.
- Health data: if you choose the goal "Rehabilitation / injury recovery" we process data about your health. We only do it with your explicit consent. Please do not put health data in free text fields unless necessary.

## Legal basis
- Performance of the service or pre-contractual steps you request (account, trial session, packs).
- Legitimate interest in answering your messages and keeping the service secure.
- Legal obligation for invoicing and tax record-keeping.
- Your consent for health data and for external content (third-party maps, reviews and videos). You can withdraw it at any time.

## Who we share your data with
Only the studio team and the trainer assigned to you. To provide the service we use these providers, who process data on our behalf:
- Google Workspace, Google Calendar and Gmail: the studio's e-mail, the session calendar and sending notices.
- Firebase Authentication and Google Cloud: sign-in and e-mail verification.
- Render: hosting of the server and the database.
- Vercel: hosting of the website.
We do not sell your data or share it for advertising.

## International transfers
Some providers (Google, Render, Vercel) may process data outside the European Economic Area, for example in the United States. They do so with adequate safeguards: an adequacy decision (EU-US Data Privacy Framework) or standard contractual clauses.
[[REVIEW: confirm with each provider the data processing agreement and the transfer safeguards]]

## How long we keep the data
- While you are a client, and afterwards for the periods required by tax and consumer law.
- Contact messages: {{retention_contact}} days.
- Trial session requests that were declined, cancelled or never answered: {{retention_trial}} days.
- Log of e-mails sent: {{retention_email_log}} days.
- When they are no longer needed, the data is deleted.

## Your rights and how to use them
You can ask for access, rectification, erasure, restriction, portability and objection, and withdraw your consent.
- In your client area, under "My data", you can download your data and request the deletion of your account.
- You can also write to {{email}}.
We answer within one month at most.

## Complaints
If you think we do not process your data properly, you can complain to the Spanish Data Protection Agency (aepd.es).

## Commercial communications
We do not send commercial communications or advertising without your own, separate consent. The e-mails you receive are about your sessions, packs and requests.`,

    ca: `## Responsable del tractament
{{holder}}
NIF/CIF: {{tax_id}}
Adreça: {{address}}
Correu de contacte: {{email}}
Telèfon: {{phone}}
Registre: {{registry}}
Delegat de protecció de dades: {{dpo_name}}

## Quines dades tractem i per a què
- Compte de client: nom, correu, telèfon, foto de perfil (opcional), dades de facturació (adreça, codi postal, NIF), sessions, packs i missatges. Per prestar-te el servei contractat.
- Sessió de prova: nom, correu, telèfon, edat o data de naixement, objectius i experiència, i les dades d'una segona persona si la sessió és dual. Per respondre't i organitzar la sessió.
- Formulari de contacte: nom, correu, telèfon (opcional) i el teu missatge. Per respondre't.
- Sol·licituds de pack i de canvi d'horari: els horaris triats i les notes que escriguis. Per gestionar el teu entrenament.
- Dades de salut: si tries l'objectiu «Rehabilitació / recuperació de lesió» tractem una dada sobre la teva salut. Només ho fem amb el teu consentiment explícit. Et demanem que no incloguis dades de salut als camps de text lliure si no és necessari.

## Base jurídica
- Execució del servei o de les mesures precontractuals que sol·licites (compte, sessió de prova, packs).
- Interès legítim a respondre els teus missatges i mantenir el servei segur.
- Obligació legal per a la facturació i la conservació fiscal.
- El teu consentiment per a les dades de salut i per al contingut extern (mapes, ressenyes i vídeos de tercers). Pots retirar-lo en qualsevol moment.

## Amb qui compartim les teves dades
Només amb l'equip de l'estudi i l'entrenador que t'assignem. Per prestar el servei fem servir aquests proveïdors, que tracten dades per encàrrec nostre:
- Google Workspace, Google Calendar i Gmail: correu de l'estudi, calendari de sessions i enviament d'avisos.
- Firebase Authentication i Google Cloud: inici de sessió i verificació del correu.
- Render: allotjament del servidor i de la base de dades.
- Vercel: allotjament del lloc web.
No venem les teves dades ni les cedim per a publicitat.

## Transferències internacionals
Alguns proveïdors (Google, Render, Vercel) poden tractar dades fora de l'Espai Econòmic Europeu, per exemple als Estats Units. Ho fan amb garanties adequades: decisió d'adequació (Marc de Privacitat de Dades UE-EUA) o clàusules contractuals tipus.
[[REVIEW: confirmar amb cada proveïdor l'acord d'encarregat del tractament i les garanties de transferència]]

## Quant de temps conservem les dades
- Mentre siguis client, i després durant els terminis que exigeixen les normes fiscals i de consum.
- Missatges de contacte: {{retention_contact}} dies.
- Sol·licituds de sessió de prova rebutjades, cancel·lades o sense resposta: {{retention_trial}} dies.
- Registre de correus enviats: {{retention_email_log}} dies.
- Quan deixen de ser necessàries, les dades s'eliminen.

## Els teus drets i com exercir-los
Pots demanar accés, rectificació, supressió, limitació, portabilitat i oposició, i retirar el teu consentiment.
- Des de la teva àrea de client, a «Les meves dades», pots descarregar les teves dades i sol·licitar l'eliminació del compte.
- També pots escriure a {{email}}.
Responem en un termini màxim d'un mes.

## Reclamacions
Si creus que no tractem correctament les teves dades, pots reclamar davant l'Agència Espanyola de Protecció de Dades (aepd.es).

## Comunicacions comercials
No enviem comunicacions comercials ni publicitat sense el teu consentiment propi i separat. Els correus que reps es refereixen a les teves sessions, packs i sol·licituds.`
  },

  // ---------------------------------------------------------------------------------------------------------- legal notice
  legal: {
    es: `## Titular del sitio web
{{holder}}
NIF/CIF: {{tax_id}}
Dirección: {{address}}
Correo de contacto: {{email}}
Teléfono: {{phone}}
Registro Mercantil: {{registry}}

## Objeto
Este sitio web presenta los servicios de entrenamiento personal de {{brand}} y permite solicitar una sesión de prueba, contratar packs, gestionar tus sesiones y contactar con el estudio.

## Propiedad intelectual
Los textos, imágenes, vídeos y el diseño pertenecen a {{brand}} o se usan con permiso de sus titulares. No pueden reproducirse sin autorización escrita.
[[REVIEW: confirmar que se tienen los derechos de todas las imágenes, vídeos y textos publicados]]

## Responsabilidad
Cuidamos la exactitud de los contenidos, pero no garantizamos que estén libres de errores. Los consejos de entrenamiento son generales y no sustituyen el consejo médico: consulta con tu médico antes de empezar.

## Legislación aplicable
Legislación española. Los consumidores conservan los derechos que les reconoce la ley, incluido el de acudir a los tribunales de su domicilio.`,

    en: `## Owner of the website
{{holder}}
Tax ID: {{tax_id}}
Address: {{address}}
Contact e-mail: {{email}}
Phone: {{phone}}
Commercial registry: {{registry}}

## Purpose
This website presents the personal training services of {{brand}} and lets you request a trial session, buy packs, manage your sessions and contact the studio.

## Intellectual property
The texts, images, videos and design belong to {{brand}} or are used with permission of their owners. They may not be reproduced without written authorisation.
[[REVIEW: confirm that the rights to all published images, videos and texts are held]]

## Responsibility
We take care of the accuracy of the content, but we do not guarantee it is free of errors. Training advice is general and does not replace medical advice: consult your doctor before you start.

## Applicable law
Spanish law. Consumers keep the rights the law gives them, including going to the courts of their place of residence.`,

    ca: `## Titular del lloc web
{{holder}}
NIF/CIF: {{tax_id}}
Adreça: {{address}}
Correu de contacte: {{email}}
Telèfon: {{phone}}
Registre Mercantil: {{registry}}

## Objecte
Aquest web presenta els serveis d'entrenament personal de {{brand}} i permet sol·licitar una sessió de prova, contractar packs, gestionar les teves sessions i contactar amb l'estudi.

## Propietat intel·lectual
Els textos, imatges, vídeos i el disseny pertanyen a {{brand}} o s'utilitzen amb permís dels seus titulars. No es poden reproduir sense autorització escrita.
[[REVIEW: confirmar que es tenen els drets de totes les imatges, vídeos i textos publicats]]

## Responsabilitat
Tenim cura de l'exactitud dels continguts, però no garantim que estiguin lliures d'errors. Els consells d'entrenament són generals i no substitueixen el consell mèdic: consulta amb el teu metge abans de començar.

## Legislació aplicable
Legislació espanyola. Els consumidors conserven els drets que els reconeix la llei, inclòs el d'acudir als tribunals del seu domicili.`
  },

  // ---------------------------------------------------------------------------------------------------------- terms
  terms: {
    es: `## Quiénes somos y qué ofrecemos
{{brand}} ofrece sesiones de entrenamiento personal individuales y duales, una sesión de prueba y packs de sesiones. Datos de contacto: {{email}}.

## Uso del sitio y de tu cuenta
- Debes dar datos verdaderos y mantener tu cuenta y tu contraseña en secreto.
- Las sesiones se reservan con un entrenador, un día y una hora concretos. Los horarios y la disponibilidad pueden cambiar.
- Tienes que ser mayor de edad o contar con la autorización de tu madre, padre o tutor.
- Antes de empezar, consulta con tu médico si tienes dudas sobre tu estado de salud.

## Sesión de prueba
La sesión de prueba se solicita desde la web y queda pendiente hasta que el estudio la confirma con un entrenador. Puede tener un precio, que se muestra antes de enviar la solicitud. Solo se admite una solicitud activa por persona.

## Contratación de packs
- Eliges un pack (individual o dual), las sesiones por semana y tus horarios. El estudio revisa la solicitud y, si la aprueba, activa el pack con las fechas acordadas.
- El precio es el que se muestra en el momento de la solicitud.
[[REVIEW: indicar si los precios incluyen impuestos y la forma y el momento del pago]]
- Las sesiones se programan de lunes a viernes.

## Cambios y cancelaciones
Se rigen por la Política de cancelaciones y reembolsos.

## Responsabilidad
El entrenamiento físico tiene riesgos. Te comprometes a seguir las indicaciones del entrenador y a avisar de cualquier lesión o molestia.
[[REVIEW: revisar la cláusula de responsabilidad y el seguro de responsabilidad civil]]

## Cambios en estas condiciones
Podemos actualizar estas condiciones. Cuando cambien de forma relevante te lo indicaremos y te pediremos de nuevo la aceptación.

## Ley aplicable
Legislación española. Los consumidores conservan los derechos que les reconoce la ley.`,

    en: `## Who we are and what we offer
{{brand}} offers individual and dual personal training sessions, a trial session and packs of sessions. Contact: {{email}}.

## Using the site and your account
- You must give true details and keep your account and password secret.
- Sessions are booked with a trainer, on a specific day and time. Schedules and availability may change.
- You must be of legal age or have the permission of a parent or guardian.
- Before you start, consult your doctor if you have doubts about your state of health.

## Trial session
The trial session is requested on the website and stays pending until the studio confirms it with a trainer. It may have a price, shown before you send the request. Only one active request per person is accepted.

## Buying packs
- You choose a pack (individual or dual), the sessions per week and your schedule. The studio reviews the request and, if it approves it, activates the pack with the agreed dates.
- The price is the one shown when you make the request.
[[REVIEW: state whether prices include taxes and how and when payment is made]]
- Sessions are scheduled from Monday to Friday.

## Changes and cancellations
They follow the Cancellation and refund policy.

## Responsibility
Physical training has risks. You agree to follow the trainer's instructions and to report any injury or discomfort.
[[REVIEW: review the liability clause and the civil liability insurance]]

## Changes to these terms
We may update these terms. When they change in a relevant way we will tell you and ask you to accept again.

## Applicable law
Spanish law. Consumers keep the rights the law gives them.`,

    ca: `## Qui som i què oferim
{{brand}} ofereix sessions d'entrenament personal individuals i dobles, una sessió de prova i packs de sessions. Contacte: {{email}}.

## Ús del lloc i del teu compte
- Has de donar dades certes i mantenir en secret el teu compte i la teva contrasenya.
- Les sessions es reserven amb un entrenador, un dia i una hora concrets. Els horaris i la disponibilitat poden canviar.
- Has de ser major d'edat o tenir l'autorització de la teva mare, pare o tutor.
- Abans de començar, consulta amb el teu metge si tens dubtes sobre el teu estat de salut.

## Sessió de prova
La sessió de prova se sol·licita des del web i queda pendent fins que l'estudi la confirma amb un entrenador. Pot tenir un preu, que es mostra abans d'enviar la sol·licitud. Només s'admet una sol·licitud activa per persona.

## Contractació de packs
- Tries un pack (individual o dual), les sessions per setmana i els teus horaris. L'estudi revisa la sol·licitud i, si l'aprova, activa el pack amb les dates acordades.
- El preu és el que es mostra en el moment de la sol·licitud.
[[REVIEW: indicar si els preus inclouen impostos i la forma i el moment del pagament]]
- Les sessions es programen de dilluns a divendres.

## Canvis i cancel·lacions
Es regeixen per la Política de cancel·lacions i reemborsaments.

## Responsabilitat
L'entrenament físic té riscos. Et compromets a seguir les indicacions de l'entrenador i a avisar de qualsevol lesió o molèstia.
[[REVIEW: revisar la clàusula de responsabilitat i l'assegurança de responsabilitat civil]]

## Canvis en aquestes condicions
Podem actualitzar aquestes condicions. Quan canviïn de manera rellevant t'ho indicarem i et demanarem de nou l'acceptació.

## Llei aplicable
Legislació espanyola. Els consumidors conserven els drets que els reconeix la llei.`
  },

  // ---------------------------------------------------------------------------------------------------------- cancellations
  cancellations: {
    es: `## Cambiar el horario de una sesión
- Puedes pedir que se cambie una sesión desde «Mis sesiones», hasta 24 horas antes de su hora de inicio.
- Cada sesión se puede cambiar una sola vez.
- El cambio no es automático: el estudio debe aprobarlo y puede proponerte otra hora. Hasta que lo apruebe, la sesión sigue en su horario original.
- Las sesiones solo se programan de lunes a viernes.

## Si no puedes asistir
Si no avisas con la antelación indicada, o no te presentas, la sesión se considera realizada y se descuenta de tu pack.
[[REVIEW: confirmar esta norma y si se admiten excepciones por causa justificada]]

## Si cancela el estudio
Si el estudio o el entrenador cancelan una sesión, la reprogramamos contigo sin coste y no se descuenta de tu pack.

## Sesiones sin usar y validez de los packs
[[REVIEW: indicar el plazo de validez de cada pack y qué ocurre con las sesiones sin usar cuando termina]]

## Reembolsos
[[REVIEW: indicar en qué casos se devuelve el dinero (por ejemplo, un pack sin ninguna sesión realizada), el plazo y la forma de devolución]]
Los reembolsos se hacen por el mismo medio de pago, salvo que acordemos otra cosa.

## Derecho de desistimiento
[[REVIEW: revisar el derecho de desistimiento de 14 días en las compras a distancia (arts. 102 y ss. del Real Decreto Legislativo 1/2007) y qué ocurre cuando el servicio empieza con tu solicitud expresa durante ese plazo]]

## Cómo contactar con nosotros
Escríbenos a {{email}}.`,

    en: `## Changing the time of a session
- You can ask to change a session from "My sessions", up to 24 hours before it starts.
- Each session can be changed only once.
- The change is not automatic: the studio must approve it and may suggest another time. Until it approves it, the session stays at its original time.
- Sessions are only scheduled from Monday to Friday.

## If you cannot attend
If you do not give notice in time, or you do not show up, the session counts as done and is taken from your pack.
[[REVIEW: confirm this rule and whether exceptions are allowed for a justified reason]]

## If the studio cancels
If the studio or the trainer cancels a session, we reschedule it with you at no cost and it is not taken from your pack.

## Unused sessions and validity of packs
[[REVIEW: state the validity period of each pack and what happens to unused sessions when it ends]]

## Refunds
[[REVIEW: state in which cases money is refunded (for example a pack with no session done), the deadline and the way of refund]]
Refunds are made by the same payment method, unless we agree otherwise.

## Right of withdrawal
[[REVIEW: review the 14-day right of withdrawal for distance purchases (arts. 102 ff. of Royal Legislative Decree 1/2007) and what happens when the service starts at your express request during that period]]

## How to contact us
Write to {{email}}.`,

    ca: `## Canviar l'horari d'una sessió
- Pots demanar que es canviï una sessió des de «Les meves sessions», fins a 24 hores abans de l'hora d'inici.
- Cada sessió es pot canviar només una vegada.
- El canvi no és automàtic: l'estudi l'ha d'aprovar i et pot proposar una altra hora. Fins que l'aprovi, la sessió continua en l'horari original.
- Les sessions només es programen de dilluns a divendres.

## Si no pots assistir
Si no avises amb l'antelació indicada, o no et presentes, la sessió es considera feta i es descompta del teu pack.
[[REVIEW: confirmar aquesta norma i si s'admeten excepcions per causa justificada]]

## Si cancel·la l'estudi
Si l'estudi o l'entrenador cancel·len una sessió, la reprogramem amb tu sense cost i no es descompta del teu pack.

## Sessions sense usar i validesa dels packs
[[REVIEW: indicar el termini de validesa de cada pack i què passa amb les sessions sense usar quan acaba]]

## Reemborsaments
[[REVIEW: indicar en quins casos es retorna els diners (per exemple, un pack sense cap sessió feta), el termini i la forma de devolució]]
Els reemborsaments es fan pel mateix mitjà de pagament, tret que acordem una altra cosa.

## Dret de desistiment
[[REVIEW: revisar el dret de desistiment de 14 dies en les compres a distància (arts. 102 i ss. del Reial decret legislatiu 1/2007) i què passa quan el servei comença amb la teva sol·licitud expressa durant aquest termini]]

## Com contactar-nos
Escriu-nos a {{email}}.`
  },

  // ---------------------------------------------------------------------------------------------------------- cookies
  cookies: {
    es: `## Qué son
Una cookie es un pequeño archivo que un sitio guarda en tu navegador. Aquí hablamos también de tecnologías parecidas, como el almacenamiento local del navegador.

## Necesarias (siempre activas, no requieren consentimiento)
- Tu idioma (tb_language) y tu elección sobre cookies (tb_cookie_consent), guardadas en tu navegador.
- La sesión de tu cuenta, que gestiona Firebase Authentication (Google) cuando inicias sesión.
- Una marca temporal que evita recargar la página en bucle tras una actualización del sitio.

## Contenido externo (solo si lo aceptas)
- Mapas y reseñas de Google (Google Maps y Elfsight).
- Vídeos de YouTube, Vimeo e Instagram.
Estas empresas pueden instalar sus propias cookies y recibir tu dirección IP. Hasta que lo aceptes, no cargamos nada de ellas y verás un aviso en su lugar.

## Lo que no usamos
No usamos cookies de analítica, de publicidad ni de seguimiento. Las tipografías se sirven desde nuestro propio sitio, sin pedirlas a Google.

## Cambiar tu elección
Puedes cambiar o retirar tu elección cuando quieras con el enlace «Configurar cookies» del pie de página.`,

    en: `## What they are
A cookie is a small file a site saves in your browser. Here we also mean similar technologies, such as the browser's local storage.

## Necessary (always on, no consent needed)
- Your language (tb_language) and your cookie choice (tb_cookie_consent), saved in your browser.
- The session of your account, managed by Firebase Authentication (Google) when you sign in.
- A temporary mark that prevents reloading the page in a loop after the site is updated.

## External content (only if you accept)
- Google maps and reviews (Google Maps and Elfsight).
- YouTube, Vimeo and Instagram videos.
These companies may set their own cookies and receive your IP address. Until you accept, we load nothing from them and you see a notice instead.

## What we do not use
We do not use analytics, advertising or tracking cookies. The fonts are served from our own site, without requesting them from Google.

## Change your choice
You can change or withdraw your choice at any time with the "Cookie settings" link in the footer.`,

    ca: `## Què són
Una galeta és un petit arxiu que un lloc desa al teu navegador. Aquí parlem també de tecnologies similars, com l'emmagatzematge local del navegador.

## Necessàries (sempre actives, no requereixen consentiment)
- El teu idioma (tb_language) i la teva elecció sobre galetes (tb_cookie_consent), desades al teu navegador.
- La sessió del teu compte, que gestiona Firebase Authentication (Google) quan inicies sessió.
- Una marca temporal que evita recarregar la pàgina en bucle després d'una actualització del lloc.

## Contingut extern (només si ho acceptes)
- Mapes i ressenyes de Google (Google Maps i Elfsight).
- Vídeos de YouTube, Vimeo i Instagram.
Aquestes empreses poden instal·lar les seves pròpies galetes i rebre la teva adreça IP. Fins que no ho acceptis, no carreguem res d'elles i veuràs un avís en el seu lloc.

## El que no fem servir
No fem servir galetes d'analítica, de publicitat ni de seguiment. Les tipografies es serveixen des del nostre propi lloc, sense demanar-les a Google.

## Canviar la teva elecció
Pots canviar o retirar la teva elecció quan vulguis amb l'enllaç «Configurar galetes» del peu de pàgina.`
  }
}

export const TITLES = {
  privacy: { es: 'Política de privacidad', en: 'Privacy policy', ca: 'Política de privacitat' },
  legal: { es: 'Aviso legal', en: 'Legal notice', ca: 'Avís legal' },
  terms: { es: 'Términos y condiciones', en: 'Terms and conditions', ca: 'Termes i condicions' },
  cancellations: { es: 'Política de cancelaciones y reembolsos', en: 'Cancellation and refund policy', ca: 'Política de cancel·lacions i reemborsaments' },
  cookies: { es: 'Política de cookies', en: 'Cookie policy', ca: 'Política de galetes' }
}

export const ROUTES = { privacy: '/privacy', legal: '/legal-notice', terms: '/terms', cancellations: '/cancellations', cookies: '/cookies' }

/** The model text of a document in a language (English when the language has none). */
export const modelText = (doc, lang) => MODELS[doc]?.[lang] || MODELS[doc]?.en || ''

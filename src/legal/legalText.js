// Legal pages (privacy, cookies, legal notice) and the cookie notice, in the three languages of the site.
// DRAFT based on what the site really does. The owner must complete LEGAL below and have the texts reviewed.

export const LEGAL = {
  brand: 'ThundBalance',
  // Legal name and tax ID (NIF/CIF) of the holder: fill in. While empty they are left out of the pages.
  holder: '',
  taxId: '',
  address: 'Carrer de Pallars, 286, 08005 Barcelona (Spain)',
  email: 'pt@thundbalance.com',
  updated: '2026-11-06'
}

const holderLine = {
  en: () => [LEGAL.holder, LEGAL.taxId && `NIF/CIF ${LEGAL.taxId}`].filter(Boolean).join(' · '),
  es: () => [LEGAL.holder, LEGAL.taxId && `NIF/CIF ${LEGAL.taxId}`].filter(Boolean).join(' · '),
  ca: () => [LEGAL.holder, LEGAL.taxId && `NIF/CIF ${LEGAL.taxId}`].filter(Boolean).join(' · ')
}

const who = lang => [LEGAL.brand, holderLine[lang](), LEGAL.address, LEGAL.email].filter(Boolean).join(' · ')

export const UI = {
  en: { back: 'Back to the website', updated: 'Last updated', privacy: 'Privacy policy', cookies: 'Cookies', legal: 'Legal notice',
    notFoundTitle: 'Page not found', notFoundText: 'The page you are looking for does not exist or has moved.', home: 'Go to the home page',
    cookieTitle: 'Your privacy', cookieText: 'We only use the cookies and storage the site needs to work. Reviews, maps and videos come from other companies (Google, YouTube, Vimeo, Instagram) and only load if you accept.',
    accept: 'Accept external content', reject: 'Only essential', more: 'More information',
    consentTitle: 'External content', consentText: 'This content is provided by a third party and may use cookies. It loads only with your consent.', consentLoad: 'Accept and show' },
  es: { back: 'Volver a la web', updated: 'Última actualización', privacy: 'Política de privacidad', cookies: 'Cookies', legal: 'Aviso legal',
    notFoundTitle: 'Página no encontrada', notFoundText: 'La página que buscas no existe o ha cambiado de sitio.', home: 'Ir al inicio',
    cookieTitle: 'Tu privacidad', cookieText: 'Solo usamos las cookies y el almacenamiento necesarios para que la web funcione. Las reseñas, los mapas y los vídeos vienen de otras empresas (Google, YouTube, Vimeo, Instagram) y solo se cargan si lo aceptas.',
    accept: 'Aceptar contenido externo', reject: 'Solo lo esencial', more: 'Más información',
    consentTitle: 'Contenido externo', consentText: 'Este contenido lo ofrece un tercero y puede usar cookies. Solo se carga con tu consentimiento.', consentLoad: 'Aceptar y mostrar' },
  ca: { back: 'Tornar al web', updated: 'Darrera actualització', privacy: 'Política de privacitat', cookies: 'Galetes', legal: 'Avís legal',
    notFoundTitle: 'Pàgina no trobada', notFoundText: 'La pàgina que cerques no existeix o ha canviat de lloc.', home: 'Anar a l\'inici',
    cookieTitle: 'La teva privacitat', cookieText: 'Només fem servir les galetes i l\'emmagatzematge necessaris perquè el web funcioni. Les ressenyes, els mapes i els vídeos vénen d\'altres empreses (Google, YouTube, Vimeo, Instagram) i només es carreguen si ho acceptes.',
    accept: 'Acceptar contingut extern', reject: 'Només l\'essencial', more: 'Més informació',
    consentTitle: 'Contingut extern', consentText: 'Aquest contingut l\'ofereix un tercer i pot fer servir galetes. Només es carrega amb el teu consentiment.', consentLoad: 'Acceptar i mostrar' }
}

export const PAGES = {
  privacy: {
    en: { title: 'Privacy policy', sections: [
      { h: 'Who is responsible', p: [who('en')] },
      { h: 'What data we collect and why', p: [
        'Trial session and training requests: name, email, phone, date of birth or age, goal and experience, to answer you and organise your session.',
        'Client account: name, email, phone, billing details (when you become a client), profile photo (optional), sessions, packs and messages, to give you the service.',
        'Contact form: name, email and your message, to answer it.',
        'We use your email only for messages about your sessions, packs and requests. We do not send advertising without your consent.' ] },
      { h: 'Legal basis', p: ['The performance of the service you request (trial, pack, account), our legitimate interest in answering your messages and keeping the service secure, and your consent for external content.'] },
      { h: 'Who receives your data', p: [
        'Only the studio team and the trainer assigned to you.',
        'Providers that work for us: Google (sign-in with Firebase, Calendar, email delivery), our hosting and database providers. Sessions can appear in Google Calendar as an event where you are the only guest.',
        'We do not sell your data.' ] },
      { h: 'How long we keep it', p: ['While you are a client and, afterwards, for the period required by tax and consumer law. Requests that do not become a client are deleted when they are no longer needed.'] },
      { h: 'Your rights', p: [`You can ask for access, correction, deletion, restriction, portability or object to the processing by writing to ${LEGAL.email}. You can also complain to the Spanish Data Protection Agency (aepd.es).`] }
    ] },
    es: { title: 'Política de privacidad', sections: [
      { h: 'Responsable', p: [who('es')] },
      { h: 'Qué datos recogemos y para qué', p: [
        'Sesión de prueba y solicitudes de entrenamiento: nombre, email, teléfono, fecha de nacimiento o edad, objetivo y experiencia, para responderte y organizar tu sesión.',
        'Cuenta de cliente: nombre, email, teléfono, datos de facturación (cuando eres cliente), foto de perfil (opcional), sesiones, packs y mensajes, para prestarte el servicio.',
        'Formulario de contacto: nombre, email y tu mensaje, para responderlo.',
        'Usamos tu email solo para mensajes sobre tus sesiones, packs y solicitudes. No enviamos publicidad sin tu consentimiento.' ] },
      { h: 'Base legal', p: ['La ejecución del servicio que solicitas (prueba, pack, cuenta), nuestro interés legítimo en responder tus mensajes y mantener el servicio seguro, y tu consentimiento para el contenido externo.'] },
      { h: 'Quién recibe tus datos', p: [
        'Solo el equipo del estudio y el entrenador que te asignamos.',
        'Proveedores que trabajan para nosotros: Google (inicio de sesión con Firebase, Calendar, envío de emails) y nuestros proveedores de alojamiento y base de datos. Tus sesiones pueden aparecer en Google Calendar como un evento en el que eres el único invitado.',
        'No vendemos tus datos.' ] },
      { h: 'Cuánto tiempo los conservamos', p: ['Mientras seas cliente y, después, durante el plazo que exigen las normas fiscales y de consumo. Las solicitudes que no llegan a ser cliente se eliminan cuando dejan de ser necesarias.'] },
      { h: 'Tus derechos', p: [`Puedes solicitar acceso, rectificación, supresión, limitación, portabilidad u oponerte al tratamiento escribiendo a ${LEGAL.email}. También puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).`] }
    ] },
    ca: { title: 'Política de privacitat', sections: [
      { h: 'Responsable', p: [who('ca')] },
      { h: 'Quines dades recollim i per què', p: [
        'Sessió de prova i sol·licituds d\'entrenament: nom, correu, telèfon, data de naixement o edat, objectiu i experiència, per respondre\'t i organitzar la sessió.',
        'Compte de client: nom, correu, telèfon, dades de facturació (quan ets client), foto de perfil (opcional), sessions, packs i missatges, per donar-te el servei.',
        'Formulari de contacte: nom, correu i el teu missatge, per respondre\'l.',
        'Fem servir el teu correu només per a missatges sobre les teves sessions, packs i sol·licituds. No enviem publicitat sense el teu consentiment.' ] },
      { h: 'Base legal', p: ['L\'execució del servei que sol·licites (prova, pack, compte), el nostre interès legítim a respondre els teus missatges i mantenir el servei segur, i el teu consentiment per al contingut extern.'] },
      { h: 'Qui rep les teves dades', p: [
        'Només l\'equip de l\'estudi i l\'entrenador que t\'assignem.',
        'Proveïdors que treballen per a nosaltres: Google (inici de sessió amb Firebase, Calendar, enviament de correus) i els nostres proveïdors d\'allotjament i base de dades. Les teves sessions poden aparèixer a Google Calendar com un esdeveniment on ets l\'únic convidat.',
        'No venem les teves dades.' ] },
      { h: 'Quant de temps les conservem', p: ['Mentre siguis client i, després, durant el termini que exigeixen les normes fiscals i de consum. Les sol·licituds que no arriben a client s\'eliminen quan deixen de ser necessàries.'] },
      { h: 'Els teus drets', p: [`Pots sol·licitar accés, rectificació, supressió, limitació, portabilitat o oposar-te al tractament escrivint a ${LEGAL.email}. També pots reclamar davant l'Agència Espanyola de Protecció de Dades (aepd.es).`] }
    ] }
  },
  cookies: {
    en: { title: 'Cookies and similar technologies', sections: [
      { h: 'Essential (always active)', p: ['Language choice and your cookie choice (saved in your browser) and the sign-in session of your account (Firebase). The site cannot work without them and they do not need consent.'] },
      { h: 'External content (only if you accept)', p: [
        'Google reviews and maps (Google, Elfsight), and videos (YouTube, Vimeo, Instagram). These companies may set their own cookies and receive your IP address. Until you accept, they are not loaded and a notice is shown instead.',
        'We do not use advertising or analytics cookies.' ] },
      { h: 'Change your choice', p: ['Use the button below to delete your choice; the notice will appear again.'] }
    ] },
    es: { title: 'Cookies y tecnologías similares', sections: [
      { h: 'Esenciales (siempre activas)', p: ['La elección de idioma y de cookies (guardadas en tu navegador) y la sesión de tu cuenta (Firebase). La web no funciona sin ellas y no requieren consentimiento.'] },
      { h: 'Contenido externo (solo si lo aceptas)', p: [
        'Reseñas y mapas de Google (Google, Elfsight) y vídeos (YouTube, Vimeo, Instagram). Estas empresas pueden instalar sus propias cookies y recibir tu dirección IP. Hasta que aceptes no se cargan y se muestra un aviso en su lugar.',
        'No usamos cookies publicitarias ni de analítica.' ] },
      { h: 'Cambiar tu elección', p: ['Usa el botón de abajo para borrar tu elección; el aviso volverá a aparecer.'] }
    ] },
    ca: { title: 'Galetes i tecnologies similars', sections: [
      { h: 'Essencials (sempre actives)', p: ['L\'elecció d\'idioma i de galetes (desades al teu navegador) i la sessió del teu compte (Firebase). El web no funciona sense elles i no requereixen consentiment.'] },
      { h: 'Contingut extern (només si ho acceptes)', p: [
        'Ressenyes i mapes de Google (Google, Elfsight) i vídeos (YouTube, Vimeo, Instagram). Aquestes empreses poden instal·lar les seves galetes i rebre la teva adreça IP. Fins que no ho acceptis no es carreguen i es mostra un avís.',
        'No fem servir galetes publicitàries ni d\'analítica.' ] },
      { h: 'Canviar l\'elecció', p: ['Fes servir el botó de sota per esborrar l\'elecció; l\'avís tornarà a aparèixer.'] }
    ] }
  },
  legal: {
    en: { title: 'Legal notice', sections: [
      { h: 'Owner of the website', p: [who('en')] },
      { h: 'Purpose', p: ['This website presents the personal training services of ThundBalance and allows you to request a trial session, manage your sessions and contact the studio.'] },
      { h: 'Intellectual property', p: ['Texts, images, videos and design belong to ThundBalance or are used with permission. They cannot be reproduced without written authorisation.'] },
      { h: 'Responsibility', p: ['We take care of the accuracy of the content, but we do not guarantee it is free of errors. Training advice is general and does not replace medical advice: consult your doctor before starting.'] },
      { h: 'Applicable law', p: ['Spanish law. Any dispute is submitted to the courts of Barcelona, without prejudice to the rights of consumers.'] }
    ] },
    es: { title: 'Aviso legal', sections: [
      { h: 'Titular del sitio web', p: [who('es')] },
      { h: 'Objeto', p: ['Esta web presenta los servicios de entrenamiento personal de ThundBalance y permite solicitar una sesión de prueba, gestionar tus sesiones y contactar con el estudio.'] },
      { h: 'Propiedad intelectual', p: ['Los textos, imágenes, vídeos y el diseño pertenecen a ThundBalance o se usan con permiso. No pueden reproducirse sin autorización escrita.'] },
      { h: 'Responsabilidad', p: ['Cuidamos la exactitud de los contenidos, pero no garantizamos que estén libres de errores. Los consejos de entrenamiento son generales y no sustituyen a un consejo médico: consulta con tu médico antes de empezar.'] },
      { h: 'Legislación aplicable', p: ['Legislación española. Cualquier conflicto se somete a los juzgados de Barcelona, sin perjuicio de los derechos de los consumidores.'] }
    ] },
    ca: { title: 'Avís legal', sections: [
      { h: 'Titular del lloc web', p: [who('ca')] },
      { h: 'Objecte', p: ['Aquest web presenta els serveis d\'entrenament personal de ThundBalance i permet sol·licitar una sessió de prova, gestionar les teves sessions i contactar amb l\'estudi.'] },
      { h: 'Propietat intel·lectual', p: ['Els textos, imatges, vídeos i el disseny pertanyen a ThundBalance o s\'utilitzen amb permís. No es poden reproduir sense autorització escrita.'] },
      { h: 'Responsabilitat', p: ['Tenim cura de l\'exactitud dels continguts, però no garantim que estiguin lliures d\'errors. Els consells d\'entrenament són generals i no substitueixen un consell mèdic: consulta amb el teu metge abans de començar.'] },
      { h: 'Legislació aplicable', p: ['Legislació espanyola. Qualsevol conflicte se sotmet als jutjats de Barcelona, sense perjudici dels drets dels consumidors.'] }
    ] }
  }
}

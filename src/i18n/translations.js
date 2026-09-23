// Small, hand-rolled translation dictionary — intentionally NOT a heavy i18n
// library, since the scope here is limited to fixed interface text (menu
// labels, buttons, placeholders). Admin-authored content
// (content.sections.*, content.aboutUsPage, Training Tips video titles/
// descriptions) is NEVER looked up here — it always stays in English,
// regardless of the selected language. See I18nContext.jsx for the t()
// lookup function and its fallback chain.
export const translations = {
  en: {
    nav_about: 'About',
    nav_services: 'Services',
    nav_pricing: 'Pricing',
    nav_contact: 'Contact',
    nav_about_us: 'About Us',
    nav_home: 'Home',
    nav_dashboard: 'Dashboard',
    nav_profile: 'Profile',
    nav_sessions: 'Sessions',
    nav_login: 'Login',
    nav_register: 'Register',
    nav_my_sessions: 'My Sessions',
    nav_book_session: 'Book Session',
    nav_logout: 'Logout',
    nav_aria_open_menu: 'Open menu',
    nav_aria_close_menu: 'Close menu',

    footer_get_in_touch: 'Get In Touch',
    footer_visit_us: 'Visit Us',
    footer_contact_us: 'Contact us',
    footer_join_us: 'Join us',
    footer_whatsapp_fallback: 'WhatsApp',
    footer_tagline: 'Private fitness studio focused on personalized training and real results.',
    footer_instagram_aria: 'Follow ThundBalance on Instagram',

    contact_placeholder_name: 'Your Name',
    contact_placeholder_email: 'Your Email',
    contact_placeholder_message: 'Your Message',
    contact_button_send: 'Send Message',

    training_tips_eyebrow: 'Video Library',
    training_tips_title: 'Training Tips',
    training_tips_loading: 'Loading videos…',
    training_tips_empty: 'No videos yet — check back soon.',

    aboutus_360_heading: 'Take a Look Inside',

    language_switcher_aria: 'Change language'
  },

  es: {
    nav_about: 'Sobre',
    nav_services: 'Servicios',
    nav_pricing: 'Precios',
    nav_contact: 'Contacto',
    nav_about_us: 'Sobre nosotros',
    nav_home: 'Inicio',
    nav_dashboard: 'Panel',
    nav_profile: 'Perfil',
    nav_sessions: 'Sesiones',
    nav_login: 'Iniciar sesión',
    nav_register: 'Registrarse',
    nav_my_sessions: 'Mis sesiones',
    nav_book_session: 'Reservar sesión',
    nav_logout: 'Cerrar sesión',
    nav_aria_open_menu: 'Abrir menú',
    nav_aria_close_menu: 'Cerrar menú',

    footer_get_in_touch: 'Contáctanos',
    footer_visit_us: 'Visítanos',
    footer_contact_us: 'Contáctanos',
    footer_join_us: 'Únete a nosotros',
    footer_whatsapp_fallback: 'WhatsApp',
    footer_tagline: 'Estudio de fitness privado centrado en entrenamiento personalizado y resultados reales.',
    footer_instagram_aria: 'Sigue a ThundBalance en Instagram',

    contact_placeholder_name: 'Tu nombre',
    contact_placeholder_email: 'Tu correo electrónico',
    contact_placeholder_message: 'Tu mensaje',
    contact_button_send: 'Enviar mensaje',

    training_tips_eyebrow: 'Biblioteca de vídeos',
    training_tips_title: 'Consejos de entrenamiento',
    training_tips_loading: 'Cargando vídeos…',
    training_tips_empty: 'Aún no hay vídeos — vuelve pronto.',

    aboutus_360_heading: 'Echa un vistazo por dentro',

    language_switcher_aria: 'Cambiar idioma'
  },

  ca: {
    nav_about: 'Sobre',
    nav_services: 'Serveis',
    nav_pricing: 'Preus',
    nav_contact: 'Contacte',
    nav_about_us: 'Sobre nosaltres',
    nav_home: 'Inici',
    nav_dashboard: 'Tauler',
    nav_profile: 'Perfil',
    nav_sessions: 'Sessions',
    nav_login: 'Iniciar sessió',
    nav_register: 'Registrar-se',
    nav_my_sessions: 'Les meves sessions',
    nav_book_session: 'Reservar sessió',
    nav_logout: 'Tancar sessió',
    nav_aria_open_menu: 'Obrir menú',
    nav_aria_close_menu: 'Tancar menú',

    footer_get_in_touch: 'Contacta amb nosaltres',
    footer_visit_us: "Visita'ns",
    footer_contact_us: 'Contacta amb nosaltres',
    footer_join_us: "Uneix-te a nosaltres",
    footer_whatsapp_fallback: 'WhatsApp',
    footer_tagline: "Estudi de fitness privat centrat en l'entrenament personalitzat i resultats reals.",
    footer_instagram_aria: 'Segueix ThundBalance a Instagram',

    contact_placeholder_name: 'El teu nom',
    contact_placeholder_email: 'El teu correu electrònic',
    contact_placeholder_message: 'El teu missatge',
    contact_button_send: 'Enviar missatge',

    training_tips_eyebrow: 'Biblioteca de vídeos',
    training_tips_title: "Consells d'entrenament",
    training_tips_loading: 'Carregant vídeos…',
    training_tips_empty: 'Encara no hi ha vídeos — torna aviat.',

    aboutus_360_heading: "Fes un cop d'ull per dins",

    language_switcher_aria: 'Canviar idioma'
  }
}

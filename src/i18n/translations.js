// Small, hand-rolled translation dictionary — intentionally NOT a heavy i18n
// library, since the scope here is limited to fixed interface text (menu
// labels, buttons, placeholders). Admin-authored content
// (content.sections.*, content.aboutUsPage, Training Tips video titles/
// descriptions) is NEVER looked up here — it always stays in English,
// regardless of the selected language. See I18nContext.jsx for the t()
// lookup function and its fallback chain.
import { pageText } from './pageText'

const base = {
  en: {
    contact_eyebrow_form: "YOUR NEXT CHAPTER",
    contact_baseline: "Your goals. Our energy.",
    contact_label_name: "Name",
    contact_label_email: "Email",
    contact_label_message: "Message",
    contact_visit: "Visit our studio",
    contact_whatsapp: "Talk to us",
    contact_form_title: "Let's start a conversation.",
    contact_form_description: "Tell us about your goals or ask us a question. We'd love to hear from you.",
    contact_subject: "Contact ThundBalance",
    contact_email_note: "Opens your email app with your message ready to send.",
    contact_email_opened: "Your email app has been requested. Send your message there, or contact us using the email link.",
    contact_email_unavailable: "Please use one of the contact options to get in touch.",
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
    contact_eyebrow_form: "TU PRÓXIMA ETAPA",
    contact_baseline: "Tus objetivos. Nuestra energía.",
    contact_label_name: "Nombre",
    contact_label_email: "Correo electrónico",
    contact_label_message: "Mensaje",
    contact_visit: "Visita nuestro estudio",
    contact_whatsapp: "Habla con nosotros",
    contact_form_title: "Empecemos una conversación.",
    contact_form_description: "Cuéntanos tus objetivos o haznos una pregunta. Nos encantará saber de ti.",
    contact_subject: "Contacto ThundBalance",
    contact_email_note: "Abre tu aplicación de correo con el mensaje listo para enviar.",
    contact_email_opened: "Se ha solicitado abrir tu aplicación de correo. Envía el mensaje allí o utiliza el enlace de correo.",
    contact_email_unavailable: "Utiliza una de las opciones de contacto para hablar con nosotros.",
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
    contact_eyebrow_form: "LA TEVA PRÓXIMA ETAPA",
    contact_baseline: "Els teus objectius. La nostra energia.",
    contact_label_name: "Nom",
    contact_label_email: "Correu electrònic",
    contact_label_message: "Missatge",
    contact_visit: "Visita el nostre estudi",
    contact_whatsapp: "Parla amb nosaltres",
    contact_form_title: "Comencem una conversa.",
    contact_form_description: "Explica'ns els teus objectius o fes-nos una pregunta. Ens encantará saber de tu.",
    contact_subject: "Contacte ThundBalance",
    contact_email_note: "Obre la teva aplicació de correu amb el missatge preparat per enviar.",
    contact_email_opened: "S'ha sol·licitat obrir la teva aplicació de correu. Envia el missatge allà o utilitza l'enllaç de correu.",
    contact_email_unavailable: "Utilitza una de les opcions de contacte per parlar amb nosaltres.",
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

export const translations = {
  en: { ...base.en, ...pageText.en },
  es: { ...base.es, ...pageText.es },
  ca: { ...base.ca, ...pageText.ca }
}

// Small, hand-rolled translation dictionary — intentionally NOT a heavy i18n
// library, since the scope here is limited to fixed interface text (menu
// labels, buttons, placeholders). Admin-authored content
// (content.sections.*, content.aboutUsPage, Training Tips video titles/
// descriptions) is NEVER looked up here — it always stays in English,
// regardless of the selected language. See I18nContext.jsx for the t()
// lookup function and its fallback chain.
import { pageText } from './pageText.js'
import { trainerText } from './trainerText.js'

const base = {
  en: {
    contact_send: 'Send message',
    contact_label_name: "Name",
    contact_label_email: "Email",
    contact_label_message: "Message",
    contact_sending: "Sending your message…",
    contact_error_message: "Please write a message (at least 5 characters).",
    contact_sent: "Thank you! Your message has been sent. We will get back to you soon.",
    contact_error: "We could not send your message. Please try again in a moment.",
    nav_about: 'About',
    nav_services: 'Services',
    nav_pricing: 'Pricing',
    nav_contact: 'Contact',
    nav_home: 'Home',
    nav_dashboard: 'Dashboard',
    nav_profile: 'Profile',
    nav_sessions: 'Sessions',
    nav_my_sessions: 'My Sessions',
    bn_label: 'Client area', bn_home: 'Home', bn_sessions: 'Sessions', bn_messages: 'Messages', bn_profile: 'Profile',
    nav_logout: 'Logout',
    nav_aria_open_menu: 'Open menu',
    nav_aria_close_menu: 'Close menu',



    training_tips_eyebrow: 'Video Library',
    training_tips_title: 'Training Tips',
    training_tips_loading: 'Loading videos…',
    training_tips_empty: 'No videos yet — check back soon.',


    language_switcher_aria: 'Change language'
  },

  es: {
    contact_send: 'Enviar mensaje',
    contact_label_name: "Nombre",
    contact_label_email: "Correo electrónico",
    contact_label_message: "Mensaje",
    contact_sending: "Enviando tu mensaje…",
    contact_error_message: "Escribe un mensaje (mínimo 5 caracteres).",
    contact_sent: "¡Gracias! Tu mensaje se ha enviado. Te responderemos pronto.",
    contact_error: "No hemos podido enviar tu mensaje. Inténtalo de nuevo en un momento.",
    nav_about: 'Sobre',
    nav_services: 'Servicios',
    nav_pricing: 'Precios',
    nav_contact: 'Contacto',
    nav_home: 'Inicio',
    nav_dashboard: 'Panel',
    nav_profile: 'Perfil',
    nav_sessions: 'Sesiones',
    nav_my_sessions: 'Mis sesiones',
    bn_label: 'Área de cliente', bn_home: 'Inicio', bn_sessions: 'Sesiones', bn_messages: 'Mensajes', bn_profile: 'Perfil',
    nav_logout: 'Cerrar sesión',
    nav_aria_open_menu: 'Abrir menú',
    nav_aria_close_menu: 'Cerrar menú',



    training_tips_eyebrow: 'Biblioteca de vídeos',
    training_tips_title: 'Consejos de entrenamiento',
    training_tips_loading: 'Cargando vídeos…',
    training_tips_empty: 'Aún no hay vídeos — vuelve pronto.',


    language_switcher_aria: 'Cambiar idioma'
  },

  ca: {
    contact_send: 'Envia el missatge',
    contact_label_name: "Nom",
    contact_label_email: "Correu electrònic",
    contact_label_message: "Missatge",
    contact_sending: "Enviant el teu missatge…",
    contact_error_message: "Escriu un missatge (mínim 5 caràcters).",
    contact_sent: "Gràcies! El teu missatge s'ha enviat. Et respondrem aviat.",
    contact_error: "No hem pogut enviar el teu missatge. Torna-ho a provar d'aquí a un moment.",
    nav_about: 'Sobre',
    nav_services: 'Serveis',
    nav_pricing: 'Preus',
    nav_contact: 'Contacte',
    nav_home: 'Inici',
    nav_dashboard: 'Tauler',
    nav_profile: 'Perfil',
    nav_sessions: 'Sessions',
    nav_my_sessions: 'Les meves sessions',
    bn_label: 'Àrea de client', bn_home: 'Inici', bn_sessions: 'Sessions', bn_messages: 'Missatges', bn_profile: 'Perfil',
    nav_logout: 'Tancar sessió',
    nav_aria_open_menu: 'Obrir menú',
    nav_aria_close_menu: 'Tancar menú',



    training_tips_eyebrow: 'Biblioteca de vídeos',
    training_tips_title: "Consells d'entrenament",
    training_tips_loading: 'Carregant vídeos…',
    training_tips_empty: 'Encara no hi ha vídeos — torna aviat.',


    language_switcher_aria: 'Canviar idioma'
  }
}

export const translations = {
  en: { ...base.en, ...pageText.en, ...trainerText.en },
  es: { ...base.es, ...pageText.es, ...trainerText.es },
  ca: { ...base.ca, ...pageText.ca, ...trainerText.ca }
}

// Default landing page content. This is the single source of truth for the
// shape of the content object. It mirrors backend/landing_page_default.py so
// the public site always has something sensible to render, even before the
// backend responds (or if a field was added here but isn't in the DB yet,
// deepMerge in LandingContentContext fills the gap).

// Shared shape for every text element's companion "Style" object. All
// defaults are '' (empty string) which means "don't override the Tailwind
// value" — see buildInlineStyle() in Editable.jsx, which skips empty values.
function textStyle(overrides = {}) {
  return {
    fontSize: '',
    color: '',
    marginTop: '',
    marginBottom: '',
    marginLeft: '',
    marginRight: '',
    padding: '',
    textAlign: '',
    ...overrides
  }
}

// Shared shape for an editable image's companion "Style" object.
function imageStyle(overrides = {}) {
  return {
    marginTop: '',
    marginBottom: '',
    borderRadius: '',
    ...overrides
  }
}

// Shared shape for a video slot's stored value, used both for a section's
// video background and for any content video slot (ImageTextSection's media
// side, VideoBlockSection). 'upload' uses a file uploaded via
// /landing-page/upload-video; 'embed' uses a YouTube/Vimeo (or other) link
// converted to an iframe embed src at render time (see utils/videoEmbed.js).
function videoObject(overrides = {}) {
  return {
    sourceType: 'upload',
    url: '',
    autoplay: true,
    loop: true,
    muted: true,
    ...overrides
  }
}

// Shared shape for every section's background: solid color, image, or
// video (background.type decides which). Defaults keep every section
// visually identical to today (type: 'color', color: '' means "don't
// override the Tailwind bg-* class"; overlayOpacity defaults to 0 unless a
// section overrides it, like Hero does).
function sectionBackground(overrides = {}) {
  return {
    type: 'color',
    color: '',
    image: null,
    position: 'center',
    overlayColor: '#000000',
    overlayOpacity: 0,
    video: videoObject(),
    ...overrides
  }
}

// Shorthand for a multilingual text field: { en, es, ca }. Used only for
// real editable text (titles, body copy, button labels) — never for colors,
// URLs, image paths, emails, phone numbers or proper nouns like the brand
// name, which are the same in every language. Resolved at render time via
// resolveText() (src/utils/multilingual.js), which also gracefully treats
// a plain string as "same text in every language" for any field not yet
// converted to this shape (e.g. new blank sections the admin adds).
function ml(en, es, ca) {
  return { en, es, ca }
}

export const defaultContent = {
  theme: {
    colors: {
      primary: '#ffffff',
      secondary: '#000000',
      background: '#000000',
      text: '#ffffff',
      accent: '#22c55e',
      buttonBg: 'transparent',
      buttonText: '#ffffff',
      border: 'rgba(255,255,255,0.15)'
    },
    typography: {
      headingFont: 'Aldrich',
      bodyFont: 'Inter',
      accentFont: 'Roboto',
      buttonSize: '0.875rem'
    }
  },

  // Order in which the dynamic MIDDLE sections render, between the fixed
  // Hero and Footer. Hero, Navbar and Footer are NOT part of this list —
  // they're structural, always-present, and rendered directly by
  // LandingSections.jsx / the page layout, outside this system entirely.
  // Every ID in this list is a key inside `sections` below, and that
  // section object has a `type` field saying which template it uses.
  sectionOrder: ['about', 'services', 'pricing', 'testimonials', 'contact'],

  sections: {
    navbar: {
      visible: true,
      brand: 'THUNDBALANCE',
      brandStyle: textStyle(),
      logoImage: null,
      showBrandText: true,
      background: sectionBackground()
    },

    hero: {
      visible: true,
      eyebrow: ml('Private Fitness Studio', 'Estudio de Fitness Privado', 'Estudi de Fitness Privat'),
      eyebrowStyle: textStyle(),
      title: ml('Transform Your Body And Performance', 'Transforma Tu Cuerpo Y Rendimiento', 'Transforma El Teu Cos I Rendiment'),
      titleStyle: textStyle({
        fontWeight: '700',
        letterSpacing: '',
        lineHeight: '',
        textAlign: 'center'
      }),
      subtitle: ml(
        'Personalized 1:1 training sessions focused on performance, health, rehabilitation and real results.',
        'Sesiones de entrenamiento personalizado 1 a 1 centradas en el rendimiento, la salud, la rehabilitación y resultados reales.',
        "Sessions d'entrenament personalitzat 1 a 1 centrades en el rendiment, la salut, la rehabilitació i resultats reals."
      ),
      subtitleStyle: textStyle(),
      button: {
        text: ml('BOOK A TRIAL SESSION', 'RESERVA UNA SESIÓN DE PRUEBA', 'RESERVA UNA SESSIÓ DE PROVA'),
        link: '/trial-session',
        bgColor: 'transparent',
        textColor: '#ffffff',
        borderColor: '#ffffff',
        radius: '0px'
      },
      background: sectionBackground({ overlayOpacity: 0.6 })
    },

    // The 5 sections below use fixed, human-readable keys as their "ID" —
    // that's perfectly valid (an ID just needs to be unique), it's simply
    // the built-in ones happen to be readable instead of generated. Any
    // NEW section the admin adds gets a real generated ID (see
    // generateSectionId below) and lives alongside these under the same
    // `sections` object.

    about: {
      type: 'about',
      visible: true,
      eyebrow: ml('About Us', 'Sobre Nosotros', 'Sobre Nosaltres'),
      eyebrowStyle: textStyle(),
      title: ml('Private Training Focused On Real Results', 'Entrenamiento Privado Centrado En Resultados Reales', 'Entrenament Privat Centrat En Resultats Reals'),
      titleStyle: textStyle(),
      body: ml(
        'ThundBalance is a private fitness studio focused on personalized 1:1 and dual training sessions. Every client receives individual support, training plans, nutritional guidance and body metrics monitoring in an exclusive and professional environment.',
        'ThundBalance es un estudio de fitness privado centrado en sesiones de entrenamiento personalizado 1 a 1 y en pareja. Cada cliente recibe apoyo individual, planes de entrenamiento, orientación nutricional y seguimiento de métricas corporales en un entorno exclusivo y profesional.',
        "ThundBalance és un estudi de fitness privat centrat en sessions d'entrenament personalitzat 1 a 1 i en parella. Cada client rep suport individual, plans d'entrenament, orientació nutricional i seguiment de mètriques corporals en un entorn exclusiu i professional."
      ),
      bodyStyle: textStyle(),
      image: null,
      imageStyle: imageStyle(),
      // 360° photo sphere embed, built from the exact coordinates/heading/
      // tilt in the admin's own Google Maps share link for this specific
      // 360° photo (not a generic geocoded guess) — see PropertiesPanel for
      // how to replace it if it doesn't show the right photo.
      embed360Url: 'https://www.google.com/maps?layer=c&cbll=41.404704,2.2027016&cbp=12,255.85,0,0,-38.06&output=svembed',
      // Migrated from the old standalone /about-us page (now removed) —
      // same structure ImageCarousel already expects: [{ image, caption }].
      carousel: [],
      background: sectionBackground({ color: '#ffffff' }),
      textColor: '#000000'
    },

    services: {
      type: 'services',
      visible: true,
      eyebrow: ml('Services', 'Servicios', 'Serveis'),
      eyebrowStyle: textStyle(),
      title: ml('Personalized Training Experience', 'Experiencia De Entrenamiento Personalizado', "Experiència D'Entrenament Personalitzat"),
      titleStyle: textStyle(),
      background: sectionBackground(),
      items: [
        {
          title: ml('1:1 Training', 'Entrenamiento 1 a 1', 'Entrenament 1 a 1'),
          titleStyle: textStyle(),
          description: ml(
            'Individual sessions fully focused on your goals, performance and physical condition.',
            'Sesiones individuales totalmente centradas en tus objetivos, rendimiento y condición física.',
            'Sessions individuals totalment centrades en els teus objectius, rendiment i condició física.'
          ),
          descriptionStyle: textStyle(),
          image: null,
          imageStyle: imageStyle()
        },
        {
          title: ml('Dual Sessions', 'Sesiones En Pareja', 'Sessions En Parella'),
          titleStyle: textStyle(),
          description: ml(
            'Train together with a partner while maintaining personalized coaching and guidance.',
            'Entrena junto a un compañero manteniendo un coaching y una orientación personalizados.',
            'Entrena juntament amb un company mantenint un coaching i una orientació personalitzats.'
          ),
          descriptionStyle: textStyle(),
          image: null,
          imageStyle: imageStyle()
        },
        {
          title: ml('Nutrition & Metrics', 'Nutrición Y Métricas', 'Nutrició I Mètriques'),
          titleStyle: textStyle(),
          description: ml(
            'Training plans, nutritional guidance and body metrics tracking included in every program.',
            'Planes de entrenamiento, orientación nutricional y seguimiento de métricas corporales incluidos en cada programa.',
            "Plans d'entrenament, orientació nutricional i seguiment de mètriques corporals inclosos a cada programa."
          ),
          descriptionStyle: textStyle(),
          image: null,
          imageStyle: imageStyle()
        }
      ]
    },

    pricing: {
      type: 'pricing',
      visible: true,
      eyebrow: ml('Pricing', 'Precios', 'Preus'),
      eyebrowStyle: textStyle(),
      title: ml('Training Packages', 'Paquetes De Entrenamiento', "Paquets D'Entrenament"),
      titleStyle: textStyle(),
      background: sectionBackground(),
      plans: [
        {
          name: ml('Monthly Plan', 'Plan Mensual', 'Pla Mensual'),
          nameStyle: textStyle(),
          price: '€65',
          priceStyle: textStyle(),
          period: ml('/session', '/sesión', '/sessió'),
          periodStyle: textStyle(),
          description: ml(
            'Includes 1 to 5 training sessions per week with full coaching support.',
            'Incluye de 1 a 5 sesiones de entrenamiento por semana con apoyo completo de coaching.',
            "Inclou d'1 a 5 sessions d'entrenament per setmana amb suport complet de coaching."
          ),
          descriptionStyle: textStyle(),
          features: [
            ml('1-5 sessions per week', 'De 1 a 5 sesiones por semana', "D'1 a 5 sessions per setmana"),
            ml('Personal Training', 'Entrenamiento Personal', 'Entrenament Personal'),
            ml('Flexible Scheduling', 'Horario Flexible', 'Horari Flexible')
          ],
          buttonText: ml('Get Started', 'Empezar', 'Començar'),
          buttonTextStyle: textStyle(),
          highlighted: false
        },
        {
          name: ml('Quarterly Plan', 'Plan Trimestral', 'Pla Trimestral'),
          nameStyle: textStyle(),
          price: '€60',
          priceStyle: textStyle(),
          period: ml('/session', '/sesión', '/sessió'),
          periodStyle: textStyle(),
          description: ml(
            'Designed for long-term progress with training and nutrition follow-up.',
            'Diseñado para un progreso a largo plazo con seguimiento de entrenamiento y nutrición.',
            "Dissenyat per a un progrés a llarg termini amb seguiment d'entrenament i nutrició."
          ),
          descriptionStyle: textStyle(),
          features: [
            ml('1-5 sessions per week', 'De 1 a 5 sesiones por semana', "D'1 a 5 sessions per setmana"),
            ml('1 Body Metrics Assessment', '1 Evaluación de Métricas Corporales', '1 Avaluació de Mètriques Corporals'),
            ml('3 Training Plan Reviews', '3 Revisiones del Plan de Entrenamiento', "3 Revisions del Pla d'Entrenament"),
            ml('3 Nutrition Plan Reviews', '3 Revisiones del Plan de Nutrición', '3 Revisions del Pla de Nutrició')
          ],
          buttonText: ml('Most Popular', 'Más Popular', 'Més Popular'),
          buttonTextStyle: textStyle(),
          highlighted: true
        },
        {
          name: ml('Semiannual Plan', 'Plan Semestral', 'Pla Semestral'),
          nameStyle: textStyle(),
          price: '€55',
          priceStyle: textStyle(),
          period: ml('/session', '/sesión', '/sessió'),
          periodStyle: textStyle(),
          description: ml(
            'The most complete package for maximum results and continuous monitoring.',
            'El paquete más completo para obtener el máximo resultado y un seguimiento continuo.',
            'El paquet més complet per obtenir el màxim resultat i un seguiment continu.'
          ),
          descriptionStyle: textStyle(),
          features: [
            ml('1-5 sessions per week', 'De 1 a 5 sesiones por semana', "D'1 a 5 sessions per setmana"),
            ml('2 Body Metrics Assessments', '2 Evaluaciones de Métricas Corporales', '2 Avaluacions de Mètriques Corporals'),
            ml('6 Training Plan Reviews', '6 Revisiones del Plan de Entrenamiento', "6 Revisions del Pla d'Entrenament"),
            ml('6 Nutrition Plan Reviews', '6 Revisiones del Plan de Nutrición', '6 Revisions del Pla de Nutrició'),
            ml('1 Personal Consultation', '1 Consulta Personal', '1 Consulta Personal')
          ],
          buttonText: ml('Best Value', 'Mejor Valor', 'Millor Valor'),
          buttonTextStyle: textStyle(),
          highlighted: false
        }
      ]
    },

    testimonials: {
      type: 'testimonials',
      visible: true,
      eyebrow: ml('Testimonials', 'Testimonios', 'Testimonis'),
      eyebrowStyle: textStyle(),
      title: ml('Real Experiences', 'Experiencias Reales', 'Experiències Reals'),
      titleStyle: textStyle(),
      background: sectionBackground(),
      // Optional admin-curated client photos/videos, shown as a grid below
      // the Elfsight reviews widget. Empty by default — see Testimonials.jsx,
      // which hides the grid entirely when this is empty.
      media: []
    },

    contact: {
      type: 'contact',
      visible: true,
      eyebrow: ml('Contact', 'Contacto', 'Contacte'),
      eyebrowStyle: textStyle(),
      title: ml('Start Your Transformation', 'Comienza Tu Transformación', 'Comença La Teva Transformació'),
      titleStyle: textStyle(),
      body: ml(
        'Book your first session and discover a personalized training experience focused on real results.',
        'Reserva tu primera sesión y descubre una experiencia de entrenamiento personalizado centrada en resultados reales.',
        "Reserva la teva primera sessió i descobreix una experiència d'entrenament personalitzat centrada en resultats reals."
      ),
      bodyStyle: textStyle(),
      image: null,
      imageStyle: imageStyle(),
      background: sectionBackground()
    },

    footer: {
      visible: true,
      brand: 'THUNDBALANCE',
      brandStyle: textStyle(),
      text: ml(
        '© 2026 ThundBalance. All rights reserved.',
        '© 2026 ThundBalance. Todos los derechos reservados.',
        '© 2026 ThundBalance. Tots els drets reservats.'
      ),
      textStyle: textStyle(),
      logoImage: null,
      showBrandText: true,
      background: sectionBackground(),

      // Address, map/360 embeds and contact links — all plain fields edited
      // only via PropertiesPanel (not click-to-select in the canvas, since
      // there's no sensible way to "click to edit" a Google iframe).
      address: {
        text: ml(
          'Carrer de Pallars, 286, Sant Martí, 08005 Barcelona, Spain',
          'Carrer de Pallars, 286, Sant Martí, 08005 Barcelona, España',
          'Carrer de Pallars, 286, Sant Martí, 08005 Barcelona, Espanya'
        ),
        mapsLink: 'https://www.google.com/maps/place//data=!4m2!3m1!1s0x12a4a385af63a49b:0x841dd304c428a382?sa=X&ved=1t:8290&ictx=111'
      },
      // Text-query embed — works with no API key, Google resolves the
      // address server-side. See PropertiesPanel for how the admin can
      // replace this with a "Share > Embed a map" iframe src instead.
      mapEmbedUrl: 'https://www.google.com/maps?q=Carrer+de+Pallars+286+Barcelona&output=embed',
      // Empty by default on purpose — see README/Footer section for why an
      // automatic Street View embed wasn't used here (real risk of showing
      // the generic street view instead of the gym's own 360° photo). The
      // admin pastes the "Share or embed image" iframe src from Google
      // Maps once they've picked the right photo.
      streetView360EmbedUrl: '',
      contactUsUrl: 'https://www.thundbalance.com/contactus',
      joinUsEmail: 'mailto:info@thundbalance.com?subject=I%20am%20interested%20to%20join%20TB%20team',
      contactEmail: 'info@thundbalance.com',
      whatsappNumber: '+34 617 21 33 60',
      whatsappLink: 'https://wa.me/+34617213360',
      instagramUrl: 'https://www.instagram.com/thundbalance'
    }
  }
}

// --- Dynamic section instances ----------------------------------------------

// Generates a unique ID for a new section instance. Doesn't need to be
// cryptographically strong — just unique within one admin's editing session
// (collisions across different admins/sessions are astronomically unlikely
// given the timestamp + random suffix, and IDs are never chosen by a user).
let sectionIdCounter = 0
export function generateSectionId() {
  sectionIdCounter += 1
  return `section_${Date.now().toString(36)}${sectionIdCounter}_${Math.random().toString(36).slice(2, 8)}`
}

// Factories (NOT plain objects!) for each addable section type's starter
// content — must be functions so every new instance gets its own fresh
// objects/arrays, never sharing references with another instance or with
// defaultContent.sections above. Used both when the admin clicks "+ Add
// Section" and when migrating pre-Phase-2 content (see migrateContent.js),
// where they're deep-merged under existing content to backfill any newer
// field an old save doesn't have yet.
export const SECTION_TYPE_DEFAULTS = {
  about: () => ({
    type: 'about',
    visible: true,
    eyebrow: 'Eyebrow',
    eyebrowStyle: textStyle(),
    title: 'New Section Title',
    titleStyle: textStyle(),
    body: 'Edit this text...',
    bodyStyle: textStyle(),
    image: null,
    imageStyle: imageStyle(),
    embed360Url: '',
    carousel: [],
    background: sectionBackground(),
    textColor: '#000000'
  }),

  services: () => ({
    type: 'services',
    visible: true,
    eyebrow: 'Eyebrow',
    eyebrowStyle: textStyle(),
    title: 'New Section Title',
    titleStyle: textStyle(),
    background: sectionBackground(),
    items: [makeDefaultServiceItem(), makeDefaultServiceItem(), makeDefaultServiceItem()]
  }),

  pricing: () => ({
    type: 'pricing',
    visible: true,
    eyebrow: 'Eyebrow',
    eyebrowStyle: textStyle(),
    title: 'New Section Title',
    titleStyle: textStyle(),
    background: sectionBackground(),
    plans: [makeDefaultPricingPlan(), makeDefaultPricingPlan(), makeDefaultPricingPlan()]
  }),

  testimonials: () => ({
    type: 'testimonials',
    visible: true,
    eyebrow: 'Eyebrow',
    eyebrowStyle: textStyle(),
    title: 'New Section Title',
    titleStyle: textStyle(),
    background: sectionBackground(),
    media: []
  }),

  contact: () => ({
    type: 'contact',
    visible: true,
    eyebrow: 'Eyebrow',
    eyebrowStyle: textStyle(),
    title: 'New Section Title',
    titleStyle: textStyle(),
    body: 'Edit this text...',
    bodyStyle: textStyle(),
    image: null,
    imageStyle: imageStyle(),
    background: sectionBackground()
  }),

  textBlock: () => ({
    type: 'textBlock',
    visible: true,
    eyebrow: 'Eyebrow',
    eyebrowStyle: textStyle(),
    title: 'New Section Title',
    titleStyle: textStyle(),
    body: 'Edit this text...',
    bodyStyle: textStyle(),
    background: sectionBackground()
  }),

  imageText: () => ({
    type: 'imageText',
    visible: true,
    eyebrow: 'Eyebrow',
    eyebrowStyle: textStyle(),
    title: 'New Section Title',
    titleStyle: textStyle(),
    body: 'Edit this text...',
    bodyStyle: textStyle(),
    mediaType: 'image',
    image: null,
    imageStyle: imageStyle(),
    video: videoObject(),
    imagePosition: 'left',
    background: sectionBackground()
  }),

  videoBlock: () => ({
    type: 'videoBlock',
    visible: true,
    eyebrow: 'Eyebrow',
    eyebrowStyle: textStyle(),
    title: 'New Section Title',
    titleStyle: textStyle(),
    textPosition: 'above',
    video: videoObject(),
    background: sectionBackground()
  })
}

// Friendly name + one-line description for each addable type, shown in the
// "+ Add Section" template picker and used as the fallback label for a
// dynamic section's sidebar entry / edit overlay.
export const SECTION_TYPE_INFO = {
  about: {
    label: 'About',
    description: 'Two-column intro: eyebrow, title and body text.'
  },
  services: {
    label: 'Services',
    description: 'Grid of cards with image, title and description.'
  },
  pricing: {
    label: 'Pricing',
    description: 'Grid of pricing plans with features and a CTA button.'
  },
  testimonials: {
    label: 'Testimonials',
    description: 'Eyebrow and title, with the testimonials widget below.'
  },
  contact: {
    label: 'Contact',
    description: 'Centered heading and text, with a contact form.'
  },
  textBlock: {
    label: 'Text Block',
    description: 'Simple centered eyebrow, title and body text.'
  },
  imageText: {
    label: 'Image + Text',
    description: 'Image on one side, eyebrow/title/text on the other.'
  },
  videoBlock: {
    label: 'Video Block',
    description: 'Full-width video with an optional eyebrow/title above or below it.'
  }
}

// Template used when the admin adds a new Service card from the editor, kept
// here (not just inline in PropertiesPanel) so it always matches the shape
// above, including the *Style companion objects.
export function makeDefaultServiceItem() {
  return {
    title: 'New Service',
    titleStyle: textStyle(),
    description: 'Describe this service.',
    descriptionStyle: textStyle(),
    image: null,
    imageStyle: imageStyle()
  }
}

// Template used when the admin adds a new Pricing plan from the editor.
export function makeDefaultPricingPlan() {
  return {
    name: 'New Plan',
    nameStyle: textStyle(),
    price: '€0',
    priceStyle: textStyle(),
    period: ml('/session', '/sesión', '/sessió'),
    periodStyle: textStyle(),
    description: 'Describe this plan.',
    descriptionStyle: textStyle(),
    features: ['Feature one'].map((f) => ml(f, 'Característica uno', 'Característica u')),
    buttonText: 'Get Started',
    buttonTextStyle: textStyle(),
    highlighted: false
  }
}

// Template used when the admin adds a new Testimonials media item
// (client photo or video) from the editor.
export function makeDefaultTestimonialMedia(type = 'image') {
  return {
    type,
    url: '',
    videoSourceType: type === 'video' ? 'upload' : '',
    clientName: '',
    caption: ''
  }
}

// Human-friendly labels for the FIXED sections only (navbar/hero/footer).
// Dynamic sections (in sectionOrder) get their label from SECTION_TYPE_INFO
// based on their `type` instead — see EditorSidebar.jsx / Editable.jsx.
export const SECTION_LABELS = {
  navbar: 'Navbar',
  hero: 'Hero',
  footer: 'Footer'
}

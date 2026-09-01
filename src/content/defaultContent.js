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
      headingFont: 'Bebas Neue',
      bodyFont: 'inherit',
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
      eyebrow: 'Private Fitness Studio',
      eyebrowStyle: textStyle(),
      title: 'Transform Your Body And Performance',
      titleStyle: textStyle({
        fontWeight: '700',
        letterSpacing: '',
        lineHeight: '',
        textAlign: 'center'
      }),
      subtitle: 'Personalized 1:1 training sessions focused on performance, health, rehabilitation and real results.',
      subtitleStyle: textStyle(),
      button: {
        text: 'BOOK A TRIAL SESSION',
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
      eyebrow: 'About Us',
      eyebrowStyle: textStyle(),
      title: 'Private Training Focused On Real Results',
      titleStyle: textStyle(),
      body: 'ThundBalance is a private fitness studio focused on personalized 1:1 and dual training sessions. Every client receives individual support, training plans, nutritional guidance and body metrics monitoring in an exclusive and professional environment.',
      bodyStyle: textStyle(),
      image: null,
      imageStyle: imageStyle(),
      background: sectionBackground({ color: '#ffffff' }),
      textColor: '#000000'
    },

    services: {
      type: 'services',
      visible: true,
      eyebrow: 'Services',
      eyebrowStyle: textStyle(),
      title: 'Personalized Training Experience',
      titleStyle: textStyle(),
      background: sectionBackground(),
      items: [
        {
          title: '1:1 Training',
          titleStyle: textStyle(),
          description: 'Individual sessions fully focused on your goals, performance and physical condition.',
          descriptionStyle: textStyle(),
          image: null,
          imageStyle: imageStyle()
        },
        {
          title: 'Dual Sessions',
          titleStyle: textStyle(),
          description: 'Train together with a partner while maintaining personalized coaching and guidance.',
          descriptionStyle: textStyle(),
          image: null,
          imageStyle: imageStyle()
        },
        {
          title: 'Nutrition & Metrics',
          titleStyle: textStyle(),
          description: 'Training plans, nutritional guidance and body metrics tracking included in every program.',
          descriptionStyle: textStyle(),
          image: null,
          imageStyle: imageStyle()
        }
      ]
    },

    pricing: {
      type: 'pricing',
      visible: true,
      eyebrow: 'Pricing',
      eyebrowStyle: textStyle(),
      title: 'Training Packages',
      titleStyle: textStyle(),
      background: sectionBackground(),
      plans: [
        {
          name: 'Monthly Plan',
          nameStyle: textStyle(),
          price: '€65',
          priceStyle: textStyle(),
          period: '/session',
          periodStyle: textStyle(),
          description: 'Includes 1 to 5 training sessions per week with full coaching support.',
          descriptionStyle: textStyle(),
          features: ['1-5 sessions per week', 'Personal Training', 'Flexible Scheduling'],
          buttonText: 'Get Started',
          buttonTextStyle: textStyle(),
          highlighted: false
        },
        {
          name: 'Quarterly Plan',
          nameStyle: textStyle(),
          price: '€60',
          priceStyle: textStyle(),
          period: '/session',
          periodStyle: textStyle(),
          description: 'Designed for long-term progress with training and nutrition follow-up.',
          descriptionStyle: textStyle(),
          features: [
            '1-5 sessions per week',
            '1 Body Metrics Assessment',
            '3 Training Plan Reviews',
            '3 Nutrition Plan Reviews'
          ],
          buttonText: 'Most Popular',
          buttonTextStyle: textStyle(),
          highlighted: true
        },
        {
          name: 'Semiannual Plan',
          nameStyle: textStyle(),
          price: '€55',
          priceStyle: textStyle(),
          period: '/session',
          periodStyle: textStyle(),
          description: 'The most complete package for maximum results and continuous monitoring.',
          descriptionStyle: textStyle(),
          features: [
            '1-5 sessions per week',
            '2 Body Metrics Assessments',
            '6 Training Plan Reviews',
            '6 Nutrition Plan Reviews',
            '1 Personal Consultation'
          ],
          buttonText: 'Best Value',
          buttonTextStyle: textStyle(),
          highlighted: false
        }
      ]
    },

    testimonials: {
      type: 'testimonials',
      visible: true,
      eyebrow: 'Testimonials',
      eyebrowStyle: textStyle(),
      title: 'Real Experiences',
      titleStyle: textStyle(),
      background: sectionBackground()
    },

    contact: {
      type: 'contact',
      visible: true,
      eyebrow: 'Contact',
      eyebrowStyle: textStyle(),
      title: 'Start Your Transformation',
      titleStyle: textStyle(),
      body: 'Book your first session and discover a personalized training experience focused on real results.',
      bodyStyle: textStyle(),
      image: null,
      imageStyle: imageStyle(),
      background: sectionBackground()
    },

    footer: {
      visible: true,
      brand: 'THUNDBALANCE',
      brandStyle: textStyle(),
      text: '© 2026 ThundBalance. All rights reserved.',
      textStyle: textStyle(),
      logoImage: null,
      showBrandText: true,
      background: sectionBackground()
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
    background: sectionBackground()
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
    period: '/session',
    periodStyle: textStyle(),
    description: 'Describe this plan.',
    descriptionStyle: textStyle(),
    features: ['Feature one'],
    buttonText: 'Get Started',
    buttonTextStyle: textStyle(),
    highlighted: false
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

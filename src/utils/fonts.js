// Friendly labels retain the agreed aliases while using licensed Google Fonts.
// General Sans -> Inter and Cabinet Grotesk -> Space Grotesk keep this
// dependency-free and avoid relying on an unofficial Fontshare CDN.
export const FONT_OPTIONS = [
  'Aldrich', 'Helvetica Neue', 'Aktiv Grotesk', 'Inter', 'Roboto', 'Montserrat',
  'Poppins', 'Open Sans', 'Lato', 'Bebas Neue', 'Oswald', 'Space Grotesk',
  'Outfit', 'Sora', 'Manrope', 'DM Sans', 'Barlow', 'Archivo', 'Urbanist',
  'Work Sans', 'IBM Plex Sans', 'League Spartan', 'Plus Jakarta Sans', 'Anton',
  'Playfair Display', 'Cormorant Garamond', 'Merriweather', 'Raleway', 'Exo 2',
  'Geist', 'General Sans', 'Cabinet Grotesk'
]

const FONT_ALIASES = {
  'Helvetica Neue': 'Inter',
  'Aktiv Grotesk': 'Roboto',
  'General Sans': 'Inter',
  'Cabinet Grotesk': 'Space Grotesk'
}
const injectedFonts = new Map()

export function actualFontFamily(label) {
  return FONT_ALIASES[label] || label
}

// Menu text. The stored value stays the original name (existing content uses
// it), but the menu says which font is really rendered so nobody picks
// "Helvetica Neue" expecting the licensed typeface.
export function fontLabel(font) {
  return FONT_ALIASES[font] ? `${font} (renders as ${FONT_ALIASES[font]})` : font
}

export function loadFont(label) {
  if (!label || typeof document === 'undefined') return Promise.resolve()
  const family = actualFontFamily(label)
  if (injectedFonts.has(family)) return injectedFonts.get(family)
  const encodedFamily = encodeURIComponent(family).replace(/%20/g, '+')
  const existing = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .find(link => link.href.includes('fonts.googleapis.com/css2') && link.href.includes(`family=${encodedFamily}`))
  if (existing) {
    const ready = Promise.resolve()
    injectedFonts.set(family, ready)
    return ready
  }

  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${encodedFamily}&display=swap`
  link.dataset.googleFont = family
  const ready = new Promise(resolve => {
    link.addEventListener('load', () => {
      if (document.fonts?.load) document.fonts.load(`16px "${family}"`).then(resolve, resolve)
      else resolve()
    }, { once: true })
    link.addEventListener('error', () => resolve(), { once: true })
  })
  injectedFonts.set(family, ready)
  document.head.appendChild(link)
  return ready
}

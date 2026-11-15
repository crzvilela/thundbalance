// Friendly labels retain the agreed aliases while using open-licence fonts (served from our own files).
// General Sans -> Inter and Cabinet Grotesk -> Space Grotesk keep this
// dependency-free and avoid relying on an external CDN.
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

// The fonts are our own files (src/fonts.css, made by scripts/gen-fonts-css.mjs from the @fontsource packages): nothing is requested from
// Google Fonts. This only asks the browser to have the font ready, and it downloads the file the first time a text uses it.
export function loadFont(label) {
  if (!label || typeof document === 'undefined') return Promise.resolve()
  const family = actualFontFamily(label)
  if (injectedFonts.has(family)) return injectedFonts.get(family)
  const ready = document.fonts?.load ? document.fonts.load(`16px "${family}"`).then(() => undefined, () => undefined) : Promise.resolve()
  injectedFonts.set(family, ready)
  return ready
}

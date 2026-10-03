import { actualFontFamily } from './fonts.js'

export const TYPOGRAPHY_DEFAULTS = {
  fontFamily: '', fontSize: {}, fontWeight: '', letterSpacing: '', lineHeight: '',
  textTransform: '', textAlign: '', color: '', opacity: 1
}

const HEADING_PATH = /(^|\.)(title|heading|name|brand|price)(\.|$)/i
const ACCENT_PATH = /(^|\.)(eyebrow|buttonText|period|label)(\.|$)|(^|\.)button\.text(\.|$)|sections\.navbar\.labels\./i

export function getEffectiveTypography(content, path, tagName = '') {
  const key = String(path || '')
  const global = content?.theme?.typography || {}
  const roleFont = HEADING_PATH.test(key) || /^h[1-6]$/i.test(tagName)
    ? global.headingFont
    : ACCENT_PATH.test(key) ? global.accentFont : global.bodyFont
  const stored = content?.typography?.[key] || {}
  const effective = {
    ...TYPOGRAPHY_DEFAULTS,
    ...stored,
    fontFamily: stored.fontFamily || roleFont || '',
    fontSize: { ...(TYPOGRAPHY_DEFAULTS.fontSize || {}), ...(stored.fontSize || {}) }
  }
  effective.actualFontFamily = actualFontFamily(effective.fontFamily)
  return effective
}

export function cssFontSizeVariables(sizes = {}) {
  const vars = {}
  for (const device of ['desktop', 'tablet', 'mobile']) {
    if (sizes[device]) vars[`--editable-font-size-${device}`] = sizes[device]
  }
  return vars
}

export function migrateLegacyTypography(content) {
  const typography = { ...(content.typography || {}) }
  const styleProperties = ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'textTransform', 'textAlign', 'color', 'opacity']
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}.${index}`))
      return
    }
    for (const [key, value] of Object.entries(node)) {
      if (key.endsWith('Style') && value && typeof value === 'object') {
        const textKey = key.slice(0, -5)
        const textPath = `${path}.${textKey}`
        const transferred = {}
        for (const property of styleProperties) {
          if (value[property] !== undefined && value[property] !== '') {
            // These values were part of the old built-in Hero defaults and
            // already match its Tailwind classes, so they are not overrides.
            if (textPath === 'sections.hero.title' && ((property === 'fontWeight' && value[property] === '700') || (property === 'textAlign' && value[property] === 'center'))) continue
            if (property === 'fontSize') transferred.fontSize = { desktop: value[property] }
            else transferred[property] = value[property]
          }
        }
        if (Object.keys(transferred).length) typography[textPath] = { ...transferred, ...(typography[textPath] || {}) }
        // Keep only legacy layout values here; typography is now centralized.
        for (const property of styleProperties) {
          if (property in value) value[property] = ''
        }
      }
      walk(value, `${path}.${key}`)
    }
  }
  walk(content.sections || {}, 'sections')
  return { ...content, typography }
}

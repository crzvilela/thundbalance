export const DEFAULT_FOOTER_SETTINGS = {
  layoutPreset: 'logo-contact-maps',
  order: ['brand', 'contacts', 'maps', 'navigation', 'social', 'copyright'],
  blocks: {
    brand: { visible: true, align: 'left', width: 'small', maxWidth: 220, gap: 12, padding: 0, margin: 0, verticalAlign: 'center' },
    contacts: { visible: true, align: 'center', width: 'large', maxWidth: 560, gap: 12, padding: 0, margin: 0, verticalAlign: 'center' },
    maps: { visible: true, align: 'right', width: 'medium', maxWidth: 380, gap: 8, padding: 0, margin: 0, verticalAlign: 'center' },
    navigation: { visible: true, align: 'center', width: 'medium', maxWidth: 480, gap: 12, padding: 0, margin: 0, verticalAlign: 'center' },
    social: { visible: true, align: 'center', width: 'medium', maxWidth: 380, gap: 12, padding: 0, margin: 0, verticalAlign: 'center' },
    copyright: { visible: true, align: 'left', width: 'full', maxWidth: 1280, gap: 8, padding: 0, margin: 0, verticalAlign: 'center' }
  },
  logo: { visible: true, width: 40, height: 40, maxWidth: 160, align: 'left', margin: 0, padding: 0 },
  map: { width: 100, height: 140, radius: 9, margin: 0, padding: 0, align: 'right', shadow: false },
  typography: { fontFamily: '', fontSize: 13, titleSize: 12, weight: 400, letterSpacing: 1, textColor: '', linkColor: '', hoverColor: '#ffffff' },
  colors: { background: '', accent: '', divider: '', border: '' },
  navigationLinks: []
}

export function createDefaultFooterSettings() {
  return {
    ...DEFAULT_FOOTER_SETTINGS,
    order: [...DEFAULT_FOOTER_SETTINGS.order],
    blocks: Object.fromEntries(Object.entries(DEFAULT_FOOTER_SETTINGS.blocks).map(([key, value]) => [key, { ...value }])),
    logo: { ...DEFAULT_FOOTER_SETTINGS.logo },
    map: { ...DEFAULT_FOOTER_SETTINGS.map },
    typography: { ...DEFAULT_FOOTER_SETTINGS.typography },
    colors: { ...DEFAULT_FOOTER_SETTINGS.colors },
    navigationLinks: []
  }
}

export function footerSettings(section = {}) {
  const saved = section.settings || {}
  const savedOrder = Array.isArray(saved.order) ? saved.order.map(key => ({ map: 'maps', contact: 'contacts' }[key] || key)) : DEFAULT_FOOTER_SETTINGS.order
  const order = [...new Set([...savedOrder, ...DEFAULT_FOOTER_SETTINGS.order])]
  return {
    ...DEFAULT_FOOTER_SETTINGS,
    ...saved,
    order,
    blocks: Object.fromEntries(Object.keys(DEFAULT_FOOTER_SETTINGS.blocks).map(key => [
      key,
      { ...DEFAULT_FOOTER_SETTINGS.blocks[key], ...(saved.blocks?.[key] || {}) }
    ])),
    logo: { ...DEFAULT_FOOTER_SETTINGS.logo, ...(saved.logo || {}) },
    map: { ...DEFAULT_FOOTER_SETTINGS.map, ...(saved.map || {}) },
    typography: { ...DEFAULT_FOOTER_SETTINGS.typography, ...(saved.typography || {}) },
    colors: { ...DEFAULT_FOOTER_SETTINGS.colors, ...(saved.colors || {}) },
    navigationLinks: Array.isArray(saved.navigationLinks) ? saved.navigationLinks : []
  }
}

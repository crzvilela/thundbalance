export const FOOTER_ELEMENTS = [
  ['contact', 'Contact Us'], ['instagram', 'Instagram'], ['whatsapp', 'WhatsApp'],
  ['youtube', 'YouTube'], ['gmail', 'Gmail'], ['visit', 'Visit Us'],
  ['address', 'Morada'], ['map', 'Google Maps']
]
export const FOOTER_ICONS = ['none', 'instagram', 'whatsapp', 'youtube', 'gmail', 'location', 'phone', 'arrow', 'globe']
export function footerElement(section, key, contactUrl = '/#contact') {
  const defaults = {
    contact: { text: 'Contact Us', url: contactUrl, icon: 'none', fontSize: 12, iconSize: 20 },
    instagram: { label: 'Instagram @thundbalance', url: 'https://www.instagram.com/thundbalance/', icon: 'instagram', width: 46, height: 46, iconSize: 20 },
    whatsapp: { label: 'WhatsApp +34 617 21 33 60', url: 'https://wa.me/34617213360', icon: 'whatsapp', width: 46, height: 46, iconSize: 20 },
    youtube: { label: 'YouTube Thundbalance', url: 'https://www.youtube.com/@thundbalance3668', icon: 'youtube', width: 46, height: 46, iconSize: 20 },
    gmail: { label: 'Gmail: info@thundbalance.com', url: 'https://mail.google.com/mail/?view=cm&fs=1&to=info%40thundbalance.com', icon: 'gmail', width: 46, height: 46, iconSize: 20 },
    visit: { text: 'Visit Us', fontSize: 12 }, address: { fontSize: 12, iconSize: 16 }, map: { width: '100%', height: 112 }
  }
  return { ...defaults[key], ...section.elements?.[key] }
}
export function footerElementStyle(element, device) {
  const style = {}
  for (const screen of ['mobile', 'tablet', 'desktop']) {
    const layout = { ...element, ...element.layout?.[screen] }
    for (const field of ['x', 'y', 'width', 'height', 'fontSize', 'iconSize']) {
      const number = Number(layout[field])
      const value = field === 'width' && layout[field] === '100%' ? '100%' : layout[field] !== '' && layout[field] != null && Number.isFinite(number)
        ? `${field === 'x' || field === 'y' ? number : Math.max(1, number)}px`
        : field === 'x' || field === 'y' ? '0px' : field === 'iconSize' ? '20px' : 'auto'
      style[`--fe-${field}-${screen}`] = value
      if (device === screen) style[`--fe-${field}`] = value
    }
  }
  return style
}

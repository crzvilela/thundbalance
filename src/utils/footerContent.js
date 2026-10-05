import { resolveText } from './multilingual.js'

/** @typedef {{id: string, type: 'email'|'phone'|'address'|'link'|'text', label: string|Object, value: string|Object, url?: string, icon?: string, visible?: boolean}} ContactItem */
/** @typedef {{id: string, label: string, url: string, visible?: boolean}} SocialLink */

/** Preserve legacy data until an administrator edits the corresponding list. */
export function contactItems(section) {
  if (Array.isArray(section.contactItems)) return section.contactItems
  return [
    { id: 'address', type: 'address', value: section.address?.text, url: section.address?.mapsLink, icon: 'pin' },
    { id: 'email', type: 'email', value: section.contactEmail, icon: 'mail' },
    { id: 'whatsapp', type: 'link', value: section.whatsappNumber || 'WhatsApp', url: section.whatsappLink, icon: 'whatsapp' },
    { id: 'contact', type: 'link', label: { en: 'Contact us', es: 'Contáctanos', ca: 'Contacta amb nosaltres' }, value: section.contactUsUrl, url: section.contactUsUrl, icon: 'arrow' },
    { id: 'join', type: 'link', label: { en: 'Join us', es: 'Únete a nosotros', ca: 'Uneix-te a nosaltres' }, value: section.joinUsEmail, url: section.joinUsEmail, icon: 'arrow' },
  ].filter(item => item.id === 'whatsapp' ? item.url : item.value).map(item => ({ label: '', visible: true, ...item }))
}

export function socialLinks(section) {
  return section.socialLinks ?? (section.instagramUrl ? [{ id: 'instagram', label: 'Instagram', url: section.instagramUrl, visible: true }] : [])
}

export function safeLink(value, allowMail = false) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return (['https:', 'http:'].includes(url.protocol) || (allowMail && ['mailto:', 'tel:'].includes(url.protocol))) ? value : undefined
  } catch { return undefined }
}

export function contactHref(item, language) {
  const value = resolveText(item.value, language)
  if (item.type === 'email') return `mailto:${value}`
  if (item.type === 'phone') return `tel:${value.replace(/[^+\d]/g, '')}`
  if (item.type === 'text') return undefined
  return safeLink(item.url || (item.type === 'address' ? `https://www.google.com/maps?q=${encodeURIComponent(value)}` : value), true)
}

/** Convert a Google Maps share URL or a human-readable address to the existing map format. */
export function mapFromLocation(address, link) {
  let query = ''
  if (link.trim()) {
    let url
    try { url = new URL(link.trim()) } catch { throw new Error('Enter a valid Google Maps URL.') }
    const google = /^(www\.|maps\.)?google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(url.hostname)
    const short = ['maps.app.goo.gl', 'goo.gl'].includes(url.hostname)
    if (url.protocol !== 'https:' || !(short || (google && (url.pathname.startsWith('/maps') || url.hostname.startsWith('maps.'))))) throw new Error('Use an HTTPS Google Maps link.')
    if (google && (url.pathname.startsWith('/maps/embed') || url.searchParams.get('output') === 'embed')) return url.href
    query = url.searchParams.get('q') || url.searchParams.get('query') || ''
    const place = url.pathname.match(/\/place\/([^/]+)/)
    if (!query && place) query = decodeURIComponent(place[1].replace(/\+/g, ' '))
    if (!query && !address.trim()) throw new Error('Add the location address to preview this shared link.')
  }
  query ||= address.trim()
  if (!query) throw new Error('Enter a location or a Google Maps link.')
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`
}

export function validateFooter(section) {
  for (const item of contactItems(section)) {
    for (const language of ['en', 'es', 'ca']) {
      const value = resolveText(item.value, language).trim()
      if (!value) return 'Enter a value for every contact item, or remove the empty item.'
      if (item.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter a valid email address.'
      if (item.type === 'phone' && !/^\+?[\d\s().-]{5,}$/.test(value)) return 'Enter a valid phone number.'
      if (item.type === 'link' && !safeLink(item.url || value, true)) return 'Enter a valid contact link (https:// or mailto:).'
      if (item.type === 'address' && item.url && !safeLink(item.url)) return 'Enter a valid address link.'
    }
  }
  for (const item of socialLinks(section)) {
    if (!item.label.trim() || !safeLink(item.url)) return 'Give each social link a name and a valid website URL.'
  }
  return ''
}

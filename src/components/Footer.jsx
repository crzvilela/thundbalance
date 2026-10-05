import { EditableText, useSectionSelection, SectionEditOverlay } from './editor/Editable'
import { useLandingContent } from '../content/LandingContentContext'
import { useI18n } from '../i18n/I18nContext'
import { resolveText } from '../utils/multilingual'
import { safeLink } from '../utils/footerContent'
import { useLayoutItem } from './editor/useLayoutItem'
import './Footer.css'

const ICONS = {
  location: <><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
  email: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></>,
  gmail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></>,
  phone: <path d="m5 3 4 1 1 5-2 1c1 3 3 5 6 6l1-2 5 1 1 4c-1 4-7 2-12-3S2 4 5 3Z"/>,
  instagram: <><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor" stroke="none"/></>,
  facebook: <path d="M14 21v-8h3l.5-4H14V7c0-1.2.4-2 2-2h2V1.4C17.3 1.2 16.3 1 15 1c-3.2 0-5 1.9-5 5.3V9H7v4h3v8Z"/>,
  tiktok: <path d="M14 3v11.2a3.5 3.5 0 1 1-3-3.5M14 3c.7 3.2 2.8 5 6 5"/>,
  youtube: <><rect x="2" y="5" width="20" height="14" rx="4"/><path d="m10 9 5 3-5 3Z" fill="currentColor" stroke="none"/></>,
  linkedin: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 10v7m0-10v.01M12 17v-7m0 3a3 3 0 0 1 6 0v4"/></>,
  whatsapp: <><path d="M20.5 11.5a8.5 8.5 0 0 1-12.7 7.4L3 20l1.2-4.7a8.5 8.5 0 1 1 16.3-3.8Z"/><path d="M8 7.5c-1 1-.5 3 1.5 5s4 2.5 5 1.5l1-1-3-1.5-.8.8a7 7 0 0 1-2.5-2.5l.8-.8-1.5-2Z"/></>,
  x: <path d="M4 4 20 20M20 4 4 20"/>,
  pinterest: <path d="M12 3a9 9 0 0 0-3.3 17.4c0-1.2 0-2.2.3-3.2l1.2-5.1s-.3-.6-.3-1.5c0-1.4.8-2.5 1.9-2.5.9 0 1.3.7 1.3 1.5 0 .9-.6 2.2-.9 3.5-.3 1 .5 1.8 1.5 1.8 1.8 0 3.2-2.4 3.2-5.2 0-2.2-1.5-3.8-4.2-3.8-3.1 0-5 2.3-5 4.8 0 .9.3 1.9.8 2.4.2.3.3.4.2.7l-.2.8c-.1.3-.3.4-.6.3-1.3-.5-1.9-1.9-1.9-3.5 0-2.6 2.2-5.8 6.7-5.8 3.6 0 6 2.6 6 5.4 0 3.7-2 6.4-4.9 6.4-1 0-2-.6-2.3-1.2l-.7 2.8c-.3 1-1 2-1.5 2.7A9 9 0 1 0 12 3Z"/>
}
const footerHref = url => typeof url === 'string' && (/^\/(?!\/)|^#/.test(url)) ? url : safeLink(url, true)

const DEFAULT_ICONS = [
  { id: 'location', icon: 'location', label: 'Google Maps', url: 'https://www.google.com/maps/place//data=!4m2!3m1!1s0x12a4a385af63a49b:0x841dd304c428a382?sa=X&ved=1t:8290&ictx=111', newTab: true, visible: true },
  { id: 'email', icon: 'email', label: 'Email', url: 'mailto:info@thundbalance.com', newTab: true, visible: true },
  { id: 'whatsapp', icon: 'whatsapp', label: 'WhatsApp', url: 'https://wa.me/+34617213360', newTab: true, visible: true },
  { id: 'instagram', icon: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/thundbalance/', newTab: true, visible: true },
  { id: 'youtube', icon: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/@thundbalance3668', newTab: true, visible: true }
]

function Icon({ name }) {
  if (!ICONS[name]) return null
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>
}

// One icon of the footer. Besides opening its link, it can be dragged to a new
// position in the editor, like any other element.
function FooterIconLink({ path, href, newTab, label, selected, editProps, children }) {
  const { select } = useLandingContent()
  const item = useLayoutItem({ path, kind: 'icon', tag: 'a', onSelect: () => select({ type: 'footerElement', path, label }) })
  return (
    <a
      {...editProps}
      {...item.attrs}
      href={href}
      target={newTab === false ? undefined : '_blank'}
      rel={newTab === false ? undefined : 'noopener noreferrer'}
      aria-label={label}
      title={label}
      className={`footer-icon-link ${selected ? 'is-selected' : ''} ${editProps.className || ''} ${item.className}`}
      style={item.style}
    >
      {children}
    </a>
  )
}

function Footer() {
  const { content, device, select, selection } = useLandingContent()
  const { language } = useI18n()
  const { section, isEditMode, isSelected, onSectionClick, visible } = useSectionSelection('footer')
  const sectionSettings = section.settings || {}
  const configuredIcons = Array.isArray(section.footerIcons) ? section.footerIcons : DEFAULT_ICONS.map(icon => {
    if (icon.id === 'location') return { ...icon, url: resolveText(section.address?.mapsLink, language) || icon.url }
    if (icon.id === 'email') return { ...icon, url: resolveText(section.contactEmail, language) ? `mailto:${resolveText(section.contactEmail, language)}` : icon.url }
    if (icon.id === 'whatsapp') return { ...icon, url: resolveText(section.whatsappLink, language) || icon.url }
    if (icon.id === 'instagram') return { ...icon, url: resolveText(section.instagramUrl, language) || icon.url }
    return icon
  })
  const savedIcons = Array.isArray(section.footerIcons) && !section.footerIcons.some(icon => icon.icon === 'youtube')
    ? [...configuredIcons, DEFAULT_ICONS.find(icon => icon.icon === 'youtube')]
    : configuredIcons
  const footerIcons = new Set(['location', 'email', 'gmail', 'whatsapp', 'instagram', 'youtube'])
  const icons = savedIcons.map(icon => icon.icon === 'email' || icon.icon === 'gmail'
    ? { ...icon, url: `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(resolveText(section.contactEmail, language) || 'info@thundbalance.com')}` }
    : icon).filter(icon => footerIcons.has(icon.icon) && icon.visible !== false)
  const edit = key => ({
    'data-footer-element': key,
    className: isEditMode ? 'footer-editable' : undefined,
    onClick: event => {
      if (!isEditMode) return
      event.preventDefault()
      event.stopPropagation()
      select({ type: 'footerElement', path: key })
    }
  })
  const linkFor = icon => {
    const url = resolveText(icon.url, language)
    if ((icon.icon === 'email' || icon.icon === 'gmail') && url && !/^(https?:|mailto:)/i.test(url)) return `mailto:${url}`
    if (icon.icon === 'phone' && url && !url.startsWith('tel:')) return `tel:${url.replace(/[^+\d]/g, '')}`
    return footerHref(url)
  }
  const font = sectionSettings.fontFamily || content.theme?.typography?.bodyFont
  const iconSize = Math.max(10, Math.round((Number(sectionSettings.iconSize) || 18) * 0.65))
  const iconGap = Math.max(10, Math.round((Number(sectionSettings.iconSpacing) || 18) * 0.78))

  if (!visible && !isEditMode) return null
  return <footer onClick={onSectionClick} data-device={isEditMode ? device : undefined} className={`compact-footer ${!visible ? 'footer-hidden' : ''}`} style={{ backgroundColor: sectionSettings.backgroundColor || '#050505', color: sectionSettings.textColor || '#fff', fontFamily: font || undefined, textAlign: 'center', '--footer-icon-size': `${iconSize}px`, '--footer-icon-gap': `${iconGap}px` }}>
    <SectionEditOverlay isEditMode={isEditMode} isSelected={isSelected} hidden={!visible} label="Footer" />
    <div className="footer-main">
      <div className="footer-brand">
        <EditableText as="span" path="sections.footer.brand" label="Footer Brand" />
      </div>
      <nav className="footer-icons" aria-label="Social and contact links">
        {icons.map(icon => {
          const href = linkFor(icon)
          const label = resolveText(icon.label, language)
          const key = icon.id || `${icon.icon}-${label}`
          const props = edit(`icon:${key}`)
          return href && <FooterIconLink key={key} path={`icon:${key}`} href={href} newTab={icon.newTab} label={label} selected={isEditMode && selection?.path === `icon:${key}`} editProps={props}><Icon name={icon.icon} /></FooterIconLink>
        })}
      </nav>
    </div>
    <div className="footer-meta">
      <EditableText as="span" path="sections.footer.text" label="Footer Copyright" />
    </div>
  </footer>
}

export default Footer

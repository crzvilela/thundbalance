import { useSectionSelection, SectionEditOverlay } from './editor/Editable'
import { useLandingContent } from '../content/LandingContentContext'
import { defaultContent } from '../content/defaultContent'
import { useI18n } from '../i18n/I18nContext'
import { resolveText } from '../utils/multilingual'
import { safeLink } from '../utils/footerContent'
import { footerElement, footerElementStyle } from '../utils/footerElements'
import './Footer.css'

const footerLink = url => typeof url === 'string' && /^\/(?!\/)|^#/.test(url) ? url : safeLink(url, true)

function Icon({ name }) {
  const paths = {
    instagram: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".8" fill="currentColor" stroke="none" /></>,
    whatsapp: <><path d="M20.5 11.5a8.5 8.5 0 0 1-12.7 7.4L3 20l1.2-4.7a8.5 8.5 0 1 1 16.3-3.8Z" /><path d="M8 7.5c-1 1-.5 3 1.5 5s4 2.5 5 1.5l1-1-3-1.5-.8.8a7 7 0 0 1-2.5-2.5l.8-.8-1.5-2Z" /></>,
    youtube: <><rect x="2" y="5" width="20" height="14" rx="4" /><path d="m10 9 5 3-5 3Z" fill="currentColor" stroke="none" /></>,
    gmail: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m3 6 9 7 9-7M3 19V7m18 12V7" /></>,
    location: <><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    phone: <path d="m5 3 4 1 1 5-2 1c1 3 3 5 6 6l1-2 5 1 1 4c-1 4-7 2-12-3S2 4 5 3Z" />,
    arrow: <path d="M5 19 19 5M7 5h12v12" />,
    globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>
  }
  if (!paths[name]) return null
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function Footer() {
  const { content, device, select, selection } = useLandingContent()
  const { language } = useI18n()
  const { section, isEditMode, isSelected, onSectionClick, visible } = useSectionSelection('footer')
  const contactId = (content.sectionOrder || []).find(id => content.sections[id]?.type === 'contact' && content.sections[id]?.visible !== false) || 'contact'
  const element = key => footerElement(section, key, `/#${contactId}`)
  const editable = key => ({
    'data-footer-element': key,
    style: footerElementStyle(element(key), isEditMode ? device : undefined),
    className: `footer-element ${isEditMode ? 'is-editable' : ''} ${isEditMode && selection?.type === 'footerElement' && selection.path === key ? 'is-selected' : ''}`,
    onClick: event => {
      if (!isEditMode) return
      event.preventDefault()
      event.stopPropagation()
      select({ type: 'footerElement', path: key })
    }
  })
  const address = resolveText(section.address?.text, language) || resolveText(defaultContent.sections.footer.address.text, language)
  const mapsLink = safeLink(section.address?.mapsLink || defaultContent.sections.footer.address.mapsLink)
  const mapEmbedUrl = section.mapEmbedUrl || defaultContent.sections.footer.mapEmbedUrl
  const contact = element('contact')
  const contactProps = editable('contact')
  const visitProps = editable('visit')
  const addressProps = editable('address')
  const mapProps = editable('map')

  if (!visible && !isEditMode) return null

  return (
    <footer onClick={onSectionClick} data-device={isEditMode ? device : undefined} className={`compact-footer relative bg-black px-6 py-6 text-white sm:px-8 ${!visible ? 'opacity-40' : ''}`}>
      <SectionEditOverlay isEditMode={isEditMode} isSelected={isSelected} hidden={!visible} label="Footer" />
      <div className="footer-grid grid grid-cols-1 items-center gap-8 md:grid-cols-3 md:gap-6">
        <div className="justify-self-start">
          <a {...contactProps} href={footerLink(contact.url)} className={`${contactProps.className} inline-flex items-center justify-center gap-2 border border-white/30 px-6 py-3 uppercase tracking-[3px] transition hover:border-white hover:bg-white hover:text-black focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white`}><Icon name={contact.icon} />{resolveText(contact.text, language)}</a>
        </div>
        <nav aria-label="Social media and email" className="flex items-center justify-center gap-5 justify-self-center">
          {['instagram', 'whatsapp', 'youtube', 'gmail'].map(key => {
            const link = element(key)
            const props = editable(key)
            return <a key={key} {...props} href={footerLink(link.url)} target="_blank" rel="noopener noreferrer" aria-label={link.label} title={link.label} className={`${props.className} inline-flex shrink-0 items-center justify-center rounded-full border border-white/15 text-gray-300 transition hover:border-white/50 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white`}><Icon name={link.icon} /></a>
          })}
        </nav>
        <div className="w-full max-w-sm justify-self-end">
          <h2 {...visitProps} className={`${visitProps.className} mb-3 uppercase tracking-[3px]`}>{resolveText(element('visit').text, language)}</h2>
          <a {...addressProps} href={mapsLink} target="_blank" rel="noopener noreferrer" className={`${addressProps.className} mb-3 flex items-start gap-2 leading-relaxed text-gray-400 transition hover:text-white`}><Icon name="location" /><span>{address}</span></a>
          <div {...mapProps} className={`${mapProps.className} footer-map rounded-md overflow-hidden`}>
            <iframe src={mapEmbedUrl} title="Thundbalance location on Google Maps" loading="lazy" referrerPolicy="no-referrer-when-downgrade" className="h-full w-full border-0" />
            {isEditMode && <button type="button" aria-label="Editar Google Maps" onClick={mapProps.onClick} className="absolute inset-0 cursor-pointer" />}
          </div>
        </div>
      </div>
    </footer>
  )
}

export default Footer


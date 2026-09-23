import { EditableText, EditableImage, useSectionSelection, SectionEditOverlay } from './editor/Editable'
import { SectionBackgroundImage, sectionBackgroundStyle } from './editor/SectionBackground'
import { BLANK_IMAGE_PLACEHOLDER } from '../utils/placeholderImage'
import { useI18n } from '../i18n/I18nContext'
import { resolveText } from '../utils/multilingual'

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4 shrink-0 mt-0.5">
      <path d="M12 22s7-7.16 7-12a7 7 0 1 0-14 0c0 4.84 7 12 7 12Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  )
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4 shrink-0">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  )
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 shrink-0">
      <path d="M12.01 2C6.48 2 2 6.48 2 12c0 1.86.51 3.6 1.4 5.09L2 22l5.06-1.33A9.94 9.94 0 0 0 12.01 22C17.53 22 22 17.52 22 12S17.53 2 12.01 2Zm5.61 14.24c-.24.67-1.4 1.28-1.93 1.34-.5.06-1.02.28-3.43-.72-2.91-1.2-4.79-4.12-4.94-4.32-.14-.2-1.18-1.58-1.18-3s.74-2.13 1-2.42c.26-.29.57-.36.76-.36h.55c.18 0 .42-.03.64.5.24.58.82 2 .89 2.15.07.15.11.32.02.51-.1.2-.15.32-.29.5-.15.18-.31.4-.44.53-.15.15-.3.32-.13.62.17.3.75 1.24 1.61 2 1.11.99 2.05 1.3 2.35 1.44.3.15.47.13.65-.08.18-.2.76-.88.96-1.19.2-.3.4-.25.67-.15.27.1 1.71.81 2 .96.29.15.48.22.55.35.07.13.07.75-.17 1.44Z" />
    </svg>
  )
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4 shrink-0">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

function ArrowUpRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 shrink-0 opacity-60 group-hover:opacity-100 transition">
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  )
}

function Footer() {
  const { section, isEditMode, isSelected, onSectionClick, visible, theme } = useSectionSelection('footer')
  const { t, language } = useI18n()

  if (!visible && !isEditMode) return null

  const address = section.address || {}
  const accentStyle = { fontFamily: theme.typography.accentFont }
  const bodyStyle = { fontFamily: theme.typography.bodyFont }

  const handleLinkClick = (e) => {
    if (!isEditMode) return
    e.preventDefault()
    e.stopPropagation()
  }

  // Google's free Maps embed always ships light/white — this is the
  // well-known no-cost CSS trick for a "dark mode" look. Applied only to
  // the flat map (mostly solid fills + text labels, which invert cleanly),
  // NOT to the 360°/Street View embed below: that one shows real
  // photographic imagery, and inverting a photo's colors just looks like a
  // negative, not "dark mode" — so it intentionally keeps its natural
  // colors, framed the same way as the map for visual consistency.
  const mapDarkFilterClass = '[filter:invert(90%)_hue-rotate(180deg)]'

  return (
    <footer
      onClick={onSectionClick}
      style={sectionBackgroundStyle(section.background)}
      className={`relative isolate bg-black text-white pt-20 pb-8 px-6 border-t border-white/10 ${!visible ? 'opacity-40' : ''}`}
    >
      <SectionEditOverlay isEditMode={isEditMode} isSelected={isSelected} hidden={!visible} label="Footer" />
      <SectionBackgroundImage background={section.background} />

      <div className="max-w-7xl mx-auto">

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-14">

          {/* Column 1 — brand */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              {(section.logoImage || isEditMode) && (
                <EditableImage
                  path="sections.footer.logoImage"
                  defaultSrc={BLANK_IMAGE_PLACEHOLDER}
                  alt="Logo"
                  containerClassName="h-10 w-auto"
                  imageClassName="h-10 w-auto object-contain"
                  label="Footer Logo"
                />
              )}
              {section.showBrandText !== false && (
                <EditableText
                  as="h2"
                  path="sections.footer.brand"
                  styleObj="sections.footer.brandStyle"
                  label="Footer Brand"
                  className="tracking-[4px] text-xl font-bold"
                />
              )}
            </div>

            <p className="text-gray-500 text-sm leading-6 max-w-xs" style={bodyStyle}>
              {t('footer_tagline')}
            </p>
          </div>

          {/* Column 2 — get in touch */}
          <div className="flex flex-col gap-5">
            <h3 className="uppercase tracking-[3px] text-xs text-gray-500" style={accentStyle}>
              {t('footer_get_in_touch')}
            </h3>

            <ul className="flex flex-col gap-3 text-sm text-gray-400" style={bodyStyle}>
              {address.text && (
                <li>
                  <a
                    href={address.mapsLink || undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleLinkClick}
                    className="flex items-start gap-2.5 hover:text-white transition"
                  >
                    <PinIcon />
                    <span>{resolveText(address.text, language)}</span>
                  </a>
                </li>
              )}

              {section.contactEmail && (
                <li>
                  <a
                    href={`mailto:${section.contactEmail}`}
                    onClick={handleLinkClick}
                    className="flex items-center gap-2.5 hover:text-white transition"
                  >
                    <MailIcon />
                    <span>{section.contactEmail}</span>
                  </a>
                </li>
              )}

              {section.whatsappLink && (
                <li>
                  <a
                    href={section.whatsappLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleLinkClick}
                    className="flex items-center gap-2.5 hover:text-white transition"
                  >
                    <WhatsAppIcon />
                    <span>{section.whatsappNumber || t('footer_whatsapp_fallback')}</span>
                  </a>
                </li>
              )}

              {section.contactUsUrl && (
                <li>
                  <a
                    href={section.contactUsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleLinkClick}
                    className="group flex items-center gap-2 hover:text-white transition"
                  >
                    <span>{t('footer_contact_us')}</span>
                    <ArrowUpRightIcon />
                  </a>
                </li>
              )}

              {section.joinUsEmail && (
                <li>
                  <a
                    href={section.joinUsEmail}
                    onClick={handleLinkClick}
                    className="group flex items-center gap-2 hover:text-white transition"
                  >
                    <span>{t('footer_join_us')}</span>
                    <ArrowUpRightIcon />
                  </a>
                </li>
              )}

              {section.instagramUrl && (
                <li>
                  <a
                    href={section.instagramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleLinkClick}
                    aria-label={t('footer_instagram_aria')}
                    className="flex items-center gap-2.5 hover:text-white transition"
                  >
                    <InstagramIcon />
                    <span>Instagram</span>
                  </a>
                </li>
              )}
            </ul>
          </div>

        </div>

        {(section.mapEmbedUrl || section.streetView360EmbedUrl) && (
          <div className="mb-14">
            <h3 className="uppercase tracking-[3px] text-xs text-gray-500 mb-5" style={accentStyle}>
              {t('footer_visit_us')}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {section.mapEmbedUrl && (
                <div className="rounded-xl overflow-hidden border border-white/10 shadow-lg">
                  <iframe
                    src={section.mapEmbedUrl}
                    width="100%"
                    height="320"
                    style={{ border: 0 }}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    title="Location map"
                    className={`w-full h-full ${mapDarkFilterClass}`}
                  />
                </div>
              )}

              {section.streetView360EmbedUrl && (
                <div className="rounded-xl overflow-hidden border border-white/10 shadow-lg">
                  <iframe
                    src={section.streetView360EmbedUrl}
                    width="100%"
                    height="320"
                    style={{ border: 0 }}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    allowFullScreen
                    title="360° view"
                    className="w-full h-full"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        <div className="pt-6 border-t border-white/10 text-center sm:text-left">
          <EditableText
            as="p"
            path="sections.footer.text"
            styleObj="sections.footer.textStyle"
            label="Footer Text"
            style={bodyStyle}
            className="text-gray-500 text-xs"
          />
        </div>

      </div>

    </footer>
  )
}

export default Footer

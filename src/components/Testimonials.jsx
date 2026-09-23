import { useEffect } from 'react'
import { EditableText, useSectionSelection, SectionEditOverlay } from './editor/Editable'
import { VideoMedia } from './editor/EditableVideo'
import { SectionBackgroundImage, sectionBackgroundStyle } from './editor/SectionBackground'
import { useLandingContent } from '../content/LandingContentContext'
import { useI18n } from '../i18n/I18nContext'
import { resolveText } from '../utils/multilingual'
import { resolveImageUrl } from '../api/landingPage'

// One client photo/video card. Click-to-select in edit mode, same pattern
// as EditableImage — clicking it opens a dedicated panel (see
// PropertiesPanel's TestimonialMediaPanel) to swap the media or edit the
// caption/client name.
function TestimonialMediaItem({ sectionId, index, item }) {
  const { isEditMode, select, selection } = useLandingContent()
  const { language } = useI18n()
  const path = `sections.${sectionId}.media.${index}`
  const isSelected = isEditMode && selection?.type === 'testimonialMedia' && selection.path === path

  const clientName = resolveText(item.clientName, language)
  const caption = resolveText(item.caption, language)

  const handleClick = (e) => {
    if (!isEditMode) return
    e.stopPropagation()
    select({ type: 'testimonialMedia', path, label: clientName || `Testimonial ${index + 1}` })
  }

  const hasCaption = !!(clientName || caption)

  return (
    <div
      onClick={handleClick}
      className={`relative group/tm border border-white/10 rounded-lg overflow-hidden transition ${
        isEditMode ? `cursor-pointer ${isSelected ? 'ring-2 ring-emerald-400 ring-inset' : 'hover:ring-2 hover:ring-emerald-400/50 hover:ring-inset'}` : ''
      }`}
    >
      <div className="aspect-[4/5] bg-[#111]">
        {item.type === 'video' ? (
          <VideoMedia
            video={{
              sourceType: item.videoSourceType === 'upload' ? 'upload' : 'embed',
              url: item.url,
              autoplay: false,
              loop: false,
              muted: true
            }}
            className="w-full h-full object-cover"
          />
        ) : (
          <img src={resolveImageUrl(item.url)} alt={caption || ''} className="w-full h-full object-cover" />
        )}
      </div>

      {hasCaption && (
        <div className="p-4">
          {clientName && <p className="text-sm font-semibold">{clientName}</p>}
          {caption && <p className="text-xs text-gray-400 mt-1">{caption}</p>}
        </div>
      )}

      {isEditMode && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover/tm:bg-black/40 transition pointer-events-none">
          <span className="opacity-0 group-hover/tm:opacity-100 text-white text-[11px] uppercase tracking-wider bg-black/70 px-3 py-1 rounded transition">
            Click to edit
          </span>
        </div>
      )}
    </div>
  )
}

function Testimonials({ sectionId }) {
  const { section, isEditMode, isSelected, onSectionClick, visible, theme } = useSectionSelection(sectionId, 'Testimonials')

  useEffect(() => {
    if (document.querySelector('script[src*="elfsight"]')) return

    const script = document.createElement('script')
    script.src = 'https://elfsightcdn.com/platform.js'
    script.async = true
    document.body.appendChild(script)
  }, [])

  if (!visible && !isEditMode) return null

  const media = section.media || []

  return (
    <section
      id={sectionId}
      onClick={onSectionClick}
      style={sectionBackgroundStyle(section.background)}
      className={`relative isolate bg-black text-white py-20 md:py-40 px-6 ${!visible ? 'opacity-40' : ''}`}
    >
      <SectionEditOverlay isEditMode={isEditMode} isSelected={isSelected} hidden={!visible} label="Testimonials" />
      <SectionBackgroundImage background={section.background} />

      <div className="max-w-7xl mx-auto">

        <div className="mb-12 md:mb-20 text-center">
          <EditableText
            as="p"
            path={`sections.${sectionId}.eyebrow`}
            styleObj={`sections.${sectionId}.eyebrowStyle`}
            label="Testimonials Eyebrow"
            style={{ fontFamily: theme.typography.accentFont }}
            className="uppercase tracking-[5px] text-sm text-gray-400 mb-6"
          />

          <EditableText
            as="h2"
            path={`sections.${sectionId}.title`}
            styleObj={`sections.${sectionId}.titleStyle`}
            label="Testimonials Title"
            style={{ fontFamily: theme.typography.headingFont }}
            className="text-4xl sm:text-5xl md:text-7xl"
          />
        </div>

        <div
          className="elfsight-app-ad21ff0a-7d99-486d-a394-b51a8007f2c6"
          data-elfsight-app-lazy
        ></div>

        {media.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 mt-16">
            {media.map((item, index) => (
              <TestimonialMediaItem key={index} sectionId={sectionId} index={index} item={item} />
            ))}
          </div>
        )}

      </div>
    </section>
  )
}

export default Testimonials

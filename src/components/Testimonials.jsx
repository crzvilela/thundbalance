import { useEffect } from 'react'
import { EditableText, useSectionSelection, SectionEditOverlay } from './editor/Editable'
import { SectionBackgroundImage, sectionBackgroundStyle } from './editor/SectionBackground'

function Testimonials({ sectionId }) {
  const { section, isEditMode, isSelected, onSectionClick, visible } = useSectionSelection(sectionId, 'Testimonials')

  useEffect(() => {
    if (document.querySelector('script[src*="elfsight"]')) return

    const script = document.createElement('script')
    script.src = 'https://elfsightcdn.com/platform.js'
    script.async = true
    document.body.appendChild(script)
  }, [])

  if (!visible && !isEditMode) return null

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
            className="uppercase tracking-[5px] text-sm text-gray-400 mb-6"
          />

          <EditableText
            as="h2"
            path={`sections.${sectionId}.title`}
            styleObj={`sections.${sectionId}.titleStyle`}
            label="Testimonials Title"
            style={{ fontFamily: 'Bebas Neue' }}
            className="text-4xl sm:text-5xl md:text-7xl"
          />
        </div>

        <div
          className="elfsight-app-ad21ff0a-7d99-486d-a394-b51a8007f2c6"
          data-elfsight-app-lazy
        ></div>

      </div>
    </section>
  )
}

export default Testimonials

import { EditableText, useSectionSelection, SectionEditOverlay } from './editor/Editable'
import { SectionBackgroundImage, sectionBackgroundStyle } from './editor/SectionBackground'

// Generic centered section: eyebrow, title, body text, standardized
// background. No dedicated concept behind it — this is the "type: textBlock"
// template an admin picks from "+ Add Section" for freeform content that
// doesn't need its own bespoke component.
function TextBlockSection({ sectionId }) {
  const { section, isEditMode, isSelected, onSectionClick, visible } = useSectionSelection(sectionId, 'Text Block')

  if (!visible && !isEditMode) return null

  return (
    <section
      id={sectionId}
      onClick={onSectionClick}
      style={sectionBackgroundStyle(section.background)}
      className={`relative isolate bg-black text-white py-20 md:py-40 px-6 ${!visible ? 'opacity-40' : ''}`}
    >
      <SectionEditOverlay isEditMode={isEditMode} isSelected={isSelected} hidden={!visible} label="Text Block" />
      <SectionBackgroundImage background={section.background} />

      <div className="max-w-4xl mx-auto text-center">

        <EditableText
          as="p"
          path={`sections.${sectionId}.eyebrow`}
          styleObj={`sections.${sectionId}.eyebrowStyle`}
          label="Eyebrow"
          className="uppercase tracking-[5px] text-sm text-gray-400 mb-6"
        />

        <EditableText
          as="h2"
          path={`sections.${sectionId}.title`}
          styleObj={`sections.${sectionId}.titleStyle`}
          label="Title"
          style={{ fontFamily: 'Bebas Neue' }}
          className="text-4xl sm:text-5xl md:text-7xl mb-8"
        />

        <EditableText
          as="p"
          path={`sections.${sectionId}.body`}
          styleObj={`sections.${sectionId}.bodyStyle`}
          label="Body"
          className="text-gray-300 text-lg leading-8 block"
        />

      </div>

    </section>
  )
}

export default TextBlockSection

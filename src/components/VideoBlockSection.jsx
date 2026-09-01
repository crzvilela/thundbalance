import { EditableText, useSectionSelection, SectionEditOverlay } from './editor/Editable'
import { EditableVideo } from './editor/EditableVideo'
import { SectionBackgroundImage, sectionBackgroundStyle } from './editor/SectionBackground'

// Full-width section dedicated to video, with an optional eyebrow/title
// above or below it. The "type: videoBlock" template an admin picks from
// "+ Add Section" for a video-first section without a bespoke component.
function VideoBlockSection({ sectionId }) {
  const { section, isEditMode, isSelected, onSectionClick, visible } = useSectionSelection(sectionId, 'Video Block')

  if (!visible && !isEditMode) return null

  const textBelow = section.textPosition === 'below'

  const textBlock = (
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
        className="text-4xl sm:text-5xl md:text-7xl"
      />
    </div>
  )

  return (
    <section
      id={sectionId}
      onClick={onSectionClick}
      style={sectionBackgroundStyle(section.background)}
      className={`relative isolate bg-black text-white py-20 md:py-40 px-6 ${!visible ? 'opacity-40' : ''}`}
    >
      <SectionEditOverlay isEditMode={isEditMode} isSelected={isSelected} hidden={!visible} label="Video Block" />
      <SectionBackgroundImage background={section.background} />

      <div className="max-w-6xl mx-auto">

        {!textBelow && <div className="mb-12">{textBlock}</div>}

        <EditableVideo
          path={`sections.${sectionId}.video`}
          containerClassName="w-full aspect-video overflow-hidden bg-black"
          videoClassName="w-full h-full object-cover"
          label="Video"
        />

        {textBelow && <div className="mt-12">{textBlock}</div>}

      </div>

    </section>
  )
}

export default VideoBlockSection

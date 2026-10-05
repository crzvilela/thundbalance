import { EditableText, EditableImage, useSectionSelection, SectionEditOverlay } from './editor/Editable'
import { EditableVideo } from './editor/EditableVideo'
import { SectionBackgroundImage, sectionBackgroundStyle } from './editor/SectionBackground'
import { BLANK_IMAGE_PLACEHOLDER } from '../utils/placeholderImage'

// Generic 2-column section: image (or video) on one side, eyebrow/title/body
// on the other, with a toggle for which side the media sits on and whether
// it's an image or a video. The "type: imageText" template an admin picks
// from "+ Add Section" for new content that needs media without a bespoke
// component.
function ImageTextSection({ sectionId }) {
  const { section, isEditMode, isSelected, onSectionClick, visible, theme } = useSectionSelection(sectionId, 'Image + Text')

  if (!visible && !isEditMode) return null

  const imageOnRight = section.imagePosition === 'right'
  const isVideo = section.mediaType === 'video'

  return (
    <section
      id={sectionId}
      onClick={onSectionClick}
      style={sectionBackgroundStyle(section.background)}
      className={`relative isolate bg-black text-white py-20 md:py-40 px-6 ${!visible ? 'opacity-40' : ''}`}
    >
      <SectionEditOverlay isEditMode={isEditMode} isSelected={isSelected} hidden={!visible} label="Image + Text" />
      <SectionBackgroundImage background={section.background} />

      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-16 items-center">

        <div className={imageOnRight ? 'md:order-2' : ''}>
          {isVideo ? (
            <EditableVideo
              path={`sections.${sectionId}.video`}
              containerClassName="w-full h-96 overflow-hidden bg-black"
              videoClassName="w-full h-full object-cover"
              label="Video"
            />
          ) : (
            <EditableImage
              path={`sections.${sectionId}.image`}
              styleObj={`sections.${sectionId}.imageStyle`}
              defaultSrc={BLANK_IMAGE_PLACEHOLDER}
              alt=""
              containerClassName="w-full h-96 overflow-hidden"
              imageClassName="w-full h-96 object-cover"
              label="Image"
            />
          )}
        </div>

        <div className={imageOnRight ? 'md:order-1' : ''}>
          <EditableText
            as="p"
            path={`sections.${sectionId}.eyebrow`}
            styleObj={`sections.${sectionId}.eyebrowStyle`}
            label="Eyebrow"
            style={{ fontFamily: theme.typography.accentFont }}
            className="uppercase tracking-[5px] text-sm text-gray-400 mb-6"
          />

          <EditableText
            as="h2"
            path={`sections.${sectionId}.title`}
            styleObj={`sections.${sectionId}.titleStyle`}
            label="Title"
            style={{ fontFamily: theme.typography.headingFont }}
            className="text-4xl sm:text-5xl md:text-7xl leading-none mb-8"
          />

          <EditableText
            as="p"
            path={`sections.${sectionId}.body`}
            styleObj={`sections.${sectionId}.bodyStyle`}
            label="Body"
            style={{ fontFamily: theme.typography.bodyFont }}
            className="text-lg leading-8 text-gray-300 block"
          />
        </div>

      </div>

    </section>
  )
}

export default ImageTextSection

import { motion } from 'framer-motion'
import { EditableText, EditableImage, useSectionSelection, SectionEditOverlay } from './editor/Editable'
import { SectionBackgroundImage, sectionBackgroundStyle } from './editor/SectionBackground'
import { BLANK_IMAGE_PLACEHOLDER } from '../utils/placeholderImage'
import ImageCarousel from './ImageCarousel'

function About({ sectionId }) {
  const { section, isEditMode, isSelected, onSectionClick, visible, theme } = useSectionSelection(sectionId, 'About')

  if (!visible && !isEditMode) return null

  const hasImage = !!section.image
  const carousel = section.carousel || []

  return (
    <motion.section
      id={sectionId}
      onClick={onSectionClick}
      initial={{ opacity: 0, y: 100 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ duration: 1 }}
      viewport={{ once: true }}
      style={{
        ...sectionBackgroundStyle(section.background),
        color: section.textColor || '#000000'
      }}
      className={`relative isolate py-20 md:py-40 px-6 ${!visible ? 'opacity-40' : ''}`}
    >
      <SectionEditOverlay isEditMode={isEditMode} isSelected={isSelected} hidden={!visible} label="About" />
      <SectionBackgroundImage background={section.background} />

      {hasImage ? (
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-16 items-center">

          <div>
            <EditableImage
              path={`sections.${sectionId}.image`}
              styleObj={`sections.${sectionId}.imageStyle`}
              defaultSrc={BLANK_IMAGE_PLACEHOLDER}
              alt=""
              containerClassName="w-full h-96 overflow-hidden"
              imageClassName="w-full h-96 object-cover"
              label="About Image"
            />
          </div>

          <div>
            <EditableText
              as="p"
              path={`sections.${sectionId}.eyebrow`}
              styleObj={`sections.${sectionId}.eyebrowStyle`}
              label="About Eyebrow"
              style={{ fontFamily: theme.typography.accentFont }}
              className="uppercase tracking-[5px] text-sm opacity-60 mb-6"
            />

            <EditableText
              as="h2"
              path={`sections.${sectionId}.title`}
              styleObj={`sections.${sectionId}.titleStyle`}
              label="About Title"
              style={{ fontFamily: theme.typography.headingFont }}
              className="text-4xl sm:text-5xl md:text-7xl leading-none mb-8"
            />

            <EditableText
              as="p"
              path={`sections.${sectionId}.body`}
              styleObj={`sections.${sectionId}.bodyStyle`}
              label="About Body"
              style={{ fontFamily: theme.typography.bodyFont }}
              className="text-lg leading-8 opacity-80 block"
            />
          </div>

        </div>
      ) : (
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-16 items-center">

          <div>
            <EditableText
              as="p"
              path={`sections.${sectionId}.eyebrow`}
              styleObj={`sections.${sectionId}.eyebrowStyle`}
              label="About Eyebrow"
              style={{ fontFamily: theme.typography.accentFont }}
              className="uppercase tracking-[5px] text-sm opacity-60 mb-6"
            />

            <EditableText
              as="h2"
              path={`sections.${sectionId}.title`}
              styleObj={`sections.${sectionId}.titleStyle`}
              label="About Title"
              style={{ fontFamily: theme.typography.headingFont }}
              className="text-4xl sm:text-5xl md:text-7xl leading-none mb-8"
            />
          </div>

          <div>
            <EditableText
              as="p"
              path={`sections.${sectionId}.body`}
              styleObj={`sections.${sectionId}.bodyStyle`}
              label="About Body"
              style={{ fontFamily: theme.typography.bodyFont }}
              className="text-lg leading-8 opacity-80 block"
            />
          </div>

        </div>
      )}

      {carousel.length > 0 && (
        <div className="max-w-4xl mx-auto mt-14 md:mt-20">
          <ImageCarousel items={carousel} />
        </div>
      )}

      {section.embed360Url && (
        <div className="max-w-4xl mx-auto mt-14 md:mt-20">
          <div className="rounded-xl overflow-hidden border border-white/10 shadow-lg">
            <iframe
              src={section.embed360Url}
              width="100%"
              height="400"
              style={{ border: 0 }}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
              title="360° view"
              className="w-full h-full"
            />
          </div>
        </div>
      )}

    </motion.section>
  )
}

export default About

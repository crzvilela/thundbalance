import { EditableText, EditableImage, useSectionSelection, SectionEditOverlay } from './editor/Editable'
import { SectionBackgroundImage, sectionBackgroundStyle } from './editor/SectionBackground'
import { BLANK_IMAGE_PLACEHOLDER } from '../utils/placeholderImage'
import { useI18n } from '../i18n/I18nContext'

function Contact({ sectionId }) {
  const { section, isEditMode, isSelected, onSectionClick, visible, theme } = useSectionSelection(sectionId, 'Contact')
  const { t } = useI18n()

  if (!visible && !isEditMode) return null

  const hasImage = !!section.image

  const textAndForm = (
    <>
      <EditableText
        as="p"
        path={`sections.${sectionId}.eyebrow`}
        styleObj={`sections.${sectionId}.eyebrowStyle`}
        label="Contact Eyebrow"
        style={{ fontFamily: theme.typography.accentFont }}
        className="uppercase tracking-[5px] text-sm text-gray-500 mb-6"
      />

      <EditableText
        as="h2"
        path={`sections.${sectionId}.title`}
        styleObj={`sections.${sectionId}.titleStyle`}
        label="Contact Title"
        style={{ fontFamily: theme.typography.headingFont }}
        className="text-4xl sm:text-5xl md:text-7xl mb-8"
      />

      <EditableText
        as="p"
        path={`sections.${sectionId}.body`}
        styleObj={`sections.${sectionId}.bodyStyle`}
        label="Contact Body"
        style={{ fontFamily: theme.typography.bodyFont }}
        className="text-gray-600 text-lg mb-16 block"
      />

      <form className="flex flex-col gap-6" onClick={(e) => isEditMode && e.stopPropagation()}>

        <input
          type="text"
          placeholder={t('contact_placeholder_name')}
          className="border border-black/20 px-6 py-4 outline-none"
        />

        <input
          type="email"
          placeholder={t('contact_placeholder_email')}
          className="border border-black/20 px-6 py-4 outline-none"
        />

        <textarea
          placeholder={t('contact_placeholder_message')}
          rows="6"
          className="border border-black/20 px-6 py-4 outline-none resize-none"
        ></textarea>

        <button
          style={{ fontFamily: theme.typography.accentFont }}
          className="mt-10 border border-white px-10 py-4 uppercase text-sm tracking-[3px] hover:bg-white hover:text-black transition-all duration-500 hover:scale-105 hover:tracking-[5px]"
        >
          {t('contact_button_send')}
        </button>

      </form>
    </>
  )

  return (
    <section
      id={sectionId}
      onClick={onSectionClick}
      style={sectionBackgroundStyle(section.background)}
      className={`relative isolate bg-white text-black py-20 md:py-40 px-6 ${!visible ? 'opacity-40' : ''}`}
    >
      <SectionEditOverlay isEditMode={isEditMode} isSelected={isSelected} hidden={!visible} label="Contact" />
      <SectionBackgroundImage background={section.background} />

      {hasImage ? (
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-16 items-center">
          <div>
            <EditableImage
              path={`sections.${sectionId}.image`}
              styleObj={`sections.${sectionId}.imageStyle`}
              defaultSrc={BLANK_IMAGE_PLACEHOLDER}
              alt=""
              containerClassName="w-full h-[32rem] overflow-hidden"
              imageClassName="w-full h-full object-cover"
              label="Contact Image"
            />
          </div>
          <div>
            {textAndForm}
          </div>
        </div>
      ) : (
        <div className="max-w-4xl mx-auto text-center">
          {textAndForm}
        </div>
      )}

    </section>
  )
}

export default Contact

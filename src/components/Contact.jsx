import { useState } from 'react'
import { EditableText, EditableFormField, EditableImage, useSectionSelection, SectionEditOverlay } from './editor/Editable'
import { SectionBackgroundImage, sectionBackgroundStyle } from './editor/SectionBackground'
import { BLANK_IMAGE_PLACEHOLDER } from '../utils/placeholderImage'
import { useLandingContent } from '../content/LandingContentContext'
import { useI18n } from '../i18n/I18nContext'

function Contact({ sectionId }) {
  const { section, isEditMode, isSelected, onSectionClick, visible, theme } = useSectionSelection(sectionId, 'Contact')
  const { content } = useLandingContent()
  const { t } = useI18n()
  const [emailOpened, setEmailOpened] = useState(false)
  const email = content.sections.footer?.contactEmail || ''

  if (!visible && !isEditMode) return null

  function handleSubmit(event) {
    event.preventDefault()
    if (isEditMode || !email) return
    const values = new FormData(event.currentTarget)
    const subject = encodeURIComponent(`${t('contact_subject')}: ${values.get('name')}`)
    const body = encodeURIComponent(`${values.get('message')}\n\n${values.get('name')}\n${values.get('email')}`)
    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`
    setEmailOpened(true)
  }

  const textAndForm = (
    <>
      <EditableText as="p" path={`sections.${sectionId}.eyebrow`} styleObj={`sections.${sectionId}.eyebrowStyle`} label="Contact Eyebrow" style={{ fontFamily: theme.typography.accentFont }} className="uppercase tracking-[5px] text-sm text-gray-500 mb-6" />
      <EditableText as="h2" path={`sections.${sectionId}.title`} styleObj={`sections.${sectionId}.titleStyle`} label="Contact Title" style={{ fontFamily: theme.typography.headingFont }} className="text-4xl sm:text-5xl md:text-7xl mb-8" />
      <EditableText as="p" path={`sections.${sectionId}.body`} styleObj={`sections.${sectionId}.bodyStyle`} label="Contact Body" style={{ fontFamily: theme.typography.bodyFont }} className="text-gray-600 text-lg mb-16 block" />
      <form className="flex flex-col gap-6" onSubmit={handleSubmit} onClick={event => isEditMode && event.stopPropagation()}>
        <EditableFormField name="name" type="text" path={`sections.${sectionId}.formLabels.name`} label="Contact Name Placeholder" autoComplete="name" required maxLength={120} className="border border-black/20 px-6 py-4 outline-none focus:border-black" />
        <EditableFormField name="email" type="email" path={`sections.${sectionId}.formLabels.email`} label="Contact Email Placeholder" autoComplete="email" required maxLength={254} className="border border-black/20 px-6 py-4 outline-none focus:border-black" />
        <EditableFormField as="textarea" name="message" path={`sections.${sectionId}.formLabels.message`} label="Contact Message Placeholder" required rows={6} maxLength={3000} className="border border-black/20 px-6 py-4 outline-none focus:border-black resize-none" />
        <EditableText as="button" path={`sections.${sectionId}.buttonText`} label="Contact Send Button" disabled={!isEditMode && !email} style={{ fontFamily: theme.typography.accentFont }} className="mt-10 border border-black px-10 py-4 uppercase text-sm tracking-[3px] hover:bg-black hover:text-white transition-all duration-300 disabled:opacity-50" />
        {emailOpened && <p role="status" className="text-sm text-gray-500">{t('contact_email_opened')}</p>}
      </form>
    </>
  )

  return (
    <section id={sectionId} onClick={onSectionClick} style={sectionBackgroundStyle(section.background)} className={`relative isolate bg-white text-black py-20 md:py-40 px-6 ${!visible ? 'opacity-40' : ''}`}>
      <SectionEditOverlay isEditMode={isEditMode} isSelected={isSelected} hidden={!visible} label="Contact" />
      <SectionBackgroundImage background={section.background} />
      {section.image ? (
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-16 items-center">
          <div><EditableImage path={`sections.${sectionId}.image`} styleObj={`sections.${sectionId}.imageStyle`} defaultSrc={BLANK_IMAGE_PLACEHOLDER} alt="" containerClassName="w-full h-[32rem] overflow-hidden" imageClassName="w-full h-full object-cover" label="Contact Image" /></div>
          <div>{textAndForm}</div>
        </div>
      ) : <div className="max-w-4xl mx-auto text-center">{textAndForm}</div>}
    </section>
  )
}

export default Contact

import { useState } from 'react'
import { EditableText, EditableFormField, EditableImage, useSectionSelection, SectionEditOverlay } from './editor/Editable'
import { SectionBackgroundImage, sectionBackgroundStyle } from './editor/SectionBackground'
import { BLANK_IMAGE_PLACEHOLDER } from '../utils/placeholderImage'
import { API_URL } from '../config'
import { useI18n } from '../i18n/I18nContext'

function Contact({ sectionId }) {
  const { section, isEditMode, isSelected, onSectionClick, visible, theme } = useSectionSelection(sectionId, 'Contact')
  const { t, language } = useI18n()
  // idle | sending | sent | error
  const [status, setStatus] = useState('idle')
  const [errorText, setErrorText] = useState('')

  if (!visible && !isEditMode) return null

  async function handleSubmit(event) {
    event.preventDefault()
    if (isEditMode || status === 'sending') return
    const form = event.currentTarget
    const values = new FormData(form)
    setStatus('sending')
    setErrorText('')
    try {
      const response = await fetch(`${API_URL}/contact-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.get('name'),
          email: values.get('email'),
          message: values.get('message'),
          website: values.get('website'),
          language
        })
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(response.status === 422 && typeof data.detail === 'string' ? data.detail : '')
      }
      form.reset()
      setStatus('sent')
    } catch (error) {
      setErrorText(error instanceof TypeError || !error.message ? t('contact_error') : error.message)
      setStatus('error')
    }
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
        <EditableText as="button" path={`sections.${sectionId}.buttonText`} label="Contact Send Button" disabled={!isEditMode && status === 'sending'} style={{ fontFamily: theme.typography.accentFont }} className="mt-10 border border-black px-10 py-4 uppercase text-sm tracking-[3px] hover:bg-black hover:text-white transition-all duration-300 disabled:opacity-50" />
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 opacity-0" />
        {status === 'sending' && <p role="status" className="text-sm text-gray-500">{t('contact_sending')}</p>}
        {status === 'sent' && <p role="status" className="text-sm text-emerald-700">{t('contact_sent')}</p>}
        {status === 'error' && <p role="alert" className="text-sm text-red-600">{errorText}</p>}
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

import { useState } from 'react'
import { EditableText, EditableFormField, EditableImage, useSectionSelection, SectionEditOverlay } from './editor/Editable'
import { SectionBackgroundImage, sectionBackgroundStyle } from './editor/SectionBackground'
import { BLANK_IMAGE_PLACEHOLDER } from '../utils/placeholderImage'
import { API_URL } from '../config'
import { useI18n } from '../i18n/I18nContext'
import { formText, serverFieldError } from '../i18n/formText'
import { emailProblem, emailSuggestion, nameProblem, normalizeEmail } from '../utils/validators'

const MESSAGE_MAX = 3000

// Error under a field of the (light) contact form: icon + text, the space is
// kept so nothing jumps when a message appears.
function FieldError({ id, text }) {
  return (
    <p id={id} role={text ? 'alert' : undefined} className="-mt-4 flex min-h-[1.25rem] items-start gap-1.5 text-left text-sm text-red-600">
      {text && (<>
        <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></svg>
        <span>{text}</span>
      </>)}
    </p>
  )
}

function Contact({ sectionId }) {
  const { section, isEditMode, isSelected, onSectionClick, visible, theme } = useSectionSelection(sectionId, 'Contact')
  const { t, language } = useI18n()
  // idle | sending | sent | error
  const [status, setStatus] = useState('idle')
  const [errorText, setErrorText] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [messageLength, setMessageLength] = useState(0)
  const [suggestion, setSuggestion] = useState('')

  if (!visible && !isEditMode) return null

  const problemOf = (field, value) => {
    const code = field === 'name' ? nameProblem(value) : field === 'email' ? emailProblem(value)
      : (String(value ?? '').trim().length < 5 ? (String(value ?? '').trim() ? 'invalid_message' : 'required') : null)
    if (code === 'invalid_message') return t('contact_error_message')
    return code ? formText(language, code) : ''
  }
  const check = (event) => {
    const { name, value } = event.target
    if (isEditMode || !['name', 'email', 'message'].includes(name)) return
    if (name === 'email') {
      event.target.value = normalizeEmail(value)
      setSuggestion(emailProblem(value) ? '' : (emailSuggestion(value) || ''))
    }
    setFieldErrors(current => ({ ...current, [name]: problemOf(name, event.target.value) }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (isEditMode || status === 'sending') return
    const form = event.currentTarget
    const values = new FormData(form)
    const found = Object.fromEntries(['name', 'email', 'message'].map(field => [field, problemOf(field, values.get(field))]))
    setFieldErrors(found)
    const firstBad = ['name', 'email', 'message'].find(field => found[field])
    if (firstBad) {
      const element = form.elements.namedItem(firstBad)
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      element?.focus({ preventScroll: true })
      return
    }
    setStatus('sending')
    setErrorText('')
    try {
      const response = await fetch(`${API_URL}/contact-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.get('name'),
          email: normalizeEmail(values.get('email')),
          message: values.get('message'),
          website: values.get('website'),
          language
        })
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const fieldError = response.status === 422 ? serverFieldError(data.detail, language) : null
        if (fieldError && ['name', 'email'].includes(fieldError.field)) {
          setFieldErrors(current => ({ ...current, [fieldError.field]: fieldError.message }))
          setStatus('idle')
          return
        }
        throw new Error(response.status === 422 && typeof data.detail === 'string' ? data.detail : '')
      }
      form.reset()
      setMessageLength(0)
      setSuggestion('')
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
      <form noValidate className="flex flex-col gap-6" onSubmit={handleSubmit} onClick={event => isEditMode && event.stopPropagation()}>
        <EditableFormField onBlur={check} aria-invalid={fieldErrors.name ? true : undefined} aria-describedby={`${sectionId}-name-error`} name="name" type="text" path={`sections.${sectionId}.formLabels.name`} label="Contact Name Placeholder" autoComplete="name" required maxLength={120} className="border border-black/20 px-6 py-4 outline-none focus:border-black" />
        {!isEditMode && <FieldError id={`${sectionId}-name-error`} text={fieldErrors.name} />}
        <EditableFormField onBlur={check} aria-invalid={fieldErrors.email ? true : undefined} aria-describedby={`${sectionId}-email-error`} name="email" type="email" path={`sections.${sectionId}.formLabels.email`} label="Contact Email Placeholder" autoComplete="email" required maxLength={254} className="border border-black/20 px-6 py-4 outline-none focus:border-black" />
        {suggestion && !isEditMode && <p className="-mt-4 flex flex-wrap items-center gap-2 text-sm text-amber-700"><span>{formText(language, 'email_suggest', { email: suggestion })}</span><button type="button" className="min-h-[36px] rounded-lg border border-amber-600/40 px-3" onClick={event => { const input = event.currentTarget.form.elements.namedItem('email'); input.value = suggestion; setSuggestion(''); setFieldErrors(current => ({ ...current, email: '' })) }}>{formText(language, 'email_suggest_accept')}</button></p>}
        {!isEditMode && <FieldError id={`${sectionId}-email-error`} text={fieldErrors.email} />}
        <EditableFormField onBlur={check} aria-invalid={fieldErrors.message ? true : undefined} aria-describedby={`${sectionId}-message-error`} onChange={event => setMessageLength(event.target.value.length)} as="textarea" name="message" path={`sections.${sectionId}.formLabels.message`} label="Contact Message Placeholder" required rows={6} maxLength={3000} className="border border-black/20 px-6 py-4 outline-none focus:border-black resize-none" />
        {!isEditMode && <p className="-mt-4 text-right text-xs text-gray-500" aria-live="polite">{formText(language, 'characters', { n: messageLength, max: MESSAGE_MAX })}</p>}
        {!isEditMode && <FieldError id={`${sectionId}-message-error`} text={fieldErrors.message} />}
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

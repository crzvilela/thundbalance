import { useId } from 'react'
import { useI18n } from '../i18n/I18nContext'
import { uiText } from '../legal/legalText'

// "I have read and accept the Privacy policy (and the Terms)": unchecked by default, required. The links open in a new tab so the form is not lost.
// `terms`: also mention the Terms and conditions (account and pack requests). `health`: the extra box for health data (explicit consent).
const LINK = 'text-emerald-300 underline underline-offset-2 hover:text-emerald-200'
const LINK_LIGHT = 'text-emerald-700 underline underline-offset-2 hover:text-emerald-900'

export default function ConsentCheckbox({ checked, onChange, error, terms = false, health = false, light = false }) {
  const { language } = useI18n()
  const text = uiText(language)
  const id = useId()
  const label = health ? (
    <><strong className={light ? 'text-black' : 'text-white'}>{text.healthTitle}.</strong> {text.healthText}</>
  ) : (
    <>
      {text.consentRead}{' '}
      <a href="/privacy" target="_blank" rel="noopener noreferrer" className={light ? LINK_LIGHT : LINK}>{text.privacy}</a>
      {terms && <>{' '}{text.consentAnd}{' '}<a href="/terms" target="_blank" rel="noopener noreferrer" className={light ? LINK_LIGHT : LINK}>{text.terms}</a></>}
    </>
  )
  return (
    <div className="mb-1 mt-2">
      <div className="flex items-start gap-3">
        {/* the box sits in a 44 x 44 px area that toggles it (the padding is cancelled by the negative margin: the layout does not move) */}
        <label className="-m-3 shrink-0 cursor-pointer p-3">
          <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} required
            aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
            className="mt-1 block h-5 w-5 cursor-pointer accent-emerald-400" />
        </label>
        <label htmlFor={id} className={`cursor-pointer text-left text-sm leading-relaxed ${light ? 'text-gray-700' : 'text-gray-300'}`}>{label}</label>
      </div>
      {error && <p id={`${id}-error`} role="alert" className={`mt-1 pl-8 text-left text-sm ${light ? 'text-red-600' : 'text-red-300'}`}>{error}</p>}
    </div>
  )
}

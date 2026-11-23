import { useI18n } from '../i18n/I18nContext'
import { uiText } from '../legal/legalText'
import { saveConsent, useAllowed, useConsent } from '../utils/consent'

// Shows `children` (content of another company: Google reviews or map, a YouTube video...) only once the visitor accepted the category
// "external content". Until then it shows a notice with a button; the button accepts that category (the rest of the choice is kept).
// `kind`: 'map' | 'reviews' | 'video' | 'content' (the text of the button).
export default function ConsentGate({ children, className = '', kind = 'content' }) {
  const allowed = useAllowed('external')
  const consent = useConsent()
  const { language } = useI18n()
  if (allowed) return children
  const text = uiText(language)
  return (
    <div className={`flex flex-col items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 p-6 text-center ${className}`}>
      <p className="text-base font-semibold text-white">{text.consentTitle}</p>
      <p className="max-w-md text-sm text-gray-400">{text.consentText}</p>
      <button type="button" onClick={() => saveConsent({ ...consent, external: true })}
        className="min-h-[44px] rounded-xl bg-emerald-400 px-5 text-sm font-semibold text-black transition hover:bg-emerald-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">{text.load[kind] || text.load.content}</button>
      <a href="/cookies" className="tap-target text-sm text-emerald-300 underline underline-offset-2">{text.more}</a>
    </div>
  )
}

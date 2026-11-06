import { useI18n } from '../i18n/I18nContext'
import { UI } from '../legal/legalText'
import { saveConsent, useConsent } from '../utils/consent'

// Shows `children` (content of another company: Google reviews, a YouTube video...) only once the visitor accepted it.
export default function ConsentGate({ children, className = '' }) {
  const consent = useConsent()
  const { language } = useI18n()
  if (consent === 'accepted') return children
  const text = UI[language] || UI.en
  return (
    <div className={`flex flex-col items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 p-6 text-center ${className}`}>
      <p className="text-base font-semibold text-white">{text.consentTitle}</p>
      <p className="max-w-md text-sm text-gray-400">{text.consentText}</p>
      <button type="button" onClick={() => saveConsent('accepted')}
        className="min-h-[44px] rounded-xl bg-emerald-400 px-5 text-sm font-semibold text-black transition hover:bg-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">{text.consentLoad}</button>
      <a href="/cookies" className="text-sm text-emerald-300 underline underline-offset-2">{text.more}</a>
    </div>
  )
}

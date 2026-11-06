import { useLocation } from 'react-router-dom'
import { useI18n } from '../i18n/I18nContext'
import { UI } from '../legal/legalText'
import { saveConsent, useConsent } from '../utils/consent'

// First visit: asks about external content (reviews, maps, videos). Essential storage needs no consent.
// Not shown in the admin / trainer areas (staff) nor on the cookie page itself.
export default function ConsentBanner() {
  const { language } = useI18n()
  const consent = useConsent()
  const { pathname } = useLocation()
  if (consent || /^\/(admin|trainer)/.test(pathname)) return null
  const text = UI[language] || UI.en
  const button = 'min-h-[44px] rounded-xl px-4 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400'
  return (
    <div role="dialog" aria-label={text.cookieTitle} className="fixed inset-x-0 bottom-0 z-[80] border-t border-white/10 bg-[#0d1110]/95 p-4 text-white backdrop-blur sm:p-5">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-center">
        <p className="flex-1 text-sm leading-relaxed text-gray-300">
          <strong className="text-white">{text.cookieTitle}. </strong>{text.cookieText}{' '}
          <a href="/cookies" className="text-emerald-300 underline underline-offset-2">{text.more}</a>
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => saveConsent('rejected')} className={`${button} border border-white/20 text-gray-100 hover:border-white/50`}>{text.reject}</button>
          <button type="button" onClick={() => saveConsent('accepted')} className={`${button} bg-emerald-400 text-black hover:bg-emerald-300`}>{text.accept}</button>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useI18n } from '../i18n/I18nContext'
import { uiText } from '../legal/legalText'
import { acceptAll, rejectAll } from '../utils/consentCore'
import { closePreferences, saveConsent, useConsent, usePreferencesOpen } from '../utils/consent'

// Cookie notice. First visit (no choice yet) or the footer link "Cookie settings": "Accept all", "Reject all" and "Configure" have the SAME
// look and size, so rejecting is as easy as accepting. Necessary storage is always on and needs no consent; the external content
// (Google maps and reviews, videos) only loads when its category is accepted. Not shown in the admin / trainer areas (staff).
const BUTTON = 'min-h-[44px] flex-1 rounded-xl border border-white/30 bg-white/5 px-5 text-sm font-semibold text-white transition hover:border-white/70 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 sm:flex-none'

function Switch({ checked, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 ${checked ? 'border-emerald-400 bg-emerald-400/80' : 'border-white/30 bg-white/10'}`}>
      <span aria-hidden="true" className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? 'left-6' : 'left-0.5'}`} />
    </button>
  )
}

export default function ConsentBanner() {
  const { language } = useI18n()
  const consent = useConsent()
  const reopened = usePreferencesOpen()
  const { pathname } = useLocation()
  const [configuring, setConfiguring] = useState(false)
  const [draft, setDraft] = useState(null)               // the switch while the visitor is choosing (null: what is saved)
  const visible = (!consent || reopened) && !/^\/(admin|trainer)/.test(pathname)
  const showConfig = configuring || reopened             // the footer link opens the panel already in the configuration view
  const external = draft ?? Boolean(consent?.external)
  const finish = () => { setConfiguring(false); setDraft(null) }
  const save = (choices) => { finish(); saveConsent(choices) }
  const close = () => { finish(); closePreferences() }

  useEffect(() => {
    if (!visible || !consent) return undefined
    const onKey = (event) => { if (event.key === 'Escape') { setConfiguring(false); setDraft(null); closePreferences() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, consent])

  if (!visible) return null
  const text = uiText(language)
  return (
    <div role="dialog" aria-label={text.cookieTitle} className="fixed inset-x-0 bottom-0 z-[80] max-h-[90dvh] overflow-y-auto border-t border-white/10 bg-[#0d1110]/95 p-4 text-white backdrop-blur sm:p-5">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm leading-relaxed text-gray-300">
          <strong className="text-white">{text.cookieTitle}. </strong>{text.cookieText}{' '}
          <a href="/cookies" className="text-emerald-300 underline underline-offset-2">{text.more}</a>
        </p>
        {showConfig && (
          <ul className="mt-4 space-y-3">
            <li className="flex items-start justify-between gap-4 rounded-xl border border-white/10 p-3">
              <div><p className="font-semibold">{text.catNecessary}</p><p className="text-sm text-gray-400">{text.catNecessaryText}</p></div>
              <span className="shrink-0 text-xs text-gray-400">{text.alwaysOn}</span>
            </li>
            <li className="flex items-start justify-between gap-4 rounded-xl border border-white/10 p-3">
              <div><p className="font-semibold">{text.catExternal}</p><p className="text-sm text-gray-400">{text.catExternalText}</p></div>
              <Switch checked={external} onChange={setDraft} label={text.catExternal} />
            </li>
          </ul>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={() => save(rejectAll())} className={BUTTON}>{text.rejectAll}</button>
          {showConfig
            ? <button type="button" onClick={() => save({ external })} className={BUTTON}>{text.save}</button>
            : <button type="button" onClick={() => setConfiguring(true)} className={BUTTON}>{text.configure}</button>}
          <button type="button" onClick={() => save(acceptAll())} className={BUTTON}>{text.acceptAll}</button>
          {consent && reopened && <button type="button" onClick={close} className="min-h-[44px] px-3 text-sm text-gray-400 underline underline-offset-2 hover:text-white">{text.close}</button>}
        </div>
      </div>
    </div>
  )
}

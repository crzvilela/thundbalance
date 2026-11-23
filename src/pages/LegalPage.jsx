import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { useI18n } from '../i18n/I18nContext'
import LegalBlocks from '../legal/LegalBlocks'
import { dateFor, documentFor } from '../legal/legalDoc'
import { DOCS, ROUTES, TITLES } from '../legal/legalModels'
import { pendingMarks } from '../legal/legalRender'
import { uiText } from '../legal/legalText'
import { useIsAdmin } from '../legal/useIsAdmin'
import { useLegal } from '../legal/useLegal'
import { openPreferences } from '../utils/consent'

// /privacy, /legal-notice, /terms, /cancellations and /cookies. `page` is one of DOCS. The text is the one the admin edited (Admin > Textos
// legales) or the model of the code, with the company data filled in. Lines that still lack a datum or a decision are shown only to the admin.
export default function LegalPage({ page }) {
  const { language } = useI18n()
  const ui = uiText(language)
  const { settings, documents } = useLegal()
  const admin = useIsAdmin()
  const title = (TITLES[page][language] || TITLES[page].en)
  const { body } = documentFor(page, language, documents)
  useEffect(() => { document.title = `${title} · ThundBalance` }, [title])
  const pending = admin ? pendingMarks(body, settings) : 0
  return (
    <div className="min-h-dvh bg-black text-white">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-5">
        <Link to="/" className="tap-target text-sm text-emerald-300 underline underline-offset-2">← {ui.back}</Link>
        <LanguageSwitcher />
      </header>
      <main id="main" className="mx-auto max-w-3xl px-4 pb-16">
        <h1 className="text-3xl font-semibold sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-hint">{ui.updated}: {dateFor(page, language, documents, settings)}</p>
        {pending > 0 && <p role="note" className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">{ui.pendingNotice} ({pending})</p>}
        <LegalBlocks text={body} settings={settings} admin={admin} />
        {page === 'cookies' && (
          <button type="button" onClick={openPreferences}
            className="mt-8 min-h-[44px] rounded-xl border border-white/30 px-5 text-sm font-semibold text-white transition hover:border-white/70">{ui.cookieSettings}</button>
        )}
        <nav className="mt-12 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/10 pt-6 text-sm text-gray-400" aria-label={ui.navLabel}>
          {DOCS.map(key => <Link key={key} to={ROUTES[key]} className="tap-target underline underline-offset-2 hover:text-white">{ui[key]}</Link>)}
        </nav>
      </main>
    </div>
  )
}

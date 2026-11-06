import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { useI18n } from '../i18n/I18nContext'
import { LEGAL, PAGES, UI } from '../legal/legalText'
import { saveConsent } from '../utils/consent'

// /privacy, /cookies and /legal-notice. `page` is 'privacy' | 'cookies' | 'legal'.
export default function LegalPage({ page }) {
  const { language } = useI18n()
  const ui = UI[language] || UI.en
  const content = (PAGES[page][language] || PAGES[page].en)
  useEffect(() => { document.title = `${content.title} · ThundBalance` }, [content.title])
  const links = [['privacy', '/privacy'], ['cookies', '/cookies'], ['legal', '/legal-notice']]
  return (
    <div className="min-h-screen bg-black text-white">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-5">
        <Link to="/" className="text-sm text-emerald-300 underline underline-offset-2">← {ui.back}</Link>
        <LanguageSwitcher />
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16">
        <h1 className="text-3xl font-semibold sm:text-4xl">{content.title}</h1>
        <p className="mt-2 text-sm text-gray-500">{ui.updated}: {LEGAL.updated}</p>
        {content.sections.map(section => (
          <section key={section.h} className="mt-8">
            <h2 className="text-xl font-semibold text-white">{section.h}</h2>
            {section.p.map(paragraph => <p key={paragraph} className="mt-3 text-base leading-relaxed text-gray-300">{paragraph}</p>)}
          </section>
        ))}
        {page === 'cookies' && (
          <button type="button" onClick={() => saveConsent(null)}
            className="mt-8 min-h-[44px] rounded-xl border border-white/20 px-5 text-sm font-semibold text-white transition hover:border-white/50">{ui.reject} / {ui.accept}</button>
        )}
        <nav className="mt-12 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/10 pt-6 text-sm text-gray-400" aria-label="Legal">
          {links.map(([key, href]) => <Link key={key} to={href} className="underline underline-offset-2 hover:text-white">{ui[key]}</Link>)}
        </nav>
      </main>
    </div>
  )
}

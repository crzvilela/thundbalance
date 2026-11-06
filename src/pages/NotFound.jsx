import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/I18nContext'
import { UI } from '../legal/legalText'

export default function NotFound() {
  const { language } = useI18n()
  const ui = UI[language] || UI.en
  useEffect(() => {
    document.title = `${ui.notFoundTitle} · ThundBalance`
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex'
    document.head.appendChild(robots)
    return () => robots.remove()
  }, [ui.notFoundTitle])
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-black px-6 text-center text-white">
      <p className="text-6xl font-semibold text-emerald-400" aria-hidden="true">404</p>
      <h1 className="mt-4 text-2xl font-semibold">{ui.notFoundTitle}</h1>
      <p className="mt-2 max-w-md text-gray-400">{ui.notFoundText}</p>
      <Link to="/" className="mt-8 inline-flex min-h-[44px] items-center rounded-xl bg-emerald-400 px-6 font-semibold text-black transition hover:bg-emerald-300">{ui.home}</Link>
    </main>
  )
}

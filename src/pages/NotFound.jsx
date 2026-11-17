import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/I18nContext'
import { useRoles } from '../roles/rolesContext'
import { areaFor, textsFor } from '../i18n/errorPages'
import logo from '../assets/images/thundbalance-logo.svg?inline'
import { Button } from '../components/ui'

// A path that does not exist (the "*" route). The same dark look as the site (logo, emerald accent), in the language in use, with a way back
// home and, for somebody who is signed in, a way to their own area. It says nothing about how the site works inside.
export default function NotFound() {
  const { language } = useI18n()
  const rolesState = useRoles()
  const text = textsFor(language)
  const area = areaFor(rolesState)

  useEffect(() => {
    document.title = `${text.notFoundTitle} · ThundBalance`
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex'
    document.head.appendChild(robots)
    return () => robots.remove()
  }, [text.notFoundTitle])

  return (
    <main id="main" className="flex min-h-[100dvh] flex-col items-center justify-center bg-black px-6 py-12 text-center text-white">
      <Link to="/" aria-label="ThundBalance" className="mb-10 inline-block rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400">
        <img src={logo} alt="ThundBalance" className="h-10 w-auto" />
      </Link>
      <p className="text-7xl font-semibold tracking-tight text-emerald-400 sm:text-8xl" aria-hidden="true" style={{ fontFamily: 'Bebas Neue, Inter, sans-serif' }}>404</p>
      <h1 style={{ fontFamily: 'Bebas Neue' }} className="mt-4 text-4xl uppercase sm:text-5xl">{text.notFoundTitle}</h1>
      <p className="mt-3 max-w-md text-base leading-7 text-gray-400">{text.notFoundText}</p>
      <div className="mt-9 flex w-full max-w-sm flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row">
        <Button as={Link} to="/" variant="primary" size="lg">{text.home}</Button>
        {area && <Button as={Link} to={area.to} variant="secondary" size="lg">{text[area.labelKey]}</Button>}
      </div>
    </main>
  )
}

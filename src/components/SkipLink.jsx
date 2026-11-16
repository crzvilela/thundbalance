import { useLocation } from 'react-router-dom'
import { useI18n } from '../i18n/I18nContext'
import { useAdminText } from '../admin/useAdminText'

// "Skip to main content": the first thing a keyboard reaches on every page. Invisible until it has the focus. It moves the focus to the
// page's <main id="main"> (the admin panel uses its own language).
export default function SkipLink() {
  const { t } = useI18n()
  const admin = useAdminText()
  const { pathname } = useLocation()
  const label = pathname.startsWith('/admin') ? admin.t('a11y_skip') : t('a11y_skip')

  const go = (event) => {
    event.preventDefault()
    const main = document.querySelector('main')
    if (!main) return
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1')
    main.focus()
    main.scrollIntoView?.({ block: 'start' })
  }

  return (
    <a href="#main" onClick={go}
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-black focus:shadow-xl">
      {label}
    </a>
  )
}

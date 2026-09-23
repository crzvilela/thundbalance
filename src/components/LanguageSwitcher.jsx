import { useState, useRef, useEffect } from 'react'
import { useI18n } from '../i18n/I18nContext'

const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'ca', label: 'Català' }
]

// Globe icon button + dropdown, used in both the desktop Navbar (near
// Login/Register or the avatar) and inside the mobile hamburger menu. No
// icon library is installed in this project, so a plain 🌐 emoji is used
// instead of adding a new dependency for one icon.
function LanguageSwitcher({ className = '' }) {
  const { language, setLanguage, t } = useI18n()
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!open) return

    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        aria-label={t('language_switcher_aria')}
        aria-expanded={open}
        className="w-9 h-9 flex items-center justify-center rounded-full border border-white/15 text-gray-300 hover:text-white hover:border-white transition text-base shrink-0"
      >
        🌐
      </button>

      {open && (
        <div className="absolute right-0 mt-3 w-40 backdrop-blur-md bg-black/90 border border-white/10 rounded-xl overflow-hidden z-50">
          {LANGUAGE_OPTIONS.map((opt) => (
            <button
              key={opt.code}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setLanguage(opt.code)
                setOpen(false)
              }}
              className={`w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition ${
                language === opt.code ? 'text-emerald-400' : 'text-gray-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span>{opt.label}</span>
              {language === opt.code && <span>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default LanguageSwitcher

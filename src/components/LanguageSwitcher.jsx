import { useState, useRef, useEffect } from 'react'
import { useI18n } from '../i18n/I18nContext'

const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'ca', label: 'Català' }
]

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4 shrink-0">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 4 5.5 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.5-4-9s1.5-6.5 4-9Z" />
    </svg>
  )
}

// Globe icon button + dropdown, used in both the desktop Navbar (near
// Login/Register or the avatar) and inside the mobile hamburger menu. An
// inline SVG (not an emoji) so the icon's color actually follows Tailwind
// text-color classes — emoji glyphs render in their own fixed colors
// regardless of CSS.
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
        className="w-9 h-9 flex items-center justify-center rounded-full border border-white text-white hover:bg-white/10 transition shrink-0"
      >
        <GlobeIcon />
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

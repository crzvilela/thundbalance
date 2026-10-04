import { useCallback, useSyncExternalStore } from 'react'
import { adminText } from './adminText'

const STORAGE_KEY = 'tb_admin_language'
const CHANGE_EVENT = 'tb-admin-language'

// In-memory copy so the language still switches when storage is unavailable.
let current = null

function readLanguage() {
  if (current) return current
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'en' || stored === 'es') current = stored
  } catch {
    // storage unavailable: fall through to the default
  }
  return current || 'en'
}

function subscribe(callback) {
  window.addEventListener(CHANGE_EVENT, callback)
  return () => window.removeEventListener(CHANGE_EVENT, callback)
}

// Admin-only language (English or Spanish). It is remembered separately from
// the public site's language, so changing one never changes the other. The
// value is shared, so switching it updates every admin screen at once.
export function useAdminText() {
  const language = useSyncExternalStore(subscribe, readLanguage, () => 'en')

  const setLanguage = useCallback((next) => {
    current = next
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // the choice just won't survive a reload
    }
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])

  const t = (key) => adminText[language]?.[key] ?? adminText.en[key] ?? key
  return {
    t, language, setLanguage,
    dayLabel: (day) => adminText[language].days[day] || day,
    dayFull: (day) => adminText[language].days_full[day] || day
  }
}

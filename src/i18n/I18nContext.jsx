import { createContext, useContext, useState } from 'react'
import { translations } from './translations'

const STORAGE_KEY = 'tb_language'
const DEFAULT_LANGUAGE = 'en'
const SUPPORTED_LANGUAGES = ['en', 'es', 'ca']

const I18nContext = createContext(null)

export function I18nProvider({ children }) {
  // Always 'en' on a brand new visit — we deliberately do NOT read
  // navigator.language here. localStorage is only ever set by an explicit
  // choice the visitor made via the language switcher, so reading it back
  // is "remember what they picked," not "guess from the browser."
  const [language, setLanguageState] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_LANGUAGE
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      return SUPPORTED_LANGUAGES.includes(stored) ? stored : DEFAULT_LANGUAGE
    } catch {
      return DEFAULT_LANGUAGE
    }
  })

  const setLanguage = (lang) => {
    if (!SUPPORTED_LANGUAGES.includes(lang)) return
    setLanguageState(lang)
    try {
      window.localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      // localStorage unavailable (private browsing, storage full, etc.) —
      // the choice just won't survive a reload, which is a harmless
      // degradation rather than something worth surfacing to the visitor.
    }
  }

  // Looks up a FIXED interface string only. Never used for admin-authored
  // content (content.sections.*, content.aboutUsPage, Training Tips video
  // titles/descriptions) — those are rendered directly from the content
  // object elsewhere, in English, regardless of `language`.
  const t = (key) => {
    return translations[language]?.[key] ?? translations[DEFAULT_LANGUAGE]?.[key] ?? key
  }

  return (
    <I18nContext.Provider value={{ language, setLanguage, t, supportedLanguages: SUPPORTED_LANGUAGES }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    // Defensive fallback for a component rendered outside the provider —
    // shouldn't happen once App.jsx wraps everything, mirrors the same
    // pattern already used by useLandingContent()'s defaultContextValue.
    return {
      language: DEFAULT_LANGUAGE,
      setLanguage: () => {},
      t: (key) => translations[DEFAULT_LANGUAGE]?.[key] ?? key,
      supportedLanguages: SUPPORTED_LANGUAGES
    }
  }
  return ctx
}

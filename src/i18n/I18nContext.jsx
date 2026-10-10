import { createContext, useContext, useState } from 'react'
import { translations } from './translations'

const STORAGE_KEY = 'tb_language'
const DEFAULT_LANGUAGE = 'en'
const SUPPORTED_LANGUAGES = ['en', 'es', 'ca']

const LOCALES = { en: 'en-GB', es: 'es-ES', ca: 'ca-ES' }

const I18nContext = createContext(null)

export function I18nProvider({ children }) {
  // Always 'en' on a brand new visit — we deliberately do NOT read
  // navigator.language here. localStorage is only ever set by an explicit
  // choice the visitor made via the language switcher, so reading it back
  // is "remember what they picked," not "guess from the browser."
  const [language, setLanguageState] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_LANGUAGE
    let stored = null
    try {
      stored = window.localStorage.getItem(STORAGE_KEY)
    } catch {
      // storage unavailable: treated as "no saved choice"
    }
    if (SUPPORTED_LANGUAGES.includes(stored)) return stored
    // No saved choice: a ?lang=xx in the link (e.g. from an email written in that
    // language) decides. It is not saved, and a saved choice always wins over it.
    try {
      const fromLink = new URLSearchParams(window.location.search).get('lang')
      if (SUPPORTED_LANGUAGES.includes(fromLink)) return fromLink
    } catch {
      // ignore a malformed query string
    }
    return DEFAULT_LANGUAGE
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
  // Optional {name}-style placeholders are filled from `vars`. An unknown key
  // comes back unchanged, so server-written messages can be passed through.
  const t = (key, vars) => {
    const text = translations[language]?.[key] ?? translations[DEFAULT_LANGUAGE]?.[key] ?? key
    return vars ? text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match)) : text
  }
  const locale = LOCALES[language]

  return (
    <I18nContext.Provider value={{ language, locale, setLanguage, t, supportedLanguages: SUPPORTED_LANGUAGES }}>
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
      locale: LOCALES[DEFAULT_LANGUAGE],
      setLanguage: () => {},
      t: (key) => translations[DEFAULT_LANGUAGE]?.[key] ?? key,
      supportedLanguages: SUPPORTED_LANGUAGES
    }
  }
  return ctx
}

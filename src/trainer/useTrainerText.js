import { useMemo } from 'react'
import { useI18n } from '../i18n/I18nContext'
import { translations } from '../i18n/translations'

const LOCALES = { en: 'en-GB', es: 'es-ES', ca: 'ca-ES' }

// The panel's texts. By default the site's language; the admin's view passes the language of the admin panel instead.
export function useTrainerText(override) {
  const site = useI18n()
  const language = LOCALES[override] ? override : site.language
  return useMemo(() => {
    const t = (key, vars) => {
      const text = translations[language]?.[key] ?? translations.en[key] ?? key
      return vars ? text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match)) : text
    }
    return { t, language, locale: LOCALES[language] }
  }, [language])
}

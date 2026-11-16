// The version of the legal texts a visitor accepts: the date of the text they could read (the date the admin edited it, or the date of the
// model). It is the proof stored with the consent (consent_version): which text, not who. With `terms` the newest of privacy and terms.
import { useI18n } from '../i18n/I18nContext'
import { dateFor } from './legalDate'
import { useLegal } from './useLegal'

export function useLegalVersion({ terms = false } = {}) {
  const { language } = useI18n()
  const { settings, documents } = useLegal()
  const dates = [dateFor('privacy', language, documents, settings)]
  if (terms) dates.push(dateFor('terms', language, documents, settings))
  return dates.sort().at(-1)
}

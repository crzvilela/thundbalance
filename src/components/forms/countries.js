import { getCountries, getCountryCallingCode } from 'libphonenumber-js/min'

// Main countries, in this order, at the top of the list. "US" stands for the
// +1 row (United States / Canada); Canada is also in the full list below.
export const MAIN_COUNTRIES = ['ES', 'PT', 'FR', 'AD', 'IT', 'GB', 'DE', 'NL', 'BE', 'IE', 'US', 'MX', 'AR', 'CO', 'BR', 'MA']
export const DEFAULT_COUNTRY = 'ES'

// Flags are SVG files (the emoji flags do not show on Windows). Only the ones
// that are on screen are downloaded: this gives URLs, not the images.
const FLAG_URLS = import.meta.glob('/node_modules/country-flag-icons/3x2/*.svg', {
  eager: true, query: '?url&no-inline', import: 'default',
})

export function flagUrl(iso) {
  return FLAG_URLS[`/node_modules/country-flag-icons/3x2/${iso}.svg`] || ''
}

const ALL = getCountries()

function nameOf(iso, language) {
  try {
    return new Intl.DisplayNames([language || 'en'], { type: 'region' }).of(iso) || iso
  } catch {
    return iso
  }
}

const cache = new Map()

// [{ iso, name, code: '+34' }] in two groups: the main ones, then the rest A-Z.
export function countryLists(language = 'en') {
  const hit = cache.get(language)
  if (hit) return hit
  const make = (iso) => ({ iso, name: nameOf(iso, language), code: `+${getCountryCallingCode(iso)}` })
  const main = MAIN_COUNTRIES.map((iso) => {
    const item = make(iso)
    // the +1 row covers both countries
    return iso === 'US' ? { ...item, name: `${nameOf('US', language)} / ${nameOf('CA', language)}` } : item
  })
  const rest = ALL.filter((iso) => !MAIN_COUNTRIES.includes(iso)).map(make)
    .sort((a, b) => a.name.localeCompare(b.name, language))
  const value = { main, rest }
  cache.set(language, value)
  return value
}

// The country to show for a calling code like "+351" (Spain for +34, ...).
const PREFERRED = { 1: 'US', 44: 'GB', 7: 'RU', 39: 'IT', 47: 'NO' }

export function countryForCode(code) {
  const digits = String(code || '').replace(/\D/g, '')
  if (!digits) return DEFAULT_COUNTRY
  if (PREFERRED[digits]) return PREFERRED[digits]
  const main = MAIN_COUNTRIES.find((iso) => getCountryCallingCode(iso) === digits)
  if (main) return main
  return ALL.find((iso) => getCountryCallingCode(iso) === digits) || DEFAULT_COUNTRY
}

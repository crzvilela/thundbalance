// The same rules as backend/validators.py. The server is the one that decides;
// this gives the answer before sending. Every function answers with a CODE
// (a key of src/i18n/formText.js) or null when the value is fine.
import { parsePhoneNumberFromString } from 'libphonenumber-js/min'
import { taxIdProblem } from './taxId'

// ----------------------------------------------------------------------- name
export function nameProblem(value, { required = true } = {}) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return required ? 'required' : null
  if (text.length < 2 || text.length > 120 || !/\p{L}/u.test(text)) return 'invalid_name'
  return null
}

// ---------------------------------------------------------------------- email
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/

export const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase()

export function emailProblem(value, { required = true } = {}) {
  const text = normalizeEmail(value)
  if (!text) return required ? 'required' : null
  const [local = '', domain = ''] = text.split('@')
  if (text.length > 254 || local.length > 64 || /\s/.test(text) || text.includes('..') || !EMAIL.test(text) || !/\.[a-z]{2,}$/.test(domain)) {
    return 'invalid_email'
  }
  return null
}

// Common slips in the domain. The answer is a suggestion, never an error.
const DOMAIN_TYPOS = {
  'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmai.com': 'gmail.com',
  'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com', 'gnail.com': 'gmail.com', 'gmaill.com': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmail.con': 'hotmail.com',
  'hotamil.com': 'hotmail.com', 'outlok.com': 'outlook.com', 'outlook.con': 'outlook.com', 'yahooo.com': 'yahoo.com',
  'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'iclod.com': 'icloud.com', 'icloud.con': 'icloud.com',
}

export function emailSuggestion(value) {
  const text = normalizeEmail(value)
  const at = text.lastIndexOf('@')
  if (at < 1) return null
  const fixed = DOMAIN_TYPOS[text.slice(at + 1)]
  return fixed ? `${text.slice(0, at)}@${fixed}` : null
}

// ---------------------------------------------------------------------- phone
// A stored number is E.164 ("+34613502662"). An old record has only the
// national digits; it is read as Spanish (+34) unless it came with its own code.
export function toE164(value, fallbackCode = '+34') {
  const text = String(value ?? '').replace(/[\s().-]/g, '')
  if (!text) return ''
  if (text.startsWith('+')) return text
  if (text.startsWith('00')) return `+${text.slice(2)}`
  const code = String(fallbackCode || '+34').replace(/\D/g, '') || '34'
  return `+${code}${text}`
}

export function phoneProblem(value, { required = true, fallbackCode } = {}) {
  const text = toE164(value, fallbackCode)
  if (!text) return required ? 'required' : null
  const number = parsePhoneNumberFromString(text)
  if (!number) return 'invalid_phone'
  const national = String(number.nationalNumber)
  if (number.countryCallingCode === '34') return /^[6-9]\d{8}$/.test(national) ? null : 'invalid_phone_es'
  if (number.countryCallingCode === '351') return /^[92]\d{8}$/.test(national) ? null : 'invalid_phone_pt'
  return number.isValid() ? null : 'invalid_phone'
}

// The country of a phone number ("ES" for +34...), or null.
export function regionOfPhone(value) {
  const number = parsePhoneNumberFromString(toE164(value))
  return number?.country || null
}

// "+34" for a stored E.164 number (sent with it as the old separate country code).
export function callingCodeOf(value) {
  const number = parsePhoneNumberFromString(toE164(value))
  return number ? `+${number.countryCallingCode}` : ''
}

// For reading: "+34 613 50 26 62". An old number without a prefix is shown as
// it is, after its saved country code.
export function formatPhone(value, savedCode = '') {
  const text = String(value ?? '').trim()
  if (!text) return ''
  if (!text.startsWith('+')) return [savedCode, text].filter(Boolean).join(' ')
  const number = parsePhoneNumberFromString(text)
  return number ? number.formatInternational() : text
}

// ---------------------------------------------------------------- postal code
const POSTAL = {
  PT: /^\d{4}-?\d{3}$/, FR: /^\d{5}$/, AD: /^AD\d{3}$/, IT: /^\d{5}$/, DE: /^\d{5}$/, NL: /^\d{4} ?[A-Z]{2}$/,
  BE: /^\d{4}$/, IE: /^[A-Z0-9]{3} ?[A-Z0-9]{4}$/, US: /^\d{5}(-\d{4})?$/, CA: /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/,
  MX: /^\d{5}$/, AR: /^([A-Z]\d{4}[A-Z]{3}|\d{4})$/, CO: /^\d{6}$/, BR: /^\d{5}-?\d{3}$/, MA: /^\d{5}$/,
  GB: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/,
}

export function postalCodeProblem(value, country = 'ES', { required = true } = {}) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().toUpperCase()
  if (!text) return required ? 'required' : null
  const iso = String(country || 'ES').toUpperCase()
  if (iso === 'ES') {
    if (!/^\d{5}$/.test(text) || Number(text) < 1000 || Number(text) > 52999) return 'invalid_postal_code_es'
    return null
  }
  const pattern = POSTAL[iso]
  if (pattern) return pattern.test(text) ? null : 'invalid_postal_code'
  return /^[A-Z0-9][A-Z0-9 -]{1,8}[A-Z0-9]$/.test(text) ? null : 'invalid_postal_code'
}

// ISO country for the postal code rule, from a code or a common name. Empty
// means Spain; a name it does not know gives 'ZZ' (the general 3 to 10 rule).
const COUNTRY_NAMES = {
  spain: 'ES', españa: 'ES', espanha: 'ES', espanya: 'ES', portugal: 'PT', france: 'FR', francia: 'FR', frança: 'FR',
  andorra: 'AD', italy: 'IT', italia: 'IT', itália: 'IT', germany: 'DE', alemania: 'DE', alemanha: 'DE',
  'united kingdom': 'GB', 'reino unido': 'GB', uk: 'GB', 'united states': 'US', 'estados unidos': 'US', usa: 'US',
}

export function countryIsoOf(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return 'ES'
  if (/^[A-Za-z]{2}$/.test(text)) return text.toUpperCase()
  return COUNTRY_NAMES[text.toLowerCase()] || 'ZZ'
}

// ----------------------------------------------------------------- birth date
export function birthDateProblem(date, { required = false, today = new Date() } = {}) {
  if (!date) return required ? 'required' : null
  const value = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(value.getTime())) return 'invalid_birth_date'
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59)
  if (value > end || value < new Date(1900, 0, 1)) return 'invalid_birth_date'
  return null
}

// ---------------------------------------------------------------- document
export function documentProblem(type, value, { required = false } = {}) {
  const problem = taxIdProblem(type, value)
  if (problem) return `tax_id_${problem}`
  if (required && !String(value ?? '').trim()) return 'required'
  return null
}

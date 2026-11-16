// Name and e-mail rules (the same as backend/validators.py). Kept apart from validators.js so that the landing page does not
// download the phone-number library just to check an e-mail address.

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

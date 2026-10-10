// Identity document of a client: the same rules as backend/tax_id.py (the
// server is the one that decides; this only gives the answer before sending).

export const TAX_ID_TYPES = ['DNI', 'NIE', 'PASSPORT', 'OTHER']
export const DEFAULT_TAX_ID_TYPE = 'DNI'

const LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE'      // control letter: number % 23

// Upper case, without spaces, dots or hyphens.
export const normalizeTaxId = (value) => String(value ?? '').replace(/[\s.-]/g, '').toUpperCase()

// null when the document is fine (or empty: it is optional), otherwise a code:
// dni_format | dni_letter | nie_format | nie_letter | other_format | type
export function taxIdProblem(type, value) {
  const text = normalizeTaxId(value)
  if (!text) return null
  const kind = String(type || DEFAULT_TAX_ID_TYPE).toUpperCase()
  if (!TAX_ID_TYPES.includes(kind)) return 'type'

  if (kind === 'DNI') {
    if (!/^\d{8}[A-Z]$/.test(text)) return 'dni_format'
    return LETTERS[Number(text.slice(0, 8)) % 23] === text[8] ? null : 'dni_letter'
  }
  if (kind === 'NIE') {
    if (!/^[XYZ]\d{7}[A-Z]$/.test(text)) return 'nie_format'
    const number = { X: '0', Y: '1', Z: '2' }[text[0]] + text.slice(1, 8)
    return LETTERS[Number(number) % 23] === text[8] ? null : 'nie_letter'
  }
  return /^[\p{L}\p{N}]{4,20}$/u.test(text) ? null : 'other_format'
}

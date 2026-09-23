// A "multilingual" field value is either:
//  - a plain string (legacy / not yet translated — treated as the same text
//    in every language until someone edits it per-language), or
//  - an { en, es, ca } object.
//
// Only real editable text fields (title, eyebrow, body, button text, etc.)
// use this shape. Colors, URLs, image paths, emails, phone numbers,
// addresses and proper nouns (brand names) are never wrapped this way —
// those are the same in every language, not "content" to translate.

export function resolveText(raw, language = 'en') {
  if (raw === null || raw === undefined) return ''
  if (typeof raw === 'object') return raw[language] ?? raw.en ?? ''
  return raw
}

// Sets one language's value on a possibly-multilingual field, converting a
// legacy plain string into a proper { en, es, ca } object the first time
// it's edited (preserving the existing text as `en` so nothing is lost).
export function setTextForLanguage(raw, language, value) {
  const base = raw && typeof raw === 'object' ? raw : { en: typeof raw === 'string' ? raw : '' }
  return { ...base, [language]: value }
}

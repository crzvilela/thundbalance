import { resolveText } from './multilingual.js'

// The contact form of the landing page shows the labels that the admin writes in the editor (section.formLabels). A form published with a
// label empty in any language would show a field without a name: the editor refuses to publish it and says which ones.
export const CONTACT_LABEL_FIELDS = ['name', 'email', 'message']
const LANGUAGES = ['en', 'es', 'ca']

// [{ section, field, languages: ['ca'] }, ...] for every visible contact section; [] when all is fine.
export function emptyContactLabels(content) {
  const problems = []
  for (const [key, section] of Object.entries(content?.sections || {})) {
    if (!section || (section.type || key) !== 'contact' || section.visible === false) continue
    for (const field of CONTACT_LABEL_FIELDS) {
      const missing = LANGUAGES.filter(language => !String(resolveText(section.formLabels?.[field], language) ?? '').trim())
      if (missing.length) problems.push({ section: key, field, languages: missing })
    }
  }
  return problems
}

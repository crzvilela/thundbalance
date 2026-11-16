// What a legal page shows for a document and a language: the text the admin edited, or the model of the code.
import { modelText } from './legalModels'

export function documentFor(doc, language, documents = {}) {
  const override = documents?.[doc]?.[language]
  const edited = override?.body ? override : null
  return { body: edited ? edited.body : modelText(doc, language), edited: Boolean(edited), override: edited }
}

export { dateFor } from './legalDate'

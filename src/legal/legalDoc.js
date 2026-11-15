// What a legal page shows for a document and a language: the text the admin edited, or the model of the code.
import { modelText } from './legalModels'
import { updatedDate } from './legalRender'

export function documentFor(doc, language, documents = {}) {
  const override = documents?.[doc]?.[language]
  const edited = override?.body ? override : null
  return { body: edited ? edited.body : modelText(doc, language), edited: Boolean(edited), override: edited }
}

export const dateFor = (doc, language, documents, settings) => updatedDate(documents?.[doc]?.[language], settings)

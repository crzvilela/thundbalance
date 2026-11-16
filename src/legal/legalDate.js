// The date of a legal text (kept apart from legalDoc.js: it must not pull the model texts into the landing page).
import { updatedDate } from './legalRender'

export const dateFor = (doc, language, documents, settings) => updatedDate(documents?.[doc]?.[language], settings)

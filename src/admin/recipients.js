// The extra recipients of an email the admin triggers. The CLIENT always gets it (a fixed address, not editable); the admin can ADD
// more: they get it in blind copy (the client does not see them). Pure helpers, so they can be tested without a page.

export const MAX_EXTRA = 5
const EMAIL = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/

export const isEmail = (text) => EMAIL.test(String(text || '').trim())

// Adds what was typed (one or several addresses separated by comma, semicolon or spaces) to the list.
// -> { list, error } where error is '' | 'invalid' | 'max' (the list is then left as it was) and `bad` is the address that failed.
export function addRecipients(list, typed, clientEmail = '') {
  const parts = String(typed || '').split(/[\s,;]+/).map(item => item.trim().toLowerCase()).filter(Boolean)
  const client = String(clientEmail || '').trim().toLowerCase()
  const next = [...list]
  for (const part of parts) {
    if (!isEmail(part)) return { list, error: 'invalid', bad: part }
    if (part !== client && !next.includes(part)) next.push(part)
  }
  if (next.length > MAX_EXTRA) return { list, error: 'max', bad: '' }
  return { list: next, error: '', bad: '' }
}

// "Se enviará a: ana@x.com (+ copia oculta: pt@x.com, otro@x.com)" -> the two parts, for the confirmation of the action.
export const recipientSummary = (clientEmail, extra) => ({ client: String(clientEmail || ''), hidden: [...extra] })

// What goes in the body of the request.
export const extraBody = (extra) => ({ extra_recipients: [...extra] })

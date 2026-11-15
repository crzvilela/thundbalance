// Turns a legal text (plain text with a few marks) into safe blocks for the page. Pure functions, no React, tested in legalRender.test.js.
//
// The format of a text (the same for the model texts of the code and for what the admin edits):
//   ## Title            a title
//   - item              a list item (consecutive items are one list)
//   any other line      a paragraph (one per line)
//   {{holder}}          a company datum, taken from the company data of the admin (legal_settings)
//   [[REVIEW: ...]]     something the owner must decide or check
// Everything else is plain text: the page shows it as text (React escapes it), so "<script>" is shown, never run.
//
// A line with a datum that is still empty, or with a [[...]] mark, is HIDDEN from the public and shown to the admin with a marker.

export const MODEL_UPDATED = '2026-11-15'
export const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g
export const MARK = /\[\[([^\]]*)\]\]/

// The names the texts may use and what the admin sees when one is empty.
export const FIELD_LABELS = {
  holder: 'razón social / titular', tax_id: 'NIF/CIF', address: 'dirección', email: 'e-mail de contacto', phone: 'teléfono',
  registry: 'Registro Mercantil', dpo_name: 'delegado de protección de datos'
}

/** The values the placeholders take: the company data plus the retention periods (days). Never undefined. */
export function templateData(settings = {}) {
  const data = { brand: 'ThundBalance' }
  for (const key of Object.keys(FIELD_LABELS)) data[key] = String(settings?.[key] || '').trim()
  data.retention_contact = String(settings?.retention_contact_days || '')
  data.retention_trial = String(settings?.retention_trial_days || '')
  data.retention_email_log = String(settings?.retention_email_log_days || '')
  data.last_review = String(settings?.last_review || '')
  return data
}

/** Replaces {{name}}; an empty or unknown datum becomes the mark [[FALTA: name]] (so the line is treated as pending). */
export function fill(text, data) {
  return String(text || '').replace(PLACEHOLDER, (_whole, name) => {
    const value = data[name]
    return value ? value : `[[FALTA: ${FIELD_LABELS[name] || name}]]`
  })
}

/** Splits a line in pieces: { text, mark } so the page can highlight the marks (admin) without ever using HTML. */
export function pieces(line) {
  const out = []
  let rest = String(line)
  for (;;) {
    const match = MARK.exec(rest)
    if (!match) break
    if (match.index > 0) out.push({ text: rest.slice(0, match.index), mark: false })
    out.push({ text: match[1].trim(), mark: true })
    rest = rest.slice(match.index + match[0].length)
  }
  if (rest) out.push({ text: rest, mark: false })
  return out
}

/** The blocks of a text: [{ type: 'h' | 'p' | 'ul', ... }]. `admin`: keep the lines with pending marks (the public never sees them). */
export function blocks(text, settings, { admin = false } = {}) {
  const lines = fill(text, templateData(settings)).replace(/\r\n?/g, '\n').split('\n')
  const out = []
  let list = null
  const closeList = () => { if (list) out.push(list); list = null }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) { closeList(); continue }
    if (MARK.test(line) && !admin) continue                          // pending: the public does not see it
    if (line.startsWith('## ')) {
      closeList()
      out.push({ type: 'h', pieces: pieces(line.slice(3).trim()) })
    } else if (line.startsWith('- ')) {
      list = list || { type: 'ul', items: [] }
      list.items.push(pieces(line.slice(2).trim()))
    } else {
      closeList()
      out.push({ type: 'p', pieces: pieces(line) })
    }
  }
  closeList()
  // a title left alone (everything under it was pending) is not shown
  return out.filter((block, index) => block.type !== 'h' || (out[index + 1] && out[index + 1].type !== 'h'))
}

/** True when the text still has something pending (a mark or an empty datum): what the admin must complete. */
export function pendingMarks(text, settings) {
  return fill(text, templateData(settings)).split('\n').filter(line => MARK.test(line)).length
}

/** The date shown as "last updated": the date of the admin's edit, else the date of the last review, else the one of the model. */
export function updatedDate(override, settings) {
  const date = override?.updated_at || settings?.last_review || MODEL_UPDATED
  return String(date).slice(0, 10)
}

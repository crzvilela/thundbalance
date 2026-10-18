// Splits a plain text into pieces: { text } or { href, text } for every http(s) address.
// Nothing here builds HTML: the page draws each piece as React text or as an <a>, so the text is always
// escaped. Only http and https addresses become links (never javascript:, data: ...).
const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi
const TRAILING = /[.,;:!?)\]}»”’]+$/

export function linkify(text) {
  const value = String(text ?? '')
  const pieces = []
  let last = 0
  for (const match of value.matchAll(URL_PATTERN)) {
    let address = match[0]
    const trimmed = address.match(TRAILING)
    if (trimmed) address = address.slice(0, address.length - trimmed[0].length)
    if (address.length <= 'https://'.length - 1) continue
    if (match.index > last) pieces.push({ text: value.slice(last, match.index) })
    pieces.push({ href: address, text: address })
    last = match.index + address.length
  }
  if (last < value.length) pieces.push({ text: value.slice(last) })
  return pieces
}

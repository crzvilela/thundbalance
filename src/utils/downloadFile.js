// Saves a downloaded answer (a JSON file) on the person's computer. The name comes from the server's Content-Disposition header.

// 'attachment; filename="thundbalance-datos-2026-11-14.json"' -> 'thundbalance-datos-2026-11-14.json' (the fallback when it has none).
export function filenameFrom(header, fallback) {
  const found = /filename="?([^";]+)"?/i.exec(String(header || ''))
  const name = found ? found[1].trim() : ''
  return /^[\w.-]{1,100}$/.test(name) ? name : fallback
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// What the server says went wrong: { code, message } from the answer (JSON), or empty strings.
export async function problemOf(response) {
  const body = await response.json().catch(() => ({}))
  const detail = body?.detail && typeof body.detail === 'object' && !Array.isArray(body.detail) ? body.detail : {}
  return { code: detail.code || '', message: detail.message || (typeof body?.detail === 'string' ? body.detail : '') }
}

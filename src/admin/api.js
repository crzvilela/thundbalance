import { API_URL } from '../config'
import { adminFetch } from '../api/admin'

// Sends a JSON request to an admin endpoint and throws an Error with the
// server's own message (plus the HTTP status) when it fails.
export async function adminRequest(method, path, body) {
  const response = await adminFetch(`${API_URL}${path}`, {
    method,
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  })
  // A gateway timeout or crash can answer with HTML instead of JSON.
  const result = await response.json().catch(() => ({}))
  if (!response.ok || result.error) {
    // detail can be text, a list of validation errors, or an object such as
    // { code: 'conflicts', message, conflicts: [...] } (the pack form lists them).
    const object = result.detail && typeof result.detail === 'object' && !Array.isArray(result.detail) ? result.detail : null
    const detail = typeof result.detail === 'string' ? result.detail
      : object ? object.message || ''
      : Array.isArray(result.detail) ? 'Invalid data' : ''
    const error = new Error(`${detail || result.error || 'Request failed'} (HTTP ${response.status})`)
    if (object) { error.code = object.code; error.conflicts = object.conflicts }
    throw error
  }
  return result
}

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
    const detail = typeof result.detail === 'string' ? result.detail : Array.isArray(result.detail) ? 'Invalid data' : ''
    throw new Error(`${detail || result.error || 'Request failed'} (HTTP ${response.status})`)
  }
  return result
}

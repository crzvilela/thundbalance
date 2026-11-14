import { API_URL } from '../config'
import { authFetch } from './authFetch'
import { filenameFrom, problemOf, saveBlob } from '../utils/downloadFile'

// The client's own data (GET /me/export) and the request to delete the account (/me/deletion-request). The server finds the person
// by the token: no id is ever sent. An address that is not verified is answered with email_not_verified (authFetch shows the
// verification screen).

async function failure(response) {
  const problem = await problemOf(response)
  return Object.assign(new Error(problem.message || 'request failed'), { code: problem.code, status: response.status })
}

// format: 'html' (the readable page, the main download) or 'json' (the technical file)
export async function downloadMyData(format = 'html') {
  const kind = format === 'json' ? 'json' : 'html'
  const response = await authFetch(`${API_URL}/me/export?format=${kind}`)
  if (!response.ok) throw await failure(response)
  const fallback = `thundbalance-datos-${new Date().toISOString().slice(0, 10)}.${kind}`
  saveBlob(await response.blob(), filenameFrom(response.headers.get('Content-Disposition'), fallback))
}

// { status: 'none' | 'pending' | 'completed' | 'rejected', created_at, handled_at, reason }
export async function getDeletionRequest() {
  const response = await authFetch(`${API_URL}/me/deletion-request`)
  if (!response.ok) throw await failure(response)
  return response.json()
}

export async function requestDeletion() {
  const response = await authFetch(`${API_URL}/me/deletion-request`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }),
  })
  if (!response.ok) throw await failure(response)
  return response.json()
}

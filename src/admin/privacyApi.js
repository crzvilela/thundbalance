import { API_URL } from '../config'
import { adminFetch } from '../api/admin'
import { filenameFrom, problemOf, saveBlob } from '../utils/downloadFile'

// The export of ONE client's data (what the client asks for by e-mail): the same JSON the client can download, saved on the admin's
// computer. The server records the export in the audit log (the action and the client's number, no personal data).
export async function downloadClientExport(clientId) {
  const response = await adminFetch(`${API_URL}/admin/clients/${clientId}/export`)
  if (!response.ok) {
    const problem = await problemOf(response)
    throw new Error(problem.message || `Request failed (HTTP ${response.status})`)
  }
  const fallback = `thundbalance-datos-${new Date().toISOString().slice(0, 10)}.json`
  saveBlob(await response.blob(), filenameFrom(response.headers.get('Content-Disposition'), fallback))
}

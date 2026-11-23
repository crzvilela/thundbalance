import { API_URL } from '../config'
import { authFetch } from '../api/authFetch'

// Where to go once somebody has signed in. Everybody goes where they always went (`fallback`), except the administrator, who is taken to the panel
// (where the server says it is: GET /me/roles, which only the administrator is told) or back to the bookmarked page of the panel if they came from one.
// If the server can not be asked, nobody is locked out: they go to `fallback` and the next visit asks again.
export async function destinationAfterLogin(fallback = '/dashboard', returnTo = '') {
  try {
    const response = await authFetch(`${API_URL}/me/roles`)
    if (!response.ok) return fallback
    const roles = await response.json()
    if (roles?.is_admin && typeof roles.admin_path === 'string' && roles.admin_path) {
      const base = `/${roles.admin_path}`
      return returnTo === base || String(returnTo).startsWith(`${base}/`) ? returnTo : base
    }
  } catch { /* fall through */ }
  return fallback
}

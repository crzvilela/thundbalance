import { loadAuthModule } from '../firebase/session'

// A request of the admin panel to the API. The server answers "not found" (the same 404 as for a path that does not exist, {"detail": {"code": "not_found"}})
// to anybody whose login it does not accept as the administrator's: an expired token looks like that too. So when a 404 of that kind arrives during an
// active session the token is renewed (getIdToken(true)) and the request is sent ONCE more; if it is still that 404 the session is over and the person goes
// to the login. A 404 that has its own text ("client not found") is a normal answer of the panel and is never retried. No loops.
export const isGenericNotFound = (status, body) => status === 404 && body?.detail?.code === 'not_found'

let leaving = false

async function sessionLost() {
  if (leaving) return
  leaving = true
  try {
    const { auth, signOut } = await loadAuthModule()
    await signOut(auth)
  } catch { /* the login page is what matters */ }
  try { window.location.assign('/login') } catch { /* not in a browser */ }
}

export async function adminFetch(url, options = {}, renewed = false) {
  const { auth } = await loadAuthModule()          // the SDK is a separate file (firebase/session.js)
  const user = auth.currentUser
  if (!user) throw new Error('Admin login required')

  const token = await user.getIdToken(renewed)
  const headers = new Headers(options.headers || {})
  headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(url, { ...options, headers })
  if (response.status === 404) {
    const body = await response.clone().json().catch(() => null)
    if (isGenericNotFound(response.status, body)) {
      if (!renewed) return adminFetch(url, options, true)
      sessionLost()
    }
  }
  return response
}

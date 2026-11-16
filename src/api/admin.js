import { loadAuthModule } from '../firebase/session'

export async function adminFetch(url, options = {}) {
  const { auth } = await loadAuthModule()          // the SDK is a separate file (firebase/session.js)
  const user = auth.currentUser
  if (!user) throw new Error('Admin login required')

  const token = await user.getIdToken()
  const headers = new Headers(options.headers || {})
  headers.set('Authorization', `Bearer ${token}`)

  return fetch(url, { ...options, headers })
}

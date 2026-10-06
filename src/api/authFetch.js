import { auth } from '../firebase/auth'

// fetch() for the client area: sends the signed-in user's Firebase ID token so
// the server knows whose data is being asked for.
export async function authFetch(url, options = {}) {
  const user = auth.currentUser
  if (!user) throw new Error('Please sign in again.')

  const token = await user.getIdToken()
  const headers = new Headers(options.headers || {})
  headers.set('Authorization', `Bearer ${token}`)

  return fetch(url, { ...options, headers })
}

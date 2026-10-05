import { auth } from '../firebase/auth'

export async function adminFetch(url, options = {}) {
  const user = auth.currentUser
  if (!user) throw new Error('Admin login required')

  const token = await user.getIdToken()
  const headers = new Headers(options.headers || {})
  headers.set('Authorization', `Bearer ${token}`)

  return fetch(url, { ...options, headers })
}
